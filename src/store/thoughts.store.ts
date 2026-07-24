/**
 * #7 沉淀（Thoughts）笔记模块 -- Zustand store。
 *
 * 数据单元 Thought：content_doc（RichDocument，正文唯一真源）+ 标签数组(tags) +
 * 兼容 attachments 数组(AttachmentMeta[]，仅用于读取/回填旧版消费方) +
 * created_at(可被用户修改的展示时间) + original_created_at(首次创建时间，用于溯源)。
 *
 * 公开 API 变化（Issue #15 第三切片）：
 *   - 公开输入支持 content_doc: RichDocument；保留 content?: string / attachments? 仅作兼容输入。
 *   - 新建/更新优先 content_doc；标签从 documentToText 派生。
 *   - 文档作为正文唯一真源；不再把 content_doc JSON.stringify 成字符串。
 *   - 删除时通过 collectReferencedAttachmentIds + filterAttachmentIdsToDelete 引用感知清理
 *     db.attachments Blob：仅删该 thought 引用过、且全库其它 thought 也不引用的孤儿。
 *   - 历史 attachments 数组（kind/link 等）的兼容清理也保留。
 *
 * 公开纯函数 seam（供测试 + 复用）：
 *   - createThoughtParamsToRow(params, id, now) → Thought
 *   - updateThoughtParamsToPatch(existing, params) → Partial<Thought>
 *   - collectReferencedAttachmentIds(thoughtLike) → string[]
 *   - filterAttachmentIdsToDelete(referencedIds, candidateIds) → string[]
 *
 * 标签来源：content_doc 经 documentToText 后用 parseTagsFromText 解析、
 * resolveAlias 纠正被合并的标签、createTag 落库到全局 tags 表。
 *
 * 删除/编辑用 db.thoughts.update/delete。embedding 由 embedding.ts 的 Dexie 钩子自动
 * 入队（ENTITY_CONFIG.thought），本 store 不直接调用 embedding。
 */
import { create } from 'zustand';
import { db, type Thought, type AttachmentMeta } from '../db/db';
import { generateUUID } from '../lib/utils';
import { parseTagsFromText, resolveAlias } from '../lib/tags';
import { useTagsStore } from './tags.store';
import {
  documentToText,
  normalizeDocument,
  plainTextToDocument,
  extractAttachmentIds,
  type RichDocument,
} from '../lib/documentModel';

// ---------------------------------------------------------------------------
// 公开 seam 1: createThoughtParamsToRow — 纯函数
// ---------------------------------------------------------------------------

/**
 * createThought 的输入参数（公开 seam）：
 *   - content_doc: RichDocument   优先
 *   - content?: string            兼容旧输入，会被派生为 content_doc
 *   - attachments?: AttachmentMeta[]  兼容旧输入
 *   - created_at?: number         用户指定的展示时间
 *   - tags?: string[]             可选预解析标签（默认会从 documentToText 派生）
 */
export interface CreateThoughtParams {
  content_doc?: RichDocument;
  content?: string;
  attachments?: AttachmentMeta[];
  created_at?: number;
  tags?: string[];
}

/** updateThought 的输入参数（公开 seam）：所有字段可选。 */
export interface UpdateThoughtParams {
  content_doc?: RichDocument;
  content?: string;
  attachments?: AttachmentMeta[];
  created_at?: number;
  tags?: string[];
}

/**
 * 从多种输入派生出最终 RichDocument：
 *   1. 优先 content_doc（经 normalizeDocument 兜底）
 *   2. 否则从 content 字符串派生
 *   3. 否则空文档
 */
function resolveInputDocument(params: { content_doc?: RichDocument; content?: string }): RichDocument {
  if (params.content_doc) return normalizeDocument(params.content_doc);
  if (typeof params.content === 'string' && params.content.length > 0) {
    return plainTextToDocument(params.content);
  }
  return normalizeDocument(undefined);
}

