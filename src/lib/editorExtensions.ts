/**
 * Issue #15 — 统一编辑器 extensions（公开 seam）
 *
 * 把 editorSchema.ts 的 ProseMirror NodeSpec 适配为 Tiptap 3.x Extension。
 * 这是「编辑器 / documentModel 单点事实源」一面的事实源：DocumentEditor 与
 * DocumentView 都使用本模块暴露的 extensions，节点 / 标记 / 媒体属性
 * 自动与 editorSchema 保持一致。
 *
 * 公开 API：
 *   - createEditorExtensions(options?): Extensions[]      Tiptap extensions
 *   - MEDIA_NODE_NAME: 'mediaBlock'                       Tiptap 节点 name（统一入口）
 *   - getMediaNodeName(kind): 'image' | 'audio' | ...    与 schema 一致
 *   - mediaNodeKind(attrs): MediaKind                     由 attrs 推断媒体种类
 *   - makeMediaAttrs(kind, attachmentId, partial?): MediaAttrs
 *   - normalizeMediaAttrs(input): MediaAttrs
 *   - insertMediaNodeJson(doc, mediaAttrs, position?): RichDocument
 *   - editorSelectionToBlockIndex(doc, pos): number      从 editor.selection.$from 推导块下标
 *   - updateMediaAttrs(doc, attachmentId, patch): RichDocument  caption/width/align patch
 *   - findMediaNodeByIdExt(doc, attachmentId): RichDocumentNode | null  (alias)
 *   - renderMediaNodeHtml(attrs): string                  共享 toDOM 字符串（无副作用，不含 src）
 *   - richDocumentToTiptapJSON(doc): Tiptap JSONContent  (别名)
 *   - tiptapJSONToRichDocument(json): RichDocument
 */
import { Node, mergeAttributes } from '@tiptap/core';
import React from 'react';
import { StarterKit } from '@tiptap/starter-kit';
import { Link } from '@tiptap/extension-link';
import { TextAlign } from '@tiptap/extension-text-align';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { ReactNodeViewRenderer } from '@tiptap/react';
import MediaNodeView from '../components/MediaNodeView';
import {
  buildEditorSchema,
  defaultMediaAttrs,
  normalizeEditorDocument,
  richDocumentToEditorJson,
  editorJsonToRichDocument,
  MEDIA_KINDS,
  MEDIA_WIDTHS,
  MEDIA_ALIGNS,
  type MediaAttrs,
  type MediaKind,
  type RichDocument,
  type RichDocumentNode,
} from './editorSchema';

export {
  MEDIA_KINDS,
  MEDIA_WIDTHS,
  MEDIA_ALIGNS,
  type MediaKind,
  type MediaAttrs,
  type RichDocument,
  type RichDocumentNode,
} from './editorSchema';

export const MEDIA_NODE_NAME = 'mediaBlock';

// ---------------------------------------------------------------------------
// Media attrs 辅助（纯函数，可被 UI 直接复用）
// ---------------------------------------------------------------------------

/** 从 mimeType 或显式 kind 字段推断媒体种类。 */
export function mediaNodeKind(input: { mimeType?: string; kind?: MediaKind; [k: string]: unknown } | MediaAttrs): MediaKind {
  const anyInput = input as { kind?: MediaKind; mimeType?: string };
  if (anyInput.kind && (MEDIA_KINDS as readonly string[]).includes(anyInput.kind)) {
    return anyInput.kind as MediaKind;
  }
  const mt = String(anyInput.mimeType || '').toLowerCase();
  if (mt.startsWith('image/')) return 'image';
  if (mt.startsWith('audio/')) return 'audio';
  if (mt.startsWith('video/')) return 'video';
  return 'file';
}

function clampWidth(v: unknown): (typeof MEDIA_WIDTHS)[number] {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return (MEDIA_WIDTHS as readonly number[]).includes(n) ? (n as (typeof MEDIA_WIDTHS)[number]) : 100;
}

function clampAlign(v: unknown): (typeof MEDIA_ALIGNS)[number] {
  const s = String(v || '');
  return (MEDIA_ALIGNS as readonly string[]).includes(s) ? (s as (typeof MEDIA_ALIGNS)[number]) : 'center';
}

