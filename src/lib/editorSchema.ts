/**
 * Issue #15 — 统一文档编辑器 schema（公开 seam，单点事实源）
 *
 * 这是 Issue #15 第二纵向切片新增的「事实源模块」：
 *   - `buildEditorSchema()` 是 ProseMirror Schema 的唯一构造点
 *   - `normalizeEditorDocument(input)` / `richDocumentToEditorJson(doc)` /
 *     `editorJsonToRichDocument(json)` 是纯转换函数，所有归一化都走这里
 *   - `MEDIA_KINDS / MEDIA_ATTR_KEYS / MEDIA_WIDTHS / MEDIA_ALIGNS` 是公开常量
 *
 * 该 schema 接受编辑器实际产出的全部节点 / marks：
 *   doc / paragraph / heading(1-6) / bulletList / orderedList / listItem /
 *   blockquote / codeBlock / hardBreak / text /
 *   image / audio / video / file（block，独占行）/
 *   bold / italic / code / link
 *
 * 媒体是 block 节点，attrs 含 attachmentId / alt / caption / name /
 * width(25/50/75/100) / align(left/center/right) / mimeType / duration。
 *
 * 该模块是 Tiptap 无关的纯 schema；`editorExtensions.ts` 在此之上包
 * Tiptap Node / Extension 适配层，documentModel 在此之上做高阶归一化。
 */
import { Schema, type NodeSpec, type MarkSpec } from '@tiptap/pm/model';

// ---------------------------------------------------------------------------
// 公开常量（外部导入编辑扩展、UI 控件、测试均使用这些）
// ---------------------------------------------------------------------------

