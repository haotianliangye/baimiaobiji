/**
 * #4 全局标签系统 -- Zustand store。
 *
 * 持久化到 IndexedDB（tags / tag_aliases 表），不用 localStorage。
 * 状态中的 aliases 缓存供 Record 等页面在保存时同步调用 resolveAlias。
 * tags 列表由组件通过 useLiveQuery 响应式读取；本 store 负责写操作 + aliases 缓存。
 */
import { create } from 'zustand';
import { db, type TagDef } from '../db/db';
import { normalizeTagPath } from '../lib/tags';

/** 置顶标签与未置顶标签的分界线：置顶 sort_order < BASE，未置顶 >= BASE。 */
const PINNED_ORDER_BASE = 1_000_000_000;

interface TagsState {
  /** 别名缓存（alias -> target），供同步 resolveAlias 使用。 */
  aliases: Record<string, string>;
  /** 从 db.tag_aliases 刷新别名缓存。 */
  refreshAliases: () => Promise<void>;
  /** 创建标签定义（已存在则忽略）。 */
  createTag: (path: string) => Promise<void>;
  /**
   * 重命名标签：级联更新所有记录（raw_logs + daily_reviews）中
   * oldPath 及其子路径，替换为对应 newPath 前缀。
   */
  renameTag: (oldPath: string, newPath: string) => Promise<void>;
  /**
   * 合并标签：写 alias sourcePath -> targetPath，级联把所有记录的
   * sourcePath（及子路径）改为 targetPath（及对应子路径）。
   */
  mergeTags: (sourcePath: string, targetPath: string) => Promise<void>;
  /**
   * 删除标签：从所有记录的 tags 数组移除 path 及其子路径；
   * 标签定义本身也删除；alias 中 target 为 path 的也清理。
   */
  deleteTag: (path: string) => Promise<void>;
  /** 置顶标签：排在同层级最前。 */
  pinTag: (path: string) => Promise<void>;
  /** 取消置顶。 */
  unpinTag: (path: string) => Promise<void>;
  /**
   * 编辑标签名称（路径）与图标。
   * 若路径变化则级联更新所有关联记录；图标更新写入 TagDef。
   */
  updateTag: (oldPath: string, newPath: string, icon?: string) => Promise<void>;
  /**
   * 仅移除标签：从所有关联记录中移除该标签（及子路径），保留记录本身；
   * 同时删除标签定义与相关别名。
   */
  removeTagOnly: (path: string) => Promise<void>;
  /**
   * 删除标签和笔记：级联删除标签定义及所有带该标签（含子路径）的记录。
   */
  deleteTagAndNotes: (path: string) => Promise<void>;
}

/**
 * 判断 tagPath 是否等于 path 或是 path 的子路径（前缀匹配）。
 * 例如 path='工作', tagPath='工作/项目A' -> true。
 */
function isPathOrChild(tagPath: string, path: string): boolean {
  const n = normalizeTagPath(tagPath);
  const p = normalizeTagPath(path);
  if (n === p) return true;
  return n.startsWith(p + '/');
}

/**
 * 把 oldPath 前缀替换为 newPath 前缀。
 * '工作/项目A' under oldPath='工作' -> newPath + '/项目A'
 * 若 tagPath 不是 oldPath 的子路径或自身，返回原值。
 */
function replacePathPrefix(tagPath: string, oldPath: string, newPath: string): string {
  const n = normalizeTagPath(tagPath);
  const op = normalizeTagPath(oldPath);
  const np = normalizeTagPath(newPath);
  if (n === op) return np;
  if (n.startsWith(op + '/')) {
    return np + '/' + n.slice(op.length + 1);
  }
  return n;
}