/** 构造一份完整 MediaAttrs，自动应用默认值。 */
export function makeMediaAttrs(
  kind: MediaKind,
  attachmentId: string,
  partial: Partial<MediaAttrs> = {},
): MediaAttrs {
  const base = defaultMediaAttrs(attachmentId);
  return {
    ...base,
    ...partial,
    attachmentId,
    width: clampWidth(partial.width ?? base.width),
    align: clampAlign(partial.align ?? base.align),
    mimeType: typeof partial.mimeType === 'string' ? partial.mimeType : (typeof base.mimeType === 'string' ? base.mimeType : ''),
    duration: typeof partial.duration === 'number' && isFinite(partial.duration) ? partial.duration : 0,
  };
}

/** 把任意输入归一为 MediaAttrs（缺字段补默认，越界修正）。 */
export function normalizeMediaAttrs(input: unknown): MediaAttrs {
  if (!input || typeof input !== 'object') return defaultMediaAttrs('');
  const obj = input as Record<string, unknown>;
  const id = typeof obj.attachmentId === 'string' ? obj.attachmentId : '';
  return makeMediaAttrs(mediaNodeKind(obj), id, obj as Partial<MediaAttrs>);
}

// ---------------------------------------------------------------------------
// 媒体属性更新（单点事实源：caption / width / align）
// ---------------------------------------------------------------------------

/** 媒体可被 patch 的字段白名单。 */
export const MEDIA_PATCH_KEYS = ['caption', 'width', 'align', 'alt', 'name'] as const;
export type MediaPatchKey = (typeof MEDIA_PATCH_KEYS)[number];

export type MediaPatch = Partial<Pick<MediaAttrs, MediaPatchKey>>;

/**
 * 在 doc 中找到 attachmentId 命中的媒体节点，对 attrs 做浅 patch。
 * - 缺 attachmentId / 未命中 → 返回原 doc（不可变）
 * - width/align 越界 → clamp 到白名单
 * - caption/alt/name 接受任意 string；非法类型 → 忽略该字段
 * - 不修改原对象（深拷贝分支）
 */
export function updateMediaAttrs(
  doc: RichDocument,
  attachmentId: string,
  patch: MediaPatch,
): RichDocument {
  if (!attachmentId) return doc;
  if (!doc || !Array.isArray(doc.content)) return doc;
  let changed = false;
  const next: RichDocumentNode[] = doc.content.map((child): RichDocumentNode => {
    if (!isMediaKindString((child as RichDocumentNode).type) || !isObject((child as RichDocumentNode).attrs)) {
      return child;
    }
    const childAttrs = (child as RichDocumentNode).attrs as Record<string, unknown>;
    if (childAttrs.attachmentId !== attachmentId) return child;
    const oldAttrs = childAttrs as unknown as MediaAttrs;
    const newAttrs: Record<string, unknown> = { ...oldAttrs };
    if (typeof patch.caption === 'string') newAttrs.caption = patch.caption;
    if (typeof patch.alt === 'string') newAttrs.alt = patch.alt;
    if (typeof patch.name === 'string') newAttrs.name = patch.name;
    if (patch.width !== undefined) newAttrs.width = clampWidth(patch.width);
    if (patch.align !== undefined) newAttrs.align = clampAlign(patch.align);
    changed = true;
    return { ...(child as RichDocumentNode), attrs: newAttrs as unknown as RichDocumentNode['attrs'] };
  });
  return changed ? { type: 'doc', content: next } : doc;
}

/** viewMod.findMediaNodeById 的 re-export（避免 DocumentView 直接依赖 editorExtensions 反向依赖）。 */
export function findMediaNodeByIdExt(
  doc: RichDocument | null | undefined,
  attachmentId: string,
): RichDocumentNode | null {
  if (!doc) return null;
  let found: RichDocumentNode | null = null;
  const walk = (n: unknown) => {
    if (found || !isObject(n)) return;
    const node = n as unknown as RichDocumentNode;
    if (isMediaKindString(node.type) && isObject(node.attrs) && (node.attrs as Record<string, unknown>).attachmentId === attachmentId) {
      found = node;
      return;
    }
    if (Array.isArray(node.content)) {
      for (const c of node.content) walk(c);
    }
  };
  walk(doc);
  return found;
}

// ---------------------------------------------------------------------------
// Selection → doc.content 块下标（光标位置插入的核心算法）
// ---------------------------------------------------------------------------

/**
 * 由 editor.state.selection.from (PM position) 推导目标 doc.content 块下标。
 * 块大小用 ProseMirror Node.nodeSize 估算；返回的下标可安全用于 insertMediaNodeJson(doc, media, idx)。
 * - pos 越界 → 末尾
 * - doc 缺 content → 0
 */
