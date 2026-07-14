/**
 * #7 沉思（Thoughts）笔记模块 -- flomo/Blinko 式慢思考沉淀空间。
 *
 * 功能：
 * - 列表默认瀑布流（CSS columns masonry），顶部可切换「瀑布流 / 时间线」。
 *   时间线按 created_at（可被用户修改的展示时间）分组。
 * - 底部快速输入框，点击展开 Blinko 风格富文本编辑器（RichEditor：格式工具栏 +
 *   标签入口 + 图片附件入口）。
 * - 双击记录进入编辑弹窗；可修改 content 与 created_at，original_created_at 保留
 *   首次值用于溯源。
 * - 标签：内容中的 #标签由 thoughts.store 统一 parseTagsFromText + resolveAlias +
 *   createTag 解析落库，存入 thought.tags。
 * - 附件：图片以 data URL 存 AttachmentMeta.ref（最小实现，#6 完善多媒体 Blob）。
 * - 删除/编辑用 db.thoughts.update/delete；embedding 由 embedding.ts 钩子自动索引。
 */
import { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import { Notepad } from '@phosphor-icons/react';
import {
  LayoutGrid,
  List as ListIcon,
  Plus,
  X,
  Trash2,
  Save,
  Hash,
  Clock,
  Copy,
  Check,
  Sparkles,
  Lightbulb,
  ChevronUp,
  ChevronDown,
  Film,
  Music,
} from 'lucide-react';
import { db, type Thought, type AttachmentMeta } from '../db/db';
import { useThoughtsStore } from '../store/thoughts.store';
import { useTagsStore } from '../store/tags.store';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { countChars } from '../lib/wordCount';
import RichEditor from '../components/RichEditor';
import RandomWalk from '../components/RandomWalk';
import { useTranslation } from '../lib/i18n';

type ViewMode = 'masonry' | 'timeline';

/** 毫秒时间戳 -> datetime-local input 所需的 yyyy-MM-ddTHH:mm（本地时区）。 */
function tsToDatetimeLocal(ts: number): string {
  return format(new Date(ts), "yyyy-MM-dd'T'HH:mm");
}

/** datetime-local 字符串 -> 毫秒时间戳（按本地时区解析）。 */
function datetimeLocalToTs(s: string): number {
  const t = new Date(s).getTime();
  return isNaN(t) ? Date.now() : t;
}

/** 时间线分组：按 created_at 的 yyyy-MM-dd 归并，组内按 created_at 倒序。 */
interface TimelineGroup {
  date: string; // yyyy-MM-dd
  label: string;
  thoughts: Thought[];
}

/** 时间线分组标签翻译函数类型（与 useTranslation().t 签名一致）。 */
type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

function buildTimelineGroups(thoughts: Thought[], t: TranslateFn): TimelineGroup[] {
  const map = new Map<string, Thought[]>();
  const sorted = [...thoughts].sort((a, b) => b.created_at - a.created_at);
  for (const thought of sorted) {
    const date = format(new Date(thought.created_at), 'yyyy-MM-dd');
    if (!map.has(date)) map.set(date, []);
    map.get(date)!.push(thought);
  }
  const today = format(new Date(), 'yyyy-MM-dd');
  const yesterday = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd');
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, items]) => {
      let label: string;
      if (date === today) label = t('thoughts.today');
      else if (date === yesterday) label = t('thoughts.yesterday');
      else label = format(new Date(date), t('thoughts.dateLabelFormat'));
      return { date, label, thoughts: items };
    });
}

