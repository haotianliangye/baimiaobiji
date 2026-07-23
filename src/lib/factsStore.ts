/**
 * factsStore — Issue P1-004 (ADR-0004)
 *
 * 长期记忆 facts 表的 CRUD 封装。详见 docs/adr/0004-facts-table.md。
 *
 * 设计：
 *   - 复用 P0 #004 沉淀的 dexie 模式，存储在 db.facts 表（v17 schema）
 *   - UPSERT by key：同 key 二次 add 是覆盖，不是新建（用户改生日时）
 *   - 7 个 CRUD 函数 + 1 个 count
 *   - 不引 localStorage/sessionStorage（保持后端 + 离线性质）
 *   - 不缓存到内存（每次重新读 IDB，简单优先）
 *
 * 调用模式（P1-004 范围 = 基础设施，0 调用方）：
 *   - P1-004 follow-up 会加 UI（Settings → Facts tab）
 *   - P2 会接 Copilot prompt 自动注入
 *
 * 不做（留 follow-up）：
 *   - 自动备份（autoBackup.ts 显式排除）
 *   - AI 自动抽取
 *   - 跨设备同步
 */

import { db, type Fact } from '../db/db';

export type FactCategory = 'user' | 'preference' | 'event' | 'context';
export type FactSource = 'manual' | 'extracted';

export interface FactInput {
  key: string;
  value: string;
  category: FactCategory;
  confidence?: number;
  source?: FactSource;
}

export interface ListOptions {
  category?: FactCategory;
  limit?: number;
  offset?: number;
}

function uuid(): string {
  return 'f-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/**
 * 加一个 fact。同 key 已存在则覆盖（UPSERT）。
 * 返回最终存入的 Fact（含 id 和时间戳）。
 */
export async function addFact(input: FactInput): Promise<Fact> {
  const now = Date.now();
  const existing = await db.facts.where('key').equals(input.key).first();
  if (existing) {
    const updated: Fact = {
      ...existing,
      value: input.value,
      category: input.category,
      confidence: input.confidence ?? existing.confidence,
      source: input.source ?? existing.source,
      updated_at: now,
    };
    await db.facts.put(updated);
    return updated;
  }
  const fact: Fact = {
    id: uuid(),
    key: input.key,
    value: input.value,
    category: input.category,
    confidence: input.confidence ?? 1.0,
    source: input.source ?? 'manual',
    created_at: now,
    updated_at: now,
  };
  await db.facts.put(fact);
  return fact;
}

/**
 * 按 id 拿一个 fact。不存在返回 undefined。
 */
export async function getFact(id: string): Promise<Fact | undefined> {
  return db.facts.get(id);
}

/**
 * 按 key 拿一个 fact（key 是唯一业务键）。不存在返回 undefined。
 */
export async function getFactByKey(key: string): Promise<Fact | undefined> {
  return db.facts.where('key').equals(key).first();
}

/**
 * 列出 facts。支持 category 过滤和 limit/offset 分页。
 * 按 created_at 倒序（新 → 旧）。
 */
export async function listFacts(opts: ListOptions = {}): Promise<Fact[]> {
  let q: any = db.facts.orderBy('created_at').reverse();
  if (opts.category) {
    q = db.facts.where('category').equals(opts.category).reverse();
  }
  let arr = await q.toArray();
  if (opts.offset) arr = arr.slice(opts.offset);
  if (opts.limit) arr = arr.slice(0, opts.limit);
  return arr;
}

/**
 * 模糊搜索 facts。在 key 和 value 字段做大小写不敏感子串匹配。
 * 返回按 created_at 倒序。
 */
export async function searchFacts(query: string): Promise<Fact[]> {
  const q = query.toLowerCase();
  return db.facts
    .filter((f: Fact) =>
      f.key.toLowerCase().includes(q) || f.value.toLowerCase().includes(q)
    )
    .reverse()
    .sortBy('created_at');
}

/**
 * 按 id 部分更新 fact。只更新 patch 里有的字段。
 * updated_at 自动刷新。
 */
export async function updateFact(id: string, patch: Partial<FactInput>): Promise<Fact | undefined> {
  const existing = await db.facts.get(id);
  if (!existing) return undefined;
  const updated: Fact = {
    ...existing,
    ...patch,
    updated_at: Date.now(),
  };
  await db.facts.put(updated);
  return updated;
}

/**
 * 按 id 删除 fact。返回是否真的删了一条。
 * 注：dexie 的 Table.delete() 在新版本返回 void（之前返回删除条数）。
 * 这里用 get + delete 模式：先 get 确认存在，再 delete。
 */
export async function deleteFact(id: string): Promise<boolean> {
  const existing = await db.facts.get(id);
  if (!existing) return false;
  await db.facts.delete(id);
  return true;
}

/**
 * 计数。
 */
export async function countFacts(): Promise<number> {
  return db.facts.count();
}