import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format, startOfWeek, subDays, startOfDay, isSameDay, addDays, parse } from 'date-fns';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { db } from '../db/db';
import TodayStats from '../components/TodayStats';
import { countChars } from '../lib/wordCount';
import { formatDiaryMarkdown } from '../lib/utils';
import { washCitations } from '../lib/citationWash';
import ActionSheet from '../components/ActionSheet';
import ContextChat from '../components/ContextChat';
import { Trash2, ChevronDown, ChevronUp, RefreshCw, X, Sparkles, MessageCircle, Copy, Check, Activity, Save, Edit2, Loader2, CheckSquare, Square, Hash, Plus, Volume2, Square as SquareIcon } from 'lucide-react';
import { useAppStore } from '../store/app.store';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { useTTS } from '../lib/tts';
import { useSettingsStore, isDiarySlot } from '../store/settings.store';
import { normalizeTagPath, resolveAlias } from '../lib/tags';
import { useTagsStore } from '../store/tags.store';
import { useTranslation } from '../lib/i18n';

const generateUUID = () => {
  return self.crypto?.randomUUID?.() || Math.random().toString(36).substring(2);
};

// ——— Smart Popover positioning helper ———
// Returns CSS top (fixed) for the popover given the anchor DOMRect.
// Priority: above the anchor. Falls back to below if not enough room above.
const POPOVER_HEIGHT = 280; // approximate height of the 5-slot multi-select prompt menu
const POPOVER_GAP = 8;
const MENU_HALF_WIDTH = 135;
const MENU_SAFE_MARGIN = 280;

function calcPopoverTop(anchorRect: DOMRect): number {
  const spaceAbove = anchorRect.top;
  const spaceBelow = window.innerHeight - anchorRect.bottom;

  if (spaceAbove >= POPOVER_HEIGHT + POPOVER_GAP) {
    // Show above
    return Math.max(8, anchorRect.top - POPOVER_HEIGHT - POPOVER_GAP);
  } else if (spaceBelow >= POPOVER_HEIGHT + POPOVER_GAP) {
    // Show below
    return Math.min(anchorRect.bottom + POPOVER_GAP, window.innerHeight - POPOVER_HEIGHT - 8);
  } else {
    // Not enough room either way — pick the side with more space
    return spaceAbove > spaceBelow
      ? Math.max(8, anchorRect.top - POPOVER_HEIGHT - POPOVER_GAP)
      : Math.min(anchorRect.bottom + POPOVER_GAP, window.innerHeight - POPOVER_HEIGHT - 8);
  }
}

