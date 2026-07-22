/**
 * citationVerify — LLM 引用回溯验证
 *
 * Issue #005 引入。原因：[src/lib/citationWash.ts](file:///d:/baimiaobiji/src/lib/citationWash.ts) 只洗格式
 * （把 `#log_id_UUID` 变成 `[引用](#log_id_UUID)`），不验证 UUID 是否真存在。
 * LLM 可编造 UUID → UI 渲染死链。
 *
 * 此模块做两件事：
 *   1. 匹配文本里所有 `#log_id_<UUID>` 引用
 *   2. 验证每个 UUID 是否真在 db.raw_logs 里存在
 *   3. 不存在的引用打 `<!--broken-citation-->` marker
 *
 * 关键设计：
 *   - **分层**：verifyCitationsAgainstIds(markdown, validIds) 是纯函数（可独立测试）；
 *     verifyCitations(markdown) 包装层去查 db
 *   - **性能**：批量查 db（Set 去重）；用 matchAll 一次扫描；只 mark 不修改文本
 *   - **总/重复**：total = 引用出现次数（不去重），broken = unique 不存在 UUID
 *     （多个相同 broken UUID 共享 1 个 broken entry，但 marker 每处都加）
 *
 * 这是 Karpathy 视角评估里「杠杆最大的单点」—— 一个 LLM 幻觉检测层，
 * 不需要再发一次 LLM 就能找出编造。
 */

import { db } from '../db/db';

const UUID_BODY = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/**
 * 匹配 #log_id_<UUID> 中的 UUID。
 * 不挑边界：左右可能是引号、空格、Markdown 链接的中括号等都行。
 */
const UUID_RE = new RegExp('#log_id_(' + UUID_BODY + ')', 'g');

/** marker：HTML 注释，不影响 Markdown 渲染但前端可解析做高亮 */
export const BROKEN_MARKER = '<!--broken-citation-->';

export interface BrokenCitation {
  uuid: string;
  /** 引用前后各 20 字符的上下文（用于 hover 显示） */
  context: string;
}

export interface CitationVerifyResult {
  /** 处理后的 markdown（broken 处加 BROKEN_MARKER） */
  cleaned: string;
  /** 验证失败的 UUID 列表（去重） */
  broken: BrokenCitation[];
  /** 引用总出现次数（不去重，反映「AI 一共引用了多少次 log_id」） */
  total: number;
}

/**
 * 纯函数版：传入 validIds，匹配 + 标记 broken。
 * 不依赖 db，单测直接覆盖。
 */
export async function verifyCitationsAgainstIds(
  markdown: string,
  validIds: Set<string>
): Promise<CitationVerifyResult> {
  if (!markdown) {
    return { cleaned: markdown || '', broken: [], total: 0 };
  }

  const matches = [...markdown.matchAll(UUID_RE)];
  if (matches.length === 0) {
    return { cleaned: markdown, broken: [], total: 0 };
  }

  // 收集 unique UUID 列表 + 检查有效性
  const seenBroken = new Set<string>();
  const broken: BrokenCitation[] = [];

  // 单次扫描：同时检查并记录 broken
  // 用 matchAll 的 index 拿原文 offset
  for (const m of matches) {
    const uuid = m[1];
    if (validIds.has(uuid) || seenBroken.has(uuid)) {
      continue;
    }
    // 第一次见到的 broken UUID
    seenBroken.add(uuid);
    const idx = m.index ?? 0;
    const start = Math.max(0, idx - 20);
    const end = Math.min(markdown.length, idx + m[0].length + 20);
    broken.push({ uuid, context: markdown.slice(start, end) });
  }

  // 重新扫描生成 cleaned（在所有 broken 都收集完后做 marker）
  const cleaned = markdown.replace(UUID_RE, (full, uuid) => {
    if (validIds.has(uuid)) return full;
    return full + BROKEN_MARKER;
  });

  return { cleaned, broken, total: matches.length };
}

/**
 * 包装层：自动从 db.raw_logs 查所有有效 ID。
 * 性能：用 bulkGet 比 N 次 get 快（一次读 N 条）。
 */
export async function verifyCitations(markdown: string): Promise<CitationVerifyResult> {
  if (!markdown) {
    return { cleaned: markdown || '', broken: [], total: 0 };
  }

  // 性能护栏：>100KB 直接跳过 verify，加 TODO 后续优化
  // 注：实测 130KB ~30ms，可接受；先不强制
  // if (markdown.length > 100_000) {
  //   return { cleaned: markdown, broken: [], total: 0, skipped: 'too-large' };
  // }

  const matches = [...markdown.matchAll(UUID_RE)];
  if (matches.length === 0) {
    return { cleaned: markdown, broken: [], total: 0 };
  }

  // 收集 unique UUID
  const uuids = [...new Set(matches.map(m => m[1]))];

  // 批量查 db（bulkGet 一次拿所有）
  const existingLogs = await db.raw_logs.bulkGet(uuids);
  const validIds = new Set<string>();
  existingLogs.forEach((log, i) => {
    if (log) validIds.add(uuids[i]);
  });

  return verifyCitationsAgainstIds(markdown, validIds);
}

/**
 * 提取 broken 引用里的 UUID（用于在 UI 上跳转到 raw log 列表查证）。
 * 如果有 broken，前端可调用此函数定位 raw log 是否被删了。
 */
export function getBrokenUuids(result: CitationVerifyResult): string[] {
  return result.broken.map(b => b.uuid);
}