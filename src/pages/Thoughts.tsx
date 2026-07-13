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
import { useState, useRef, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import { db, type Thought, type AttachmentMeta } from '../db/db';
import { useThoughtsStore } from '../store/thoughts.store';
import { useTagsStore } from '../store/tags.store';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { countChars } from '../lib/wordCount';
import RichEditor from '../components/RichEditor';
import RandomWalk from '../components/RandomWalk';

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

function buildTimelineGroups(thoughts: Thought[]): TimelineGroup[] {
  const map = new Map<string, Thought[]>();
  const sorted = [...thoughts].sort((a, b) => b.created_at - a.created_at);
  for (const t of sorted) {
    const date = format(new Date(t.created_at), 'yyyy-MM-dd');
    if (!map.has(date)) map.set(date, []);
    map.get(date)!.push(t);
  }
  const today = format(new Date(), 'yyyy-MM-dd');
  const yesterday = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd');
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, items]) => {
      let label: string;
      if (date === today) label = '今天';
      else if (date === yesterday) label = '昨天';
      else label = format(new Date(date), 'M月d日');
      return { date, label, thoughts: items };
    });
}

export default function Thoughts() {
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
    if (!confirm('确认删除这条沉思笔记吗？')) return;
    await deleteThought(editingId);
    closeEdit();
  };

  const totalChars = useMemo(
    () => thoughts.reduce((sum, t) => sum + countChars(t.content), 0),
    [thoughts]
  );

  const timelineGroups = useMemo(() => buildTimelineGroups(thoughts), [thoughts]);

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Header */}
      <div className="flex h-[52px] items-center px-4 bg-[#faf9fc]/85 backdrop-blur border-b border-baimiao-border/40 z-20 shrink-0 w-full justify-between">
        <h2 className="text-[13.5px] font-bold tracking-wide text-baimiao-mysteria flex items-center gap-1.5 font-serif baimiao-editorial-title">
          <Notepad weight="regular" className="w-4 h-4 text-baimiao-mysteria/70 translate-y-[-0.8px] shrink-0" />
          沉思
          {thoughts.length > 0 && (
            <span className="text-[11px] font-medium text-stone-400 ml-1">{thoughts.length} 条 · {totalChars} 字</span>
          )}
        </h2>
        {/* 视图切换 + 随机漫步入口 */}
        <div className="flex items-center gap-1.5">
          <button
            data-testid="walk-open"
            onClick={() => setShowRandomWalk(true)}
            className="p-2 rounded-full text-amber-400 hover:bg-amber-50 transition-colors"
            title="随机漫步"
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
            瀑布流
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
            时间线
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
                  <span className="text-[10.5px] text-stone-400">{g.thoughts.length} 条</span>
                </div>
                {g.thoughts.map((t) => (
                  <ThoughtCard
                    key={t.id}
                    thought={t}
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
              <span className="text-[11px] text-stone-400 pl-1">{countChars(createContent)} 字</span>
              <div className="flex gap-2">
                <button
                  onClick={handleCloseCreate}
                  className="px-3.5 py-1.5 rounded-full text-[12.5px] font-medium text-stone-600 bg-white border border-stone-200 hover:bg-stone-50 transition-colors"
                >
                  取消
                </button>
                <button
                  data-testid="thought-create-save"
                  onClick={handleSaveCreate}
                  disabled={!createContent.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12.5px] font-medium text-white bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Save className="w-3.5 h-3.5" />
                  保存
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
            记录一条沉思...
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
                编辑沉思
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
                <label className="text-[11.5px] text-stone-500 shrink-0">展示时间</label>
                <input
                  type="datetime-local"
                  data-testid="thought-edit-created-at"
                  value={editCreatedAt}
                  onChange={(e) => setEditCreatedAt(e.target.value)}
                  className="flex-1 bg-stone-50 border border-stone-200 rounded-lg px-2 py-1 text-[12px] text-stone-700 outline-none focus:border-baimiao-mysteria/40"
                />
              </div>
              <p className="text-[10.5px] text-stone-400 px-1 -mt-1">
                修改展示时间不影响创建溯源时间（original_created_at 保留首次值）。
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
                删除
              </button>
              <div className="flex gap-2">
                <button
                  onClick={closeEdit}
                  className="px-3.5 py-1.5 rounded-full text-[12.5px] font-medium text-stone-600 bg-white border border-stone-200 hover:bg-stone-50 transition-colors"
                >
                  取消
                </button>
                <button
                  data-testid="thought-edit-save"
                  onClick={handleSaveEdit}
                  disabled={!editContent.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12.5px] font-medium text-white bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Save className="w-3.5 h-3.5" />
                  保存
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
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center select-none">
      <div className="text-baimiao-mysteria mb-4 bg-white p-3 rounded-xl shadow-[0_2px_10px_rgba(27,25,56,0.05)] border border-baimiao-mysteria/5">
        <Sparkles className="w-6 h-6 stroke-[1.5px] text-baimiao-mysteria/70" />
      </div>
      <p className="text-[15px] text-stone-900 font-medium tracking-tight mb-2 font-serif baimiao-editorial-title">
        沉思板块
      </p>
      <p className="text-[12.5px] text-stone-500 leading-relaxed max-w-[260px]">
        这里是你慢思考的沉淀空间——支持 Markdown、标签与附件的笔记系统。
      </p>
      <p className="text-[11px] text-stone-400 mt-3">点击下方输入框，记录第一条沉思</p>
    </div>
  );
}

/** 单条沉思卡片 */
interface ThoughtCardProps {
  thought: Thought;
  copied: boolean;
  onCopy: () => void;
  onEdit: () => void;
}

function ThoughtCard({ thought, copied, onCopy, onEdit }: ThoughtCardProps) {
  const tags = thought.tags || [];
  const attachments = thought.attachments || [];
  return (
    <div
      data-testid="thought-card"
      data-thought-id={thought.id}
      onDoubleClick={onEdit}
      className="baimiao-card-bubble p-3.5 cursor-pointer group select-none"
      title="双击编辑"
    >
      {/* 正文 Markdown */}
      {thought.content.trim() && (
        <div className="markdown-body prose prose-stone baimiao-editorial-body prose-headings:font-serif baimiao-editorial-title max-w-none text-[13.5px] leading-relaxed prose-h1:text-[16px] prose-h2:text-[15px] prose-h3:text-[14px]">
          <ReactMarkdown>{thought.content}</ReactMarkdown>
        </div>
      )}

      {/* 附件图片缩略图 */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {attachments.map((att, idx) =>
            att.kind === 'image' && att.ref ? (
              <img
                key={idx}
                src={att.ref}
                alt={att.name || '附件'}
                className="w-16 h-16 object-cover rounded-lg border border-stone-200"
              />
            ) : null
          )}
        </div>
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
          {copied ? '已复制' : '复制'}
        </button>
      </div>
    </div>
  );
}
