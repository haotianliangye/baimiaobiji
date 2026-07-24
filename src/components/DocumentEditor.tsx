/**
 * Issue #15 — DocumentEditor（共用 Tiptap 富文本编辑器，公开组件）
 *
 * 设计目标：替代旧的 textarea 风格 RichEditor.tsx，但暂不接入 Record/Thoughts。
 * 调用方迁移到本组件后，再删除旧 RichEditor。
 *
 * 公开 props（公开 seam）：
 *   - value: RichDocument
 *   - onChange(doc: RichDocument): void
 *   - onUpload(file: File): Promise<{ attachmentId, name, mimeType }>   ← 必填
 *   - placeholder?: string
 *   - autoFocus?: boolean
 *   - editable?: boolean                       默认 true
 *   - minHeightClass?: string
 *   - dataTestId?: string
 *
 * 行为约束：
 *   - 上传文件必须走 onUpload；禁止 data URL 持久化（node attrs 仅保留 attachmentId）
 *   - 媒体块独占行（block），与 editorSchema 单点事实源一致
 *   - 工具栏覆盖：粗体 / 斜体 / 行内代码 / 链接 / 标题(1-3) / 列表 / 引用 / 代码块 / 表格 / 对齐 / 上传
 *   - 工具栏通过 useEditor.commands 触发；上传通过命令插入媒体块
 *
 * 公开纯函数（供测试 / 上传 hook 共用）：
 *   - buildUploadedMediaKind(file): MediaKind
 *   - buildUploadResultToMedia(file, result): MediaAttrs
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Code as CodeIcon,
  Link as LinkIcon,
  Heading1,
  Heading2,
  Heading3,
  List as ListIcon,
  ListOrdered,
  Quote,
  Code2,
  Table as TableIcon,
  Upload,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Image as ImageIcon,
  Undo2,
  Redo2,
} from 'lucide-react';
import {
  createEditorExtensions,
  editorSelectionToBlockIndex,
  insertMediaNodeJson,
  makeMediaAttrs,
  mediaNodeKind,
  normalizeMediaAttrs,
  richDocumentToTiptapJSON,
  tiptapJSONToRichDocument,
  updateMediaAttrs,
  type MediaAttrs,
  type MediaKind,
  type RichDocument,
} from '../lib/editorExtensions';
import { normalizeDocument } from '../lib/documentModel';

// ---------------------------------------------------------------------------
// 公开纯函数（供测试与上传 hook 共用，零 React 依赖）
// ---------------------------------------------------------------------------

/** 根据文件 mimeType 推断媒体种类。 */
export function buildUploadedMediaKind(file: { type?: string; name?: string }): MediaKind {
  const t = String(file?.type || '').toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  // 兜底：看扩展名
  const name = String(file?.name || '').toLowerCase();
  if (/\.(png|jpe?g|gif|webp|avif|svg|bmp|heic|heif)$/.test(name)) return 'image';
  if (/\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/.test(name)) return 'audio';
  if (/\.(mp4|mov|m4v|webm|ogv|mkv)$/.test(name)) return 'video';
  return 'file';
}

/** 把 onUpload 返回的 { attachmentId, name, mimeType } 转换为 MediaAttrs。 */
export function buildUploadResultToMedia(
  file: { type?: string; name?: string },
  result: { attachmentId: string; name?: string; mimeType?: string },
): MediaAttrs {
  const kind = buildUploadedMediaKind(file);
  return makeMediaAttrs(kind, result.attachmentId, {
    name: result.name || file.name || '',
    mimeType: result.mimeType || file.type || '',
  });
}

/**
 * 由当前 editor selection 推导「doc.content 中的块下标」。
 * Issue #15 第二切片：上传必须按光标位置插入 → 调用 editor.state.selection.from
 * 单点事实源委托给 editorExtensions.editorSelectionToBlockIndex，避免散落实现。
 */
