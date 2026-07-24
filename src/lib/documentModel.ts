/**
 * Issue #15 — 统一文档模型（RichDocument）切片（公开 API 入口）
 *
 * 该文件是「文档模型」的对外接口门面，所有 schema 与归一化都委托给
 * 单点事实源 `editorSchema.ts`。组件、UI、测试都仅依赖本文件暴露的
 * 5 个公开函数 + 类型，不直接操作 schema。
 *
 * 公开 API：
 *   - 类型：RichDocument / RichDocumentNode / MediaKind / MediaAttrs
 *   - createEmptyDocument()                       → RichDocument
 *   - plainTextToDocument(text: string)           → RichDocument
 *   - documentToText(doc: RichDocument)           → string
 *   - extractAttachmentIds(doc: RichDocument)     → string[]
 *   - normalizeDocument(input: unknown)           → RichDocument
 *
 * 与上一切片（v1）的差异：
 *   - 媒体节点从 inline 改为 block（独占行），与 editorExtensions 单点事实源一致
 *   - normalizeDocument 接受更宽的节点集（heading/list/blockquote/codeBlock/
 *     hardBreak + block 媒体），schema 委托给 editorSchema.buildEditorSchema
 *
 * documentToText 行为约束：
 *   - paragraph / heading / list item 等 block 之间用 '\n' 分隔
 *   - hardBreak 渲染为 '\n'
 *   - 媒体节点只在 alt/caption/name 非空时输出可读文字（独占行，前后各换行）
 *   - 严格不输出 type/attrs/content/marks 等 JSON 属性名
 */

import {
  buildEditorSchema,
  defaultMediaAttrs,
  normalizeEditorDocument,
  EMPTY_RICH_DOCUMENT,
  type MediaAttrs,
  type MediaKind,
  type RichDocument,
  type RichDocumentNode,
} from './editorSchema';

// 重新导出类型，方便消费方只引用 documentModel
export type { RichDocument, RichDocumentNode, MediaKind, MediaAttrs } from './editorSchema';
export { MEDIA_KINDS, MEDIA_ATTR_KEYS, MEDIA_WIDTHS, MEDIA_ALIGNS } from './editorSchema';

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function trimText(s: string): string {
  return s
    .replace(/^[ \t\r\n]+/, '')
    .replace(/[ \t\r\n]+$/, '')
    .replace(/^[ \t]+|[ \t]+$/gm, '');
}

function isMediaKind(t: string): t is MediaKind {
  return t === 'image' || t === 'audio' || t === 'video' || t === 'file';
}

function mediaReadableText(attrs: Record<string, unknown> | undefined): string {
  if (!attrs) return '';
  const alt = typeof attrs.alt === 'string' ? attrs.alt.trim() : '';
  const caption = typeof attrs.caption === 'string' ? attrs.caption.trim() : '';
  const name = typeof attrs.name === 'string' ? attrs.name.trim() : '';
  return caption || alt || name;
}

/** 合法空文档：doc -> paragraph（无内容）。 */
function emptyDoc(): RichDocument {
  return EMPTY_RICH_DOCUMENT;
}

