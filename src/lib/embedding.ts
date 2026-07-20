import { db, type TextChunk } from '../db/db';
import { chunkText } from './chunking';
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
  type: EntityType;
  retryCount: number;
  force?: boolean; // true when content changed and the embedding must be regenerated even if version matches
}

// Single source of truth for the four embeddable entity types. Drives the
// queue processor, the backfill scan and the Dexie hooks so none of them
// repeat the record/diary/review/insight cascade. `table` is typed loosely
// because Dexie's Table<T,K> differs per entity and we only call get/update/toArray/hook.
//
// V2: daily_diaries 已合并进 daily_reviews。diary 与 review 共享 daily_reviews 表，
// 靠 `matches`（按 entry_type 过滤）确保每个 hook 只处理自己那一类行，避免日记行
// 的 legacy `ai_review` 被 review hook 重复 embedding 并覆盖 `ai_editorial` 向量。
// 队列 key 仍用 type 前缀，两类记录 id 不冲突。
type EntityType = 'record' | 'diary' | 'review' | 'insight' | 'thought' | 'multimedia';
const ENTITY_CONFIG: Record<EntityType, {
  table: any;
  textField: 'content' | 'ai_editorial' | 'ai_review' | 'attachment_summary';
  embedField?: string;       // 向量存储字段名（默认 'embedding'）
  versionField?: string;     // 版本标记字段名（默认 'embedding_version'）
  matches?: (obj: any) => boolean;
  sourceType: string;        // #14 chunks 表的 source_type（源表名）
}> = {
  record: { table: db.raw_logs, textField: 'content', sourceType: 'raw_logs' },
  diary: { table: db.daily_reviews, textField: 'ai_editorial', matches: (o) => o.entry_type === 'diary', sourceType: 'daily_reviews' },
  review: { table: db.daily_reviews, textField: 'ai_review', matches: (o) => o.entry_type === 'review', sourceType: 'daily_reviews' },
  insight: { table: db.insights, textField: 'content', sourceType: 'insights' },
  thought: { table: db.thoughts, textField: 'content', sourceType: 'thoughts' },
  // #6 多媒体摘要：对 raw_logs 的 attachment_summary 字段做 embedding，写入独立的
  // attachment_embedding 字段（避免与 content 的 embedding 互相覆盖）。
  // matches 过滤只对有摘要的记录入队，避免与 record 的 content 钩子重复处理无摘要记录。
  // #14 sourceType 仍为 'raw_logs'，靠 field='attachment_summary' 与 content 分块区分。
  multimedia: {
    table: db.raw_logs,
    textField: 'attachment_summary',
    embedField: 'attachment_embedding',
    versionField: 'attachment_embedding_version',
    matches: (o) => !!(o.attachment_summary && String(o.attachment_summary).trim()),
    sourceType: 'raw_logs',
  },
};

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