export function buildInsertPositionFromSelection(doc: RichDocument, fromPos: number): number {
  return editorSelectionToBlockIndex(doc, fromPos);
}

/**
 * 把媒体块插入到 doc 的 selection 位置（由 fromPos 推导 blockIndex）。
 * 纯函数：不修改原 doc；kind 由 caller 显式覆盖（不依赖 mimeType 推断）。
 */
export function insertMediaAtSelection(
  doc: RichDocument,
  fromPos: number,
  media: MediaAttrs,
  kindOverride?: MediaKind,
): RichDocument {
  return insertMediaNodeJson(doc, media, editorSelectionToBlockIndex(doc, fromPos), kindOverride);
}

// ---------------------------------------------------------------------------
// React 组件
// ---------------------------------------------------------------------------

export interface DocumentEditorProps {
  value: RichDocument;
  onChange: (doc: RichDocument) => void;
  /** 必填：上传文件。返回的 attachmentId 必须能在 db.attachments 中查到 Blob。 */
  onUpload: (file: File) => Promise<{ attachmentId: string; name?: string; mimeType?: string }>;
  placeholder?: string;
  autoFocus?: boolean;
  editable?: boolean;
  minHeightClass?: string;
  dataTestId?: string;
  /**
   * 可选：在工具栏下方显示一行 hint（例如：「# 输入 #标签 自动归类」）。
   * 用于沉淀页还原旧 RichEditor 视觉。
   */
  hint?: string;
  /** 自定义工具栏的 onBeforeUpload 钩子；返回 false 跳过。 */
  shouldUpload?: () => boolean;
}

/** 工具栏按钮定义。 */
interface ToolButton {
  key: string;
  label: string;
  icon: React.ReactNode;
  isActive?: (e: NonNullable<ReturnType<typeof useEditor>>) => boolean;
  onClick: (e: NonNullable<ReturnType<typeof useEditor>>) => void;
}