/**
 * 从 RichDocument + 兼容 attachments 收集所有 media attachmentId。
 * 兼容 attachments 数组里 ref 为 data URL / http(s) 链接（非 attachmentId）的项会跳过，
 * 仅保留可作为 attachmentId 的非空字符串（UUID 风格或 store id）。
 */
function docAndLegacyAttachmentIds(doc: RichDocument, legacy?: AttachmentMeta[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of extractAttachmentIds(doc)) {
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  if (Array.isArray(legacy)) {
    for (const a of legacy) {
      if (!a || typeof a.ref !== 'string' || a.ref === '') continue;
      // 跳过 data URL（不应被作为 attachmentId 用作 db.attachments 查询）
      if (a.ref.startsWith('data:') || a.ref.startsWith('http://') || a.ref.startsWith('https://')) {
        continue;
      }
      if (!seen.has(a.ref)) {
        seen.add(a.ref);
        out.push(a.ref);
      }
    }
  }
  return out;
}

/**
 * 从 content_doc 媒体节点派生兼容 attachments 数组（仅供旧版消费方读取）。
 * 这样旧的 thought.content + 旧 attachments 路径不会突然丢失图片/音频引用。
 */
function deriveLegacyAttachments(doc: RichDocument, legacy?: AttachmentMeta[]): AttachmentMeta[] {
  const out: AttachmentMeta[] = [];
  const seenIds = new Set<string>();
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    const t = n.type as string;
    if (t === 'image' || t === 'audio' || t === 'video' || t === 'file') {
      const attrs = n.attrs || {};
      const id = typeof attrs.attachmentId === 'string' ? attrs.attachmentId : '';
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        out.push({
          kind: t as AttachmentMeta['kind'],
          ref: id,
          name: typeof attrs.name === 'string' ? attrs.name : undefined,
          summary: typeof attrs.caption === 'string' ? attrs.caption : undefined,
        });
      }
    }
    if (Array.isArray(n.content)) {
      for (const c of n.content) walk(c);
    }
  };
  walk(doc);
  if (Array.isArray(legacy)) {
    for (const a of legacy) {
      if (!a || typeof a.ref !== 'string' || a.ref === '') continue;
      if (a.ref.startsWith('data:') || a.ref.startsWith('http://') || a.ref.startsWith('https://')) {
        // 保留 link 等外链类型
        out.push(a);
      }
    }
  }
  return out;
}

/**
 * 把 CreateThoughtParams 转换成可写入 db.thoughts 的 Thought 行（纯函数）。
 * 不调用任何 IDB / IO；标签在此不解析（调用方负责传 parsedTags）。
 */
export function createThoughtParamsToRow(
  params: CreateThoughtParams,
  id: string,
  now: number,
  parsedTags?: string[],
): Thought {
  const doc = resolveInputDocument(params);
  const text = documentToText(doc);
  const tags = Array.isArray(parsedTags)
    ? parsedTags
    : Array.isArray(params.tags)
      ? params.tags
      : parseTagsFromText(text);
  const thought: Thought = {
    id,
    content: '',
    content_doc: doc,
    tags: dedupeTags(tags),
    attachments: deriveLegacyAttachments(doc, params.attachments),
    created_at: params.created_at ?? now,
    original_created_at: now,
  };
  return thought;
}

/**
 * 把 UpdateThoughtParams 转换成可写入 db.thoughts 的 patch（纯函数）。
 *  - 仅当显式传入 content_doc / content 时才重算 content_doc / tags
 *  - 仅当显式传入 attachments 时才覆盖 attachments
 *  - created_at 透传
 *  - 永不动 original_created_at
 */