/** 媒体节点类型（白名单）。 */
export const MEDIA_KINDS = ['image', 'audio', 'video', 'file'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** 媒体 attrs 全集（顺序即 editor 内 attrs 顺序）。 */
export const MEDIA_ATTR_KEYS = [
  'attachmentId',
  'alt',
  'caption',
  'name',
  'width',
  'align',
  'mimeType',
  'duration',
] as const;
export type MediaAttrKey = (typeof MEDIA_ATTR_KEYS)[number];

/** 媒体 width 合法值（百分比）。 */
export const MEDIA_WIDTHS = [25, 50, 75, 100] as const;
/** 媒体 align 合法值。 */
export const MEDIA_ALIGNS = ['left', 'center', 'right'] as const;

export interface MediaAttrs {
  attachmentId: string;
  alt: string;
  caption: string;
  name: string;
  width: (typeof MEDIA_WIDTHS)[number];
  align: (typeof MEDIA_ALIGNS)[number];
  mimeType: string;
  duration: number;
}

/** 媒体默认 attrs 工厂。 */
export function defaultMediaAttrs(attachmentId: string): MediaAttrs {
  return {
    attachmentId,
    alt: '',
    caption: '',
    name: '',
    width: 100,
    align: 'center',
    mimeType: '',
    duration: 0,
  };
}

// ---------------------------------------------------------------------------
// Schema（单点事实源）
// ---------------------------------------------------------------------------

const headingLevels = [1, 2, 3, 4, 5, 6] as const;

function makeMediaSpec(kind: MediaKind): NodeSpec {
  return {
    group: 'block',
    content: 'inline*',
    defining: true,
    isolating: true,
    atom: false,
    attrs: {
      attachmentId: { default: '' },
      alt: { default: '' },
      caption: { default: '' },
      name: { default: '' },
      width: { default: 100 },
      align: { default: 'center' },
      mimeType: { default: '' },
      duration: { default: 0 },
    },
    parseDOM: [
      {
        tag: kind === 'image' ? 'img[data-attachment-id]' : kind === 'file' ? 'a[data-attachment-id]' : `${kind}[data-attachment-id]`,
        getAttrs: (dom: unknown) => {
          if (!(dom instanceof HTMLElement)) return false;
          const id = dom.getAttribute('data-attachment-id');
          if (!id) return false;
          const width = clampMediaWidth(parseInt(dom.getAttribute('data-width') || '100', 10));
          const align = clampMediaAlign(dom.getAttribute('data-align') || 'center');
          return {
            attachmentId: id,
            alt: dom.getAttribute('alt') || '',
            caption: dom.getAttribute('data-caption') || '',
            name: dom.getAttribute('data-name') || dom.getAttribute('title') || '',
            width,
            align,
            mimeType: dom.getAttribute('data-mime') || '',
            duration: parseFloat(dom.getAttribute('data-duration') || '0') || 0,
          };
        },
      },
    ],
    toDOM: (node) => {
      const attrs = node.attrs as MediaAttrs;
      const widthPct = clampMediaWidth(attrs.width);
      const align = clampMediaAlign(attrs.align);
      // toDOM 不带 src（不持久化 data URL），由 DocumentView 渲染时通过 useResolveAttachment 注入
      const data: Record<string, string> = {
        'data-attachment-id': attrs.attachmentId,
        'data-width': String(widthPct),
        'data-align': align,
        'data-name': attrs.name,
        'data-caption': attrs.caption,
        'data-mime': attrs.mimeType,
        'data-duration': String(attrs.duration || 0),
        class: `baimiao-media baimiao-media--${kind} baimiao-media--align-${align}`,
        style: `width:${widthPct}%;`,
      };
      if (kind === 'image') {
        return ['img', { ...data, alt: attrs.alt }];
      }
      if (kind === 'file') {
        return ['a', { ...data, href: '#' }, attrs.name || attrs.attachmentId];
      }
      return [kind, data, ''];
    },
  };
}

function clampMediaWidth(v: unknown): (typeof MEDIA_WIDTHS)[number] {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return (MEDIA_WIDTHS as readonly number[]).includes(n) ? (n as (typeof MEDIA_WIDTHS)[number]) : 100;
}

function clampMediaAlign(v: unknown): (typeof MEDIA_ALIGNS)[number] {
  const s = String(v || '');
  return (MEDIA_ALIGNS as readonly string[]).includes(s) ? (s as (typeof MEDIA_ALIGNS)[number]) : 'center';
}

/** 段落/标题对齐白名单：left | center | right。非法 → null（表示无对齐）。 */
export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export function clampTextAlign(v: unknown): TextAlign | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  // 兼容 'style="text-align: right"' 这种写法
  const m = s.match(/text-align\s*:\s*([a-z]+)/);
  const candidate = (m ? m[1] : s) as string;
  return (TEXT_ALIGNS as readonly string[]).includes(candidate) ? (candidate as TextAlign) : null;
}

