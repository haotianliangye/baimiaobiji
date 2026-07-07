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
  force?: boolean; // true when content changed and the embedding must be regenerated even if version matches
}

function getQueue(): EmbeddingTask[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

let onQueueChangeCallback: ((size: number) => void) | null = null;

export function registerQueueChangeListener(cb: (size: number) => void) {
  onQueueChangeCallback = cb;
  try {
    cb(getQueue().length);
  } catch {}
}

function saveQueue(queue: EmbeddingTask[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  if (onQueueChangeCallback) {
    try {
      onQueueChangeCallback(queue.length);
    } catch {}
  }
}

// Removes a task by id+type, re-reading the queue first so enqueues that happen
// during a long embedding API call (e.g. from Dexie hooks) are not overwritten.
function removeTask(task: EmbeddingTask) {
  const queue = getQueue();
  const idx = queue.findIndex(t => t.id === task.id && t.type === task.type);
  if (idx !== -1) queue.splice(idx, 1);
  saveQueue(queue);
}

export function enqueueEmbeddingTask(id: string, type: 'record' | 'diary' | 'review', force = false) {
  const queue = getQueue();
  const existing = queue.find(t => t.id === id && t.type === type);
  if (existing) {
    // A content edit requires re-embedding even if the task is already queued
    if (force && !existing.force) {
      existing.force = true;
      saveQueue(queue);
    }
    return;
  }
  queue.push({ id, type, retryCount: 0, force });
  saveQueue(queue);
}

// Mutex: ensures only one processing loop runs at a time. Dexie hooks, the
// online listener, the init timer and the settings subscriber can all trigger
// processEmbeddingQueue concurrently; without this guard they spawn parallel
// loops that duplicate API calls and clobber each other's queue writes.
let isProcessing = false;

export async function processEmbeddingQueue(
  onProgress?: (remaining: number) => void
): Promise<void> {
  const settings = useSettingsStore.getState();
  if (!settings.embedEnabled) return;
  if (!navigator.onLine) return;
  if (isProcessing) return;

  isProcessing = true;
  const versionTag = getEmbedVersionTag();
  try {
    while (true) {
      const currentQueue = getQueue();
      if (currentQueue.length === 0) break;
      if (!navigator.onLine) break;

      const task = currentQueue[0];
      try {
        let text = '';

        if (task.type === 'record') {
          const log = await db.raw_logs.get(task.id);
          if (!log) { removeTask(task); continue; }
          // Skip if already embedded with same model version AND no content change forced it
          if (log.embedding && log.embedding.length > 0 && log.embedding_version === versionTag && !task.force) {
            removeTask(task); continue;
          }
          text = log.content;
        } else if (task.type === 'diary') {
          const diary = await db.daily_diaries.get(task.id);
          if (!diary) { removeTask(task); continue; }
          if (diary.embedding && diary.embedding.length > 0 && diary.embedding_version === versionTag && !task.force) {
            removeTask(task); continue;
          }
          text = diary.ai_editorial || '';
        } else if (task.type === 'review') {
          const review = await db.daily_reviews.get(task.id);
          if (!review) { removeTask(task); continue; }
          if (review.embedding && review.embedding.length > 0 && review.embedding_version === versionTag && !task.force) {
            removeTask(task); continue;
          }
          text = review.ai_review || '';
        }

        if (!text.trim()) {
          removeTask(task);
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

        // Remove from queue on success (re-read queue to avoid clobbering concurrent enqueues)
        removeTask(task);
        onProgress?.(getQueue().length);
      } catch (err) {
        console.error(`[Embedding Queue] Failed to process ${task.type}:${task.id}`, err);
        // Exponential backoff: remove this task, re-enqueue at back with incremented retry
        const queue = getQueue();
        const idx = queue.findIndex(t => t.id === task.id && t.type === task.type);
        if (idx !== -1) queue.splice(idx, 1);
        if (task.retryCount < 5) {
          queue.push({ ...task, retryCount: task.retryCount + 1 });
        }
        saveQueue(queue);
        // Wait before retrying (exponential: 2^retry * 1000ms)
        const delay = Math.min(Math.pow(2, task.retryCount) * 1000, 30000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  } finally {
    isProcessing = false;
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
      enqueueEmbeddingTask(obj.id, 'record', true);
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
      enqueueEmbeddingTask(obj.id, 'diary', true);
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
      enqueueEmbeddingTask(obj.id, 'review', true);
      processEmbeddingQueue();
    }
  });
});

// --- Enqueue all items missing embeddings (for historical data backfilling) ---
export async function enqueueAllMissingEmbeddings(): Promise<number> {
  const versionTag = getEmbedVersionTag();
  const queue = getQueue();
  const queueSet = new Set(queue.map(t => `${t.type}:${t.id}`));
  let addedCount = 0;

  // 1. Records
  const logs = await db.raw_logs.toArray();
  for (const log of logs) {
    if ((!log.embedding || log.embedding.length === 0 || log.embedding_version !== versionTag) && log.content.trim()) {
      const key = `record:${log.id}`;
      if (!queueSet.has(key)) {
        queue.push({ id: log.id, type: 'record', retryCount: 0 });
        queueSet.add(key);
        addedCount++;
      }
    }
  }

  // 2. Diaries
  const diaries = await db.daily_diaries.toArray();
  for (const d of diaries) {
    if ((!d.embedding || d.embedding.length === 0 || d.embedding_version !== versionTag) && d.ai_editorial.trim()) {
      const key = `diary:${d.id}`;
      if (!queueSet.has(key)) {
        queue.push({ id: d.id, type: 'diary', retryCount: 0 });
        queueSet.add(key);
        addedCount++;
      }
    }
  }

  // 3. Reviews
  const reviews = await db.daily_reviews.toArray();
  for (const r of reviews) {
    if ((!r.embedding || r.embedding.length === 0 || r.embedding_version !== versionTag) && r.ai_review.trim()) {
      const key = `review:${r.id}`;
      if (!queueSet.has(key)) {
        queue.push({ id: r.id, type: 'review', retryCount: 0 });
        queueSet.add(key);
        addedCount++;
      }
    }
  }

  if (addedCount > 0) {
    saveQueue(queue);
    // Trigger queue processing
    processEmbeddingQueue();
  }
  return addedCount;
}

// --- Subscribe to Settings store to run queue when enabled ---
let prevEmbedEnabled = useSettingsStore.getState().embedEnabled;
useSettingsStore.subscribe((state) => {
  if (state.embedEnabled && !prevEmbedEnabled) {
    console.log('[Embedding Queue] Embedding enabled, scanning and backfilling queue...');
    enqueueAllMissingEmbeddings().then((added) => {
      console.log(`[Embedding Queue] Enqueued ${added} missing historical items.`);
    });
  }
  prevEmbedEnabled = state.embedEnabled;
});