export default function Thoughts() {
  const { t } = useTranslation();
  const { createThought, updateThought, deleteThought } = useThoughtsStore();
  const { copied, copy } = useCopyToClipboard();
  const refreshAliases = useTagsStore((s) => s.refreshAliases);
  useEffect(() => {
    refreshAliases();
  }, [refreshAliases]);

  const allThoughts = useLiveQuery(() => db.thoughts.toArray(), []);
  const thoughts = useMemo(
    () => (allThoughts || []).slice().sort((a, b) => b.created_at - a.created_at),
    [allThoughts]
  );

  const [view, setView] = useState<ViewMode>('masonry');

  // --- 随机漫步入口（#11） ---
  const [showRandomWalk, setShowRandomWalk] = useState(false);

  // --- 底部快速创建编辑器 ---
  const [isCreating, setIsCreating] = useState(false);
  const [createContent, setCreateContent] = useState('');
  const [createAttachments, setCreateAttachments] = useState<AttachmentMeta[]>([]);
  const createScrollRef = useRef<HTMLDivElement>(null);

  const handleOpenCreate = () => {
    setCreateContent('');
    setCreateAttachments([]);
    setIsCreating(true);
  };
  const handleCloseCreate = () => {
    setIsCreating(false);
    setCreateContent('');
    setCreateAttachments([]);
  };
  const handleSaveCreate = async () => {
    const text = createContent.trim();
    if (!text) return;
    await createThought({ content: text, attachments: createAttachments });
    handleCloseCreate();
  };

  // --- 编辑弹窗 ---
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editAttachments, setEditAttachments] = useState<AttachmentMeta[]>([]);
  const [editCreatedAt, setEditCreatedAt] = useState('');

  const openEdit = (thought: Thought) => {
    setEditingId(thought.id);
    setEditContent(thought.content);
    setEditAttachments(thought.attachments || []);
    setEditCreatedAt(tsToDatetimeLocal(thought.created_at));
  };
  const closeEdit = () => {
    setEditingId(null);
    setEditContent('');
    setEditAttachments([]);
    setEditCreatedAt('');
  };
  const handleSaveEdit = async () => {
    if (!editingId) return;
    const text = editContent.trim();
    if (!text) return;
    await updateThought(editingId, {
      content: text,
      attachments: editAttachments,
      created_at: datetimeLocalToTs(editCreatedAt),
    });
    closeEdit();
  };
  const handleDeleteEdit = async () => {
    if (!editingId) return;
    if (!confirm(t('thoughts.confirmDelete'))) return;
    await deleteThought(editingId);
    closeEdit();
  };

  const totalChars = useMemo(
    () => thoughts.reduce((sum, t) => sum + countChars(t.content), 0),
    [thoughts]
  );

  const timelineGroups = useMemo(() => buildTimelineGroups(thoughts, t), [thoughts, t]);

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Header */}
      <div className="flex h-[52px] items-center px-4 bg-[#faf9fc]/85 backdrop-blur border-b border-baimiao-border/40 z-20 shrink-0 w-full justify-between">
        <h2 className="text-[13.5px] font-bold tracking-wide text-baimiao-mysteria flex items-center gap-1.5 font-serif baimiao-editorial-title">
          <Notepad weight="regular" className="w-4 h-4 text-baimiao-mysteria/70 translate-y-[-0.8px] shrink-0" />
          {t('thoughts.title')}
          {thoughts.length > 0 && (
            <span className="text-[11px] font-medium text-stone-400 ml-1">{t('thoughts.countChars', { count: thoughts.length, chars: totalChars })}</span>
          )}
        </h2>
        {/* 视图切换 + 随机漫步入口 */}
        <div className="flex items-center gap-1.5">
          <button
            data-testid="walk-open"
            onClick={() => setShowRandomWalk(true)}
            className="p-2 rounded-full text-amber-400 hover:bg-amber-50 transition-colors"
            title={t('thoughts.randomWalk')}
          >
            <Lightbulb className="w-4 h-4" />
          </button>
          <div className="flex items-center bg-stone-100/80 rounded-full p-0.5">
          <button
            data-testid="view-masonry"
            onClick={() => setView('masonry')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-all ${
              view === 'masonry'
                ? 'bg-white text-baimiao-mysteria shadow-sm'
                : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            {t('thoughts.masonry')}
          </button>
          <button
            data-testid="view-timeline"
            onClick={() => setView('timeline')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-all ${
              view === 'timeline'
                ? 'bg-white text-baimiao-mysteria shadow-sm'
                : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            <ListIcon className="w-3.5 h-3.5" />
            {t('thoughts.timeline')}
          </button>
          </div>
        </div>
      </div>

      {/* 列表区（局部滚动，遵循移动端红线） */}
      <div ref={createScrollRef} className="flex-1 overflow-y-auto thin-scrollbar px-4 py-4">
        {thoughts.length === 0 ? (
          <EmptyState />
        ) : view === 'masonry' ? (
          <div className="columns-2 gap-2.5">
            {thoughts.map((t) => (
              <div key={t.id} className="break-inside-avoid mb-2.5">
                <ThoughtCard
                  thought={t}
                  view={view}
                  copied={copied}
                  onCopy={() => copy(t.content)}
                  onEdit={() => openEdit(t)}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {timelineGroups.map((g) => (
              <div key={g.date} className="flex flex-col gap-2.5">
                <div
                  data-testid="timeline-group"
                  data-date={g.date}
                  className="sticky top-0 z-10 bg-[#faf9fc]/90 backdrop-blur px-1 py-1 -mx-1 flex items-center gap-1.5"
                >
                  <Clock className="w-3 h-3 text-baimiao-mysteria/60" />
                  <span className="text-[12px] font-semibold text-baimiao-mysteria font-serif baimiao-editorial-title">
                    {g.label}
                  </span>
                  <span className="text-[10.5px] text-stone-400 font-mono">{g.date}</span>
                  <span className="text-[10.5px] text-stone-400">{t('thoughts.itemCount', { count: g.thoughts.length })}</span>
                </div>
                {g.thoughts.map((t) => (
                  <ThoughtCard
                    key={t.id}
                    thought={t}
                    view={view}
                    copied={copied}
                    onCopy={() => copy(t.content)}
                    onEdit={() => openEdit(t)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
        {/* 底部留白，避免被输入框遮挡 */}
        <div className="h-2" />
      </div>

      {/* 底部快速输入 / 展开编辑器 */}
      <div className="shrink-0 border-t border-baimiao-border/40 bg-[#faf9fc]/85 backdrop-blur px-3 py-2.5">
        {isCreating ? (
          <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <RichEditor
              value={createContent}
              onChange={setCreateContent}
              attachments={createAttachments}
              onAttachmentsChange={setCreateAttachments}
              autoFocus
              minHeightClass="min-h-[110px]"
              textareaTestId="thought-create-textarea"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-stone-400 pl-1">{t('thoughts.charCount', { count: countChars(createContent) })}</span>
              <div className="flex gap-2">
                <button
                  onClick={handleCloseCreate}
                  className="px-3.5 py-1.5 rounded-full text-[12.5px] font-medium text-stone-600 bg-white border border-stone-200 hover:bg-stone-50 transition-colors"
                >
                  {t('thoughts.cancel')}
                </button>
                <button
                  data-testid="thought-create-save"
                  onClick={handleSaveCreate}
                  disabled={!createContent.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12.5px] font-medium text-white bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Save className="w-3.5 h-3.5" />
                  {t('thoughts.save')}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            data-testid="thought-quick-input"
            onClick={handleOpenCreate}
            className="w-full flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white border border-stone-200/70 text-stone-400 hover:border-baimiao-mysteria/30 hover:text-stone-600 transition-colors text-[13px]"
          >
            <Plus className="w-4 h-4 text-baimiao-mysteria/60" />
            {t('thoughts.quickInput')}
          </button>
        )}
      </div>

      {/* 编辑弹窗 */}
      {editingId && (
        <div
          className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 animate-in fade-in duration-200"
          onClick={closeEdit}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-md max-h-[88vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹窗头 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 shrink-0">
              <span className="text-[13.5px] font-semibold text-baimiao-mysteria font-serif baimiao-editorial-title">
                {t('thoughts.editTitle')}
              </span>
              <button
                onClick={closeEdit}
                className="p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-full transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 弹窗内容（可滚动） */}
            <div className="flex-1 overflow-y-auto thin-scrollbar p-3 flex flex-col gap-3">
              <RichEditor
                value={editContent}
                onChange={setEditContent}
                attachments={editAttachments}
                onAttachmentsChange={setEditAttachments}
                minHeightClass="min-h-[160px]"
                textareaTestId="thought-edit-textarea"
              />

              {/* created_at 修改：original_created_at 保留用于溯源 */}
              <div className="flex items-center gap-2 px-1">
                <Clock className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                <label className="text-[11.5px] text-stone-500 shrink-0">{t('thoughts.displayTime')}</label>
                <input
                  type="datetime-local"
                  data-testid="thought-edit-created-at"
                  value={editCreatedAt}
                  onChange={(e) => setEditCreatedAt(e.target.value)}
                  className="flex-1 bg-stone-50 border border-stone-200 rounded-lg px-2 py-1 text-[12px] text-stone-700 outline-none focus:border-baimiao-mysteria/40"
                />
              </div>
              <p className="text-[10.5px] text-stone-400 px-1 -mt-1">
                {t('thoughts.displayTimeHint')}
              </p>
            </div>

            {/* 弹窗操作栏 */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100 shrink-0">
              <button
                data-testid="thought-edit-delete"
                onClick={handleDeleteEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-medium text-rose-500 hover:bg-rose-50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t('thoughts.delete')}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={closeEdit}
                  className="px-3.5 py-1.5 rounded-full text-[12.5px] font-medium text-stone-600 bg-white border border-stone-200 hover:bg-stone-50 transition-colors"
                >
                  {t('thoughts.cancel')}
                </button>
                <button
                  data-testid="thought-edit-save"
                  onClick={handleSaveEdit}
                  disabled={!editContent.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12.5px] font-medium text-white bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Save className="w-3.5 h-3.5" />
                  {t('thoughts.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 随机漫步覆盖层（#11） */}
      {showRandomWalk && (
        <RandomWalk onClose={() => setShowRandomWalk(false)} />
      )}
    </div>
  );
}

/** 空状态 */
function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center select-none">
      <div className="text-baimiao-mysteria mb-4 bg-white p-3 rounded-xl shadow-[0_2px_10px_rgba(27,25,56,0.05)] border border-baimiao-mysteria/5">
        <Sparkles className="w-6 h-6 stroke-[1.5px] text-baimiao-mysteria/70" />
      </div>
      <p className="text-[15px] text-stone-900 font-medium tracking-tight mb-2 font-serif baimiao-editorial-title">
        {t('thoughts.emptyTitle')}
      </p>
      <p className="text-[12.5px] text-stone-500 leading-relaxed max-w-[260px]">
        {t('thoughts.emptyDesc')}
      </p>
      <p className="text-[11px] text-stone-400 mt-3">{t('thoughts.emptyHint')}</p>
    </div>
  );
}

/** 单条沉思卡片 */
interface ThoughtCardProps {
  thought: Thought;
  view: ViewMode;
  copied: boolean;
  onCopy: () => void;
  onEdit: () => void;
}

/** 折叠态最大高度（按正文行高 ~22px 估算：时间线 7 行，瀑布流 12 行）。 */
const COLLAPSED_MAX_H_TIMELINE = 160; // px
const COLLAPSED_MAX_H_MASONRY = 270; // px
/** 缩略图网格：时间线一行 3 个 / 瀑布流一行 2 个；最多展示 2 行，超出显示 +N。 */
const THUMB_CAP_TIMELINE = 6; // 3 * 2
const THUMB_CAP_MASONRY = 4; // 2 * 2

/** Seam 5: 移动端长按阈值与取消判定（长按 = 进入编辑，对标桌面端双击）。 */
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_THRESHOLD = 10; // px，手指滑动超过该距离取消长按

function ThoughtCard({ thought, view, copied, onCopy, onEdit }: ThoughtCardProps) {
  const { t } = useTranslation();
  const tags = thought.tags || [];
  const attachments = thought.attachments || [];

  const collapsedMaxH = view === 'timeline' ? COLLAPSED_MAX_H_TIMELINE : COLLAPSED_MAX_H_MASONRY;
  const thumbCap = view === 'timeline' ? THUMB_CAP_TIMELINE : THUMB_CAP_MASONRY;

  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Seam 5: 移动端长按状态
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const longPressFired = useRef(false);

  // 测量内容是否超出折叠高度（ResizeObserver 兼顾图片加载后的高度变化）
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const check = () => setIsOverflowing(el.scrollHeight > collapsedMaxH + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsedMaxH, thought.content, attachments]);

  // 卸载时清理单击/长按计时器
  useEffect(() => {
    return () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  // 单击切换展开/折叠；300ms 内第二次点击判双击，取消单击进入编辑
  const handleCardClick = () => {
    // 长按已触发编辑时，吞掉手指抬起后合成的 click，避免再切换展开
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      onEdit();
      return;
    }
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      setExpanded((e) => !e);
    }, 300);
  };

  // Seam 5: 移动端长按 -> 进入编辑（对标桌面端双击）
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    touchStartPos.current = { x: touch.clientX, y: touch.clientY };
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      if (clickTimer.current) {
        clearTimeout(clickTimer.current);
        clickTimer.current = null;
      }
      onEdit();
    }, LONG_PRESS_MS);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const start = touchStartPos.current;
    if (!touch || !start) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (dx * dx + dy * dy > LONG_PRESS_MOVE_THRESHOLD * LONG_PRESS_MOVE_THRESHOLD) {
      // 手指移动过多（多为滚动），取消长按
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    // 长按已触发编辑时，touchend 会合成一次 click；longPressFired 由 handleCardClick 消费
  };

  // 阻止移动端长按弹出的系统上下文菜单/选区
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    setExpanded((x) => !x);
  };

  // 多媒体缩略图（image/video/audio），link 不计入缩略图网格
  const mediaAttachments = attachments.filter(
    (a) => a.kind === 'image' || a.kind === 'video' || a.kind === 'audio'
  );
  const showOverflow = mediaAttachments.length > thumbCap;
  const visibleMedia = showOverflow ? mediaAttachments.slice(0, thumbCap - 1) : mediaAttachments;
  const overflowCount = mediaAttachments.length - (thumbCap - 1);

  return (
    <div
      data-testid="thought-card"
      data-thought-id={thought.id}
      onClick={handleCardClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onContextMenu={handleContextMenu}
      className="baimiao-card-bubble p-3.5 cursor-pointer group select-none"
      title={t('thoughts.cardHint')}
    >
      {/* 可折叠内容区：正文 + 多媒体缩略图 */}
      <div
        ref={contentRef}
        style={!expanded && isOverflowing ? { maxHeight: `${collapsedMaxH}px` } : undefined}
        className="relative overflow-hidden"
      >
        {/* 正文 Markdown */}
        {thought.content.trim() && (
          <div className="markdown-body prose prose-stone baimiao-editorial-body prose-headings:font-serif baimiao-editorial-title max-w-none text-[13.5px] leading-relaxed prose-h1:text-[16px] prose-h2:text-[15px] prose-h3:text-[14px]">
            <ReactMarkdown>{thought.content}</ReactMarkdown>
          </div>
        )}

        {/* 多媒体缩略图：统一 1:1，时间线一行 3 个，瀑布流一行 2 个 */}
        {mediaAttachments.length > 0 && (
          <div className={`grid gap-1.5 mt-2 ${view === 'timeline' ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {visibleMedia.map((att, idx) => (
              <ThumbTile key={idx} att={att} name={att.name} />
            ))}
            {showOverflow && (
              <button
                type="button"
                onClick={toggleExpand}
                className="relative aspect-square rounded-lg overflow-hidden border border-stone-200 bg-stone-100/80 flex items-center justify-center text-stone-500 text-[13px] font-semibold hover:bg-stone-200/70 transition-colors"
              >
                {t('thoughts.moreCount', { count: overflowCount })}
              </button>
            )}
          </div>
        )}

        {/* 折叠态渐变遮罩 */}
        {!expanded && isOverflowing && (
          <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[#fdfdfc] via-[#fdfdfc]/80 to-transparent pointer-events-none" />
        )}
      </div>

      {/* 展开/收起按钮（仅在内容溢出时显示） */}
      {isOverflowing && (
        <button
          type="button"
          onClick={toggleExpand}
          className="mt-1.5 -mb-0.5 flex items-center gap-0.5 text-[11px] font-medium text-baimiao-mysteria/70 hover:text-baimiao-mysteria transition-colors"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? t('thoughts.collapse') : t('thoughts.expand')}
        </button>
      )}

      {/* 标签 */}
      {tags.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mt-2">
          {tags.map((tag) => (
            <span
              key={tag}
              data-testid={`thought-tag-${tag}`}
              className="inline-flex items-center gap-0.5 bg-baimiao-mysteria/8 text-baimiao-mysteria text-[10.5px] px-1.5 py-0.5 rounded-full"
            >
              <Hash className="w-2.5 h-2.5 opacity-60" />
              {tag.split('/').pop()}
            </span>
          ))}
        </div>
      )}

      {/* 卡片底栏：时间 + 复制 */}
      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-black/[0.04]">
        <span className="text-[10.5px] text-stone-400 font-mono flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          {format(new Date(thought.created_at), 'MM-dd HH:mm')}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
          className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10.5px] font-medium transition-colors ${
            copied
              ? 'text-emerald-600 bg-emerald-50'
              : 'text-stone-400 hover:text-stone-700 hover:bg-stone-100'
          }`}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? t('thoughts.copied') : t('thoughts.copy')}
        </button>
      </div>
    </div>
  );
}

/** 单个多媒体缩略图（1:1）：image 显示图片，video/audio 用图标占位。 */
function ThumbTile({ att, name }: { att: AttachmentMeta; name?: string }) {
  const { t } = useTranslation();
  if (att.kind === 'image' && att.ref) {
    return (
      <img
        src={att.ref}
        alt={name || t('record.image')}
        className="w-full aspect-square object-cover rounded-lg border border-stone-200"
      />
    );
  }
  if (att.kind === 'video') {
    return (
      <div className="w-full aspect-square rounded-lg border border-stone-200 bg-stone-100 flex items-center justify-center text-stone-400">
        <Film className="w-5 h-5" />
      </div>
    );
  }
  // audio
  return (
    <div className="w-full aspect-square rounded-lg border border-stone-200 bg-stone-100 flex items-center justify-center text-stone-400">
      <Music className="w-5 h-5" />
    </div>
  );
}
