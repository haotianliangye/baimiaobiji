/**
 * #7 沉思模块 -- Blinko 风格富文本编辑器。
 *
 * 轻量实现：Markdown textarea + 格式工具栏（粗体/斜体/标题/列表/引用/代码）
 * + 标签提示（#标签 即时解析展示）+ 图片附件入口 + 编辑/预览切换。
 * 不引入重型富文本依赖，避免包体积与移动端兼容问题。
 *
 * 标签不在此组件内落库，仅实时解析展示；保存时由 thoughts.store 统一 parseTagsFromText
 * + resolveAlias + createTag 落库，保证口径一致。
 */
import React, { useRef, useState, useMemo } from 'react';
import {
  Bold,
  Italic,
  Heading,
  List,
  Quote,
  Code,
  Image as ImageIcon,
  Eye,
  PencilLine,
  Hash,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type AttachmentMeta } from '../db/db';
import { parseTagsFromText } from '../lib/tags';

export interface RichEditorProps {
  value: string;
  onChange: (value: string) => void;
  attachments?: AttachmentMeta[];
  onAttachmentsChange?: (attachments: AttachmentMeta[]) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** 编辑器最小高度（tailwind class 片段），默认 min-h-[120px] */
  minHeightClass?: string;
  /** 透传给 textarea 的 data-testid，供 E2E 定位（创建/编辑两个编辑器需区分）。 */
  textareaTestId?: string;
}

/** 工具栏按钮定义。wrap=行内包裹(如 **bold**)；linePrefix=行首前缀(如 "- ")。 */
interface ToolButton {
  key: string;
  label: string;
  icon: React.ReactNode;
  wrap?: [string, string];
  linePrefix?: string;
  placeholder?: string;
}

const TOOL_BUTTONS: ToolButton[] = [
  { key: 'bold', label: '粗体', icon: <Bold className="w-4 h-4" />, wrap: ['**', '**'], placeholder: '粗体' },
  { key: 'italic', label: '斜体', icon: <Italic className="w-4 h-4" />, wrap: ['*', '*'], placeholder: '斜体' },
  { key: 'heading', label: '标题', icon: <Heading className="w-4 h-4" />, linePrefix: '## ' },
  { key: 'list', label: '列表', icon: <List className="w-4 h-4" />, linePrefix: '- ' },
  { key: 'quote', label: '引用', icon: <Quote className="w-4 h-4" />, linePrefix: '> ' },
  { key: 'code', label: '代码', icon: <Code className="w-4 h-4" />, wrap: ['`', '`'], placeholder: '代码' },
];

