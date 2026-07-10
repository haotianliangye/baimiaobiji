import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format, startOfWeek, subDays, startOfDay, isSameDay, addDays, parse } from 'date-fns';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { db } from '../db/db';
import CalendarHeatmap from '../components/CalendarHeatmap';
import { countChars } from '../lib/wordCount';
import { formatDiaryMarkdown } from '../lib/utils';
import { washCitations } from '../lib/citationWash';
import ActionSheet from '../components/ActionSheet';
import ContextChat from '../components/ContextChat';
import { Trash2, ChevronDown, ChevronUp, RefreshCw, X, Sparkles, MessageCircle, Copy, Activity, Save, Edit2, Loader2 } from 'lucide-react';
import { Clock } from '@phosphor-icons/react';
import { useAppStore } from '../store/app.store';
import { useSettingsStore, getActivePromptIndices } from '../store/settings.store';

const generateUUID = () => {
  return self.crypto?.randomUUID?.() || Math.random().toString(36).substring(2);
};

// ——— Smart Popover positioning helper ———
// Returns CSS top (fixed) for the popover given the anchor DOMRect.
// Priority: above the anchor. Falls back to below if not enough room above.
const POPOVER_HEIGHT = 192; // approximate height of the prompt menu
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
  const navigate = useNavigate();
  const { isProcessingReviewMap, generateReview, diaryErrorMap, batchProgress, generateAllReviews } = useAppStore();
  const { reviewPrompts } = useSettingsStore();
  const WEEKS_TO_SHOW = 15;
  const today = new Date();
  
  const [searchParams, setSearchParams] = useSearchParams();
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null);
  const [chatReviewId, setChatReviewId] = useState<string | null>(null);
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const [editText, setEditText] = useState<string>('');
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const handleSaveEdit = async (id: string) => {
     setIsSavingEdit(true);
     try {
       await db.daily_reviews.update(id, { ai_review: editText });
       setEditingReviewId(null);
     } catch (err: any) {
       alert('保存失败：' + (err?.message || '请重试'));
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
        alert('该天没有任何记录碎屑，无法重新生成回顾。');
        return;
      }
      const tempId = generateUUID();
      setPendingIds(prev => ({ ...prev, [tempId]: true }));
      try {
        await generateReview(tempId, existingReview.review_date, logsForDate, '', promptIndex);
      } finally {
        setPendingIds(prev => { const n = { ...prev }; delete n[tempId]; return n; });
      }
      return;
    }

    if (!targetDateStr) return;
    const logsForDate = allLogs?.filter(
      log => format(new Date(log.created_at), 'yyyy-MM-dd') === targetDateStr
    ) || [];
    if (logsForDate.length === 0) {
      alert('该天没有任何记录碎屑，无法生成回顾。');
      return;
    }
    const tempId = generateUUID();
    setPendingIds(prev => ({ ...prev, [tempId]: true }));
    try {
      await generateReview(tempId, targetDateStr, logsForDate, '', promptIndex);
    } finally {
      setPendingIds(prev => { const n = { ...prev }; delete n[tempId]; return n; });
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
        const idxA = a.review_prompt_index ?? 0;
        const idxB = b.review_prompt_index ?? 0;
        if (idxA !== idxB) return idxA - idxB;
        return b.updated_at - a.updated_at;
      });
  }, [allReviews, dateStr]);

  const dailyChars = useMemo(() => {
    return reviewsForDate.reduce((sum, review) => sum + countChars(review.ai_review), 0);
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
      setExpandedReviewId(reviewsForDate[0].id);
      lastAutoExpandedDateRef.current = dateStr;
    } else if (reviewsForDate.length === 0) {
      setExpandedDate(null);
      setExpandedReviewId(null);
      lastAutoExpandedDateRef.current = dateStr;
    }
  }, [dateStr, reviewsForDate]);

  const hasPendingForDate = Object.keys(pendingIds).some(id => pendingIds[id]);
  const logsCountForDate = allLogs?.filter(
    log => format(new Date(log.created_at), 'yyyy-MM-dd') === dateStr
  ).length ?? 0;

  return (
    <div className="flex flex-col h-full bg-transparent relative">
      <div className="flex h-[52px] items-center px-4 bg-[#faf9fc]/85 backdrop-blur border-b border-baimiao-border/40 z-20 shrink-0 w-full justify-between">
         <h2 className="text-[13.5px] font-bold tracking-wide text-baimiao-mysteria flex items-center gap-1.5 font-serif baimiao-editorial-title">
           <Clock weight="regular" className="w-4 h-4 text-baimiao-mysteria/70 translate-y-[-0.8px] shrink-0" />
           统计回顾
         </h2>
         <div className="flex items-center gap-3">
           <span className="inline-flex text-[11px] font-medium text-stone-500 bg-stone-100/80 px-2 py-1 rounded-full">
             今日 {dailyChars} 字
           </span>
           <button onClick={() => navigateToDate(-1)} className="p-1 hover:bg-stone-200/50 rounded-full transition-colors text-stone-400 hover:text-stone-700">
             <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
           </button>
           <button
             onClick={() => setShowHeatmap(true)}
             className="text-[13px] font-medium font-mono text-stone-700 w-[95px] text-center select-none hover:bg-stone-200/30 py-1 rounded-md transition-colors active:scale-95"
           >
             {dateStr}
           </button>
           <button
             onClick={() => navigateToDate(1)}
             disabled={isTodayDate}
             className="p-1 hover:bg-stone-200/50 rounded-full transition-colors text-stone-400 hover:text-stone-700 disabled:opacity-30 disabled:hover:bg-transparent"
           >
             <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
           </button>
         </div>
      </div>

      <div
        className="flex-1 overflow-y-auto thin-scrollbar p-6 flex flex-col items-center"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
         {/* 批量生成进度浮动条 */}
         {batchProgress && batchProgress.type === 'review' && (
           <div className="mb-4 w-full max-w-sm mx-auto animate-in fade-in">
             <div className="flex items-center gap-3 bg-gradient-to-r from-[#f6f3f9] to-[#ece7f4] border border-purple-200/30 rounded-xl px-4 py-3 shadow-sm">
               <div className="animate-spin rounded-full h-4 w-4 border-2 border-baimiao-mysteria border-t-transparent shrink-0" />
               <div className="flex-1 min-w-0">
                 <p className="text-[13px] font-medium text-baimiao-mysteria truncate">正在批量生成 ({batchProgress.current}/{batchProgress.total})...</p>
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

        <div className="w-full max-w-sm mb-20 flex flex-col gap-3">
          {reviewsForDate.length === 0 && !hasPendingForDate ? (
            <div className="flex flex-col items-center justify-center py-8 w-full select-none">
              <p className="text-[13px] text-stone-400 mb-5 tracking-wider font-medium font-serif">今天暂无任何回顾内容</p>
              <div className="flex flex-col items-center justify-center p-8 bg-gradient-to-br from-baimiao-mysteria/[0.03] to-[#2c2957]/[0.01] rounded-2xl border border-baimiao-mysteria/10 shadow-[0_8px_30px_rgba(27,25,56,0.03)] text-center w-full max-w-[280px]">
                <div className="text-baimiao-mysteria mb-4 bg-white p-3 rounded-xl shadow-[0_2px_10px_rgba(27,25,56,0.05)] border border-baimiao-mysteria/5">
                  <Sparkles className="w-6 h-6 stroke-[1.5px] text-baimiao-mysteria/70 animate-pulse" />
                </div>
                <p className="text-[15px] text-stone-900 font-medium tracking-tight mb-2 font-serif baimiao-editorial-title">
                  今天你积累了 {logsCountForDate} 条碎屑
                </p>
                <p className="text-[12.5px] text-stone-500 mb-6 leading-relaxed">让 AI 为你总结今天</p>
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
                  AI 智能回顾
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Pending spinner card */}
              {hasPendingForDate && (
                <div className="bg-white rounded-2xl border border-black/5 shadow-[0_2px_10px_rgb(0_0_0_/_0.02)] p-5 flex flex-col items-center gap-2">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-stone-400 border-t-transparent" />
                  <span className="text-[12px] text-stone-500 font-medium">AI 正在为您生成统计回顾…</span>
                </div>
              )}

              {/* Reviews list */}
              {reviewsForDate.map((review) => {
                const isReviewExpanded = expandedReviewId === review.id;
                const isGenerating = isProcessingReviewMap[review.id];
                const errorMsg = diaryErrorMap[dateStr];
                const isEditing = editingReviewId === review.id;

                return (
                  <div
                    key={review.id}
                    className="w-full overflow-hidden baimiao-card-review"
                    onTouchStart={(e) => {
                      if (isEditing) return;
                      const touch = e.touches[0];
                      const x = touch.clientX;
                      const y = touch.clientY;
                      holdTimeoutRef.current = setTimeout(() => {
                        if (window.navigator?.vibrate) window.navigator.vibrate(50);
                        setActiveReview(review);
                        setContextMenuState({ isOpen: true, x, y });
                      }, 500);
                    }}
                    onTouchEnd={() => clearTimeout(holdTimeoutRef.current)}
                    onTouchMove={() => clearTimeout(holdTimeoutRef.current)}
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
                      onClick={() => {
                        if (isEditing) return;
                        setExpandedReviewId(isReviewExpanded ? null : review.id);
                      }}
                      className="p-4 text-left hover:bg-stone-50 active:bg-stone-100 transition-colors flex flex-col gap-1.5 w-full relative"
                    >
                      <div className="flex justify-between items-center w-full">
                        <span className="text-[15px] font-semibold text-stone-800 font-mono tracking-tight leading-none">
                          {review.review_date}
                        </span>
                        {isReviewExpanded ? (
                          <ChevronUp className="w-4 h-4 text-stone-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-stone-400" />
                        )}
                      </div>
                      <span className="text-[13px] text-stone-500 line-clamp-2 leading-relaxed pr-6 select-none">
                        {review.ai_summary || '暂无内容概要'}
                      </span>
                    </button>

                    {/* Prompt label sub-header */}
                    <div className="px-4 py-1.5 border-t border-black/[0.03] bg-stone-50/60">
                      <span className="text-[11px] text-stone-400 font-medium">
                        回顾 ({review.review_prompt_name || '默认'}) · {format(new Date(review.updated_at), 'HH:mm')}
                      </span>
                    </div>

                    {/* Expanded content */}
                    {isReviewExpanded && (
                      <div className="px-4 pb-4 pt-2 border-t border-stone-100/60 bg-white">
                        {isGenerating ? (
                          <div className="flex flex-col items-center justify-center py-6 text-stone-400 text-[12px] gap-2 font-medium">
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-stone-400 border-t-transparent" />
                            <span>AI 正在为您生成统计回顾与反思…</span>
                          </div>
                        ) : isEditing ? (
                          <div className="flex flex-col gap-3 relative z-10 w-full animate-in fade-in zoom-in-95 duration-200">
                            <textarea
                              ref={editTextareaRef}
                              value={editText}
                              onChange={e => setEditText(e.target.value)}
                              className="w-full bg-white p-4 rounded-xl border border-stone-200 shadow-sm focus:outline-none focus:border-stone-300 focus:ring-2 focus:ring-stone-100 resize-none font-sans text-[15px] leading-relaxed text-stone-900 overflow-hidden min-h-[200px]"
                              placeholder="开始编辑回顾..."
                              autoFocus
                            />
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[12px] text-stone-500 pl-1">共 {countChars(editText)} 字</span>
                              <div className="flex gap-2 pr-1">
                                <button
                                  onClick={() => setEditingReviewId(null)}
                                  className="px-4 py-2 rounded-full text-[13px] font-medium text-stone-600 bg-white border border-stone-200 hover:bg-stone-50 transition-colors shadow-sm select-none"
                                >
                                  取消
                                </button>
                                <button
                                  onClick={() => handleSaveEdit(review.id)}
                                  disabled={isSavingEdit}
                                  className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium text-white bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] border border-white/10 hover:brightness-110 transition-all shadow-sm select-none disabled:opacity-60"
                                >
                                  {isSavingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                  {isSavingEdit ? '保存中' : '保存'}
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : review.ai_review ? (
                          <>
                            <div 
                              className="markdown-body prose prose-stone baimiao-editorial-body prose-h1:text-[19px] prose-h2:text-[17px] prose-h3:text-[16px] prose-h1:leading-snug prose-headings:font-medium prose-headings:font-serif baimiao-editorial-title max-w-none text-[15.5px] leading-relaxed select-text pointer-events-auto cursor-pointer"
                              onClick={(e) => {
                                // 避免点击内部链接时触发收起
                                if ((e.target as HTMLElement).tagName.toLowerCase() === 'a') return;
                                setExpandedReviewId(null);
                              }}
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
                                {washCitations(formatDiaryMarkdown(review.ai_review))}
                              </ReactMarkdown>
                            </div>

                            {errorMsg && (
                              <div className="mt-3 text-[11px] text-rose-500 bg-rose-50 border border-rose-100 rounded-md py-1 px-2.5 leading-relaxed">
                                {errorMsg}
                              </div>
                            )}

                            <div className="flex flex-col gap-3 mt-4 pt-3 border-t border-stone-200/40 select-none px-2">
                              <div className="flex justify-between w-full">
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (confirm('确认删除这篇回顾吗？')) {
                                      await db.daily_reviews.delete(review.id);
                                    }
                                  }}
                                  className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-rose-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  删除
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (review.ai_review) {
                                      navigator.clipboard.writeText(review.ai_review);
                                      alert('回顾已复制到剪贴板');
                                    }
                                  }}
                                  className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
                                >
                                  <Copy className="w-4 h-4" />
                                  复制
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditText(review.ai_review || '');
                                    setEditingReviewId(review.id);
                                  }}
                                  className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
                                >
                                  <Edit2 className="w-4 h-4" />
                                  编辑
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openPromptMenu(e.currentTarget.getBoundingClientRect(), { reviewId: review.id });
                                  }}
                                  className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
                                >
                                  <RefreshCw className="w-4 h-4" />
                                  重新生成
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedReviewId(null);
                                  }}
                                  className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
                                >
                                  <ChevronUp className="w-4 h-4" />
                                  收起
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
                                AI 追问
                              </button>
                            </div>
                            
                            {chatReviewId === review.id && (
                              <div className="-mx-4 px-4">
                                <ContextChat
                                  chatHistory={review.chat_history || []}
                                  contextContent={review.ai_review || ''}
                                  apiEndpoint="/api/review-chat"
                                  onUpdateHistory={async (newHistory) => {
                                    await db.daily_reviews.update(review.id, { chat_history: newHistory });
                                  }}
                                />
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="flex flex-col items-center justify-center py-6 px-3 text-center border border-dashed border-stone-200 rounded-lg bg-stone-50/50">
                            <span className="text-[12px] text-stone-500 mb-3 font-medium">该回顾内容为空</span>
                            {errorMsg && (
                              <span className="text-[11px] text-rose-500 mb-2.5 block px-2 leading-relaxed bg-rose-50 border border-rose-100 rounded-md py-1">{errorMsg}</span>
                            )}
                            <button
                              onClick={(e) => openPromptMenu(e.currentTarget.getBoundingClientRect(), { reviewId: review.id })}
                              className="px-4 py-1.5 text-[12px] bg-stone-800 text-white hover:bg-stone-900 active:scale-95 transition-all rounded-lg font-medium shadow-sm flex items-center gap-1"
                            >
                              立即生成回顾
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Append new review button */}
              <button
                onClick={(e) => openPromptMenu(e.currentTarget.getBoundingClientRect(), { dateStr })}
                disabled={logsCountForDate === 0}
                className="w-full py-3 mt-2 border border-dashed border-stone-350 rounded-2xl bg-white/30 hover:bg-white/60 hover:border-stone-400 text-stone-500 hover:text-stone-700 transition-all flex items-center justify-center gap-1.5 text-[12px] font-medium active:scale-[0.99] disabled:opacity-40"
              >
                <Sparkles className="w-3.5 h-3.5 stroke-[1.5px]" />
                + AI 智能回顾 (追加新回顾)
              </button>
            </>
          )}
        </div>
      </div>
      
      {showHeatmap && (
        <CalendarHeatmap
          currentDate={targetDate}
          onSelectDate={(date) => setSearchParams({ date })}
          onClose={() => setShowHeatmap(false)}
          activeSection="review"
        />
      )}

      {/* Prompt selection Popover — smart positioning above/below */}
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
                popoverRect.left + (popoverRect.width - 200) / 2,
                window.innerWidth - 216
              )),
              width: '200px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[11px] font-semibold text-white/40 tracking-wider px-2.5 py-1.5 border-b border-white/5 flex justify-between items-center select-none">
              <span>选择 AI 整理模板</span>
              <button 
                onClick={closePromptMenu}
                className="hover:bg-white/10 p-0.5 rounded text-white/40 hover:text-white transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            
            <div className="flex flex-col gap-0.5 mt-1">
              {/* 全部生成按钮 */}
              {(() => {
                const activeCount = getActivePromptIndices(reviewPrompts).length;
                return activeCount > 1 ? (
                  <button
                    onClick={() => {
                      closePromptMenu();
                      if (allLogs && allLogs.length > 0) {
                         const logsForDate = allLogs.filter(log => format(new Date(log.created_at), 'yyyy-MM-dd') === dateStr);
                         if (logsForDate.length > 0) {
                            generateAllReviews(dateStr, logsForDate);
                         } else {
                            alert('该天没有任何记录碎屑，无法生成回顾。');
                         }
                      }
                    }}
                    className="w-full py-2 px-2.5 bg-white/10 hover:bg-white/15 rounded-xl text-[12.5px] font-semibold text-purple-200 text-left active:scale-[0.98] transition-all border border-white/5 mb-1 flex items-center justify-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-purple-300" />
                    全部生成 ({activeCount} 套)
                  </button>
                ) : null;
              })()}

              {['默认 (系统)', '自定义一', '自定义二', '自定义三'].map((name, idx) => {
                const hasContent = reviewPrompts[idx]?.trim().length > 0;
                return (
                  <button
                    key={name}
                    onClick={() => handleGenerateReviewWithPrompt(idx)}
                    className="w-full py-2 px-2.5 hover:bg-white/5 rounded-xl text-[12.5px] font-medium text-white/90 text-left active:scale-[0.98] transition-all flex items-center justify-between"
                  >
                    <span>{name}</span>
                    {hasContent && <span className="text-purple-300 text-[11px] font-bold">✓</span>}
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
                if (activeReview?.ai_review) {
                  navigator.clipboard.writeText(activeReview.ai_review);
                }
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-white/90 hover:text-white transition-colors hover:bg-white/10 rounded-l-lg disabled:opacity-50"
            >
              <Copy className="w-3.5 h-3.5 mb-1.5 text-white/80" />
              <span className="text-[10px] font-medium tracking-wide">复制内容</span>
            </button>
            <button
              onClick={() => {
                if (activeReview) {
                  setEditText(activeReview.ai_review || '');
                  setEditingReviewId(activeReview.id);
                  setExpandedReviewId(activeReview.id);
                }
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-white/90 hover:text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <Edit2 className="w-3.5 h-3.5 mb-1.5 text-white/80" />
              <span className="text-[10px] font-medium tracking-wide">编辑内容</span>
            </button>
            <button
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setContextMenuState({ ...contextMenuState, isOpen: false });
                if (activeReview) {
                  openPromptMenu(rect, { reviewId: activeReview.id });
                }
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-white/90 hover:text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5 mb-1.5 text-white/80" />
              <span className="text-[10px] font-medium tracking-wide">重新生成</span>
            </button>
            <button
              onClick={async () => {
                if (activeReview && confirm('确认删除这篇回顾吗？(日记内容不受影响)')) {
                  await db.daily_reviews.delete(activeReview.id);
                }
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-rose-400 hover:text-rose-300 transition-colors hover:bg-white/10 rounded-r-lg"
            >
              <Trash2 className="w-3.5 h-3.5 mb-1.5" />
              <span className="text-[10px] font-medium tracking-wide">删除回顾</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}