export function editorSelectionToBlockIndex(doc: RichDocument, fromPos: number): number {
  if (!doc || !Array.isArray(doc.content) || doc.content.length === 0) return 0;
  let acc = 0;
  for (let i = 0; i < doc.content.length; i++) {
    // 粗估：每个块至少 2 token（open + close）。实际 PM nodeSize 至少 2；
    // 选中块内部任何位置都映射到 i；下一块开始位置映射到 i+1
    acc += 2;
    if (fromPos <= acc) return i;
  }
  return doc.content.length;
}

// ---------------------------------------------------------------------------
// 共享 Media NodeView 的 toDOM 字符串生成器（DocumentView 注入 src 用）
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isMediaKindString(t: unknown): t is MediaKind {
  return typeof t === 'string' && (MEDIA_KINDS as readonly string[]).includes(t);
}

/** 媒体节点名 = kind（与 editorSchema NodeSpec 同名）。 */
export function getMediaNodeName(kind: MediaKind): MediaKind {
  return kind;
}

/**
 * 生成媒体节点的 HTML 字符串（共享 toDOM 逻辑）。
 * - 不包含 src（不持久化 data URL，由 DocumentView 渲染时通过 useResolveAttachment 注入）
 * - 仅用于 DocumentView 共享；DocumentEditor 仍走 Tiptap NodeView
 */
export function renderMediaNodeHtml(attrs: Partial<MediaAttrs> & { kind?: MediaKind }): string {
  const kind: MediaKind = isMediaKindString(attrs.kind) ? attrs.kind : mediaNodeKind(attrs);
  const widthPct = clampWidth(attrs.width ?? 100);
  const align = clampAlign(attrs.align ?? 'center');
  const data: Record<string, string> = {
    'data-attachment-id': (attrs.attachmentId as string) || '',
    'data-width': String(widthPct),
    'data-align': align,
    'data-name': (attrs.name as string) || '',
    'data-caption': (attrs.caption as string) || '',
    'data-mime': (attrs.mimeType as string) || '',
    'data-duration': String((attrs.duration as number) || 0),
    class: `baimiao-media baimiao-media--${kind} baimiao-media--align-${align}`,
    style: `width:${widthPct}%;`,
  };
  if (kind === 'image') {
    return `<img ${Object.entries({ ...data, alt: (attrs.alt as string) || '' }).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ')} />`;
  }
  if (kind === 'file') {
    return `<a ${Object.entries({ ...data, href: '#' }).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ')}>${escapeAttr((attrs.name as string) || (attrs.attachmentId as string) || 'file')}</a>`;
  }
  return `<${kind} ${Object.entries(data).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ')}></${kind}>`;
}

function escapeAttr(v: string): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// insertMediaNodeJson：在指定位置插入 block 媒体节点（纯函数）
// ---------------------------------------------------------------------------

/**
 * 把媒体节点 JSON 插入到 doc.content 的指定位置。
 * - 默认插到末尾（position 不传或越界 → 末尾）
 * - 媒体节点以 block 形式独占顶层 doc.content[index]
 * - 不修改原对象（深拷贝）
 * - kind 默认从 media.mimeType 推断；可选 overrideKind 显式指定（推荐）
 */
export function insertMediaNodeJson(
  doc: RichDocument,
  media: MediaAttrs,
  position?: number,
  overrideKind?: MediaKind,
): RichDocument {
  const kind = overrideKind || mediaNodeKind(media);
  const mediaNode: RichDocumentNode = {
    type: kind,
    attrs: { ...media } as Record<string, unknown>,
  };
  const base: RichDocument = doc && Array.isArray(doc.content)
    ? { type: 'doc', content: doc.content.map((c) => ({ ...c })) }
    : { type: 'doc', content: [] };
  const insertAt = typeof position === 'number' && position >= 0 && position <= base.content.length
    ? position
    : base.content.length;
  const next = [...base.content];
  next.splice(insertAt, 0, mediaNode);
  return { type: 'doc', content: next };
}

// ---------------------------------------------------------------------------
// Tiptap 媒体扩展：image / audio / video / file 共享同一份 attrs
// ---------------------------------------------------------------------------

interface CreateMediaNodeOptions {
  kind: MediaKind;
}

