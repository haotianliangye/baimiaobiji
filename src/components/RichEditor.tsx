/**
 * #7 沉思模块 -- Blinko 风格富文本编辑器。
 *
 * 轻量实现：Markdown textarea + 格式工具栏（粗体/斜体/标题/列表/引用/代码）
 * + 通用上传 / 超链接 / 麦克风(STT) / #标签 / 更多（表格/代码块/内联代码/导出/预览）
 * + 标签提示（#标签 即时解析展示）+ 编辑/预览切换。
 * 不引入重型富文本依赖，避免包体积与移动端兼容问题。
 *
 * 标签不在此组件内落库，仅实时解析展示；保存时由 thoughts.store 统一 parseTagsFromText
 * + resolveAlias + createTag 落库，保证口径一致。
 */
import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
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
  Upload,
  Link as LinkIcon,
  Mic,
  MoreHorizontal,
  Table as TableIcon,
  Code2,
  Download,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type AttachmentMeta } from '../db/db';
import { parseTagsFromText } from '../lib/tags';
import { useTranslation } from '../lib/i18n';
import { useSettingsStore } from '../store/settings.store';

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
  labelKey: string;
  icon: React.ReactNode;
  wrap?: [string, string];
  linePrefix?: string;
  placeholderKey?: string;
}

const TOOL_BUTTONS: ToolButton[] = [
  { key: 'bold', labelKey: 'editor.bold', icon: <Bold className="w-4 h-4" />, wrap: ['**', '**'], placeholderKey: 'editor.bold' },
  { key: 'italic', labelKey: 'editor.italic', icon: <Italic className="w-4 h-4" />, wrap: ['*', '*'], placeholderKey: 'editor.italic' },
  { key: 'heading', labelKey: 'editor.heading', icon: <Heading className="w-4 h-4" />, linePrefix: '## ' },
  { key: 'list', labelKey: 'editor.list', icon: <List className="w-4 h-4" />, linePrefix: '- ' },
  { key: 'quote', labelKey: 'editor.quote', icon: <Quote className="w-4 h-4" />, linePrefix: '> ' },
  { key: 'code', labelKey: 'editor.code', icon: <Code className="w-4 h-4" />, wrap: ['`', '`'], placeholderKey: 'editor.codePlaceholder' },
];

/** 将音频 Blob 发送到 /api/transcribe 并返回转写文本。 */
async function transcribeAudioBlob(
  blob: Blob,
  mimeType: string,
): Promise<string> {
  const reader = new FileReader();
  await new Promise<void>((resolve, reject) => {
    reader.readAsDataURL(blob);
    reader.onloadend = () => resolve();
    reader.onerror = reject;
  });
  const base64data = (reader.result as string).split(',')[1];
  const settings = useSettingsStore.getState();
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_base64: base64data,
      mime_type: mimeType,
      settings,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Network error' }));
    throw new Error(err.error || `Transcribe failed: ${res.status}`);
  }
  const data = await res.json();
  return data.text || '';
}