const nodes: Record<string, NodeSpec> = {
  doc: {
    content: 'block+',
  },
  paragraph: {
    content: 'inline*',
    group: 'block',
    attrs: { textAlign: { default: null } },
    parseDOM: [
      {
        tag: 'p',
        getAttrs: (dom: unknown) => {
          if (!(dom instanceof HTMLElement)) return false;
          const align = clampTextAlign(dom.getAttribute('style') || dom.getAttribute('align'));
          return align ? { textAlign: align } : false;
        },
      },
    ],
    toDOM: (node) => {
      const align = (node.attrs as { textAlign?: string | null }).textAlign;
      return align ? ['p', { style: `text-align: ${align};` }, 0] : ['p', 0];
    },
  },
  heading: {
    content: 'inline*',
    group: 'block',
    defining: true,
    attrs: {
      level: { default: 1 },
      textAlign: { default: null },
    },
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
      tag: `h${level}`,
      getAttrs: (dom: unknown) => {
        if (!(dom instanceof HTMLElement)) return { level };
        const align = clampTextAlign(dom.getAttribute('style') || dom.getAttribute('align'));
        return align ? { level, textAlign: align } : { level };
      },
    })),
    toDOM: (node) => {
      const { level, textAlign } = node.attrs as { level: number; textAlign?: string | null };
      return textAlign ? [`h${level}`, { style: `text-align: ${textAlign};` }, 0] : [`h${level}`, 0];
    },
  },
  blockquote: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: () => ['blockquote', 0],
  },
  codeBlock: {
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    attrs: { language: { default: null } },
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
    toDOM: () => ['pre', ['code', 0]],
  },
  bulletList: {
    content: 'listItem+',
    group: 'block',
    parseDOM: [{ tag: 'ul' }],
    toDOM: () => ['ul', 0],
  },
  orderedList: {
    content: 'listItem+',
    group: 'block',
    attrs: { start: { default: 1 } },
    parseDOM: [{ tag: 'ol' }],
    toDOM: () => ['ol', 0],
  },
  listItem: {
    content: 'paragraph block*',
    parseDOM: [{ tag: 'li' }],
    toDOM: () => ['li', 0],
    defining: true,
  },
  horizontalRule: {
    group: 'block',
    parseDOM: [{ tag: 'hr' }],
    toDOM: () => ['hr'],
  },
  text: {
    group: 'inline',
  },
  hardBreak: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br'],
  },
  image: makeMediaSpec('image'),
  audio: makeMediaSpec('audio'),
  video: makeMediaSpec('video'),
  file: makeMediaSpec('file'),
  // -----------------------------------------------------------------------
  // 表格（Issue #15 第二切片：工具栏声称支持 table → 必须纳入单点事实源）
  // 与 @tiptap/extension-table / extension-table-row / extension-table-cell /
  // extension-table-header 共享同一节点名 & 同样的 content 表达式，
  // 以确保 editorExtensions.ts 注册的 Tiptap 扩展能复用本 schema。
  // -----------------------------------------------------------------------
  table: {
    content: 'tableRow+',
    group: 'block',
    isolating: true,
    parseDOM: [{ tag: 'table' }],
    toDOM: () => ['table', 0],
  },
  tableRow: {
    content: '(tableCell | tableHeader)*',
    parseDOM: [{ tag: 'tr' }],
    toDOM: () => ['tr', 0],
  },
  tableHeader: {
    content: 'block+',
    isolating: true,
    attrs: {
      colspan: { default: 1 },
      rowspan: { default: 1 },
      colwidth: { default: null },
      align: { default: null },
    },
    parseDOM: [{ tag: 'th' }],
    toDOM: (node) => {
      const attrs = node.attrs as { align?: string | null };
      return attrs.align ? ['th', { style: `text-align: ${attrs.align};` }, 0] : ['th', 0];
    },
  },
  tableCell: {
    content: 'block+',
    isolating: true,
    attrs: {
      colspan: { default: 1 },
      rowspan: { default: 1 },
      colwidth: { default: null },
      align: { default: null },
    },
    parseDOM: [{ tag: 'td' }],
    toDOM: (node) => {
      const attrs = node.attrs as { align?: string | null };
      return attrs.align ? ['td', { style: `text-align: ${attrs.align};` }, 0] : ['td', 0];
    },
  },
};

const marks: Record<string, MarkSpec> = {
  bold: {
    parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
    toDOM: () => ['strong', 0],
  },
  italic: {
    parseDOM: [{ tag: 'em' }, { tag: 'i' }],
    toDOM: () => ['em', 0],
  },
  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', 0],
  },
  link: {
    attrs: {
      href: { default: '' },
      target: { default: '_blank' },
      rel: { default: 'noopener noreferrer nofollow' },
    },
    inclusive: false,
    parseDOM: [
      {
        tag: 'a[href]',
        getAttrs: (dom: unknown) => {
          if (!(dom instanceof HTMLElement)) return false;
          const href = dom.getAttribute('href');
          if (!href) return false;
          return { href };
        },
      },
    ],
    toDOM: (mark) => ['a', { ...mark.attrs, class: 'baimiao-link' }, 0],
  },
};

let cachedSchema: Schema | null = null;

/** 单点事实源：构造 ProseMirror Schema。重复调用返回同一 schema。 */
export function buildEditorSchema(): Schema {
  if (cachedSchema) return cachedSchema;
  cachedSchema = new Schema({ nodes, marks });
  return cachedSchema;
}

// ---------------------------------------------------------------------------
// 高阶工具：归一化、互逆
// ---------------------------------------------------------------------------

