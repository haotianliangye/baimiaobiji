import React, { useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { createEditorExtensions } from '../lib/editorExtensions';
import { normalizeDocument, type RichDocument, type RichDocumentNode } from '../lib/documentModel';
import { db } from '../db/db';

export interface DocumentViewProps {
  value: RichDocument;
  /** 必填：把 attachmentId 解析为 Blob（由调用方实现：db.attachments.get） */
  resolveAttachment: (attachmentId: string) => Promise<Blob | null>;
  className?: string;
  dataTestId?: string;
}

/** 收集文档中所有媒体 attachmentId，去重保序。 */
export function resolveDocumentAttachmentIds(doc: RichDocument | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const node = n as RichDocumentNode;
    if (
      (node.type === 'image' || node.type === 'audio' || node.type === 'video' || node.type === 'file') &&
      node.attrs &&
      typeof node.attrs.attachmentId === 'string' &&
      node.attrs.attachmentId !== ''
    ) {
      const id = node.attrs.attachmentId;
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    if (Array.isArray(node.content)) {
      for (const c of node.content) walk(c);
    }
  };
  walk(doc);
  return out;
}

/** 占位节点（公开 seam：测试断言） */
export interface MissingAttachmentPlaceholder {
  kind: string;
  attachmentId: string;
  isMissing: true;
}

/** 生成稳定占位节点。 */
export function missingAttachmentPlaceholder(kind: string, attachmentId: string): MissingAttachmentPlaceholder {
  return { kind, attachmentId, isMissing: true };
}

/** 找到第一个匹配 attachmentId 的媒体节点；不存在 → null。 */
export function findMediaNodeById(doc: RichDocument | null | undefined, attachmentId: string): RichDocumentNode | null {
  if (!doc) return null;
  let found: RichDocumentNode | null = null;
  const walk = (n: unknown) => {
    if (found || !n || typeof n !== 'object') return;
    const node = n as RichDocumentNode;
    if (
      (node.type === 'image' || node.type === 'audio' || node.type === 'video' || node.type === 'file') &&
      node.attrs &&
      node.attrs.attachmentId === attachmentId
    ) {
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

/**
 * 缺省 resolveAttachment：直接读 IndexedDB attachments。
 * 调用方仍可自定义 resolveAttachment 以解耦运行环境（如测试）。
 */
const defaultResolveAttachment = async (id: string): Promise<Blob | null> => {
  try {
    const record = await db.attachments.get(id);
    return record?.blob || null;
  } catch {
    return null;
  }
};

export default function DocumentView({
  value,
  resolveAttachment = defaultResolveAttachment,
  className = '',
  dataTestId = 'document-view',
}: DocumentViewProps) {
  const initialContent = useMemo(() => normalizeDocument(value), []);

  const editor = useEditor({
    extensions: createEditorExtensions({ editable: false }),
    editable: false,
    content: initialContent,
  });

  // 同步外部 value 变化（页面级一次性 editor mount）
  useEffect(() => {
    if (!editor) return;
    const current = editor.getJSON();
    if (JSON.stringify(current) !== JSON.stringify(value)) {
      editor.commands.setContent(value);
    }
  }, [value, editor]);

  return (
    <div
      data-testid={dataTestId}
      className={`baimiao-editorial-body ${className}`}
    >
      <EditorContent editor={editor} />
    </div>
  );
}