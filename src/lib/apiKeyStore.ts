/**
 * apiKeyStore — Issue P1-003 (ADR-0003)
 *
 * 把 3 组 API Key（LLM / embedding / TTS）从 zustand persist (localStorage)
 * 抽离到 IndexedDB。详见 docs/adr/0003-api-key-isolation.md。
 *
 * 设计：
 *   - 复用 P0 #004 沉淀的 `db.settings_kv` 表（key-value）
 *   - 专用 key 前缀 `api_key.`，避免和其他 settings 冲突
 *   - 3 个独立 type：'llm' | 'embed' | 'tts'
 *   - 存的值是 `{ key: string }` 对象而非裸 string（与 settings_kv 其他 value 形状一致）
 *   - 删除 = put 空字符串（保持单条记录，便于追踪"曾有 key"）
 *
 * 调用模式：
 *   - UI 显示仍用 zustand state（同步，不抖）
 *   - 写：setApiKey(type, value) → 双写到 IndexedDB + 调 store.setApiKeyField()
 *   - 读（call site async）：await loadApiKey(type) → 拿到真值，传给 API
 *
 * 不做：
 *   - 不引 Web Crypto 加密（路径 B 留给 P2）
 *   - 不在 zustand state 里做镜像（让 UI 调 store.setApiKeyField 同步）
 *   - 不缓存到内存（每次重新读 IDB，简单优先）
 */

import { db } from '../db/db';

export type ApiKeyType = 'llm' | 'embed' | 'tts';

const KEY_PREFIX = 'api_key.';

function keyFor(type: ApiKeyType): string {
  return KEY_PREFIX + type;
}

export interface ApiKeyRow {
  key: ApiKeyType;
  value: string;
}

/**
 * 读某 type 的 API key。无则返回空字符串（而非 null/undefined，便于调用方判断）。
 */
export async function loadApiKey(type: ApiKeyType): Promise<string> {
  const row = await db.settings_kv.get(keyFor(type));
  if (!row) return '';
  const v = (row.value as any)?.key;
  return typeof v === 'string' ? v : '';
}

/**
 * 写某 type 的 API key。空字符串视为删除（与 deleteApiKey 等价）。
 */
export async function setApiKey(type: ApiKeyType, value: string): Promise<void> {
  if (!value) {
    await deleteApiKey(type);
    return;
  }
  await db.settings_kv.put({
    key: keyFor(type),
    value: { key: value },
    updated_at: Date.now(),
  });
}

/**
 * 删除某 type 的 API key。
 */
export async function deleteApiKey(type: ApiKeyType): Promise<void> {
  await db.settings_kv.delete(keyFor(type));
}

/**
 * 检查某 type 是否有 key（用于 UI 显示"已配置" / "未配置" 状态）。
 */
export async function hasApiKey(type: ApiKeyType): Promise<boolean> {
  const k = await loadApiKey(type);
  return k.length > 0;
}

/**
 * 列出所有 3 组 key 的当前状态（用于 Settings UI 总览）。
 */
export async function listAllApiKeys(): Promise<Record<ApiKeyType, string>> {
  const [llm, embed, tts] = await Promise.all([
    loadApiKey('llm'),
    loadApiKey('embed'),
    loadApiKey('tts'),
  ]);
  return { llm, embed, tts };
}