export const useTagsStore = create<TagsState>((set, get) => ({
  aliases: {},

  refreshAliases: async () => {
    const allAliases = await db.tag_aliases.toArray();
    const map: Record<string, string> = {};
    for (const a of allAliases) {
      map[a.alias] = a.target;
    }
    set({ aliases: map });
  },

  createTag: async (path: string) => {
    const normalized = normalizeTagPath(path);
    if (!normalized) return;
    const existing = await db.tags.get(normalized);
    if (existing) return;
    const parts = normalized.split('/');
    const name = parts[parts.length - 1];
    const tagDef: TagDef = {
      path: normalized,
      name,
      created_at: Date.now(),
      pinned: false,
      sort_order: Date.now() + PINNED_ORDER_BASE,
      icon: '',
    };
    await db.tags.put(tagDef);
  },

  renameTag: async (oldPath: string, newPath: string) => {
    const op = normalizeTagPath(oldPath);
    const np = normalizeTagPath(newPath);
    if (!op || !np || op === np) return;

    // 1. 更新标签定义表：oldPath 自身改名，子路径前缀替换
    const allTags = await db.tags.toArray();
    for (const tag of allTags) {
      if (tag.path === op) {
        const parts = np.split('/');
        await db.tags.put({
          ...tag,
          path: np,
          name: parts[parts.length - 1],
        });
        await db.tags.delete(op);
      } else if (tag.path.startsWith(op + '/')) {
        const newPathForChild = replacePathPrefix(tag.path, op, np);
        const parts = newPathForChild.split('/');
        await db.tags.delete(tag.path);
        await db.tags.put({
          ...tag,
          path: newPathForChild,
          name: parts[parts.length - 1],
        });
      }
    }

    // 2. 级联更新 raw_logs
    const rawLogs = await db.raw_logs.toArray();
    for (const log of rawLogs) {
      if (!log.tags || log.tags.length === 0) continue;
      const hasMatch = log.tags.some(t => isPathOrChild(t, op));
      if (!hasMatch) continue;
      const newTags = log.tags.map(t => replacePathPrefix(t, op, np));
      await db.raw_logs.update(log.id, { tags: newTags });
    }

    // 3. 级联更新 daily_reviews
    const reviews = await db.daily_reviews.toArray();
    for (const review of reviews) {
      if (!review.tags || review.tags.length === 0) continue;
      const hasMatch = review.tags.some(t => isPathOrChild(t, op));
      if (!hasMatch) continue;
      const newTags = review.tags.map(t => replacePathPrefix(t, op, np));
      await db.daily_reviews.update(review.id, { tags: newTags });
    }

    // 3b. 级联更新 thoughts（沉淀笔记也带全局标签）
    const thoughts = await db.thoughts.toArray();
    for (const th of thoughts) {
      if (!th.tags || th.tags.length === 0) continue;
      const hasMatch = th.tags.some(t => isPathOrChild(t, op));
      if (!hasMatch) continue;
      const newTags = th.tags.map(t => replacePathPrefix(t, op, np));
      await db.thoughts.update(th.id, { tags: newTags });
    }

    // 3c. 级联更新 mingwu（明悟/洞察卡片自动打标）
    const mingwu = await db.mingwu.toArray();
    for (const m of mingwu) {
      if (!m.tags || m.tags.length === 0) continue;
      const hasMatch = m.tags.some(t => isPathOrChild(t, op));
      if (!hasMatch) continue;
      const newTags = m.tags.map(t => replacePathPrefix(t, op, np));
      await db.mingwu.update(m.id, { tags: newTags });
    }

    // 4. 更新 aliases 中引用了 oldPath 的条目
    const aliases = await db.tag_aliases.toArray();
    for (const a of aliases) {
      const newAlias = replacePathPrefix(a.alias, op, np);
      const newTarget = replacePathPrefix(a.target, op, np);
      if (newAlias !== a.alias || newTarget !== a.target) {
        await db.tag_aliases.delete(a.alias);
        await db.tag_aliases.put({ alias: newAlias, target: newTarget });
      }
    }

    await get().refreshAliases();
  },

  mergeTags: async (sourcePath: string, targetPath: string) => {
    const sp = normalizeTagPath(sourcePath);
    const tp = normalizeTagPath(targetPath);
    if (!sp || !tp || sp === tp) return;

    // 1. 写 alias: sourcePath -> targetPath
    await db.tag_aliases.put({ alias: sp, target: tp });

    // 2. 级联更新所有记录：sourcePath（及子路径）-> targetPath（及对应子路径）
    const replaceTag = (t: string): string => replacePathPrefix(t, sp, tp);

    const rawLogs = await db.raw_logs.toArray();
    for (const log of rawLogs) {
      if (!log.tags || log.tags.length === 0) continue;
      const hasMatch = log.tags.some(t => isPathOrChild(t, sp));
      if (!hasMatch) continue;
      const newTags = log.tags.map(replaceTag);
      await db.raw_logs.update(log.id, { tags: newTags });
    }

    const reviews = await db.daily_reviews.toArray();
    for (const review of reviews) {
      if (!review.tags || review.tags.length === 0) continue;
      const hasMatch = review.tags.some(t => isPathOrChild(t, sp));
      if (!hasMatch) continue;
      const newTags = review.tags.map(replaceTag);
      await db.daily_reviews.update(review.id, { tags: newTags });
    }

    // 级联更新 thoughts
    const thoughts = await db.thoughts.toArray();
    for (const th of thoughts) {
      if (!th.tags || th.tags.length === 0) continue;
      const hasMatch = th.tags.some(t => isPathOrChild(t, sp));
      if (!hasMatch) continue;
      const newTags = th.tags.map(replaceTag);
      await db.thoughts.update(th.id, { tags: newTags });
    }

    // 级联更新 mingwu
    const mingwu = await db.mingwu.toArray();
    for (const m of mingwu) {
      if (!m.tags || m.tags.length === 0) continue;
      const hasMatch = m.tags.some(t => isPathOrChild(t, sp));
      if (!hasMatch) continue;
      const newTags = m.tags.map(replaceTag);
      await db.mingwu.update(m.id, { tags: newTags });
    }

    // 3. 合并标签定义：sourcePath 的子标签也迁移到 targetPath 下
    const allTags = await db.tags.toArray();
    for (const tag of allTags) {
      if (tag.path === sp) {
        // 源标签自身：如果 targetPath 标签不存在则创建，删除源标签
        const existingTarget = await db.tags.get(tp);
        if (!existingTarget) {
          const parts = tp.split('/');
          await db.tags.put({
            path: tp,
            name: parts[parts.length - 1],
            created_at: tag.created_at,
          });
        }
        await db.tags.delete(sp);
      } else if (tag.path.startsWith(sp + '/')) {
        // 源标签的子标签：迁移到 targetPath 下
        const newPathForChild = replacePathPrefix(tag.path, sp, tp);
        const existing = await db.tags.get(newPathForChild);
        if (!existing) {
          const parts = newPathForChild.split('/');
          await db.tags.put({
            ...tag,
            path: newPathForChild,
            name: parts[parts.length - 1],
          });
        }
        await db.tags.delete(tag.path);
      }
    }

    // 4. 更新其他 aliases 中引用了 sourcePath 的条目
    const aliases = await db.tag_aliases.toArray();
    for (const a of aliases) {
      if (a.alias === sp) continue; // 刚写的，跳过
      const newAlias = replacePathPrefix(a.alias, sp, tp);
      const newTarget = replacePathPrefix(a.target, sp, tp);
      if (newAlias !== a.alias || newTarget !== a.target) {
        await db.tag_aliases.delete(a.alias);
        await db.tag_aliases.put({ alias: newAlias, target: newTarget });
      }
    }

    await get().refreshAliases();
  },

  deleteTag: async (path: string) => {
    const p = normalizeTagPath(path);
    if (!p) return;

    // 1. 从 raw_logs 移除 p 及其子路径
    const rawLogs = await db.raw_logs.toArray();
    for (const log of rawLogs) {
      if (!log.tags || log.tags.length === 0) continue;
      const hasMatch = log.tags.some(t => isPathOrChild(t, p));
      if (!hasMatch) continue;
      const newTags = log.tags.filter(t => !isPathOrChild(t, p));
      await db.raw_logs.update(log.id, { tags: newTags });
    }

    // 2. 从 daily_reviews 移除 p 及其子路径
    const reviews = await db.daily_reviews.toArray();
    for (const review of reviews) {
      if (!review.tags || review.tags.length === 0) continue;
      const hasMatch = review.tags.some(t => isPathOrChild(t, p));
      if (!hasMatch) continue;
      const newTags = review.tags.filter(t => !isPathOrChild(t, p));
      await db.daily_reviews.update(review.id, { tags: newTags });
    }

    // 2b. 从 thoughts 移除 p 及其子路径
    const thoughts = await db.thoughts.toArray();
    for (const th of thoughts) {
      if (!th.tags || th.tags.length === 0) continue;
      const hasMatch = th.tags.some(t => isPathOrChild(t, p));
      if (!hasMatch) continue;
      const newTags = th.tags.filter(t => !isPathOrChild(t, p));
      await db.thoughts.update(th.id, { tags: newTags });
    }

    // 2c. 从 mingwu 移除 p 及其子路径
    const mingwu = await db.mingwu.toArray();
    for (const m of mingwu) {
      if (!m.tags || m.tags.length === 0) continue;
      const hasMatch = m.tags.some(t => isPathOrChild(t, p));
      if (!hasMatch) continue;
      const newTags = m.tags.filter(t => !isPathOrChild(t, p));
      await db.mingwu.update(m.id, { tags: newTags });
    }

    // 3. 删除标签定义（自身及子路径）
    const allTags = await db.tags.toArray();
    for (const tag of allTags) {
      if (isPathOrChild(tag.path, p)) {
        await db.tags.delete(tag.path);
      }
    }

    // 4. 清理 aliases：alias 或 target 引用了 p（及子路径）的条目
    const aliases = await db.tag_aliases.toArray();
    for (const a of aliases) {
      if (isPathOrChild(a.alias, p) || isPathOrChild(a.target, p)) {
        await db.tag_aliases.delete(a.alias);
      }
    }

    await get().refreshAliases();
  },

  pinTag: async (path: string) => {
    const p = normalizeTagPath(path);
    if (!p) return;
    let tag = await db.tags.get(p);
    if (!tag) {
      // 标签不存在（如树形推断的父级）—— 自动创建，保证置顶可作用于 UI 可见的任何标签
      const parts = p.split('/');
      tag = {
        path: p,
        name: parts[parts.length - 1],
        created_at: Date.now(),
        pinned: false,
        sort_order: Date.now() + PINNED_ORDER_BASE,
        icon: '',
      };
      await db.tags.put(tag);
    }
    if (tag.pinned) return;

    const allTags = await db.tags.toArray();
    const pinnedTags = allTags.filter(t => t.pinned && t.sort_order !== undefined);
    const minOrder = pinnedTags.length > 0
      ? Math.min(...pinnedTags.map(t => t.sort_order ?? 0))
      : PINNED_ORDER_BASE - 1;
    await db.tags.put({ ...tag, pinned: true, sort_order: minOrder - 1 });
  },

  unpinTag: async (path: string) => {
    const p = normalizeTagPath(path);
    if (!p) return;
    const tag = await db.tags.get(p);
    if (!tag || !tag.pinned) return;
    await db.tags.put({
      ...tag,
      pinned: false,
      sort_order: Date.now() + PINNED_ORDER_BASE,
    });
  },

  updateTag: async (oldPath: string, newPath: string, icon?: string) => {
    const op = normalizeTagPath(oldPath);
    const np = normalizeTagPath(newPath);
    if (!op || !np) return;
    const existing = await db.tags.get(op);
    if (!existing) return;

    if (op !== np) {
      await get().renameTag(op, np);
    }

    const targetPath = op === np ? op : np;
    const target = await db.tags.get(targetPath);
    if (!target) return;
    const parts = np.split('/');
    await db.tags.put({
      ...target,
      path: targetPath,
      name: parts[parts.length - 1],
      icon: icon !== undefined ? icon : (target.icon ?? ''),
    });
  },

  removeTagOnly: async (path: string) => {
    await get().deleteTag(path);
  },

  deleteTagAndNotes: async (path: string) => {
    const p = normalizeTagPath(path);
    if (!p) return;

    const matches = (tags?: string[]) => tags?.some(t => isPathOrChild(t, p));

    const rawLogs = await db.raw_logs.toArray();
    for (const log of rawLogs) {
      if (matches(log.tags)) await db.raw_logs.delete(log.id);
    }

    const reviews = await db.daily_reviews.toArray();
    for (const review of reviews) {
      if (matches(review.tags)) await db.daily_reviews.delete(review.id);
    }

    const thoughts = await db.thoughts.toArray();
    for (const th of thoughts) {
      if (matches(th.tags)) await db.thoughts.delete(th.id);
    }

    const mingwu = await db.mingwu.toArray();
    for (const m of mingwu) {
      if (matches(m.tags)) await db.mingwu.delete(m.id);
    }

    const allTags = await db.tags.toArray();
    for (const tag of allTags) {
      if (isPathOrChild(tag.path, p)) await db.tags.delete(tag.path);
    }

    const aliases = await db.tag_aliases.toArray();
    for (const a of aliases) {
      if (isPathOrChild(a.alias, p) || isPathOrChild(a.target, p)) {
        await db.tag_aliases.delete(a.alias);
      }
    }

    await get().refreshAliases();
  },
}));
