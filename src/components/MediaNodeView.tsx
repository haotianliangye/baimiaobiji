import React, { useEffect, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import type { MediaAttrs, MediaKind } from '../lib/editorSchema';
import { db } from '../db/db';

export interface MediaNodeViewProps extends NodeViewProps {
  kind: MediaKind;
}

export default function MediaNodeView({ node, updateAttributes, selected, kind, editor }: MediaNodeViewProps) {
  const attrs = node.attrs as MediaAttrs;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    if (attrs.attachmentId) {
      db.attachments.get(attrs.attachmentId).then((record) => {
        if (cancelled || !record) return;
        objectUrl = URL.createObjectURL(record.blob);
        setUrl(objectUrl);
      }).catch(() => undefined);
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attrs.attachmentId]);

  const editable = editor.isEditable;
  const width = `${attrs.width || 100}%`;
  const alignClass = attrs.align === 'left' ? 'items-start' : attrs.align === 'right' ? 'items-end' : 'items-center';

  return (
    <NodeViewWrapper
      className={`my-3 flex flex-col ${alignClass} ${selected ? 'ring-2 ring-baimiao-mysteria/30 rounded-lg' : ''}`}
      data-testid={`media-node-${attrs.attachmentId}`}
      data-media-kind={kind}
      data-attachment-id={attrs.attachmentId}
    >
      <div className="flex flex-col items-center gap-2" style={{ width, maxWidth: '100%' }}>
        {kind === 'image' && (
          url ? <img src={url} alt={attrs.alt || attrs.name || ''} className="block max-w-full rounded-lg" />
            : <div className="flex min-h-28 w-full items-center justify-center rounded-lg bg-stone-100 text-xs text-stone-400">图片暂不可用</div>
        )}
        {kind === 'audio' && (
          url ? <audio controls src={url} className="w-full" />
            : <div className="flex min-h-12 w-full items-center justify-center rounded-lg bg-stone-100 text-xs text-stone-400">音频暂不可用</div>
        )}
        {kind === 'video' && (
          url ? <video controls src={url} className="block max-w-full rounded-lg" />
            : <div className="flex min-h-28 w-full items-center justify-center rounded-lg bg-stone-100 text-xs text-stone-400">视频暂不可用</div>
        )}
        {kind === 'file' && (
          <div className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">
            {attrs.name || attrs.attachmentId}
          </div>
        )}
        {editable ? (
          <input
            value={attrs.caption || ''}
            onChange={(event) => updateAttributes({ caption: event.target.value })}
            placeholder="添加说明…"
            className="w-full border-0 border-b border-stone-200 bg-transparent px-1 py-1 text-center text-xs text-stone-500 outline-none placeholder:text-stone-300 focus:border-baimiao-mysteria/50"
            data-testid={`media-caption-${attrs.attachmentId}`}
          />
        ) : attrs.caption ? (
          <figcaption className="w-full text-center text-xs leading-relaxed text-stone-500 whitespace-pre-wrap">
            {attrs.caption}
          </figcaption>
        ) : null}
        {editable && selected && (
          <div className="flex items-center gap-1.5 text-[11px] text-stone-500" contentEditable={false}>
            {[25, 50, 75, 100].map((value) => (
              <button key={value} type="button" onClick={() => updateAttributes({ width: value })} className={attrs.width === value ? 'font-semibold text-baimiao-mysteria' : 'hover:text-stone-800'}>{value}%</button>
            ))}
            <span className="mx-0.5 text-stone-300">·</span>
            {(['left', 'center', 'right'] as const).map((value) => (
              <button key={value} type="button" onClick={() => updateAttributes({ align: value })} className={attrs.align === value ? 'font-semibold text-baimiao-mysteria' : 'hover:text-stone-800'}>{value === 'left' ? '左' : value === 'center' ? '中' : '右'}</button>
            ))}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}
