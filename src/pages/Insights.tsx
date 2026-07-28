import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Calendar, AlertCircle, ChevronDown, ChevronUp, Trash2, Copy, Check, RefreshCw, MessageCircle, Save, Edit2, Volume2, Square, Plus } from 'lucide-react';
import { Sun } from '@phosphor-icons/react';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { useTTS } from '../lib/tts';
import ReactMarkdown from 'react-markdown';
import ContextChat from '../components/ContextChat';
import { TagChip } from '../components/TagChip';
import { db, Insight } from '../db/db';
import { useAppStore } from '../store/app.store';
import { useMingwuStore } from '../store/mingwu.store';
import { useSettingsStore } from '../store/settings.store';
import { useTagsStore } from '../store/tags.store';
import { normalizeTagPath, resolveAlias } from '../lib/tags';
import { format, subDays } from 'date-fns';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatDiaryMarkdown } from '../lib/utils';
import { washCitations } from '../lib/citationWash';
import { VerifiedMarkdown } from '../components/VerifiedMarkdown';
import DatePickerPopover from '../components/DatePickerPopover';
import { MultiSlotPromptPopover, type MultiSlotPromptPopoverSlot } from '../components/MultiSlotPromptPopover';
import { useTranslation } from '../lib/i18n';
import { slotLabel } from '../lib/slotLabel';

const MENU_HALF_WIDTH = 140;
const MENU_SAFE_MARGIN = 296;

// #12: range_type 值 -> i18n key 映射（range_type 存英文值作标识符）
const RANGE_TYPE_KEY: Record<string, string> = {
  'day': 'insight.rangeDay',
  'week': 'insight.rangeWeek',
  'month': 'insight.rangeMonth',
  'quarter': 'insight.rangeQuarter',
  'half-year': 'insight.rangeHalfYear',
  'year': 'insight.rangeYear',
  'custom': 'insight.rangeCustom',
};


interface InsightCardProps {
  insight: Insight;
  isEditing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onDelete: (id: string) => void;
  onRegenerate: (insight: Insight) => void;
}