/** Tiptap 解析 / 序列化映射。 */
function makeMediaNode({ kind }: CreateMediaNodeOptions) {
  return Node.create<Record<string, never>, Record<string, never>>({
    name: kind, // 与 editorSchema NodeSpec name 一致（image / audio / video / file）
    group: 'block',
    content: 'inline*',
    defining: true,
    isolating: true,
    atom: false,
    addAttributes() {
      return {
        attachmentId: { default: '' },
        alt: { default: '' },
        caption: { default: '' },
        name: { default: '' },
        width: { default: 100 },
        align: { default: 'center' },
        mimeType: { default: '' },
        duration: { default: 0 },
      };
    },
    parseHTML() {
      if (kind === 'image') {
        return [{ tag: 'img[data-attachment-id]' }];
      }
      if (kind === 'file') {
        return [{ tag: 'a[data-attachment-id]' }];
      }
      return [{ tag: `${kind}[data-attachment-id]` }];
    },
    addNodeView() {
      return ReactNodeViewRenderer((props) => React.createElement(MediaNodeView, { ...props, kind }));
    },
    renderHTML({ node, HTMLAttributes }) {
      const attrs = node.attrs as MediaAttrs;
      const widthPct = clampWidth(attrs.width);
      const align = clampAlign(attrs.align);
      const data: Record<string, string> = {
        'data-attachment-id': attrs.attachmentId || '',
        'data-width': String(widthPct),
        'data-align': align,
        'data-name': attrs.name || '',
        'data-caption': attrs.caption || '',
        'data-mime': attrs.mimeType || '',
        'data-duration': String(attrs.duration || 0),
        class: `baimiao-media baimiao-media--${kind} baimiao-media--align-${align}`,
        style: `width:${widthPct}%;`,
      };
      if (kind === 'image') {
        const imageAttrs = mergeAttributes(HTMLAttributes, data, { alt: attrs.alt || '' });
        const caption = attrs.caption?.trim();
        return caption
          ? ['figure', { class: `baimiao-media-figure baimiao-media--align-${align}` }, ['img', imageAttrs], ['figcaption', {}, caption]]
          : ['figure', { class: `baimiao-media-figure baimiao-media--align-${align}` }, ['img', imageAttrs]];
      }
      if (kind === 'file') {
        return [
          'a',
          mergeAttributes(HTMLAttributes, data, { href: '#' }),
          attrs.name || attrs.attachmentId || kind,
        ];
      }
      return [kind, mergeAttributes(HTMLAttributes, data)];
    },
  });
}

// ---------------------------------------------------------------------------
// 公开 factory
// ---------------------------------------------------------------------------

export interface CreateEditorExtensionsOptions {
  /** 是否可编辑（默认 true）。DocumentView 传 false。 */
  editable?: boolean;
}

/**
 * 构造与 editorSchema 共享事实源的 Tiptap extensions。
 * DocumentEditor 与 DocumentView 都使用此函数，确保编辑器产出的 JSON
 * 一定在 editorSchema 接受的范围内。
 */
export function createEditorExtensions(_options: CreateEditorExtensionsOptions = {}) {
  void _options;
  return [
    StarterKit.configure({
      // 不让 StarterKit 提供 Link（用我们自己的）
      link: false,
      // heading / paragraph / blockquote / codeBlock / list / hardBreak 全部沿用 StarterKit 默认
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: ['http', 'https', 'mailto'],
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', class: 'baimiao-link' },
    }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Table.configure({ resizable: false, allowTableNodeSelection: true }),
    TableRow,
    TableHeader,
    TableCell,
    // 自定义媒体节点
    makeMediaNode({ kind: 'image' }),
    makeMediaNode({ kind: 'audio' }),
    makeMediaNode({ kind: 'video' }),
    makeMediaNode({ kind: 'file' }),
  ];
}

// ---------------------------------------------------------------------------
// JSON 互转（供 DocumentEditor / DocumentView 使用）
// ---------------------------------------------------------------------------

/** 任何 RichDocument → Tiptap 接受的 JSON（同步归一化）。 */
export function richDocumentToTiptapJSON(doc: RichDocument): RichDocument {
  return richDocumentToEditorJson(doc);
}

/** Tiptap editor.getJSON() → RichDocument（同步归一化）。 */
export function tiptapJSONToRichDocument(json: unknown): RichDocument {
  if (!json || typeof json !== 'object') {
    return normalizeEditorDocument(json);
  }
  return editorJsonToRichDocument(json as RichDocument);
}

// 重导出供 UI 引用 schema
export { buildEditorSchema, normalizeEditorDocument };