export default function RichEditor({
  value,
  onChange,
  attachments = [],
  onAttachmentsChange,
  placeholder,
  autoFocus = false,
  minHeightClass = 'min-h-[120px]',
  textareaTestId,
}: RichEditorProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showPreview, setShowPreview] = useState(false);

  // 超链接弹框
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');

  // 更多菜单
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // 麦克风录音状态
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  // 实时解析 #标签用于展示（不落库，保存时统一处理）
  const previewTags = useMemo(() => parseTagsFromText(value), [value]);

  // 全局标签定义（用于展示标签是否已存在/补全提示，最小实现：仅展示当前文本中的标签）
  const allTags = useLiveQuery(() => db.tags.toArray(), []);
  const knownPaths = useMemo(() => new Set((allTags || []).map((t) => t.path)), [allTags]);

  const resolvedPlaceholder = placeholder || t('thoughts.quickInput');

  /** 行内包裹：在选区两侧插入 before/after，无选区时插入占位符并选中。 */
  const applyWrap = useCallback((before: string, after: string, placeholderText: string) => {
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
  }, [value, onChange]);

  /** 行首前缀：在当前行行首插入 prefix（列表/引用/标题）。 */
  const applyLinePrefix = useCallback((prefix: string) => {
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
  }, [value, onChange]);

  /** 在光标处插入纯文本（无包裹）。 */
  const insertAtCursor = useCallback((text: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + text.length;
    });
  }, [value, onChange]);

  const handleToolClick = (btn: ToolButton) => {
    if (btn.wrap) {
      applyWrap(btn.wrap[0], btn.wrap[1], btn.placeholderKey ? t(btn.placeholderKey) : '');
    } else if (btn.linePrefix) {
      applyLinePrefix(btn.linePrefix);
    }
  };

  // --- 通用上传 ---
  /** 通用上传：支持 image/audio/video 多选，读取为 data URL 存入 attachments.ref。 */
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const readers: Promise<AttachmentMeta>[] = [];
    for (const file of Array.from(files)) {
      let kind: AttachmentMeta['kind'] = 'file';
      if (file.type.startsWith('image/')) kind = 'image';
      else if (file.type.startsWith('audio/')) kind = 'audio';
      else if (file.type.startsWith('video/')) kind = 'video';
      readers.push(
        new Promise<AttachmentMeta>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve({ kind, ref: reader.result as string, name: file.name });
          };
          reader.onerror = () => resolve({ kind, name: file.name });
          reader.readAsDataURL(file);
        }),
      );
    }
    Promise.all(readers).then((metas) => {
      onAttachmentsChange?.([...attachments, ...metas]);
    });
    // 重置 input 允许重复选择同一文件
    e.target.value = '';
  };

  const removeAttachment = (idx: number) => {
    onAttachmentsChange?.(attachments.filter((_, i) => i !== idx));
  };

  // --- 超链接 ---
  const handleInsertLink = () => {
    const url = linkUrl.trim();
    if (!url) return;
    const text = linkText.trim();
    const ta = textareaRef.current;
    if (!ta) {
      // 无 textarea 引用时追加到末尾
      const md = text ? `[${text}](${url})` : `[${url}](${url})`;
      onChange(value + md);
    } else {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const selected = value.slice(start, end) || text || url;
      const md = `[${selected}](${url})`;
      const next = value.slice(0, start) + md + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        ta.focus();
        ta.selectionStart = start + 1;
        ta.selectionEnd = start + 1 + selected.length;
      });
    }
    setLinkUrl('');
    setLinkText('');
    setShowLinkDialog(false);
  };

  // --- 麦克风录音 + STT ---
  const handleMicToggle = async () => {
    if (isTranscribing) return;

    if (isRecording && mediaRecorderRef.current) {
      // 停止录音 -> 触发 onstop 转写
      try {
        if (mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch (e) { /* ignore */ }
      setIsRecording(false);
      return;
    }

    // 开始录音
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        let mimeType = mediaRecorder.mimeType;
        if (!mimeType) {
          const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
          mimeType = isIOS ? 'audio/mp4' : 'audio/webm';
        }
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        setIsTranscribing(true);
        try {
          const text = await transcribeAudioBlob(audioBlob, mimeType);
          if (text) {
            insertAtCursor(text);
          }
        } catch (err) {
          console.error('[RichEditor] STT failed:', err);
          insertAtCursor(t('editor.transcribeFailed'));
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      alert(t('editor.micError'));
    }
  };

  // --- 更多菜单 ---
  const handleInsertTable = () => {
    const col = t('editor.col');
    const table = `\n| ${col}1 | ${col}2 | ${col}3 |\n|---|---|---|\n|  |  |  |\n`;
    insertAtCursor(table);
    setShowMoreMenu(false);
  };

  const handleCodeBlock = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.slice(start, end) || t('editor.codePlaceholder');
    const wrapped = `\n\`\`\`\n${selected}\n\`\`\`\n`;
    const next = value.slice(0, start) + wrapped + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = start + 6; // skip "\n```\n"
      ta.selectionEnd = start + 6 + selected.length;
    });
    setShowMoreMenu(false);
  };

  const handleInlineCode = () => {
    applyWrap('`', '`', t('editor.codePlaceholder'));
    setShowMoreMenu(false);
  };

  const handleExport = () => {
    const blob = new Blob([value], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `thought-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowMoreMenu(false);
  };

  const handleTogglePreview = () => {
    setShowPreview((v) => !v);
    setShowMoreMenu(false);
  };

  // 点击外部关闭更多菜单
  useEffect(() => {
    if (!showMoreMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMoreMenu]);

  // 组件卸载时清理录音
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch (e) { /* ignore */ }
      }
    };
  }, []);

  const moreMenuItems = [
    { key: 'table', label: t('editor.table'), icon: <TableIcon className="w-4 h-4" />, onClick: handleInsertTable },
    { key: 'codeBlock', label: t('editor.codeBlock'), icon: <Code2 className="w-4 h-4" />, onClick: handleCodeBlock },
    { key: 'inlineCode', label: t('editor.inlineCode'), icon: <Code className="w-4 h-4" />, onClick: handleInlineCode },
    { key: 'export', label: t('editor.exportMd'), icon: <Download className="w-4 h-4" />, onClick: handleExport },
    { key: 'preview', label: t('editor.previewMd'), icon: showPreview ? <PencilLine className="w-4 h-4" /> : <Eye className="w-4 h-4" />, onClick: handleTogglePreview },
  ];

  return (
    <div className="flex flex-col w-full bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
      {/* 工具栏 */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-stone-100 bg-stone-50/60 shrink-0">
        {/* 格式按钮组 */}
        <div className="flex items-center gap-0.5">
          {TOOL_BUTTONS.map((btn) => (
            <button
              key={btn.key}
              type="button"
              title={t(btn.labelKey)}
              onClick={() => handleToolClick(btn)}
              className="w-7 h-7 flex items-center justify-center rounded-md text-stone-500 hover:text-baimiao-mysteria hover:bg-stone-200/50 transition-colors active:scale-95"
            >
              {btn.icon}
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-stone-200 mx-1" />
        {/* 通用上传 */}
        <button
          type="button"
          title={t('editor.upload')}
          onClick={() => fileInputRef.current?.click()}
          className="w-7 h-7 flex items-center justify-center rounded-md text-stone-500 hover:text-baimiao-mysteria hover:bg-stone-200/50 transition-colors active:scale-95"
        >
          <Upload className="w-4 h-4" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,audio/*,video/*"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        {/* 超链接 */}
        <button
          type="button"
          title={t('editor.hyperlink')}
          onClick={() => { setLinkUrl(''); setLinkText(''); setShowLinkDialog(true); }}
          className="w-7 h-7 flex items-center justify-center rounded-md text-stone-500 hover:text-baimiao-mysteria hover:bg-stone-200/50 transition-colors active:scale-95"
        >
          <LinkIcon className="w-4 h-4" />
        </button>
        {/* 麦克风 */}
        <button
          type="button"
          title={isRecording ? t('editor.recording') : isTranscribing ? t('editor.transcribing') : t('editor.micRecord')}
          onClick={handleMicToggle}
          disabled={isTranscribing}
          className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors active:scale-95 ${
            isRecording
              ? 'text-red-500 bg-red-50'
              : isTranscribing
                ? 'text-stone-400'
                : 'text-stone-500 hover:text-baimiao-mysteria hover:bg-stone-200/50'
          }`}
        >
          {isTranscribing ? (
            <span className="w-4 h-4 border-[1.5px] border-stone-300 border-t-baimiao-mysteria rounded-full animate-spin" />
          ) : isRecording ? (
            <span className="w-2.5 h-2.5 rounded-sm bg-red-500 animate-pulse" />
          ) : (
            <Mic className="w-4 h-4" />
          )}
        </button>
        {/* #标签 */}
        <button
          type="button"
          title={t('editor.tag')}
          onClick={() => insertAtCursor('#')}
          className="w-7 h-7 flex items-center justify-center rounded-md text-stone-500 hover:text-baimiao-mysteria hover:bg-stone-200/50 transition-colors active:scale-95"
        >
          <Hash className="w-4 h-4" />
        </button>
        {/* 更多 */}
        <div className="relative" ref={moreMenuRef}>
          <button
            type="button"
            title={t('editor.more')}
            onClick={() => setShowMoreMenu((v) => !v)}
            className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors active:scale-95 ${
              showMoreMenu
                ? 'text-baimiao-mysteria bg-baimiao-mysteria/10'
                : 'text-stone-500 hover:text-baimiao-mysteria hover:bg-stone-200/50'
            }`}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {showMoreMenu && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white rounded-xl shadow-lg border border-stone-200 py-1 min-w-[150px] animate-in fade-in zoom-in-95 duration-100">
              {moreMenuItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.onClick}
                  className="flex items-center gap-2 w-full px-3 py-2 text-[12.5px] text-stone-600 hover:text-baimiao-mysteria hover:bg-stone-50 transition-colors"
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1" />
        {/* 预览切换 */}
        <button
          type="button"
          title={showPreview ? t('editor.edit') : t('editor.preview')}
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
            <span className="text-stone-400 text-[13px] not-prose">{t('editor.noPreviewContent')}</span>
          )}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={resolvedPlaceholder}
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
                  alt={att.name || t('editor.attachment')}
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
            {t('editor.tagHint')}
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

      {/* 超链接弹框 */}
      {showLinkDialog && (
        <div
          className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-6"
          onClick={() => setShowLinkDialog(false)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-sm p-4 space-y-3 shadow-2xl animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[14px] font-semibold text-stone-700">{t('editor.hyperlink')}</h3>
            <div className="space-y-2">
              <div>
                <label className="text-[11px] text-stone-500 mb-0.5 block">{t('editor.linkUrlLabel')}</label>
                <input
                  type="url"
                  autoFocus
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleInsertLink(); } }}
                  placeholder={t('editor.linkUrlPlaceholder')}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-[14px] outline-none focus:border-baimiao-mysteria/40"
                />
              </div>
              <div>
                <label className="text-[11px] text-stone-500 mb-0.5 block">{t('editor.linkTextLabel')}</label>
                <input
                  type="text"
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleInsertLink(); } }}
                  placeholder={t('editor.linkTextPlaceholder')}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-[14px] outline-none focus:border-baimiao-mysteria/40"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowLinkDialog(false)}
                className="px-3.5 py-1.5 rounded-full text-[13px] font-medium text-stone-600 bg-white border border-stone-200 hover:bg-stone-50 transition-colors"
              >
                {t('record.cancel')}
              </button>
              <button
                onClick={handleInsertLink}
                disabled={!linkUrl.trim()}
                className="px-4 py-1.5 rounded-full text-[13px] font-medium text-white bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] hover:brightness-110 transition-all disabled:opacity-40"
              >
                {t('editor.insertLink')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