/** 媒体默认 attrs（无 attachmentId 时，attachmentId 为空字符串）。 */
function ensureMediaAttrs(input: unknown): MediaAttrs {
  if (!isObject(input)) return defaultMediaAttrs('');
  const id = typeof input.attachmentId === 'string' ? input.attachmentId : '';
  return {
    attachmentId: id,
    alt: typeof input.alt === 'string' ? input.alt : '',
    caption: typeof input.caption === 'string' ? input.caption : '',
    name: typeof input.name === 'string' ? input.name : '',
    width: clampMediaWidth(input.width),
    align: clampMediaAlign(input.align),
    mimeType: typeof input.mimeType === 'string' ? input.mimeType : '',
    duration: typeof input.duration === 'number' && isFinite(input.duration) ? input.duration : 0,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isMediaType(t: unknown): t is MediaKind {
  return typeof t === 'string' && (MEDIA_KINDS as readonly string[]).includes(t);
}

function cleanInline(raw: unknown): unknown {
  if (!isObject(raw)) return null;
  const t = raw.type;
  if (t === 'text') {
    const text = typeof raw.text === 'string' ? raw.text : '';
    if (text === '') return null;
    const node: Record<string, unknown> = { type: 'text', text };
    const marks = cleanMarks(raw.marks);
    if (marks.length > 0) node.marks = marks;
    return node;
  }
  if (t === 'hardBreak') {
    const node: Record<string, unknown> = { type: 'hardBreak' };
    const marks = cleanMarks(raw.marks);
    if (marks.length > 0) node.marks = marks;
    return node;
  }
  return null;
}

/** marks 白名单：bold / italic / code / link。 */
const ALLOWED_MARKS = new Set(['bold', 'italic', 'code', 'link']);

function cleanMarks(input: unknown): Array<{ type: string; attrs?: Record<string, unknown> }> {
  if (!Array.isArray(input)) return [];
  const out: Array<{ type: string; attrs?: Record<string, unknown> }> = [];
  for (const m of input) {
    if (!isObject(m)) continue;
    if (typeof m.type !== 'string') continue;
    if (!ALLOWED_MARKS.has(m.type)) continue;
    if (m.type === 'link') {
      const href = isObject(m.attrs) && typeof (m.attrs as Record<string, unknown>).href === 'string'
        ? (m.attrs as Record<string, unknown>).href as string
        : '';
      if (!href) continue; // 非法 link（无 href）丢弃
      out.push({ type: 'link', attrs: { href } });
    } else {
      out.push({ type: m.type });
    }
  }
  return out;
}

function cleanBlock(raw: unknown): unknown | unknown[] {
  if (!isObject(raw)) return null;
  const t = raw.type;
  if (t === 'paragraph') {
    const src = Array.isArray(raw.content) ? raw.content : [];
    const inlines: unknown[] = [];
    for (const child of src) {
      const c = cleanInline(child);
      if (c) inlines.push(c);
    }
    const node: Record<string, unknown> = { type: 'paragraph' };
    const align = clampTextAlign(isObject(raw.attrs) ? (raw.attrs as Record<string, unknown>).textAlign : null);
    if (align) node.attrs = { textAlign: align };
    return inlines.length === 0 ? node : { ...node, content: inlines };
  }
  if (t === 'heading') {
    const level = parseHeadingLevel(raw.attrs);
    const src = Array.isArray(raw.content) ? raw.content : [];
    const inlines: unknown[] = [];
    for (const child of src) {
      const c = cleanInline(child);
      if (c) inlines.push(c);
    }
    const align = clampTextAlign(isObject(raw.attrs) ? (raw.attrs as Record<string, unknown>).textAlign : null);
    const node: Record<string, unknown> = {
      type: 'heading',
      attrs: align ? { level, textAlign: align } : { level },
    };
    if (inlines.length > 0) node.content = inlines;
    return node;
  }
  if (t === 'blockquote') {
    const src = Array.isArray(raw.content) ? raw.content : [];
    const blocks: unknown[] = [];
    for (const child of src) {
      const c = cleanBlock(child);
      if (c) {
        if (Array.isArray(c)) blocks.push(...c);
        else blocks.push(c);
      }
    }
    if (blocks.length === 0) blocks.push({ type: 'paragraph' });
    return { type: 'blockquote', content: blocks };
  }
  if (t === 'codeBlock') {
    const src = Array.isArray(raw.content) ? raw.content : [];
    const text = src
      .map((c) => (isObject(c) && c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
      .join('');
    return { type: 'codeBlock', content: [{ type: 'text', text }] };
  }
  if (t === 'bulletList' || t === 'orderedList') {
    const src = Array.isArray(raw.content) ? raw.content : [];
    const items: unknown[] = [];
    for (const child of src) {
      const c = cleanListItem(child);
      if (c) items.push(c);
    }
    if (items.length === 0) {
      items.push({
        type: 'listItem',
        content: [{ type: 'paragraph' }],
      });
    }
    return { type: t, content: items };
  }
  if (isMediaType(t)) {
    if (!isObject(raw.attrs)) return null;
    const id = raw.attrs.attachmentId;
    if (typeof id !== 'string' || id === '') return null;
    return { type: t, attrs: ensureMediaAttrs(raw.attrs) };
  }
  if (t === 'table') {
    const src = Array.isArray(raw.content) ? raw.content : [];
    const rows: unknown[] = [];
    for (const child of src) {
      const c = cleanTableRow(child);
      if (c) rows.push(c);
    }
    if (rows.length === 0) return null;
    return { type: 'table', content: rows };
  }
  // 未知节点丢弃
  return null;
}

function cleanTableRow(raw: unknown): unknown {
  if (!isObject(raw) || raw.type !== 'tableRow') return null;
  const src = Array.isArray(raw.content) ? raw.content : [];
  const cells: unknown[] = [];
  for (const child of src) {
    const c = cleanTableCell(child);
    if (c) cells.push(c);
  }
  if (cells.length === 0) return null;
  return { type: 'tableRow', content: cells };
}

function cleanTableCell(raw: unknown): unknown {
  if (!isObject(raw)) return null;
  if (raw.type !== 'tableCell' && raw.type !== 'tableHeader') return null;
  const src = Array.isArray(raw.content) ? raw.content : [];
  const blocks: unknown[] = [];
  for (const child of src) {
    const c = cleanBlock(child);
    if (c) {
      if (Array.isArray(c)) blocks.push(...c);
      else blocks.push(c);
    }
  }
  if (blocks.length === 0) blocks.push({ type: 'paragraph' });
  // 保留 align attrs（如有）
  const cellAttrs: Record<string, unknown> = {};
  if (isObject(raw.attrs)) {
    const a = raw.attrs;
    if (typeof a.colspan === 'number') cellAttrs.colspan = a.colspan;
    if (typeof a.rowspan === 'number') cellAttrs.rowspan = a.rowspan;
    if (Array.isArray(a.colwidth)) cellAttrs.colwidth = a.colwidth;
    if (typeof a.align === 'string') cellAttrs.align = a.align;
  }
  return {
    type: raw.type,
    ...(Object.keys(cellAttrs).length > 0 ? { attrs: cellAttrs } : {}),
    content: blocks,
  };
}

function parseHeadingLevel(attrs: unknown): 1 | 2 | 3 | 4 | 5 | 6 {
  if (!isObject(attrs)) return 1;
  const lvl = attrs.level;
  if (typeof lvl === 'number' && headingLevels.includes(lvl as 1)) {
    return lvl as 1 | 2 | 3 | 4 | 5 | 6;
  }
  if (typeof lvl === 'string') {
    const n = parseInt(lvl, 10);
    if (headingLevels.includes(n as 1)) return n as 1 | 2 | 3 | 4 | 5 | 6;
  }
  return 1;
}

function cleanListItem(raw: unknown): unknown {
  if (!isObject(raw)) return null;
  if (raw.type !== 'listItem') return null;
  const src = Array.isArray(raw.content) ? raw.content : [];
  const blocks: unknown[] = [];
  for (const child of src) {
    const c = cleanBlock(child);
    if (c) {
      if (Array.isArray(c)) blocks.push(...c);
      else blocks.push(c);
    }
  }
  if (blocks.length === 0) blocks.push({ type: 'paragraph' });
  return { type: 'listItem', content: blocks };
}

function cleanDocument(input: unknown): unknown {
  if (!isObject(input) || input.type !== 'doc') return EMPTY_RICH_DOCUMENT_LITERAL;
  const src = Array.isArray(input.content) ? input.content : [];
  const blocks: unknown[] = [];
  for (const child of src) {
    const c = cleanBlock(child);
    if (c) {
      if (Array.isArray(c)) blocks.push(...c);
      else blocks.push(c);
    }
  }
  if (blocks.length === 0) blocks.push({ type: 'paragraph' });
  return { type: 'doc', content: blocks };
}

/**
 * 规范的空 RichDocument（单段空段落，无 attrs）。
 *
 * 必须保持稳定：所有「同语义空文档」入口——createEmptyDocument /
 * plainTextToDocument 空输入 / normalizeDocument 非法输入 / db
 * resolveDocumentContent 空输入——都返回此结构的同一个引用，保证
 * deepEqual / JSON.stringify 行为一致，避免 ProseMirror `toJSON()` 给
 * 段落补 `attrs.textAlign:null` 导致的 deepEqual 不等。
 */
export const EMPTY_RICH_DOCUMENT: RichDocument = Object.freeze({
  type: 'doc',
  content: Object.freeze([Object.freeze({ type: 'paragraph' })]) as unknown as RichDocumentNode[],
}) as RichDocument;

const EMPTY_RICH_DOCUMENT_LITERAL: RichDocument = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * 判断节点是否就是规范的空 RichDocument（单段空段落，无 attrs、无 content）。
 * 只比较结构，不比较原型 / 引用。
 */
function isCanonicalEmptyDocument(doc: unknown): boolean {
  if (!isObject(doc) || doc.type !== 'doc') return false;
  if (!Array.isArray(doc.content) || doc.content.length !== 1) return false;
  const p = doc.content[0];
  if (!isObject(p) || p.type !== 'paragraph') return false;
  // 段落不能有 attrs、不能有 content（或 content 必须是空数组）
  if (p.attrs !== undefined && isObject(p.attrs) && Object.keys(p.attrs).length > 0) return false;
  if (p.content !== undefined) {
    if (!Array.isArray(p.content) || p.content.length !== 0) return false;
  }
  return true;
}

/** 接受任意输入，归一为合法 RichDocument（block 媒体）。 */
export function normalizeEditorDocument(input: unknown) {
  const cleaned = cleanDocument(input);
  // 规范的空文档：跳过 ProseMirror `nodeFromJSON(...).toJSON()` 往返，
  // 避免 schema 默认 attrs（paragraph.textAlign:null）污染空段落，
  // 保证 createEmptyDocument / normalizeDocument(null) / resolveDocumentContent({})
  // 三个入口对「同语义空文档」返回 deepEqual 的同一结构。
  if (isCanonicalEmptyDocument(cleaned)) return EMPTY_RICH_DOCUMENT_LITERAL;
  try {
    return buildEditorSchema().nodeFromJSON(cleaned as any).toJSON() as RichDocument;
  } catch {
    return EMPTY_RICH_DOCUMENT_LITERAL;
  }
}

/** RichDocument → 编辑器内部 JSON（同构，二者均为 PM JSON）。 */
export function richDocumentToEditorJson(doc: RichDocument): RichDocument {
  const cleaned = cleanDocument(doc);
  return buildEditorSchema().nodeFromJSON(cleaned as any).toJSON() as RichDocument;
}

/** 编辑器 JSON → RichDocument（同构，主要做一次规范化）。 */
export function editorJsonToRichDocument(json: RichDocument): RichDocument {
  return normalizeEditorDocument(json);
}

// ---------------------------------------------------------------------------
// RichDocument 类型（被 documentModel.ts 复用，文件内部导出）
// ---------------------------------------------------------------------------

export interface RichDocumentNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichDocumentNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

export type RichDocument = RichDocumentNode;