export default function Review() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isProcessingReviewMap, isProcessingDiary, generateReview, generateDiaryTimeline, diaryErrorMap, batchProgress, generateSelected } = useAppStore();
  const { copied, copy } = useCopyToClipboard();
  const { play, isPlaying } = useTTS();
  const { reviewPrompts, reviewPromptNames, reviewSelectedIndices, setSettings } = useSettingsStore();
  const WEEKS_TO_SHOW = 15;
  const today = new Date();

  const [searchParams, setSearchParams] = useSearchParams();
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  // 摘要独立折叠：仅 ai_summary 可通过 card header 展开/收起，正文始终完整显示
  const [expandedSummaryId, setExpandedSummaryId] = useState<string | null>(null);
  const [chatReviewId, setChatReviewId] = useState<string | null>(null);
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const [editText, setEditText] = useState<string>('');
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  // #104 多选模式互斥：回顾页当前无多选模式，保留状态与守卫以与拾微页一致，
  // 未来接入多选 UI 时只需切换该状态即可自动屏蔽双击编辑。
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);

  const handleSaveEdit = async (id: string) => {
     setIsSavingEdit(true);
     try {
       // V2: 日记编辑 ai_editorial，回顾编辑 ai_review
       const entry = await db.daily_reviews.get(id);
       if (entry?.entry_type === 'diary') {
         await db.daily_reviews.update(id, { ai_editorial: editText });
       } else {
         await db.daily_reviews.update(id, { ai_review: editText });
       }
       setEditingReviewId(null);
     } catch (err: any) {
       alert(t('review.saveFailed', { msg: err?.message || '' }));
     } finally {
       setIsSavingEdit(false);
     }
  };

  useEffect(() => {
     if (editingReviewId && editTextareaRef.current) {
        editTextareaRef.current.style.height = 'auto';
        editTextareaRef.current.style.height = editTextareaRef.current.scrollHeight + 'px';
     }
  }, [editText, editingReviewId]);

  // #4 标签编辑：为回顾卡片添加/删除标签
  const [addingTagToReview, setAddingTagToReview] = useState<string | null>(null);
  const [newTagInput, setNewTagInput] = useState('');
  const refreshAliases = useTagsStore(state => state.refreshAliases);
  useEffect(() => { refreshAliases(); }, [refreshAliases]);

  const addTagToReview = async (reviewId: string) => {
    const trimmed = newTagInput.trim();
    if (!trimmed) { setAddingTagToReview(null); return; }
    const { aliases, createTag } = useTagsStore.getState();
    const normalized = normalizeTagPath(trimmed);
    const resolved = resolveAlias(normalized, aliases);
    const review = await db.daily_reviews.get(reviewId);
    if (review) {
      const currentTags = review.tags || [];
      if (!currentTags.includes(resolved)) {
        await db.daily_reviews.update(reviewId, { tags: [...currentTags, resolved] });
      }
    }
    await createTag(resolved);
    setNewTagInput('');
    setAddingTagToReview(null);
  };

  const removeTagFromReview = async (reviewId: string, tagPath: string) => {
    const review = await db.daily_reviews.get(reviewId);
    if (review && review.tags) {
      await db.daily_reviews.update(reviewId, { tags: review.tags.filter(t => t !== tagPath) });
    }
  };

  const [contextMenuState, setContextMenuState] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
  }>({
    isOpen: false,
    x: 0,
    y: 0,
  });
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const [activeReview, setActiveReview] = useState<any>(null);
  const holdTimeoutRef = useRef<any>(null);
  // #104 单击/双击互斥：延迟单击折叠/展开，双击取消延迟并触发 inline 编辑
  const clickTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});
  // 移动端双击（double-tap）编辑：记录上次 tap 的时间与坐标
  const lastTapRef = useRef<{ reviewId: string | null; time: number; x: number; y: number }>({
    reviewId: null,
    time: 0,
    x: 0,
    y: 0,
  });
  const dateParam = searchParams.get('date');
  const [showPromptMenu, setShowPromptMenu] = useState(false);
  // Stores the DOMRect of the triggering button (viewport-relative, for fixed positioning)
  const [popoverRect, setPopoverRect] = useState<DOMRect | null>(null);
  const [targetDateForNewReview, setTargetDateForNewReview] = useState<string | null>(null);
  const [regeneratingReviewId, setRegeneratingReviewId] = useState<string | null>(null);
  // Tracks in-flight review generations (tempId -> true)
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});

  const openPromptMenu = (rect: DOMRect, opts: { dateStr?: string; reviewId?: string }) => {
    setPopoverRect(rect);
    setTargetDateForNewReview(opts.dateStr ?? null);
    setRegeneratingReviewId(opts.reviewId ?? null);
    setShowPromptMenu(true);
  };

  const closePromptMenu = () => {
    setShowPromptMenu(false);
    setPopoverRect(null);
  };

  const handleGenerateReviewWithPrompt = async (promptIndex: number) => {
    const targetDateStr = regeneratingReviewId
      ? null  // will be resolved from review record
      : targetDateForNewReview;

    closePromptMenu();

    if (regeneratingReviewId) {
      // Re-generate an existing review — we already have the review in the DB,
      // so we need to find its date first.
      const existingReview = await db.daily_reviews.get(regeneratingReviewId);
      if (!existingReview) return;
      const logsForDate = allLogs?.filter(
        log => format(new Date(log.created_at), 'yyyy-MM-dd') === existingReview.review_date
      ) || [];
      if (logsForDate.length === 0) {
        alert(t('review.noFragmentsRegen'));
        return;
      }
      if (existingReview.entry_type === 'diary') {
        await generateDiaryTimeline(existingReview.review_date, logsForDate, regeneratingReviewId, promptIndex);
      } else {
        const tempId = generateUUID();
        setPendingIds(prev => ({ ...prev, [tempId]: true }));
        try {
          await generateReview(tempId, existingReview.review_date, logsForDate, '', promptIndex);
        } finally {
          setPendingIds(prev => { const n = { ...prev }; delete n[tempId]; return n; });
        }
      }
      return;
    }

    if (!targetDateStr) return;
    const logsForDate = allLogs?.filter(
      log => format(new Date(log.created_at), 'yyyy-MM-dd') === targetDateStr
    ) || [];
    if (logsForDate.length === 0) {
      alert(t('review.noFragmentsGen'));
      return;
    }
    // #5: 新生成走 handleGenerateSelected，不走此路径
    if (isDiarySlot(promptIndex)) {
      await generateDiaryTimeline(targetDateStr, logsForDate, undefined, promptIndex);
    } else {
      const tempId = generateUUID();
      setPendingIds(prev => ({ ...prev, [tempId]: true }));
      try {
        await generateReview(tempId, targetDateStr, logsForDate, '', promptIndex);
      } finally {
        setPendingIds(prev => { const n = { ...prev }; delete n[tempId]; return n; });
      }
    }
  };

  // #5: 多选浮层 - 切换槽位选中状态（至少保留一项）
  const handleToggleSlot = (index: number) => {
    const current = reviewSelectedIndices || [];
    if (current.includes(index)) {
      // 取消选中 - 但至少保留一项
      if (current.length <= 1) return;
      setSettings({ reviewSelectedIndices: current.filter(i => i !== index) });
    } else {
      // 选中
      setSettings({ reviewSelectedIndices: [...current, index].sort((a, b) => a - b) });
    }
  };

  // #5: 多选浮层 - 生成所有选中槽位
  const handleGenerateSelected = async () => {
    const targetDateStr = targetDateForNewReview;
    closePromptMenu();
    if (!targetDateStr) return;
    const logsForDate = allLogs?.filter(
      log => format(new Date(log.created_at), 'yyyy-MM-dd') === targetDateStr
    ) || [];
    if (logsForDate.length === 0) {
      alert(t('review.noFragmentsGen'));
      return;
    }
    await generateSelected(targetDateStr, logsForDate, reviewSelectedIndices || [0, 1]);
  };

  // #5: 重新生成已有卡片（使用卡片原本的 promptIndex，不弹浮层）
  const handleRegenerateReview = async (review: any) => {
    const logsForDate = allLogs?.filter(
      log => format(new Date(log.created_at), 'yyyy-MM-dd') === review.review_date
    ) || [];
    if (logsForDate.length === 0) {
      alert(t('review.noFragmentsRegen'));
      return;
    }
    const promptIndex = review.prompt_index ?? (review.entry_type === 'diary' ? 0 : 1);
    if (review.entry_type === 'diary') {
      await generateDiaryTimeline(review.review_date, logsForDate, review.id, promptIndex);
    } else {
      const tempId = generateUUID();
      setPendingIds(prev => ({ ...prev, [tempId]: true }));
      try {
        await generateReview(tempId, review.review_date, logsForDate, '', promptIndex);
      } finally {
        setPendingIds(prev => { const n = { ...prev }; delete n[tempId]; return n; });
      }
    }
  };

  let targetDate = today;
  if (dateParam) {
    const parsed = parse(dateParam, 'yyyy-MM-dd', new Date());
    if (!isNaN(parsed.getTime())) {
      targetDate = parsed;
    }
  }

  const dateStr = format(targetDate, 'yyyy-MM-dd');

  const navigateToDate = (offset: number) => {
    const newDate = offset > 0 ? addDays(targetDate, offset) : subDays(targetDate, Math.abs(offset));
    setSearchParams({ date: format(newDate, 'yyyy-MM-dd') });
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const diffX = e.changedTouches[0].clientX - touchStartX.current;
    const diffY = e.changedTouches[0].clientY - touchStartY.current;

    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 60) {
      if (diffX > 0) {
        navigateToDate(-1);
      } else {
        if (!isTodayDate) navigateToDate(1);
      }
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  const isTodayDate = isSameDay(targetDate, today);

  const endDate = startOfDay(today);
  const startDate = startOfWeek(subDays(endDate, (WEEKS_TO_SHOW - 1) * 7));

  const allLogs = useLiveQuery(() => db.raw_logs.toArray(), []);
  // Query the independent daily_reviews table only
  const allReviews = useLiveQuery(() => db.daily_reviews.toArray(), []);

  // Group reviews by review_date, show only today's date
  const reviewsForDate = useMemo(() => {
    if (!allReviews) return [];
    return allReviews
      .filter(r => r.review_date === dateStr)
      .sort((a, b) => {
        // V2: 日记在前、回顾在后；同类按 prompt_index
        const typeA = a.entry_type === 'diary' ? 0 : 1;
        const typeB = b.entry_type === 'diary' ? 0 : 1;
        if (typeA !== typeB) return typeA - typeB;
        const idxA = a.prompt_index ?? 0;
        const idxB = b.prompt_index ?? 0;
        if (idxA !== idxB) return idxA - idxB;
        return b.updated_at - a.updated_at;
      });
  }, [allReviews, dateStr]);

  const dailyChars = useMemo(() => {
    return reviewsForDate.reduce((sum, review) => sum + countChars(review.ai_editorial || review.ai_review), 0);
  }, [reviewsForDate]);

  const lastAutoExpandedDateRef = useRef<string | null>(null);
  const prevReviewsCountRef = useRef(0);

  useEffect(() => {
    if (!allReviews) return;
    if (allReviews.length > prevReviewsCountRef.current) {
      lastAutoExpandedDateRef.current = null;
    }
    prevReviewsCountRef.current = allReviews.length;
  }, [allReviews]);

  useEffect(() => {
    if (reviewsForDate.length > 0 && lastAutoExpandedDateRef.current !== dateStr) {
      setExpandedDate(dateStr);
      setExpandedSummaryId(reviewsForDate[0].id);
      lastAutoExpandedDateRef.current = dateStr;
    } else if (reviewsForDate.length === 0) {
      setExpandedDate(null);
      setExpandedSummaryId(null);
      lastAutoExpandedDateRef.current = dateStr;
    }
  }, [dateStr, reviewsForDate]);

  const hasPendingForDate = Object.keys(pendingIds).some(id => pendingIds[id]);
  const logsCountForDate = allLogs?.filter(
    log => format(new Date(log.created_at), 'yyyy-MM-dd') === dateStr
  ).length ?? 0;

  return (
    <div className="flex flex-col h-full bg-transparent relative">
      <div
        className="flex-1 overflow-y-auto thin-scrollbar px-4 md:px-6 lg:px-8 py-4 md:py-6 flex flex-col"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
         {/* 批量生成进度浮动条 */}
         {batchProgress && batchProgress.type === 'review' && (
           <div className="mb-4 w-full animate-in fade-in">
             <div className="flex items-center gap-3 bg-gradient-to-r from-[#f6f3f9] to-[#ece7f4] border border-purple-200/30 rounded-xl px-4 py-3 shadow-sm">
               <div className="animate-spin rounded-full h-4 w-4 border-2 border-baimiao-mysteria border-t-transparent shrink-0" />
               <div className="flex-1 min-w-0">
                 <p className="text-[13px] font-medium text-baimiao-mysteria truncate">{t('review.batchGenerating', { current: batchProgress.current, total: batchProgress.total })}</p>
                 <div className="mt-1.5 h-1.5 bg-purple-100/60 rounded-full overflow-hidden">
                   <div
                     className="h-full bg-gradient-to-r from-baimiao-mysteria to-[#5d56b0] rounded-full transition-all duration-500"
                     style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                   />
                 </div>
               </div>
             </div>
           </div>
         )}

        <div className="flex-1 w-full mb-20 flex flex-col gap-3">
          {reviewsForDate.length === 0 && !hasPendingForDate ? (
            <div className="flex flex-col items-center justify-center py-8 w-full select-none">
              <p className="text-[13px] text-stone-400 mb-5 tracking-wider font-medium font-serif">{t('review.emptyTodayTitle')}</p>
              <div className="flex flex-col items-center justify-center p-8 bg-gradient-to-br from-baimiao-mysteria/[0.03] to-[#2c2957]/[0.01] rounded-2xl border border-baimiao-mysteria/10 shadow-[0_8px_30px_rgba(27,25,56,0.03)] text-center w-full max-w-[280px]">
                <div className="text-baimiao-mysteria mb-4 bg-white p-3 rounded-xl shadow-[0_2px_10px_rgba(27,25,56,0.05)] border border-baimiao-mysteria/5">
                  <Sparkles className="w-6 h-6 stroke-[1.5px] text-baimiao-mysteria/70 animate-pulse" />
                </div>
                <p className="text-[15px] text-stone-900 font-medium tracking-tight mb-2 font-serif baimiao-editorial-title">
                  {t('review.todayFragmentsCount', { count: logsCountForDate })}
                </p>
                <p className="text-[12.5px] text-stone-500 mb-6 leading-relaxed">{t('review.emptyTodayDesc')}</p>
                {/* 需求 1：空状态 AI 智能整理按钮上方今日统计 */}
                <TodayStats count={reviewsForDate.length} chars={dailyChars} className="w-full" />
                <button
                  disabled={logsCountForDate === 0}
                  onClick={(e) => openPromptMenu(e.currentTarget.getBoundingClientRect(), { dateStr })}
                  className={`w-full px-5 py-2.5 rounded-full text-[13px] font-medium tracking-wide flex items-center justify-center gap-2 transition-all ${
                    logsCountForDate > 0
                      ? "bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white hover:brightness-110 active:scale-[0.98] shadow-md shadow-baimiao-mysteria/10"
                      : "bg-stone-100 text-stone-400 cursor-not-allowed border border-stone-200/50"
                  }`}
                >
                  <Sparkles className="w-4 h-4 stroke-[1.5px]" />
                  {t('review.aiOrganize')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Pending spinner card */}
              {hasPendingForDate && (
                <div className="bg-white rounded-2xl border border-black/5 shadow-[0_2px_10px_rgb(0_0_0_/_0.02)] p-5 flex flex-col items-center gap-2">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-stone-400 border-t-transparent" />
                  <span className="text-[12px] text-stone-500 font-medium">{t('review.aiGeneratingStats')}</span>
                </div>
              )}

              {/* Reviews list */}
              {reviewsForDate.map((review) => {
                const isExpanded = expandedSummaryId === review.id;
                const isGenerating = isProcessingReviewMap[review.id] || (review.entry_type === 'diary' && isProcessingDiary);
                const errorMsg = diaryErrorMap[dateStr];
                const isEditing = editingReviewId === review.id;
                const entryLabel = review.entry_type === 'diary' ? t('review.diary') : t('review.review');
                const entryContent = review.ai_editorial || review.ai_review;

                return (
                  <div
                    key={review.id}
                    data-testid="review-card"
                    className="w-full overflow-hidden baimiao-card-review"
                    onClick={(e) => {
                      if (isEditing || isGenerating) return;
                      const target = e.target as HTMLElement;
                      const closestButton = target.closest('button');
                      if (closestButton && !closestButton.hasAttribute('data-card-header')) return;
                      if (target.closest('a, input, textarea')) return;
                      // 选中文本时不触发折叠/展开
                      const selection = typeof window !== 'undefined' && window.getSelection();
                      if (selection && !selection.isCollapsed) return;
                      // 单击/双击互斥：延迟折叠/展开，双击时取消
                      if (clickTimeoutsRef.current[review.id]) {
                        clearTimeout(clickTimeoutsRef.current[review.id]!);
                        clickTimeoutsRef.current[review.id] = null;
                      }
                      clickTimeoutsRef.current[review.id] = setTimeout(() => {
                        setExpandedSummaryId(isExpanded ? null : review.id);
                        clickTimeoutsRef.current[review.id] = null;
                      }, 250);
                    }}
                    onDoubleClick={(e) => {
                      // #104 双击触发 inline 编辑（textarea 获得焦点）
                      // #104 多选模式下双击不触发编辑（与拾微页一致）
                      if (isMultiSelectMode) return;
                      if (isEditing || isGenerating) return;
                      // 取消延迟的单击折叠/展开
                      if (clickTimeoutsRef.current[review.id]) {
                        clearTimeout(clickTimeoutsRef.current[review.id]!);
                        clickTimeoutsRef.current[review.id] = null;
                      }
                      const target = e.target as HTMLElement;
                      // 双击操作按钮/链接/输入框时不触发编辑
                      const closestButton = target.closest('button');
                      if (closestButton && !closestButton.hasAttribute('data-card-header')) return;
                      if (target.closest('a, input, textarea')) return;
                      setEditText(entryContent || '');
                      setEditingReviewId(review.id);
                      setExpandedSummaryId(review.id);
                    }}
                    onTouchStart={(e) => {
                      if (isEditing || isGenerating || isMultiSelectMode) return;
                      const touch = e.touches[0];
                      const x = touch.clientX;
                      const y = touch.clientY;
                      const now = Date.now();
                      const last = lastTapRef.current;
                      const isDoubleTap =
                        last.reviewId === review.id &&
                        now - last.time < 300 &&
                        Math.abs(last.x - x) < 10 &&
                        Math.abs(last.y - y) < 10;
                      if (isDoubleTap) {
                        lastTapRef.current = { reviewId: null, time: 0, x: 0, y: 0 };
                        // 取消延迟的单击折叠/展开，避免进入编辑后又触发收起
                        if (clickTimeoutsRef.current[review.id]) {
                          clearTimeout(clickTimeoutsRef.current[review.id]!);
                          clickTimeoutsRef.current[review.id] = null;
                        }
                        // 双击进入 inline 编辑（与桌面 onDoubleClick 同效）
                        const target = e.target as HTMLElement;
                        if (target.closest('button') && !target.closest('[data-card-header]')) return;
                        if (target.closest('a, input, textarea')) return;
                        setEditText(entryContent || '');
                        setEditingReviewId(review.id);
                        setExpandedSummaryId(review.id);
                        return;
                      }
                      lastTapRef.current = { reviewId: review.id, time: now, x, y };
                    }}
                    onContextMenu={(e) => {
                      if (isEditing) return;
                      e.preventDefault();
                      if (window.navigator?.vibrate) window.navigator.vibrate(50);
                      setActiveReview(review);
                      setContextMenuState({ isOpen: true, x: e.clientX, y: e.clientY });
                    }}
                  >
                    {/* Card header */}
                    <button
                      data-card-header
                      data-testid="review-card-header"
                      className="p-4 text-left hover:bg-stone-50 active:bg-stone-100 transition-colors flex flex-col gap-1.5 w-full relative"
                    >
                      <div className="flex justify-between items-center w-full">
                        <span className="text-[15px] font-semibold text-stone-800 font-mono tracking-tight leading-none">
                          {review.review_date}
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-stone-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-stone-400" />
                        )}
                      </div>
                      <span className={`text-[13px] text-stone-500 leading-relaxed pr-6 select-none ${isExpanded ? '' : 'line-clamp-2'}`}>
                        {review.ai_summary || t('review.noSummary')}
                      </span>
                    </button>

                    {/* Prompt label sub-header：收起时也显示 */}
                    <div data-testid="review-card-meta" className="px-4 py-1.5 border-t border-black/[0.03] bg-stone-50/60">
                      <span className="text-[11px] text-stone-400 font-medium">
                        {entryLabel} ({review.prompt_name || t('settings.promptDefault')}) · {format(new Date(review.updated_at), 'HH:mm')}
                      </span>
                    </div>

                    {/* #4 标签显示区（最小实现，卡片角落 chip 行）：收起时也显示添加按钮 */}
                    <div className="px-4 py-1.5 border-t border-black/[0.02] bg-stone-50/30 flex items-center gap-1 flex-wrap min-h-[28px]">
                      {(review.tags || []).map(tag => (
                        <span
                          key={tag}
                          data-testid={`review-tag-${tag}`}
                          className="inline-flex items-center gap-0.5 bg-baimiao-mysteria/8 text-baimiao-mysteria text-[10.5px] px-2 py-0.5 rounded-full select-none"
                        >
                          <Hash className="w-2.5 h-2.5 opacity-60" />
                          {tag.split('/').pop()}
                          <button
                            onClick={(e) => { e.stopPropagation(); removeTagFromReview(review.id, tag); }}
                            className="hover:text-rose-500 transition-colors ml-0.5"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </span>
                      ))}
                      {addingTagToReview === review.id ? (
                        <input
                          type="text"
                          value={newTagInput}
                          onChange={e => setNewTagInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.stopPropagation(); addTagToReview(review.id); }
                            if (e.key === 'Escape') { setAddingTagToReview(null); setNewTagInput(''); }
                          }}
                          onBlur={() => addTagToReview(review.id)}
                          placeholder={t('review.tagPlaceholder')}
                          className="bg-white border border-stone-200 rounded-full px-2 py-0.5 text-[10.5px] outline-none focus:border-baimiao-mysteria/40 w-24"
                          autoFocus
                        />
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setAddingTagToReview(review.id); setNewTagInput(''); }}
                          data-testid="tag-add-btn"
                          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-200/50 transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {isExpanded && (
                      <>
                        {/* 正文区：展开后显示完整内容与操作按钮 */}
                        <div className="px-4 pb-4 pt-2 border-t border-stone-100/60 bg-white">
                          {isGenerating ? (
                            <div className="flex flex-col items-center justify-center py-6 text-stone-400 text-[12px] gap-2 font-medium">
                              <div className="animate-spin rounded-full h-4 w-4 border-2 border-stone-400 border-t-transparent" />
                              <span>{t('review.aiGeneratingStatsReflection')}</span>
                            </div>
                          ) : isEditing ? (
                            <div className="flex flex-col gap-3 relative z-10 w-full animate-in fade-in zoom-in-95 duration-200">
                              <textarea
                                ref={editTextareaRef}
                                value={editText}
                                onChange={e => setEditText(e.target.value)}
                                className="w-full bg-white p-4 rounded-xl border border-stone-200 shadow-sm focus:outline-none focus:border-stone-300 focus:ring-2 focus:ring-stone-100 resize-none font-sans text-[15px] leading-relaxed text-stone-900 overflow-hidden min-h-[200px]"
                                placeholder={t('review.editPlaceholder')}
                                autoFocus
                              />
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[12px] text-stone-500 pl-1">{t('record.totalChars', { count: countChars(editText) })}</span>
                                <div className="flex gap-2 pr-1">
                                  <button
                                    onClick={() => setEditingReviewId(null)}
                                    className="px-4 py-2 rounded-full text-[13px] font-medium text-stone-600 bg-white border border-stone-200 hover:bg-stone-50 transition-colors shadow-sm select-none"
                                  >
                                    {t('review.cancel')}
                                  </button>
                                  <button
                                    onClick={() => handleSaveEdit(review.id)}
                                    disabled={isSavingEdit}
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium text-white bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] border border-white/10 hover:brightness-110 transition-all shadow-sm select-none disabled:opacity-60"
                                  >
                                    {isSavingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                    {isSavingEdit ? t('review.saving') : t('review.save')}
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : entryContent ? (
                            <>
                              <div
                                className="markdown-body prose prose-stone baimiao-editorial-body prose-h1:text-[19px] prose-h2:text-[17px] prose-h3:text-[16px] prose-h1:leading-snug prose-headings:font-medium prose-headings:font-serif baimiao-editorial-title max-w-none text-[15.5px] leading-relaxed select-text pointer-events-auto"
                              >
                                <ReactMarkdown
                                  components={{
                                    a: ({ node, href, children, ...props }) => {
                                        const handleClick = (e: React.MouseEvent) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          if (href?.startsWith('#log_id_')) {
                                          const logId = href.replace('#log_id_', '');
                                          navigate(`/?date=${review.review_date}&logId=${logId}`);
                                        }
                                      };
                                      return (
                                        <a
                                          href={href}
                                          onClick={handleClick}
                                          className="text-stone-500 bg-stone-200/50 hover:bg-stone-200 hover:text-stone-900 px-1.5 py-0.5 rounded cursor-pointer no-underline transition-colors border border-black/5"
                                          {...props}
                                        >
                                          {children}
                                        </a>
                                      );
                                    }
                                  }}
                                >
                                  {washCitations(formatDiaryMarkdown(entryContent))}
                                </ReactMarkdown>
                              </div>

                              {errorMsg && (
                                <div className="mt-3 text-[11px] text-rose-500 bg-rose-50 border border-rose-100 rounded-md py-1 px-2.5 leading-relaxed">
                                  {errorMsg}
                                </div>
                              )}

                              {isExpanded && (<>
                            <div className="flex flex-col gap-3 mt-4 pt-3 border-t border-stone-200/40 select-none px-2">
                              <div className="flex justify-between w-full">
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (confirm(t('review.confirmDelete'))) {
                                      await db.daily_reviews.delete(review.id);
                                    }
                                  }}
                                  className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-rose-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  {t('review.delete')}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (entryContent) {
                                      copy(entryContent);
                                    }
                                  }}
                                  className={`flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                                    copied
                                      ? 'text-emerald-600 bg-emerald-50'
                                      : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100'
                                  }`}
                                >
                                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                  {copied ? t('review.copied') : t('review.copy')}
                                </button>
                                <button
                                  data-testid="review-tts-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    play(entryContent);
                                  }}
                                  className={`flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                                    isPlaying(entryContent)
                                      ? 'text-baimiao-mysteria bg-baimiao-mysteria/5'
                                      : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100'
                                  }`}
                                >
                                  {isPlaying(entryContent) ? <SquareIcon className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                                  {isPlaying(entryContent) ? t('review.stopReading') : t('review.readAloud')}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditText(entryContent);
                                    setEditingReviewId(review.id);
                                  }}
                                  className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
                                >
                                  <Edit2 className="w-4 h-4" />
                                  {t('review.edit')}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRegenerateReview(review);
                                  }}
                                  className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
                                >
                                  <RefreshCw className="w-4 h-4" />
                                  {t('review.regenerate')}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedSummaryId(null);
                                  }}
                                  className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
                                >
                                  <ChevronUp className="w-4 h-4" />
                                  {t('review.collapse')}
                                </button>
                              </div>
                              
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setChatReviewId(chatReviewId === review.id ? null : review.id);
                                }}
                                className={`flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl text-[13px] font-medium transition-colors ${chatReviewId === review.id ? 'bg-stone-800 text-white' : 'bg-stone-100 hover:bg-stone-200 text-stone-700'}`}
                              >
                                <MessageCircle className="w-4 h-4" />
                                {t('review.aiFollowup')}
                              </button>
                            </div>
                            
                            {chatReviewId === review.id && (
                              <div className="-mx-4 px-4">
                                <ContextChat
                                  chatHistory={review.chat_history || []}
                                  contextContent={entryContent}
                                  apiEndpoint={review.entry_type === 'diary' ? '/api/diary-chat' : '/api/review-chat'}
                                  onUpdateHistory={async (newHistory) => {
                                    await db.daily_reviews.update(review.id, { chat_history: newHistory });
                                  }}
                                />
                              </div>
                            )}
                            </>)}
                          </>
                        ) : (
                          <div className="flex flex-col items-center justify-center py-6 px-3 text-center border border-dashed border-stone-200 rounded-lg bg-stone-50/50">
                            <span className="text-[12px] text-stone-500 mb-3 font-medium">{t('review.contentEmpty')}</span>
                            {errorMsg && (
                              <span className="text-[11px] text-rose-500 mb-2.5 block px-2 leading-relaxed bg-rose-50 border border-rose-100 rounded-md py-1">{errorMsg}</span>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRegenerateReview(review);
                              }}
                              className="px-4 py-1.5 text-[12px] bg-stone-800 text-white hover:bg-stone-900 active:scale-95 transition-all rounded-lg font-medium shadow-sm flex items-center gap-1"
                            >
                              {t('review.generateNow')}
                            </button>
                          </div>
                        )}
                      </div>
                      </>
                    )}
                  </div>
                );
              })}

              {/* 需求 1：卡片列表底部 AI 智能整理(追加)按钮上方今日统计 */}
              <TodayStats count={reviewsForDate.length} chars={dailyChars} />
              {/* Append new review button */}
              <button
                onClick={(e) => openPromptMenu(e.currentTarget.getBoundingClientRect(), { dateStr })}
                disabled={logsCountForDate === 0}
                className="w-full py-3 mt-2 border border-dashed border-stone-350 rounded-2xl bg-white/30 hover:bg-white/60 hover:border-stone-400 text-stone-500 hover:text-stone-700 transition-all flex items-center justify-center gap-1.5 text-[12px] font-medium active:scale-[0.99] disabled:opacity-40"
              >
                <Sparkles className="w-3.5 h-3.5 stroke-[1.5px]" />
                {t('review.aiOrganizeAppend')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* #5: 多选浮层 - Prompt 选择（日记/回顾/自定义1/2/3） */}
      {showPromptMenu && popoverRect && (
        <div
          className="fixed inset-0 z-[110] bg-black/10 backdrop-blur-[1px]"
          onClick={closePromptMenu}
        >
          <div
            className="absolute bg-gradient-to-r from-baimiao-mysteria/95 to-[#2c2957]/95 backdrop-blur-xl border border-white/10 rounded-2xl p-2 flex flex-col gap-1 shadow-[0_10px_30px_rgba(0,0,0,0.3)] z-[120] animate-in zoom-in-95 duration-100"
            style={{
              top: calcPopoverTop(popoverRect),
              left: Math.max(16, Math.min(
                popoverRect.left + (popoverRect.width - 220) / 2,
                window.innerWidth - 236
              )),
              width: '220px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[11px] font-semibold text-white/40 tracking-wider px-2.5 py-1.5 border-b border-white/5 flex justify-between items-center select-none">
              <span>{t('review.selectTemplate')}</span>
              <button
                onClick={closePromptMenu}
                className="hover:bg-white/10 p-0.5 rounded text-white/40 hover:text-white transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex flex-col gap-0.5 mt-1">
              {/* 生成 N 篇回顾 按钮 */}
              <button
                onClick={handleGenerateSelected}
                className="w-full py-2 px-2.5 bg-white/10 hover:bg-white/15 rounded-xl text-[12.5px] font-semibold text-purple-200 text-left active:scale-[0.98] transition-all border border-white/5 mb-1 flex items-center justify-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5 text-purple-300" />
                {t('review.generateNReviews', { count: (reviewSelectedIndices || [0, 1]).length })}
              </button>

              {/* 5 槽多选列表 */}
              {(reviewPromptNames || [t('settings.promptDiary'), t('settings.promptReview'), t('settings.promptCustom1'), t('settings.promptCustom2'), t('settings.promptCustom3')]).map((name, idx) => {
                const isSelected = (reviewSelectedIndices || [0, 1]).includes(idx);
                const hasContent = reviewPrompts[idx]?.trim().length > 0;
                const isFixed = idx < 2; // 日记/回顾 不可改名
                return (
                  <button
                    key={idx}
                    data-testid={`prompt-slot-${idx}`}
                    onClick={() => handleToggleSlot(idx)}
                    className={`w-full py-2 px-2.5 hover:bg-white/5 rounded-xl text-[12.5px] font-medium text-left active:scale-[0.98] transition-all flex items-center justify-between ${
                      isSelected ? 'text-white' : 'text-white/50'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {isSelected
                        ? <CheckSquare className="w-3.5 h-3.5 text-purple-300 shrink-0" />
                        : <Square className="w-3.5 h-3.5 text-white/30 shrink-0" />
                      }
                      {name}
                      {isFixed && <span className="text-[9px] text-white/30 font-normal">{t('settings.promptDefault')}</span>}
                    </span>
                    {hasContent && <span className="text-purple-300/60 text-[10px] font-normal">{t('review.configured')}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Long-press context menu */}
      {contextMenuState.isOpen && activeReview && (
        <div
          className="fixed inset-0 z-[100]"
          onClick={() => setContextMenuState({ ...contextMenuState, isOpen: false })}
          onTouchMove={() => setContextMenuState({ ...contextMenuState, isOpen: false })}
          onWheel={() => setContextMenuState({ ...contextMenuState, isOpen: false })}
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
                if (activeReview) {
                  const c = activeReview.ai_editorial || activeReview.ai_review;
                  if (c) copy(c);
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
              <span className="text-[10px] font-medium tracking-wide">{copied ? t('review.copied') : t('review.copyContent')}</span>
            </button>
            <button
              onClick={() => {
                if (activeReview) {
                  setEditText(activeReview.ai_editorial || activeReview.ai_review || '');
                  setEditingReviewId(activeReview.id);
                  setExpandedSummaryId(activeReview.id);
                }
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-white/90 hover:text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <Edit2 className="w-3.5 h-3.5 mb-1.5 text-white/80" />
              <span className="text-[10px] font-medium tracking-wide">{t('review.editContent')}</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setContextMenuState({ ...contextMenuState, isOpen: false });
                if (activeReview) {
                  handleRegenerateReview(activeReview);
                }
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-white/90 hover:text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5 mb-1.5 text-white/80" />
              <span className="text-[10px] font-medium tracking-wide">{t('review.regenerate')}</span>
            </button>
            <button
              onClick={async () => {
                if (activeReview && confirm(t('review.confirmDeleteContent'))) {
                  await db.daily_reviews.delete(activeReview.id);
                }
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-rose-400 hover:text-rose-300 transition-colors hover:bg-white/10 rounded-r-lg"
            >
              <Trash2 className="w-3.5 h-3.5 mb-1.5" />
              <span className="text-[10px] font-medium tracking-wide">{t('review.delete')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}