export function updateThoughtParamsToPatch(
  existing: Pick<Thought, 'id' | 'content_doc' | 'content' | 'tags' | 'attachments' | 'created_at' | 'original_created_at'>,
  params: UpdateThoughtParams,
  parsedTags?: string[],
): Partial<Thought> {
  const patch: Partial<Thought> = {};

  const hasContentDocInput = params.content_doc !== undefined || typeof params.content === 'string';
  if (hasContentDocInput) {
    const doc = resolveInputDocument(params);
    const text = documentToText(doc);
    patch.content_doc = doc;
    patch.content = '';
    patch.tags = dedupeTags(
      Array.isArray(parsedTags) ? parsedTags : Array.isArray(params.tags) ? params.tags : parseTagsFromText(text),
    );
    patch.attachments = deriveLegacyAttachments(doc, existing.attachments);
  } else if (params.attachments !== undefined) {
    // 仅传 attachments（兼容）：不动 doc / tags
    patch.attachments = params.attachments;
  }

  if (params.created_at !== undefined) {
    patch.created_at = params.created_at;
  }

  return patch;
}

function dedupeTags(tags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    if (typeof t !== 'string' || t === '') continue;
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 公开 seam 2: 引用感知附件 ID 收集 / 删除过滤
// ---------------------------------------------------------------------------

/**
 * 从一个 thought-like 对象（{ content_doc, attachments }）收集所有被引用的 attachmentId。
 * - content_doc 中的 media block attachmentId 优先（去重保序）
 * - 兼容 attachments 数组里的 ref（非 data URL / http）补充
 * - 缺 content_doc / 空对象 → 退化为只取 attachments
 */
export function collectReferencedAttachmentIds(
  thoughtLike: { content_doc?: unknown; attachments?: AttachmentMeta[] } | null | undefined,
): string[] {
  if (!thoughtLike) return [];
  const doc = thoughtLike.content_doc;
  let ids: string[] = [];
  if (doc) {
    try {
      ids = extractAttachmentIds(normalizeDocument(doc));
    } catch {
      ids = [];
    }
  }
  // 合并兼容 attachments 数组（去重保序，filterAttachmentIdsToDelete 会再用）
  const seen = new Set(ids);
  if (Array.isArray(thoughtLike.attachments)) {
    for (const a of thoughtLike.attachments) {
      if (!a || typeof a.ref !== 'string' || a.ref === '') continue;
      if (a.ref.startsWith('data:') || a.ref.startsWith('http://') || a.ref.startsWith('https://')) continue;
      if (!seen.has(a.ref)) {
        seen.add(a.ref);
        ids.push(a.ref);
      }
    }
  }
  return ids;
}

/**
 * 给定引用集与候选 ID 集合，返回应被删除的 ID 列表。
 * 规则：候选 ID 中**不**在引用集里的 → 可删。
 * 保守策略：引用集为空（调用方无 thought 上下文）→ 不删任何，避免误删其它文档引用的 ID。
 */
export function filterAttachmentIdsToDelete(
  referencedIds: string[],
  candidateIds: string[],
): string[] {
  if (!Array.isArray(candidateIds) || candidateIds.length === 0) return [];
  if (!Array.isArray(referencedIds) || referencedIds.length === 0) {
    // 引用集为空 → 保守不删（孤儿 GC 是另一道切片的事）
    return [];
  }
  const refSet = new Set(referencedIds);
  return candidateIds.filter((id) => !refSet.has(id));
}

// ---------------------------------------------------------------------------
// 标签解析（与 Record 共用 processTagsFromText 流程）
// ---------------------------------------------------------------------------

/**
 * 从文本解析 #标签 -> resolveAlias 纠正 -> createTag 落库，返回去重后的标签路径数组。
 * 与 Record 页面的 processTags 流程一致，保证全局标签系统口径统一。
 */
async function processTagsFromText(text: string): Promise<string[]> {
  const store = useTagsStore.getState();
  // 确保别名缓存最新（防止页面刚加载时别名尚未加载）
  await store.refreshAliases();
  const aliases = useTagsStore.getState().aliases;
  const rawTags = parseTagsFromText(text);
  if (rawTags.length === 0) return [];
  const resolved = rawTags.map((t) => resolveAlias(t, aliases));
  // 去重（resolveAlias 可能把多个标签归并到同一目标）
  const unique = Array.from(new Set(resolved));
  for (const tag of unique) {
    await store.createTag(tag);
  }
  return unique;
}

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

interface ThoughtsState {
  /** 创建一条沉淀笔记。返回新记录 id。 */
  createThought: (params: CreateThoughtParams) => Promise<string>;
  /** 更新笔记。改 content_doc / content 会重新解析标签；改 created_at 不影响 original_created_at。 */
  updateThought: (id: string, updates: UpdateThoughtParams) => Promise<void>;
  /** 删除笔记：引用感知清理 db.attachments Blob（只删该 thought 引用 + 候选集中未被引用的）。 */
  deleteThought: (id: string) => Promise<void>;
}

export const useThoughtsStore = create<ThoughtsState>(() => ({
  createThought: async (params) => {
    const now = Date.now();
    const id = generateUUID();
    const doc = resolveInputDocument(params);
    const tags = await processTagsFromText(documentToText(doc));
    const thought = createThoughtParamsToRow({ ...params, content_doc: doc }, id, now, tags);
    await db.thoughts.add(thought);
    return id;
  },

  updateThought: async (id, updates) => {
    const existing = await db.thoughts.get(id);
    if (!existing) return;

    let parsedTags: string[] | undefined;
    const hasContentDocInput = updates.content_doc !== undefined || typeof updates.content === 'string';
    if (hasContentDocInput) {
      const doc = resolveInputDocument(updates);
      parsedTags = await processTagsFromText(documentToText(doc));
    }

    const patch = updateThoughtParamsToPatch(
      {
        id: existing.id,
        content_doc: existing.content_doc,
        content: existing.content,
        tags: existing.tags,
        attachments: existing.attachments,
        created_at: existing.created_at,
        original_created_at: existing.original_created_at,
      },
      updates,
      parsedTags,
    );

    if (Object.keys(patch).length === 0) return;
    await db.thoughts.update(id, patch);
  },

  deleteThought: async (id) => {
    const existing = await db.thoughts.get(id);
    if (!existing) {
      // 幂等：不存在即视为已删
      return;
    }

    // 1) 引用感知：先收集该 thought 引用过的所有 attachmentId
    const referencedIds = collectReferencedAttachmentIds(existing);

    // 2) 对 referencedIds 中**确实存在**于 db.attachments 的 ID 跑一次
    //    全库扫描（看其它 thought 是否仍引用），决定哪些可以安全删除。
    //    保守策略：若任一 ID 仍在其它 thought 的 content_doc / attachments 中出现，则保留。
    const candidatesToInspect: string[] = [];
    if (referencedIds.length > 0) {
      // 仅检查「此 thought 引用过」的 ID —— 其它无关 Blob 不会进入本切片（孤儿 GC 是另一道切片）
      for (const attId of referencedIds) {
        const exists = await db.attachments.get(attId);
        if (exists) candidatesToInspect.push(attId);
      }
    }
    if (candidatesToInspect.length === 0) {
      await db.thoughts.delete(id);
      return;
    }

    // 3) 全库扫描：每个候选 ID 是否被任何其它 thought 引用
    const allThoughts = await db.thoughts.toArray();
    const stillReferenced: Set<string> = new Set();
    for (const other of allThoughts) {
      if (other.id === id) continue;
      const otherIds = collectReferencedAttachmentIds(other);
      for (const oid of otherIds) {
        if (candidatesToInspect.includes(oid)) stillReferenced.add(oid);
      }
    }

    const toDelete = filterAttachmentIdsToDelete(
      // 用「全库引用过」的并集作为「保留集」：从 candidates 中去掉仍被引用的
      Array.from(stillReferenced),
      candidatesToInspect,
    );

    await db.transaction('rw', db.thoughts, db.attachments, async () => {
      if (toDelete.length > 0) {
        await db.attachments.bulkDelete(toDelete);
      }
      await db.thoughts.delete(id);
    });
  },
}));
