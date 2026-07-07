import { db } from '../db/db';
import { useSettingsStore, DEFAULT_EMBED_PROVIDER_CONFIGS } from '../store/settings.store';

// --- Cosine Similarity ---
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

// --- Embedding Settings Helper ---
export interface EmbedSettings {
  provider: string;
  apiKey: string;
  baseUrl: string;
  embeddingModel: string;
}

export function getEmbedSettings(): EmbedSettings {
  const s = useSettingsStore.getState();
  const defConfig = DEFAULT_EMBED_PROVIDER_CONFIGS[s.embedProvider] || DEFAULT_EMBED_PROVIDER_CONFIGS['gemini'];
  return {
    provider: s.embedProvider,
    apiKey: s.embedApiKey || s.apiKey, // fallback to Chat apiKey if embed apiKey is empty
    baseUrl: s.embedBaseUrl || defConfig.baseUrl,
    embeddingModel: s.embedModel || defConfig.model,
  };
}

export function getEmbedVersionTag(): string {
  const s = getEmbedSettings();
  return `${s.provider}:${s.embeddingModel}`;
}

// --- API Call ---
export async function requestEmbedding(text: string): Promise<number[]> {
  const settings = getEmbedSettings();
  const res = await fetch('/api/generate-embedding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, settings }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Network error' }));
    throw new Error(err.error || `Embedding request failed: ${res.status}`);
  }
  const data = await res.json();
  return data.embedding || [];
}

// --- Persistent Queue (LocalStorage) ---
const QUEUE_KEY = 'baimiao_pending_embeddings';

export interface EmbeddingTask {
  id: string;
  type: 'record' | 'diary' | 'review';
  retryCount: number;
}