export function enqueueEmbeddingTask(id: string, type: EntityType, force = false) {
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

// --- #14 统一分块 pipeline 辅助函数 ---

/**
 * 清洗文本：归一换行、折叠连续空白、压缩多余空行。不删减正文内容，
 * 只做对 embedding 友好的规范化。是 pipeline 的第一步（清洗 -> 分块 -> Embedding -> 存储）。
 */
function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 从源记录提取分块元数据（created_at + tags）。daily_reviews 没有 created_at 字段，
 * 用 updated_at 作为分块时间戳；其余表读 created_at，缺失则回退当前时间。
 */
function extractChunkMeta(type: EntityType, record: any): { created_at: number; tags: string[] } {
  const tags: string[] = Array.isArray(record.tags) ? record.tags : [];
  if (type === 'diary' || type === 'review') {
    return { created_at: typeof record.updated_at === 'number' ? record.updated_at : Date.now(), tags };
  }
  return { created_at: typeof record.created_at === 'number' ? record.created_at : Date.now(), tags };
}

/**
 * 删除某源记录某字段的全部分块（重建前清理旧分块）。
 * 优先用 [source_type+source_id+field] 复合索引；不可用时回退到 source_id 过滤。
 * record 与 multimedia 共享 source_type='raw_logs' 与同一 source_id，靠 field 区分，
 * 故删除必须带 field，避免互相清掉对方的分块。
 */
async function deleteChunksBySource(sourceType: string, sourceId: string, field: string): Promise<void> {
  try {
    await db.chunks
      .where('[source_type+source_id+field]')
      .equals([sourceType, sourceId, field])
      .delete();
  } catch {
    await db.chunks
      .where('source_id')
      .equals(sourceId)
      .filter((c) => c.source_type === sourceType && c.field === field)
      .delete();
  }
}

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
        const { table, textField, embedField, versionField, sourceType } = ENTITY_CONFIG[task.type];
        const eField = embedField || 'embedding';
        const vField = versionField || 'embedding_version';
        const record = await table.get(task.id);
        if (!record) { removeTask(task); continue; }
        // Skip if already embedded with same model version AND no content change forced it
        if (record[eField] && record[eField].length > 0 && record[vField] === versionTag && !task.force) {
          removeTask(task); continue;
        }
        const rawText: string = record[textField] || '';

        if (!rawText.trim()) {
          removeTask(task);
          continue;
        }

        // 统一 pipeline：清洗 -> 分块 -> Embedding -> 存储
        const cleaned = cleanText(rawText);
        const slices = chunkText(cleaned);
        if (slices.length === 0) {
          removeTask(task);
          continue;
        }

        // 逐块生成向量（短文本只有 1 块，行为与重构前一致）
        const embeddings: number[][] = [];
        for (const slice of slices) {
          const emb = await requestEmbedding(slice.text);
          embeddings.push(emb);
        }

        // 写入 chunks 表：先删旧分块，再写新分块（确定性 id，bulkPut 覆盖）
        const meta = extractChunkMeta(task.type, record);
        await deleteChunksBySource(sourceType, task.id, textField);
        const chunkRows: TextChunk[] = slices.map((slice, i) => ({
          id: `${sourceType}:${task.id}:${textField}:${i}`,
          source_type: sourceType,
          source_id: task.id,
          field: textField,
          chunk_index: i,
          text: slice.text,
          embedding: embeddings[i],
          embedding_version: versionTag,
          created_at: meta.created_at,
          tags: meta.tags,
        }));
        if (chunkRows.length > 0) {
          await db.chunks.bulkPut(chunkRows);
        }

        // 向后兼容：inline embedding 字段写入首块向量。现有检索（copilotRetrieval /
        // app.store 语义搜索、Settings 向量导出）仍读 .embedding，行为不变。
        // 短文本首块即全文，等价于重构前；长文本首块是原文第一段，检索仍可命中。
        await table.update(task.id, { [eField]: embeddings[0], [vField]: versionTag });

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
// One factory registers creating + updating hooks for a single entity type,
// avoiding 6 near-identical hook blocks. `textField` is the column whose
// mutation signals a content change requiring re-embedding.
function registerEntityHooks(type: EntityType, textField: 'content' | 'ai_editorial' | 'ai_review' | 'attachment_summary') {
  const { table, matches, embedField } = ENTITY_CONFIG[type];
  const eField = embedField || 'embedding';
  table.hook('creating', (_primKey, obj, transaction) => {
    transaction.on('complete', () => {
      if (matches && !matches(obj)) return; // 合并表：仅处理本 entry_type 的行
      const settings = useSettingsStore.getState();
      if (settings.embedEnabled && (!obj[eField] || obj[eField].length === 0)) {
        enqueueEmbeddingTask(obj.id, type);
        processEmbeddingQueue();
      }
    });
  });
  table.hook('updating', (mods, primKey, obj, transaction) => {
    transaction?.on('complete', () => {
      // 用 pre-mod 记录 + mods 合并后判定：diary/review 的 entry_type 不变（pre-mod 即可），
      // 多媒体摘要可能在 update 中首次设置（merged 才能拿到新值）。
      const merged = { ...obj, ...mods };
      if (matches && !matches(merged)) return;
      const settings = useSettingsStore.getState();
      if (settings.embedEnabled && textField in mods) {
        enqueueEmbeddingTask(primKey, type, true);
        processEmbeddingQueue();
      }
      // #6 tags 变更：轻量同步 chunks 表的 tags 元数据（不重新生成向量），
      // 避免未来启用分块级标签过滤时 chunks.tags 与记录不一致。
      // 用 source_id 过滤（primKey 是 UUID，跨表碰撞概率可忽略）。
      if ('tags' in mods) {
        const newTags = Array.isArray(mods.tags) ? mods.tags : (obj.tags || []);
        db.chunks.where('source_id').equals(primKey).modify((c) => { c.tags = newTags; }).catch(() => {});
      }
    });
  });
}

(Object.keys(ENTITY_CONFIG) as EntityType[]).forEach((type) => {
  registerEntityHooks(type, ENTITY_CONFIG[type].textField);
});

// --- Enqueue all items missing embeddings (for historical data backfilling) ---
export async function enqueueAllMissingEmbeddings(): Promise<number> {
  const versionTag = getEmbedVersionTag();
  const queue = getQueue();
  const queueSet = new Set(queue.map(t => `${t.type}:${t.id}`));
  let addedCount = 0;

  for (const type of Object.keys(ENTITY_CONFIG) as EntityType[]) {
    const { table, textField, matches, embedField, versionField } = ENTITY_CONFIG[type];
    const eField = embedField || 'embedding';
    const vField = versionField || 'embedding_version';
    let rows = await table.toArray();
    if (matches) rows = rows.filter(matches); // 合并表：仅扫描本 entry_type 的行
    for (const row of rows) {
      const text: string = row[textField] || '';
      if (!text.trim()) continue;
      if (row[eField] && row[eField].length > 0 && row[vField] === versionTag) continue;
      const key = `${type}:${row.id}`;
      if (!queueSet.has(key)) {
        queue.push({ id: row.id, type, retryCount: 0 });
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

