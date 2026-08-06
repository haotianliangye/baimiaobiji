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
 *   - provider-scoped schema：每个 (type, provider) 一条独立记录
 *       api_key.llm.gemini / api_key.llm.openai / ... / api_key.embed.gemini / api_key.tts.volcengine
 *   - 存的值是 `{ key: string, updated_at: number }` 对象（与 settings_kv 其他 value 形状一致）
 *   - 删除 = `db.settings_kv.delete(...)`（物理删除该 (type, provider) 行）
 *
 * 调用模式：
 *   - UI 显示仍用 zustand state 镜像（同步不抖，初始 bootstrap 由 settings.store.onRehydrateStorage 触发）
 *   - 写：setApiKey(type, provider, value) → IndexedDB；UI 同步写 state 镜像
 *   - 读（call site async）：await loadApiKey(type, provider) → 拿到真值，传给 API
 *
 * 不做：
 *   - 不引 Web Crypto 加密（路径 B 留给 P2）
 *   - 不在 zustand state 里做长期镜像（仅 active provider 在 settings.store.apiKey 镜像，UI 用）
 *   - 不缓存到内存（每次重新读 IDB，简单优先）
 */

import { db } from '../db/db';

export type ApiKeyType = 'llm' | 'embed' | 'tts';

const KEY_PREFIX = 'api_key.';

function keyFor(type: ApiKeyType, provider: string): string {
  return `${KEY_PREFIX}${type}.${provider}`;
}

export interface ApiKeyRow {
  type: ApiKeyType;
  provider: string;
  key: string;
  updated_at: number;
}

/**
 * 读某 (type, provider) 的 API key。无则返回空字符串（而非 null/undefined，便于调用方判断）。
 */
export async function loadApiKey(type: ApiKeyType, provider: string): Promise<string> {
  const row = await db.settings_kv.get(keyFor(type, provider));
  if (!row) return '';
  const v = (row.value as any)?.key;
  return typeof v === 'string' ? v : '';
}

/**
 * 写某 (type, provider) 的 API key。空字符串视为删除（与 deleteApiKey 等价）。
 */
export async function setApiKey(type: ApiKeyType, provider: string, value: string): Promise<void> {
  if (!value) {
    await deleteApiKey(type, provider);
    return;
  }
  await db.settings_kv.put({
    key: keyFor(type, provider),
    value: { key: value },
    updated_at: Date.now(),
  });
}

/**
 * 删除某 (type, provider) 的 API key。
 */
export async function deleteApiKey(type: ApiKeyType, provider: string): Promise<void> {
  await db.settings_kv.delete(keyFor(type, provider));
}

/**
 * 检查某 (type, provider) 是否有 key（用于 UI 显示"已配置" / "未配置" 状态）。
 */
export async function hasApiKey(type: ApiKeyType, provider: string): Promise<boolean> {
  const k = await loadApiKey(type, provider);
  return k.length > 0;
}

/**
 * 列出所有 api_key.* 槽位（用于 Settings UI 总览 / 启动时 bootstrap 到 state 镜像）。
 */
export async function listAllApiKeys(): Promise<ApiKeyRow[]> {
  const rows = await db.settings_kv
    .where('key')
    .startsWith(KEY_PREFIX)
    .toArray();
  const result: ApiKeyRow[] = [];
  for (const row of rows) {
    const m = row.key.match(/^api_key\.(llm|embed|tts)\.([^.]+)$/);
    if (!m) continue;
    const type = m[1] as ApiKeyType;
    const provider = m[2];
    const v = (row.value as any)?.key;
    if (typeof v !== 'string') continue;
    result.push({ type, provider, key: v, updated_at: (row.value as any)?.updated_at ?? (row as any).updated_at ?? 0 });
  }
  return result;
}