export default function DocumentEditor({
  value,
  onChange,
  onUpload,
  placeholder = '在这里写点什么…',
  autoFocus = false,
  editable = true,
  minHeightClass = 'min-h-[160px]',
  dataTestId = 'document-editor',
  hint,
  shouldUpload,
}: DocumentEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<MediaAttrs | null>(null);
  const [selectedMediaKind, setSelectedMediaKind] = useState<MediaKind | null>(null);

  // 归一化传入的 value，避免编辑器初始化时被空 text 节点炸掉
  const initialContent = useMemo(() => richDocumentToTiptapJSON(normalizeDocument(value)), []);

  const extensions = useMemo(() => createEditorExtensions({ editable }), [editable]);

  const editor = useEditor({
    extensions,
    editable,
    autofocus: autoFocus,
    content: initialContent,
    onUpdate({ editor }) {
      const json = tiptapJSONToRichDocument(editor.getJSON());
      onChange(json);
    },
  });

  // 外部 value 变化时同步（仅当与编辑器内部 JSON 不同时），避免无限循环
  useEffect(() => {
    if (!editor) return;
    const current = tiptapJSONToRichDocument(editor.getJSON());
    if (JSON.stringify(current) !== JSON.stringify(value)) {
      editor.commands.setContent(richDocumentToTiptapJSON(normalizeDocument(value)), { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  // 编辑态变化
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  // 工具栏按钮
  const buttons: ToolButton[] = useMemo(() => {
    if (!editor) return [];
    return [
      { key: 'bold', label: '加粗', icon: <Bold className="w-4 h-4" />, isActive: (e) => e.isActive('bold'), onClick: (e) => e.chain().focus().toggleBold().run() },
      { key: 'italic', label: '斜体', icon: <Italic className="w-4 h-4" />, isActive: (e) => e.isActive('italic'), onClick: (e) => e.chain().focus().toggleItalic().run() },
      { key: 'code', label: '行内代码', icon: <CodeIcon className="w-4 h-4" />, isActive: (e) => e.isActive('code'), onClick: (e) => e.chain().focus().toggleCode().run() },
      { key: 'link', label: '超链接', icon: <LinkIcon className="w-4 h-4" />, isActive: (e) => e.isActive('link'), onClick: (e) => { void e; setShowLinkDialog(true); } },
      { key: 'h1', label: '一级标题', icon: <Heading1 className="w-4 h-4" />, isActive: (e) => e.isActive('heading', { level: 1 }), onClick: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
      { key: 'h2', label: '二级标题', icon: <Heading2 className="w-4 h-4" />, isActive: (e) => e.isActive('heading', { level: 2 }), onClick: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
      { key: 'h3', label: '三级标题', icon: <Heading3 className="w-4 h-4" />, isActive: (e) => e.isActive('heading', { level: 3 }), onClick: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
      { key: 'ul', label: '无序列表', icon: <ListIcon className="w-4 h-4" />, isActive: (e) => e.isActive('bulletList'), onClick: (e) => e.chain().focus().toggleBulletList().run() },
      { key: 'ol', label: '有序列表', icon: <ListOrdered className="w-4 h-4" />, isActive: (e) => e.isActive('orderedList'), onClick: (e) => e.chain().focus().toggleOrderedList().run() },
      { key: 'quote', label: '引用', icon: <Quote className="w-4 h-4" />, isActive: (e) => e.isActive('blockquote'), onClick: (e) => e.chain().focus().toggleBlockquote().run() },
      { key: 'codeblock', label: '代码块', icon: <Code2 className="w-4 h-4" />, isActive: (e) => e.isActive('codeBlock'), onClick: (e) => e.chain().focus().toggleCodeBlock().run() },
      { key: 'table', label: '插入表格', icon: <TableIcon className="w-4 h-4" />, onClick: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
      { key: 'align-left', label: '左对齐', icon: <AlignLeft className="w-4 h-4" />, isActive: (e) => e.isActive({ textAlign: 'left' }), onClick: (e) => e.chain().focus().setTextAlign('left').run() },
      { key: 'align-center', label: '居中', icon: <AlignCenter className="w-4 h-4" />, isActive: (e) => e.isActive({ textAlign: 'center' }), onClick: (e) => e.chain().focus().setTextAlign('center').run() },
      { key: 'align-right', label: '右对齐', icon: <AlignRight className="w-4 h-4" />, isActive: (e) => e.isActive({ textAlign: 'right' }), onClick: (e) => e.chain().focus().setTextAlign('right').run() },
      { key: 'undo', label: '撤销', icon: <Undo2 className="w-4 h-4" />, onClick: (e) => e.chain().focus().undo().run() },
      { key: 'redo', label: '重做', icon: <Redo2 className="w-4 h-4" />, onClick: (e) => e.chain().focus().redo().run() },
    ];
  }, [editor]);

  // 上传：调用 onUpload，构造 attrs，使用 Tiptap command 在当前 selection 插入媒体块
  // 由 onUpdate 回调发出新 JSON；禁止手工 before.content 变异
  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!editor) return;
      if (shouldUpload && !shouldUpload()) return;
      const arr = Array.from(files);
      if (arr.length === 0) return;
      setUploadingCount((c) => c + arr.length);
      try {
        for (const file of arr) {
          try {
            const result = await onUpload(file);
            const kind = buildUploadedMediaKind(file);
            const media = buildUploadResultToMedia(file, result);
            const ok = editor
              .chain()
              .focus()
              .insertContent({ type: kind, attrs: media })
              .run();
            if (!ok) {
              console.warn('[DocumentEditor] media insertion failed');
            }
          } catch (err) {
            console.error('[DocumentEditor] upload failed:', err);
          }
        }
      } finally {
        setUploadingCount((c) => Math.max(0, c - arr.length));
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [editor, onUpload, shouldUpload],
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) void handleFiles(files);
  };

  // 超链接弹框
  const submitLink = () => {
    if (!editor) return;
    const url = linkUrl.trim();
    if (!url) {
      setShowLinkDialog(false);
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    setLinkUrl('');
    setShowLinkDialog(false);
  };

  return (
    <div
      data-testid={dataTestId}
      className="flex flex-col w-full bg-white rounded-2xl border border-stone-200/70 shadow-[0_2px_10px_rgb(0_0_0_/_0.03)] overflow-hidden focus-within:border-baimiao-mysteria/30 transition-colors"
    >
      {editable && (
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-stone-100 bg-stone-50/60 shrink-0 flex-wrap" data-testid="document-editor-toolbar">
          {buttons.map((btn) => {
            const active = editor && btn.isActive ? btn.isActive(editor) : false;
            return (
              <button
                key={btn.key}
                type="button"
                title={btn.label}
                data-testid={`document-editor-tool-${btn.key}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => btn.onClick(editor!)}
                className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors active:scale-95 ${
                  active
                    ? 'text-baimiao-mysteria bg-baimiao-mysteria/10'
                    : 'text-stone-500 hover:text-baimiao-mysteria hover:bg-stone-200/50'
                }`}
              >
                {btn.icon}
              </button>
            );
          })}
          <div className="w-px h-4 bg-stone-200 mx-1" />
          <button
            type="button"
            title="插入图片"
            data-testid="document-editor-upload-image"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className="w-7 h-7 flex items-center justify-center rounded-md text-stone-500 hover:text-baimiao-mysteria hover:bg-stone-200/50 transition-colors active:scale-95"
          >
            <ImageIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="上传任意媒体"
            data-testid="document-editor-upload"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className="w-7 h-7 flex items-center justify-center rounded-md text-stone-500 hover:text-baimiao-mysteria hover:bg-stone-200/50 transition-colors active:scale-95"
          >
            <Upload className="w-4 h-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            data-testid="document-editor-file-input"
            accept="image/*,audio/*,video/*,*/*"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          {uploadingCount > 0 && (
            <span data-testid="document-editor-uploading" className="text-[10.5px] text-stone-500 ml-1">
              上传中 {uploadingCount}…
            </span>
          )}
        </div>
      )}

      {/* 编辑区 */}
      <div
        className={`px-3 py-2 ${minHeightClass} overflow-y-auto thin-scrollbar baimiao-editorial-body`}
        data-testid={`${dataTestId}-content`}
      >
        <EditorContent editor={editor} />
        {editor && editor.isEmpty && placeholder && (
          <div className="text-stone-400 text-[14.5px] -mt-[1.6em] pointer-events-none select-none">
            {placeholder}
          </div>
        )}
      </div>

      {/* 可选 hint 行：标签提示等。沉淀页用「# 输入 #标签 自动归类」。 */}
      {editable && hint && (
        <div className="px-3 py-1.5 text-[11.5px] text-stone-400 border-t border-stone-100 bg-stone-50/40">
          {hint}
        </div>
      )}

      {/* 超链接弹框 */}
      {showLinkDialog && (
        <div
          data-testid="document-editor-link-dialog"
          className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-6"
          onClick={() => setShowLinkDialog(false)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-sm p-4 space-y-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[14px] font-semibold text-stone-700">插入超链接</h3>
            <input
              type="url"
              autoFocus
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitLink();
                }
              }}
              placeholder="https://example.com"
              data-testid="document-editor-link-input"
              className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-[14px] outline-none focus:border-baimiao-mysteria/40"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowLinkDialog(false)}
                className="px-3 py-1.5 text-[12.5px] text-stone-500 hover:text-stone-700"
              >
                取消
              </button>
              <button
                type="button"
                onClick={submitLink}
                data-testid="document-editor-link-submit"
                className="px-3 py-1.5 text-[12.5px] bg-baimiao-mysteria text-white rounded-md hover:brightness-110"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