export default function RichEditor({
  value,
  onChange,
  attachments = [],
  onAttachmentsChange,
  placeholder = '记录一条沉思... 支持 #标签 与 Markdown',
  autoFocus = false,
  minHeightClass = 'min-h-[120px]',
  textareaTestId,
}: RichEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showPreview, setShowPreview] = useState(false);

  // 实时解析 #标签用于展示（不落库，保存时统一处理）
  const previewTags = useMemo(() => parseTagsFromText(value), [value]);

  // 全局标签定义（用于展示标签是否已存在/补全提示，最小实现：仅展示当前文本中的标签）
  const allTags = useLiveQuery(() => db.tags.toArray(), []);
  const knownPaths = useMemo(() => new Set((allTags || []).map((t) => t.path)), [allTags]);

  /** 行内包裹：在选区两侧插入 before/after，无选区时插入占位符并选中。 */
  const applyWrap = (before: string, after: string, placeholderText: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.slice(start, end) || placeholderText;
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    onChange(next);
    // React 重渲染后恢复选区
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = start + before.length;
      ta.selectionEnd = start + before.length + selected.length;
    });
  };

  /** 行首前缀：在当前行行首插入 prefix（列表/引用/标题）。 */
  const applyLinePrefix = (prefix: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + prefix.length;
    });
  };

  const handleToolClick = (btn: ToolButton) => {
    if (btn.wrap) {
      applyWrap(btn.wrap[0], btn.wrap[1], btn.placeholder || '');
    } else if (btn.linePrefix) {
      applyLinePrefix(btn.linePrefix);
    }
  };

  /** 图片附件：读取为 data URL 存入 attachments.ref（最小实现，#6 完善 Blob 存储）。 */
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const meta: AttachmentMeta = { kind: 'image', ref: dataUrl, name: file.name };
      onAttachmentsChange?.([...attachments, meta]);
    };
    reader.readAsDataURL(file);
    // 重置 input 允许重复选择同一文件
    e.target.value = '';
  };

  const removeAttachment = (idx: number) => {
    onAttachmentsChange?.(attachments.filter((_, i) => i !== idx));
  };

  return (
    <div className="flex flex-col w-full bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
      {/* 工具栏 */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-stone-100 bg-stone-50/60 shrink-0">
        <div className="flex items-center gap-0.5">
          {TOOL_BUTTONS.map((btn) => (
            <button
              key={btn.key}
              type="button"
              title={btn.label}
              onClick={() => handleToolClick(btn)}
              className="w-7 h-7 flex items-center justify-center rounded-md text-stone-500 hover:text-baimiao-mysteria hover:bg-stone-200/50 transition-colors active:scale-95"
            >
              {btn.icon}
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-stone-200 mx-1" />
        <button
          type="button"
          title="插入图片"
          onClick={() => fileInputRef.current?.click()}
          className="w-7 h-7 flex items-center justify-center rounded-md text-stone-500 hover:text-baimiao-mysteria hover:bg-stone-200/50 transition-colors active:scale-95"
        >
          <ImageIcon className="w-4 h-4" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageSelect}
        />
        <div className="flex-1" />
        <button
          type="button"
          title={showPreview ? '编辑' : '预览'}
          onClick={() => setShowPreview(!showPreview)}
          className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors active:scale-95 ${
            showPreview
              ? 'text-baimiao-mysteria bg-baimiao-mysteria/10'
              : 'text-stone-500 hover:text-baimiao-mysteria hover:bg-stone-200/50'
          }`}
        >
          {showPreview ? <PencilLine className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>

      {/* 编辑区 / 预览区 */}
      {showPreview ? (
        <div
          className={`px-4 py-3 ${minHeightClass} max-h-[260px] overflow-y-auto thin-scrollbar markdown-body prose prose-stone baimiao-editorial-body prose-headings:font-serif baimiao-editorial-title max-w-none text-[14.5px] leading-relaxed`}
        >
          {value.trim() ? (
            <ReactMarkdown>{value}</ReactMarkdown>
          ) : (
            <span className="text-stone-400 text-[13px] not-prose">暂无内容可预览</span>
          )}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          data-testid={textareaTestId}
          className={`px-4 py-3 ${minHeightClass} max-h-[260px] overflow-y-auto thin-scrollbar w-full resize-none outline-none text-[14.5px] leading-relaxed text-stone-900 placeholder:text-stone-400 bg-transparent`}
        />
      )}

      {/* 附件预览（图片缩略图） */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 py-2 border-t border-stone-100 bg-stone-50/40">
          {attachments.map((att, idx) => (
            <div key={idx} className="relative group">
              {att.kind === 'image' && att.ref ? (
                <img
                  src={att.ref}
                  alt={att.name || '附件'}
                  className="w-14 h-14 object-cover rounded-lg border border-stone-200"
                />
              ) : (
                <div className="w-14 h-14 flex items-center justify-center rounded-lg border border-stone-200 bg-stone-100 text-stone-400">
                  <ImageIcon className="w-5 h-5" />
                </div>
              )}
              <button
                type="button"
                onClick={() => removeAttachment(idx)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-stone-800 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 标签提示行 */}
      <div className="flex items-center gap-1 flex-wrap px-3 py-1.5 border-t border-stone-100 bg-stone-50/40 min-h-[28px]">
        {previewTags.length === 0 ? (
          <span className="text-[10.5px] text-stone-400 flex items-center gap-1">
            <Hash className="w-2.5 h-2.5" />
            输入 #标签 自动归类
          </span>
        ) : (
          previewTags.map((tag) => (
            <span
              key={tag}
              className={`inline-flex items-center gap-0.5 text-[10.5px] px-2 py-0.5 rounded-full ${
                knownPaths.has(tag)
                  ? 'bg-baimiao-mysteria/8 text-baimiao-mysteria'
                  : 'bg-amber-50 text-amber-600'
              }`}
            >
              <Hash className="w-2.5 h-2.5 opacity-60" />
              {tag.split('/').pop()}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