const InsightCard = ({ insight, isEditing, onStartEdit, onEndEdit, onDelete, onRegenerate }: InsightCardProps) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [contextMenuState, setContextMenuState] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
  }>({
    isOpen: false,
    x: 0,
    y: 0,
  });
  const holdTimeoutRef = useRef<any>(null);
  const { copied, copy } = useCopyToClipboard();
  const { play, isPlaying, getPhase } = useTTS();

  const [editText, setEditText] = useState(insight.content || '');
  const [isSaving, setIsSaving] = useState(false);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // #insight-manual-tags: 手动标签编辑（参照 Review.tsx addTagToReview 模式）
  const [addingTagToInsight, setAddingTagToInsight] = useState<string | null>(null);
  const [newTagInput, setNewTagInput] = useState('');
  const refreshAliases = useTagsStore((s) => s.refreshAliases);
  useEffect(() => { refreshAliases(); }, [refreshAliases]);

  const addTagToInsight = async (insightId: string) => {
    const trimmed = newTagInput.trim();
    if (!trimmed) { setAddingTagToInsight(null); return; }
    const { aliases, createTag } = useTagsStore.getState();
    const normalized = normalizeTagPath(trimmed);
    const resolved = resolveAlias(normalized, aliases);
    const current = await db.insights.get(insightId);
    if (current) {
      const currentTags = current.tags || [];
      if (!currentTags.includes(resolved)) {
        await db.insights.update(insightId, { tags: [...currentTags, resolved] });
      }
    }
    await createTag(resolved);
    setNewTagInput('');
    setAddingTagToInsight(null);
  };

  const removeTagFromInsight = async (insightId: string, tagPath: string) => {
    const current = await db.insights.get(insightId);
    if (current?.tags) {
      await db.insights.update(insightId, {
        tags: current.tags.filter((t) => t !== tagPath),
      });
    }
  };

  // C4 5 槽改造：insight_type 三态（mingwu/insight/custom）
  // - 'mingwu' / 'insight' 走默认固定名（i18n key）
  // - 'custom' 显示 insight.prompt_name（用户可改名的自定义槽名），无则 fallback 'insight.custom'
  const insightType = insight.insight_type;
  const isMingwuType = insightType === 'mingwu';
  const isInsightType = insightType === 'insight';
  const isCustomType = insightType === 'custom';
  const typeLabel = isMingwuType
    ? t('insight.mingwu')
    : isInsightType
      ? t('insight.insight')
      : (insight.prompt_name || t('insight.custom'));
  // 太阳图标色（mingwu/insight/custom 三态；custom 用 emerald 区别于前两者）
  const sunIconClass = isMingwuType
    ? 'text-baimiao-mysteria'
    : isInsightType
      ? 'text-stone-400'
      : 'text-emerald-600';
  const rangeTypeLabel = (range: string) => t(RANGE_TYPE_KEY[range] || 'insight.rangeCustom');

  useEffect(() => {
     setEditText(insight.content || '');
  }, [insight.content]);

  useEffect(() => {
     if (isEditing && editTextareaRef.current) {
        editTextareaRef.current.style.height = 'auto';
        editTextareaRef.current.style.height = editTextareaRef.current.scrollHeight + 'px';
     }
  }, [editText, isEditing]);

  const handleSaveEdit = async () => {
    if (!insight.id) return;
    setIsSaving(true);
    try {
      await db.insights.update(insight.id, { content: editText });
      onEndEdit();
    } catch (err: any) {
      alert(t('insight.saveFailed', { msg: err?.message || '' }));
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!expanded) {
       setShowChat(false);
    }
  }, [expanded]);

  const summary = insight.ai_summary || t('insight.noSummary');
  const title = insight.range_label;
  const headerDate = format(new Date(insight.created_at), 'MM-dd HH:mm');

  return (
    <>
    <div
      data-testid="insight-card"
      data-insight-type={insight.insight_type}
      id={`insight-${insight.id}`}
      className="w-full overflow-hidden baimiao-card-diary mb-4 relative"
      onTouchStart={(e) => {
         if (isEditing) return;
         const touch = e.touches[0];
         const x = touch.clientX;
         const y = touch.clientY;
         holdTimeoutRef.current = setTimeout(() => {
           if (window.navigator?.vibrate) window.navigator.vibrate(50);
           setContextMenuState({ isOpen: true, x, y });
         }, 500);
      }}
      onTouchEnd={() => clearTimeout(holdTimeoutRef.current)}
      onTouchMove={() => clearTimeout(holdTimeoutRef.current)}
      onContextMenu={(e) => {
         if (isEditing) return;
         e.preventDefault();
         if (window.navigator?.vibrate) window.navigator.vibrate(50);
         setContextMenuState({ isOpen: true, x: e.clientX, y: e.clientY });
      }}
    >
      {/* Card Header button - matches Diary/Review layout exactly */}
      <button
        type="button"
        onClick={() => { if (isEditing) return; setExpanded(!expanded); }}
        className="p-4 text-left hover:bg-stone-50 active:bg-stone-100 transition-colors flex flex-col gap-1.5 w-full relative select-none animate-in fade-in duration-200"
      >
        <div className="flex justify-between items-center w-full">
          <div className="flex items-center gap-2 min-w-0">
            <Sun weight="regular" className={`w-4 h-4 shrink-0 ${sunIconClass}`} />
            <span className="text-[15px] font-semibold text-stone-800 truncate">{title}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {expanded ? <ChevronUp className="w-4 h-4 text-stone-300" /> : <ChevronDown className="w-4 h-4 text-stone-300" />}
          </div>
        </div>
        <span className="text-[13px] text-stone-500 line-clamp-2 leading-relaxed pr-6 select-none">
          {summary}
        </span>
      </button>

      {isEditing ? (
        <div className="flex flex-col gap-3 relative z-10 w-full animate-in fade-in zoom-in-95 duration-200 p-4 border-t border-black/[0.03]">
          <textarea
            ref={editTextareaRef}
            value={editText}
            onChange={e => setEditText(e.target.value)}
            className="w-full bg-white p-4 rounded-xl border border-stone-200 shadow-sm focus:outline-none focus:border-stone-300 focus:ring-2 focus:ring-stone-100 resize-none font-sans text-[15px] leading-relaxed text-stone-900 overflow-hidden min-h-[200px]"
            placeholder={t('insight.editPlaceholder', { type: typeLabel })}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
          <div className="flex justify-end gap-2 pr-1">
            <button
              onClick={(e) => { e.stopPropagation(); onEndEdit(); }}
              className="px-4 py-2 rounded-full text-[13px] font-medium text-stone-600 bg-white border border-stone-200 hover:bg-stone-50 transition-colors shadow-sm select-none"
            >
              {t('insight.cancel')}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleSaveEdit(); }}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium text-white bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] border border-white/10 hover:brightness-110 transition-all shadow-sm select-none disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {isSaving ? t('insight.saving') : t('insight.save')}
            </button>
          </div>
        </div>
      ) : (
        <>
        {/* Prompt/range meta sub-header - mirrors Diary/Review's sub-header. 形态：洞察（明悟）· 10-16 10:16
            标题栏不再重复显示类型徽章和日期，统一收敛到这一行。 */}
        <div
          data-testid="insight-meta-subheader"
          className="px-4 py-1.5 border-t border-black/[0.03] bg-stone-50/60 text-[11px] text-stone-400 font-mono flex items-center justify-between select-none"
        >
          <span>{t('insight.title')}（{slotLabel(insight.prompt_name, insight.prompt_index, t, 'insight')}）· {headerDate}</span>
          <span>{rangeTypeLabel(insight.range_type)}</span>
        </div>
        {/* #insight-manual-tags: 手动标签编辑行 — 始终显示，参照 Review.tsx 模式。
            空标签时显示「+ 添加标签」带文字按钮，非空时只显示图标 + 现有 chip。 */}
        <div className="px-4 py-1.5 border-t border-black/[0.02] bg-stone-50/30 flex items-center gap-1 flex-wrap min-h-[28px]">
          {(insight.tags || []).map((tag) => (
            <TagChip
              key={tag}
              path={tag}
              testId={`insight-tag-${insight.id}-${tag}`}
              removable
              onRemove={() => removeTagFromInsight(insight.id!, tag)}
            />
          ))}
          {addingTagToInsight === insight.id ? (
            <input
              type="text"
              value={newTagInput}
              onChange={(e) => setNewTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.stopPropagation(); addTagToInsight(insight.id!); }
                if (e.key === 'Escape') { setAddingTagToInsight(null); setNewTagInput(''); }
              }}
              onBlur={() => addTagToInsight(insight.id!)}
              placeholder={t('insight.tagPlaceholder')}
              className="bg-white border border-stone-200 rounded-full px-2 py-0.5 text-[10.5px] outline-none focus:border-baimiao-mysteria/40 w-24"
              autoFocus
            />
          ) : (insight.tags?.length ?? 0) === 0 ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setAddingTagToInsight(insight.id || null);
                setNewTagInput('');
              }}
              data-testid="insight-tag-add-btn"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 transition-colors text-[10.5px]"
            >
              <Plus className="w-3 h-3" />
              <span>{t('insight.addTag')}</span>
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setAddingTagToInsight(insight.id || null);
                setNewTagInput('');
              }}
              data-testid="insight-tag-add-btn"
              className="inline-flex items-center justify-center w-5 h-5 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 transition-colors"
            >
              <Plus className="w-3 h-3" />
            </button>
          )}
        </div>
        {expanded && (
          <div
            data-testid="mingwu-card-content"
            className="px-4 pb-4 pt-3 border-t border-black/[0.03] markdown-body prose prose-stone max-w-none baimiao-editorial-body prose-h1:text-[19px] prose-h2:text-[17px] prose-h3:text-[16px] prose-headings:font-medium baimiao-editorial-title prose-p:text-baimiao-ink prose-li:text-baimiao-ink text-[15.5px] leading-relaxed relative z-10 selection:bg-stone-200 cursor-pointer"
            onClick={(e) => {
              if (isEditing) return;
              if ((e.target as HTMLElement).tagName.toLowerCase() === 'a') return;
              setExpanded(!expanded);
            }}
          >
             <VerifiedMarkdown markdown={formatDiaryMarkdown(insight.content)} />
          </div>
        )}
        </>
      )}

      {expanded && !isEditing && (
        <div className="flex flex-col gap-3 border-t border-black/[0.03] pt-3 pb-4 px-4 select-none">
          <div className="flex justify-between w-full">
            <button
               onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(t('insight.confirmDelete')) && insight.id) {
                     onDelete(insight.id);
                  }
               }}
               className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-rose-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
            >
               <Trash2 className="w-4 h-4" />
               {t('insight.delete')}
            </button>
            <button
               onClick={(e) => {
                  e.stopPropagation();
                  if (insight.content) {
                     copy(insight.content);
                  }
               }}
               className={`flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                  copied
                    ? 'text-emerald-600 bg-emerald-50'
                    : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100'
               }`}
            >
               {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
               {copied ? t('insight.copied') : t('insight.copy')}
            </button>
            <button
               data-testid="mingwu-tts-btn"
               onClick={(e) => {
                  e.stopPropagation();
                  play(insight.content);
               }}
               className={`flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                  isPlaying(insight.content)
                    ? 'text-baimiao-mysteria bg-baimiao-mysteria/5'
                    : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100'
               }`}
            >
               {isPlaying(insight.content) ? <Square className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
               {isPlaying(insight.content) ? t('insight.stopReading') : t('insight.readAloud')}
            </button>
            <button
               onClick={(e) => {
                  e.stopPropagation();
                  setEditText(insight.content || '');
                  onStartEdit();
               }}
               className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
            >
               <Edit2 className="w-4 h-4" />
               {t('insight.edit')}
            </button>
            <button
               onClick={(e) => { e.stopPropagation(); onRegenerate(insight); }}
               className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
            >
               <RefreshCw className="w-4 h-4" />
               {t('insight.regenerate')}
            </button>
            <button
               onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
               className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
            >
               <ChevronUp className="w-4 h-4" />
               {t('insight.collapse')}
            </button>
          </div>

          <button
             onClick={(e) => { e.stopPropagation(); setShowChat(!showChat); }}
             className={`flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl text-[13px] font-medium transition-colors ${showChat ? 'bg-stone-800 text-white' : 'bg-stone-100 hover:bg-stone-200 text-stone-700'}`}
          >
             <MessageCircle className="w-4 h-4" />
             {t('insight.chatWithAI')}
          </button>
        </div>
      )}

      {expanded && showChat && !isEditing && (
        <div className="border-t border-black/[0.03] p-4">
          <ContextChat
            chatHistory={insight.chat_history || []}
            contextContent={insight.content}
            apiEndpoint="/api/insight-chat"
            onUpdateHistory={async (newHistory) => {
              if (insight.id) {
                await db.insights.update(insight.id, { chat_history: newHistory });
              }
            }}
          />
        </div>
      )}


    </div>

    {contextMenuState.isOpen && (
        <div
          className="fixed inset-0 z-[100]"
          onClick={() => setContextMenuState({ ...contextMenuState, isOpen: false })}
          onTouchMove={(e) => { setContextMenuState({ ...contextMenuState, isOpen: false }) }}
          onWheel={(e) => { setContextMenuState({ ...contextMenuState, isOpen: false }) }}
        >
          <div
            className="absolute bg-gradient-to-r from-baimiao-mysteria/95 to-[#2c2957]/95 backdrop-blur-xl rounded-xl shadow-2xl flex items-center p-1 animate-in zoom-in-95 duration-100 divide-x divide-white/10"
            style={{
              top: contextMenuState.y > 100 ? contextMenuState.y - 75 : contextMenuState.y + 20,
              left: Math.max(16, Math.min(contextMenuState.x - MENU_HALF_WIDTH, window.innerWidth - MENU_SAFE_MARGIN)),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                 if (insight.content) {
                    copy(insight.content);
                 }
                 setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className={`flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 transition-colors rounded-l-lg disabled:opacity-50 ${
                copied
                  ? 'text-emerald-300 bg-white/10'
                  : 'text-white/90 hover:text-white hover:bg-white/10'
              }`}
            >
              {copied ? <Check className="w-3.5 h-3.5 mb-1.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5 mb-1.5 text-white/80" />}
              <span className="text-[10px] font-medium tracking-wide">{copied ? t('insight.copied') : t('insight.copy')}</span>
            </button>
            <button
              onClick={() => {
                setEditText(insight.content || '');
                onStartEdit();
                setExpanded(true);
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-white/90 hover:text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <Edit2 className="w-3.5 h-3.5 mb-1.5 text-white/80" />
              <span className="text-[10px] font-medium tracking-wide">{t('review.editContent')}</span>
            </button>
            <button
              onClick={() => {
                onRegenerate(insight);
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-white/90 hover:text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5 mb-1.5 text-white/80" />
              <span className="text-[10px] font-medium tracking-wide">{t('insight.regenerate')}</span>
            </button>
            <button
              onClick={() => {
                 if (insight.id) onDelete(insight.id);
                 setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-rose-400 hover:text-rose-300 transition-colors hover:bg-white/10 rounded-r-lg disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5 mb-1.5" />
              <span className="text-[10px] font-medium tracking-wide">{t('insight.delete')}{typeLabel}</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default function Insights() {
  const { t } = useTranslation();
  // 需求 6：时间范围与自定义日期从 app store 读取（顶部栏胶囊控制）
  const timeRange = useAppStore((s) => s.insightTimeRange);
  const customStart = useAppStore((s) => s.insightCustomStart);
  const customEnd = useAppStore((s) => s.insightCustomEnd);
  const setInsightCustomStart = useAppStore((s) => s.setInsightCustomStart);
  const setInsightCustomEnd = useAppStore((s) => s.setInsightCustomEnd);

  const { isGeneratingMingwu, mingwuError } = useAppStore();
  const { generateMingwu, regenerateMingwu } = useMingwuStore();
  // C4 5 槽改造：从 useSettingsStore 读取 5 槽 prompt + 当前选中
  const {
    mingwuInsightPrompts,
    mingwuInsightPromptNames,
    mingwuInsightSelectedIndices,
    setSettings,
  } = useSettingsStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [showFloatBtn, setShowFloatBtn] = useState(false);
  const floatBtnTimeoutRef = useRef<any>(null);

  // Edit state lifted to the page so the floating "生成洞察" button can
  // hide whenever any card is being edited/saved - otherwise its
  // pointer-events-auto overlay can intercept clicks on the Save/Cancel
  // buttons, making the save button look unresponsive.
  const [editingInsightId, setEditingInsightId] = useState<string | null>(null);

  // C4 5 槽浮层状态机
  const [showInsightPromptMenu, setShowInsightPromptMenu] = useState(false);
  const [insightPopoverRect, setInsightPopoverRect] = useState<DOMRect | null>(null);
  const openInsightPromptMenu = (rect: DOMRect) => {
    setInsightPopoverRect(rect);
    setShowInsightPromptMenu(true);
  };
  const closeInsightPromptMenu = () => {
    setShowInsightPromptMenu(false);
    setInsightPopoverRect(null);
  };
  // 至少保留 1 项；与 Review.handleToggleSlot 同语义
  const handleToggleInsightSlot = (index: number) => {
    const current = mingwuInsightSelectedIndices || [0, 1];
    if (current.includes(index)) {
      if (current.length <= 1) return;
      setSettings({ mingwuInsightSelectedIndices: current.filter((i) => i !== index) });
    } else {
      setSettings({ mingwuInsightSelectedIndices: [...current, index].sort((a, b) => a - b) });
    }
  };
  // 5 槽元数据（驱动 MultiSlotPromptPopover 渲染）
  const insightPopoverSlots: MultiSlotPromptPopoverSlot[] = (mingwuInsightPromptNames || [
    t('settings.promptMingwu'),
    t('settings.promptInsight'),
    t('settings.promptCustom1'),
    t('settings.promptCustom2'),
    t('settings.promptCustom3'),
  ]).map((name, idx) => ({
    name,
    hasContent: !!mingwuInsightPrompts?.[idx]?.trim().length,
    isFixed: idx < 2, // 明悟/洞察 不可改名
  }));

  const handleInteraction = useCallback(() => {
    setShowFloatBtn(true);
    if (floatBtnTimeoutRef.current) {
      clearTimeout(floatBtnTimeoutRef.current);
    }
    floatBtnTimeoutRef.current = setTimeout(() => {
      setShowFloatBtn(false);
    }, 5000);
  }, []);

  useEffect(() => {
    handleInteraction();
    return () => {
      if (floatBtnTimeoutRef.current) clearTimeout(floatBtnTimeoutRef.current);
    };
  }, [handleInteraction]);

  const insightList = useLiveQuery(() => db.insights.orderBy('created_at').reverse().toArray());

  // #random-walk-nav: 随机漫步双击跳转 — 滚动到目标 insight 并临时高亮
  const [searchParams] = useSearchParams();
  const insightIdParam = searchParams.get('insightId');
  useEffect(() => {
    if (!insightIdParam || !insightList) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`insight-${CSS.escape(insightIdParam)}`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('bg-baimiao-mysteria/10', 'transition-colors', 'duration-500');
        setTimeout(() => el.classList.remove('bg-baimiao-mysteria/10'), 2000);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [insightIdParam, insightList]);

  const computeRange = () => {
    const today = new Date();
    let startTime = today.getTime();
    let endTime = today.getTime();
    let rangeLabel = t('insight.rangeWeek');

    switch (timeRange) {
      case 'day':
        startTime = subDays(today, 1).getTime();
        rangeLabel = t('insight.rangeDay');
        break;
      case 'week':
        startTime = subDays(today, 7).getTime();
        rangeLabel = t('insight.rangeWeek');
        break;
      case 'month':
        startTime = subDays(today, 30).getTime();
        rangeLabel = t('insight.rangeMonth');
        break;
      case 'quarter':
        startTime = subDays(today, 90).getTime();
        rangeLabel = t('insight.rangeQuarter');
        break;
      case 'half-year':
        startTime = subDays(today, 180).getTime();
        rangeLabel = t('insight.rangeHalfYear');
        break;
      case 'year':
        startTime = subDays(today, 365).getTime();
        rangeLabel = t('insight.rangeYear');
        break;
      case 'custom':
        if (!customStart || !customEnd) {
           throw new Error(t('insight.rangeCustomError'));
        }
        startTime = new Date(customStart).getTime();
        endTime = new Date(customEnd).getTime() + 86400000;
        rangeLabel = `${customStart} ${t('insight.to')} ${customEnd}`;
        break;
    }
    return { startTime, endTime, rangeLabel };
  };

  const handleGenerate = async () => {
    try {
      const { startTime, endTime, rangeLabel } = computeRange();
      await generateMingwu({
        rangeType: timeRange,
        startTime,
        endTime,
        rangeLabel,
        // 不传 selectedIndices → 由 useMingwuStore 从 useSettingsStore 读取
      });
      setTimeout(() => {
        scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      }, 100);
    } catch (err: any) {
      console.error(err);
    }
  };

  // C4 5 槽改造：浮层「生成 N 篇洞察」按钮回调
  const handleGenerateSelectedInsights = async () => {
    closeInsightPromptMenu();
    try {
      const { startTime, endTime, rangeLabel } = computeRange();
      await generateMingwu({
        rangeType: timeRange,
        startTime,
        endTime,
        rangeLabel,
        selectedIndices: mingwuInsightSelectedIndices || [0, 1],
      });
      setTimeout(() => {
        scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      }, 100);
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleRegenerate = async (oldInsight: Insight) => {
    await regenerateMingwu(oldInsight);
    setTimeout(() => {
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 100);
  };

  const handleDelete = async (id: string) => {
    await db.insights.delete(id);
  };

  return (
    <div className="flex flex-col h-full bg-transparent relative overflow-hidden">
      {timeRange === 'custom' && (
        <div className="flex bg-white border-b border-stone-100 px-3 py-2.5 justify-center gap-2 items-center z-10 relative shadow-sm overflow-visible shrink-0">
          <DatePickerPopover
            value={customStart}
            onChange={setInsightCustomStart}
            placeholder={t('settings.startDate')}
            align="left"
          />
          <span className="text-stone-400 text-[12px] font-medium shrink-0">{t('insight.to')}</span>
          <DatePickerPopover
            value={customEnd}
            onChange={setInsightCustomEnd}
            placeholder={t('settings.endDate')}
            align="right"
          />
        </div>
      )}

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto thin-scrollbar px-4 md:px-8 lg:px-8 py-6 pb-32 flex flex-col"
        onClick={handleInteraction}
        onTouchStart={handleInteraction}
        onScroll={handleInteraction}
      >
        {mingwuError && (
          <div data-testid="mingwu-error" className="mb-6 px-4 py-3 bg-red-50 text-red-600 text-[13px] rounded-xl border border-red-100 flex items-center gap-2 animate-in fade-in shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {mingwuError}
          </div>
        )}

        {isGeneratingMingwu && (
          <div data-testid="mingwu-generating" className="flex flex-col items-center justify-center py-10 animate-in fade-in zoom-in duration-300 shrink-0">
            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-stone-100 flex items-center justify-center mb-4 relative">
               <div className="absolute inset-0 bg-stone-100/50 animate-pulse rounded-2xl"></div>
               <Loader2 className="w-8 h-8 text-stone-900 animate-spin relative z-10" />
            </div>
            <h3 className="text-[15px] text-stone-900 font-medium tracking-tight mb-1">{t('insight.generatingMingwu')}</h3>
            <p className="text-[13px] text-stone-500 font-mono">{t('insight.generatingMingwuDesc')}</p>
          </div>
        )}

        {insightList && insightList.length > 0 ? (
          <div data-testid="mingwu-card-list" className="flex flex-col w-full animate-in slide-in-from-bottom-4 fade-in duration-700">
            {insightList.map(mw => (
              <InsightCard
                key={mw.id}
                insight={mw}
                isEditing={editingInsightId === mw.id}
                onStartEdit={() => setEditingInsightId(mw.id || null)}
                onEndEdit={() => setEditingInsightId(null)}
                onDelete={handleDelete}
                onRegenerate={handleRegenerate}
              />
            ))}
          </div>
        ) : (
          !isGeneratingMingwu && (
            <div data-testid="mingwu-empty" className="flex flex-col items-center justify-center text-center mt-10 flex-1">
              <div className="w-20 h-20 bg-stone-100 rounded-full flex items-center justify-center mb-6">
                <Calendar className="w-8 h-8 text-stone-400 stroke-[1.5px]" />
              </div>
              <h3 className="text-[17px] text-stone-900 font-semibold tracking-tight mb-3">{t('insight.startTitle')}</h3>
              <p className="text-[14px] text-stone-500 mb-8 leading-relaxed max-w-[260px]">
                 {t('insight.startDesc')}
              </p>
            </div>
          )
        )}
      </div>

      {/* Floating generate button - hidden while a card is being edited
          so it can't intercept the Save/Cancel clicks below it. */}
      {!editingInsightId && (
      <div
        className={`fixed bottom-24 left-0 w-full flex justify-center pointer-events-none z-20 transition-opacity duration-500 max-w-md mx-auto right-0 ${(showFloatBtn || isGeneratingMingwu || (!insightList || insightList.length === 0)) ? 'opacity-100' : 'opacity-0'}`}
      >
        <button
          data-testid="mingwu-generate-btn"
          onClick={(e) => openInsightPromptMenu(e.currentTarget.getBoundingClientRect())}
          disabled={isGeneratingMingwu}
          className={`bg-gradient-to-r from-baimiao-mysteria/95 to-[#2c2957]/95 backdrop-blur-md border border-white/10 text-white px-6 py-2.5 rounded-full text-[13px] font-medium tracking-wide transition-all shadow-lg hover:shadow-xl active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:active:scale-100 min-w-[160px] ${(showFloatBtn || isGeneratingMingwu || (!insightList || insightList.length === 0)) ? 'pointer-events-auto' : 'pointer-events-none'}`}
        >
          {isGeneratingMingwu ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sun weight="regular" className="w-4 h-4" />}
          {isGeneratingMingwu
            ? t('insight.mingwuInProgress')
            : t('insight.generateNInsights', { count: (mingwuInsightSelectedIndices || [0, 1]).length })}
        </button>
      </div>
      )}

      {/* C4 5 槽多选浮层 — 复用 Review 的 MultiSlotPromptPopover */}
      <MultiSlotPromptPopover
        visible={showInsightPromptMenu}
        anchorRect={insightPopoverRect}
        slots={insightPopoverSlots}
        selectedIndices={mingwuInsightSelectedIndices || [0, 1]}
        onToggle={handleToggleInsightSlot}
        onGenerate={handleGenerateSelectedInsights}
        onClose={closeInsightPromptMenu}
        titleKey="insight.selectTemplate"
        generateLabelKey="insight.generateNInsights"
        testIdPrefix="insight-slot-"
        generateBtnTestId="insight-generate-n-btn"
      />
    </div>
  );
}
