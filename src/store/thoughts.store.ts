/**
 * #7 沉思（Thoughts）笔记模块 -- Zustand store。
 *
 * 数据单元 Thought：Markdown 文本(content) + 标签数组(tags) + 附件数组(attachments)
 * + created_at(可被用户修改的展示时间) + original_created_at(首次创建时间，用于溯源)。
 *
 * 标签来源：内容中的 #标签，经 parseTagsFromText 解析、resolveAlias 纠正被合并的标签、
 * createTag 落库到全局 tags 表。保存时存入 thought.tags。
 *
 * 删除/编辑用 db.thoughts.update/delete。embedding 由 embedding.ts 的 Dexie 钩子自动
 * 入队（ENTITY_CONFIG.thought），本 store 不直接调用 embedding。
 */
import { create } from 'zustand';
import { db, type Thought, type AttachmentMeta } from '../db/db';
import { generateUUID } from '../lib/utils';
import { parseTagsFromText, resolveAlias } from '../lib/tags';
import { useTagsStore } from './tags.store';

interface CreateThoughtParams {
  content: string;
  attachments?: AttachmentMeta[];
  /** 用户指定的展示时间；不传则用当前时间。original_created_at 始终为真实创建时刻。 */
  created_at?: number;
}

interface UpdateThoughtParams {
  content?: string;
  attachments?: AttachmentMeta[];
  created_at?: number;
}

interface ThoughtsState {
  /** 创建一条沉思笔记。返回新记录 id。 */
  createThought: (params: CreateThoughtParams) => Promise<string>;
  /** 更新笔记。改 content 会重新解析标签；改 created_at 不影响 original_created_at。 */
  updateThought: (id: string, updates: UpdateThoughtParams) => Promise<void>;
  /** 删除笔记。 */
  deleteThought: (id: string) => Promise<void>;
}

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

export const useThoughtsStore = create<ThoughtsState>(() => ({
  createThought: async ({ content, attachments, created_at }) => {
    const now = Date.now();
    const tags = await processTagsFromText(content);
    const id = generateUUID();
    const thought: Thought = {
      id,
      content,
      tags,
      attachments: attachments && attachments.length > 0 ? attachments : [],
      created_at: created_at ?? now,
      // original_created_at 始终记录真实创建时刻，用于溯源，永不被后续编辑覆盖
      original_created_at: now,
    };
    await db.thoughts.add(thought);
    return id;
  },

  updateThought: async (id, updates) => {
    const existing = await db.thoughts.get(id);
    if (!existing) return;
    const patch: Partial<Thought> = {};

    if (updates.content !== undefined) {
      patch.content = updates.content;
      // 内容变更 -> 重新解析 #标签（标签内联在文本中，flomo 式）
      patch.tags = await processTagsFromText(updates.content);
    }
    if (updates.attachments !== undefined) {
      patch.attachments = updates.attachments;
    }
    if (updates.created_at !== undefined) {
      patch.created_at = updates.created_at;
      // 注意：original_created_at 不在此处更新，保留首次值用于溯源
    }

    await db.thoughts.update(id, patch);
  },

  deleteThought: async (id) => {
    await db.thoughts.delete(id);
  },
}));