/** 将一段 inline 文本切成 [text, hardBreak, text, ...] 序列。空字符串 → 空数组。 */
function splitLinesToInline(line: string): RichDocumentNode[] {
  if (line === '') return [];
  const parts = line.split('\n');
  const out: RichDocumentNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) out.push({ type: 'hardBreak' });
    out.push({ type: 'text', text: parts[i] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/** 创建一个空白 RichDocument：单段空段落（schema 合法，无空 text）。 */
export function createEmptyDocument(): RichDocument {
  return emptyDoc();
}

/**
 * 把 plain text 转成 RichDocument：单换行 → hardBreak，空行 → 新段落。
 * 仅产生 paragraph / text / hardBreak，不引入媒体或 marks。
 */
export function plainTextToDocument(text: string | null | undefined): RichDocument {
  if (typeof text !== 'string') return emptyDoc();
  const trimmed = trimText(text);
  if (trimmed === '') return emptyDoc();

  const lines = trimmed.split('\n');
  const paragraphs: RichDocumentNode[] = [];
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const joined = buffer.join('\n');
    paragraphs.push({
      type: 'paragraph',
      content: splitLinesToInline(joined),
    });
    buffer = [];
  };

  for (const line of lines) {
    if (line === '') {
      flush();
    } else {
      buffer.push(line);
    }
  }
  flush();

  if (paragraphs.length === 0) {
    paragraphs.push({ type: 'paragraph' });
  }

  try {
    return buildEditorSchema().nodeFromJSON({ type: 'doc', content: paragraphs } as any).toJSON() as RichDocument;
  } catch {
    return emptyDoc();
  }
}

/**
 * 把 RichDocument 还原成 plain text：
 *   - block 之间用 '\n' 分隔
 *   - hardBreak 渲染为 '\n'
 *   - 媒体节点在 alt/caption/name 非空时独占行输出，前后各一个 '\n'
 *   - 严格不输出 type/attrs/content/marks 等 JSON 属性名
 */
export function documentToText(doc: RichDocument | null | undefined): string {
  if (!isObject(doc) || doc.type !== 'doc' || !Array.isArray(doc.content)) {
    return documentToText(emptyDoc());
  }
  const lines: string[] = [];
  for (const block of doc.content) {
    if (!isObject(block) || typeof block.type !== 'string') continue;
    if (block.type === 'paragraph') {
      lines.push(collectInlineText(block.content, '\n'));
    } else if (block.type === 'heading') {
      const t = collectInlineText(block.content, '\n');
      if (t) lines.push(t);
    } else if (block.type === 'blockquote') {
      const inner: string[] = [];
      if (Array.isArray(block.content)) {
        for (const child of block.content) {
          if (isObject(child) && child.type === 'paragraph') {
            inner.push(collectInlineText(child.content, '\n'));
          }
        }
      }
      if (inner.length > 0) lines.push(inner.join('\n'));
    } else if (block.type === 'codeBlock') {
      const code = collectInlineText(block.content, '\n');
      if (code) lines.push(code);
    } else if (block.type === 'bulletList' || block.type === 'orderedList') {
      if (Array.isArray(block.content)) {
        for (const item of block.content) {
          if (!isObject(item) || item.type !== 'listItem') continue;
          const t = collectListItemText(item);
          if (t) lines.push(t);
        }
      }
    } else if (isMediaKind(block.type)) {
      const t = mediaReadableText(block.attrs);
      if (t) lines.push(t);
    } else if (block.type === 'table') {
      // Issue #15 第二切片：表格纳入单点事实源 → documentToText 也必须支持
      // 每行 cell 用空格分隔，多行用 \n 分隔；不泄漏 JSON 属性名
      if (Array.isArray(block.content)) {
        const rows: string[] = [];
        for (const row of block.content) {
          if (!isObject(row) || row.type !== 'tableRow') continue;
          const cells: string[] = [];
          if (Array.isArray(row.content)) {
            for (const cell of row.content) {
              if (!isObject(cell) || (cell.type !== 'tableCell' && cell.type !== 'tableHeader')) continue;
              if (Array.isArray(cell.content)) {
                for (const child of cell.content) {
                  if (!isObject(child) || child.type !== 'paragraph') continue;
                  const t = collectInlineText(child.content, ' ');
                  if (t) cells.push(t);
                }
              }
            }
          }
          if (cells.length > 0) rows.push(cells.join(' '));
        }
        if (rows.length > 0) lines.push(rows.join('\n'));
      }
    }
  }
  return lines.join('\n');
}

function collectInlineText(content: unknown, hardBreakToken: string): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const inline of content) {
    if (!isObject(inline)) continue;
    if (inline.type === 'text' && typeof inline.text === 'string') {
      parts.push(inline.text);
    } else if (inline.type === 'hardBreak') {
      parts.push(hardBreakToken);
    } else if (isMediaKind(inline.type as string)) {
      // 兼容旧 inline 媒体（在规范化后会迁移到 block，但解析时仍容错）
      const t = mediaReadableText(inline.attrs as Record<string, unknown> | undefined);
      if (t) {
        parts.push('\n');
        parts.push(t);
        parts.push('\n');
      }
    }
  }
  return parts.join('');
}

function collectListItemText(item: Record<string, unknown>): string {
  if (!Array.isArray(item.content)) return '';
  const parts: string[] = [];
  for (const child of item.content) {
    if (!isObject(child)) continue;
    if (child.type === 'paragraph') {
      const t = collectInlineText(child.content, '\n');
      if (t) parts.push(t);
    } else if (isMediaKind(child.type as string)) {
      const t = mediaReadableText(child.attrs as Record<string, unknown> | undefined);
      if (t) parts.push(t);
    }
  }
  return parts.join('\n');
}

/** 收集所有媒体节点 attachmentId，去重，保持首次出现顺序。 */
export function extractAttachmentIds(doc: RichDocument | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  walk(doc, (node) => {
    if (!isMediaKind(node.type as string)) return;
    if (!isObject(node.attrs)) return;
    const id = node.attrs.attachmentId;
    if (typeof id !== 'string' || id === '') return;
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function walk(node: unknown, visit: (n: RichDocumentNode) => void): void {
  if (!isObject(node)) return;
  const n = node as unknown as RichDocumentNode;
  visit(n);
  if (Array.isArray(n.content)) {
    for (const child of n.content) {
      walk(child, visit);
    }
  }
}

/** 安全归一化任意输入为一个通过 schema 校验的 RichDocument。 */
export function normalizeDocument(input: unknown): RichDocument {
  return normalizeEditorDocument(input);
}

// ---------------------------------------------------------------------------
// 内部导出（仅供测试复用）
// ---------------------------------------------------------------------------
export const __schema = buildEditorSchema();
export const __defaultMediaAttrs = defaultMediaAttrs;