function getQueue(): EmbeddingTask[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveQueue(queue: EmbeddingTask[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function enqueueEmbeddingTask(id: string, type: 'record' | 'diary' | 'review') {
  const queue = getQueue();
  // Avoid duplicates
  if (queue.some(t => t.id === id && t.type === type)) return;
  queue.push({ id, type, retryCount: 0 });
  saveQueue(queue);
}

export async function processEmbeddingQueue(
  onProgress?: (remaining: number) => void
): Promise<void> {
  const settings = useSettingsStore.getState();
  if (!settings.embedEnabled) return;
  if (!navigator.onLine) return;

  const queue = getQueue();
  if (queue.length === 0) return;

  const versionTag = getEmbedVersionTag();
  let processed = 0;

  while (true) {
    const currentQueue = getQueue();
    if (currentQueue.length === 0) break;
    if (!navigator.onLine) break;

    const task = currentQueue[0];
    try {
      let text = '';

      if (task.type === 'record') {
        const log = await db.raw_logs.get(task.id);
        if (!log) { currentQueue.shift(); saveQueue(currentQueue); continue; }
        // Skip if already embedded with same model version
        if (log.embedding && log.embedding.length > 0 && log.embedding_version === versionTag) {
          currentQueue.shift(); saveQueue(currentQueue); continue;
        }
        text = log.content;
      } else if (task.type === 'diary') {
        const diary = await db.daily_diaries.get(task.id);
        if (!diary) { currentQueue.shift(); saveQueue(currentQueue); continue; }
        if (diary.embedding && diary.embedding.length > 0 && diary.embedding_version === versionTag) {
          currentQueue.shift(); saveQueue(currentQueue); continue;
        }
        text = diary.ai_editorial || '';
      } else if (task.type === 'review') {
        const review = await db.daily_reviews.get(task.id);
        if (!review) { currentQueue.shift(); saveQueue(currentQueue); continue; }
        if (review.embedding && review.embedding.length > 0 && review.embedding_version === versionTag) {
          currentQueue.shift(); saveQueue(currentQueue); continue;
        }
        text = review.ai_review || '';
      }

      if (!text.trim()) {
        currentQueue.shift();
        saveQueue(currentQueue);
        continue;
      }

      const embedding = await requestEmbedding(text);

      // Write back to IndexedDB
      if (task.type === 'record') {
        await db.raw_logs.update(task.id, { embedding, embedding_version: versionTag });
      } else if (task.type === 'diary') {
        await db.daily_diaries.update(task.id, { embedding, embedding_version: versionTag });
      } else if (task.type === 'review') {
        await db.daily_reviews.update(task.id, { embedding, embedding_version: versionTag });
      }

      // Remove from queue on success
      currentQueue.shift();
      saveQueue(currentQueue);
      processed++;
      onProgress?.(currentQueue.length);
    } catch (err) {
      console.error(`[Embedding Queue] Failed to process ${task.type}:${task.id}`, err);
      // Exponential backoff: move to back with incremented retry
      currentQueue.shift();
      if (task.retryCount < 5) {
        currentQueue.push({ ...task, retryCount: task.retryCount + 1 });
      }
      saveQueue(currentQueue);
      // Wait before retrying (exponential: 2^retry * 1000ms)
      const delay = Math.min(Math.pow(2, task.retryCount) * 1000, 30000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// --- Online listener for auto-resume ---
let listenerRegistered = false;

export function initEmbeddingQueueListener() {
  if (listenerRegistered) return;
  listenerRegistered = true;

  window.addEventListener('online', () => {
    console.log('[Embedding Queue] Network restored, resuming queue...');
    processEmbeddingQueue();
  });

  // Also process on init if online
  if (navigator.onLine) {
    // Delay slightly to let app fully initialize
    setTimeout(() => processEmbeddingQueue(), 3000);
  }
}

// --- Dexie hooks for automatic queueing ---
db.raw_logs.hook('creating', (primKey, obj, transaction) => {
  transaction.on('complete', () => {
    const settings = useSettingsStore.getState();
    if (settings.embedEnabled && (!obj.embedding || obj.embedding.length === 0)) {
      enqueueEmbeddingTask(obj.id, 'record');
      processEmbeddingQueue();
    }
  });
});

db.raw_logs.hook('updating', (mods, primKey, obj, transaction) => {
  transaction.on('complete', () => {
    const settings = useSettingsStore.getState();
    if (settings.embedEnabled && 'content' in mods) {
      enqueueEmbeddingTask(obj.id, 'record');
      processEmbeddingQueue();
    }
  });
});

db.daily_diaries.hook('creating', (primKey, obj, transaction) => {
  transaction.on('complete', () => {
    const settings = useSettingsStore.getState();
    if (settings.embedEnabled && (!obj.embedding || obj.embedding.length === 0)) {
      enqueueEmbeddingTask(obj.id, 'diary');
      processEmbeddingQueue();
    }
  });
});

db.daily_diaries.hook('updating', (mods, primKey, obj, transaction) => {
  transaction.on('complete', () => {
    const settings = useSettingsStore.getState();
    if (settings.embedEnabled && 'ai_editorial' in mods) {
      enqueueEmbeddingTask(obj.id, 'diary');
      processEmbeddingQueue();
    }
  });
});

db.daily_reviews.hook('creating', (primKey, obj, transaction) => {
  transaction.on('complete', () => {
    const settings = useSettingsStore.getState();
    if (settings.embedEnabled && (!obj.embedding || obj.embedding.length === 0)) {
      enqueueEmbeddingTask(obj.id, 'review');
      processEmbeddingQueue();
    }
  });
});

db.daily_reviews.hook('updating', (mods, primKey, obj, transaction) => {
  transaction.on('complete', () => {
    const settings = useSettingsStore.getState();
    if (settings.embedEnabled && 'ai_review' in mods) {
      enqueueEmbeddingTask(obj.id, 'review');
      processEmbeddingQueue();
    }
  });
});

// --- Subscribe to Settings store to run queue when enabled ---
let prevEmbedEnabled = useSettingsStore.getState().embedEnabled;
useSettingsStore.subscribe((state) => {
  if (state.embedEnabled && !prevEmbedEnabled) {
    console.log('[Embedding Queue] Embedding enabled, starting queue...');
    processEmbeddingQueue();
  }
  prevEmbedEnabled = state.embedEnabled;
});

