import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format, subMonths, startOfWeek, subDays, startOfDay, endOfDay, isSameDay, addDays, parse } from 'date-fns';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { db } from '../db/db';
import CalendarHeatmap from '../components/CalendarHeatmap';
import ActionSheet from '../components/ActionSheet';
import { Copy, Trash2, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { useAppStore } from '../store/app.store';

export default function Review() {
  const navigate = useNavigate();
  const { isProcessingReviewMap, generateReview, diaryErrorMap } = useAppStore();
  const WEEKS_TO_SHOW = 15;
  const today = new Date();
  
  const [searchParams, setSearchParams] = useSearchParams();
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null);
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
  const [activeDiary, setActiveDiary] = useState<any>(null);
  const holdTimeoutRef = useRef<any>(null);
  const dateParam = searchParams.get('date');
  const [showPromptMenu, setShowPromptMenu] = useState(false);
  const [selectedDiaryForReview, setSelectedDiaryForReview] = useState<any>(null);

  const handleGenerateReviewClick = (diary: any) => {
    const logsForDiary = allLogs?.filter(log => format(new Date(log.created_at), 'yyyy-MM-dd') === diary.diary_date) || [];
    if (logsForDiary.length === 0) {
      alert('该天没有任何记录碎屑，无法生成回顾。');
      return;
    }
    setSelectedDiaryForReview(diary);
    setShowPromptMenu(true);
  };

  const handleGenerateReviewWithPrompt = async (promptIndex: number) => {
    if (!selectedDiaryForReview) return;
    const diary = selectedDiaryForReview;
    const logsForDiary = allLogs?.filter(log => format(new Date(log.created_at), 'yyyy-MM-dd') === diary.diary_date) || [];
    await generateReview(diary.id, diary.diary_date, logsForDiary, diary.ai_editorial || "", promptIndex);
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

    // Detect horizontal swipes
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 60) {
      if (diffX > 0) {
        // Swipe Right -> previous date
        navigateToDate(-1);
      } else {
        // Swipe Left -> next date (cannot exceed today)
        if (!isTodayDate) {
          navigateToDate(1);
        }
      }
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  const isTodayDate = isSameDay(targetDate, today);

  const endDate = startOfDay(today);
  const startDate = startOfWeek(subDays(endDate, (WEEKS_TO_SHOW - 1) * 7));

  const allLogs = useLiveQuery(() => db.raw_logs.toArray(), []);
  const allDiaries = useLiveQuery(() => db.daily_diaries.toArray(), []);

  // Group diaries by date, sorting dates desc, and diaries within dates desc
  const diariesGroupedByDate = useMemo(() => {
    if (!allDiaries) return [];
    // Only keep the diaries matching the selected dateStr
    const filteredDiaries = allDiaries.filter((diary) => diary.diary_date === dateStr);

    const groups: Record<string, any[]> = {};
    filteredDiaries.forEach((diary) => {
      const date = diary.diary_date;
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(diary);
    });
    return Object.keys(groups)
      .sort((a, b) => b.localeCompare(a))
      .map((date) => {
        const sorted = groups[date].sort((a, b) => b.updated_at - a.updated_at);
        return {
          date,
          diaries: sorted,
        };
      });
  }, [allDiaries, dateStr]);

  const lastAutoExpandedDateRef = useRef<string | null>(null);
  const prevDiariesCountRef = useRef(0);

  // Reset auto-expand reference when database count increases (e.g. new diary card added)
  useEffect(() => {
    if (!allDiaries) return;
    const countIncreased = allDiaries.length > prevDiariesCountRef.current;
    if (countIncreased) {
      lastAutoExpandedDateRef.current = null;
    }
    prevDiariesCountRef.current = allDiaries.length;
  }, [allDiaries]);

  // Auto-expand card when dateStr changes, or when list changes, without blocking manual collapses
  useEffect(() => {
    if (dateStr && diariesGroupedByDate.length > 0) {
      if (lastAutoExpandedDateRef.current !== dateStr) {
        const hasDateInDiaries = diariesGroupedByDate.some(g => g.date === dateStr);
        if (hasDateInDiaries) {
          setExpandedDate(dateStr);
          const group = diariesGroupedByDate.find(g => g.date === dateStr);
          if (group && group.diaries.length > 0) {
            setExpandedReviewId(group.diaries[0].id);
          }
          lastAutoExpandedDateRef.current = dateStr;
        } else {
          // If no review exists for this date, fold other opened cards
          setExpandedDate(null);
          setExpandedReviewId(null);
          lastAutoExpandedDateRef.current = dateStr;
        }
      }
    }
  }, [dateStr, diariesGroupedByDate]);

  return (
    <div className="flex flex-col h-full bg-transparent relative">
      <div className="flex h-[52px] items-center px-4 bg-[#f4f4f0]/80 backdrop-blur border-b border-stone-200/50 z-20 shrink-0 w-full justify-between">
         <h2 className="text-[13px] font-medium tracking-wide text-stone-500 uppercase">
           统计回顾
         </h2>
         <div className="flex items-center gap-3">
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
        {/* List of Previous Diaries grouped by Date */}
        <div className="w-full max-w-sm mb-20 flex flex-col gap-3">
          {diariesGroupedByDate.length === 0 ? (
            <div className="text-stone-400 text-[13px] py-4 text-center">暂无已生成的日记记录。</div>
          ) : (
            diariesGroupedByDate.map(group => {
              const primaryDiary = group.diaries[0];
              const diaryCount = group.diaries.length;
              const isDateExpanded = expandedDate === group.date;
              const summary = (() => {
                try {
                  return JSON.parse(primaryDiary.timeline_json)[0]?.summary || '暂无内容概要...';
                } catch {
                  return '暂无内容概要...';
                }
              })();

              return (
                <div key={group.date} className="bg-white rounded-2xl border border-black/5 shadow-[0_2px_10px_rgb(0_0_0_/_0.02)] transition-all flex flex-col block w-full overflow-hidden">
                  {/* Master Date Header */}
                  <button
                    onClick={() => setExpandedDate(isDateExpanded ? null : group.date)}
                    className="p-4 text-left hover:bg-stone-50 active:bg-stone-100 transition-colors flex flex-col gap-1.5 w-full relative"
                  >
                    <div className="flex justify-between items-center w-full">
                      <span className="text-[15px] font-semibold text-stone-800 font-mono tracking-tight leading-none flex items-center">
                        {group.date}
                        {diaryCount > 1 && (
                          <span className="text-[11px] font-normal text-stone-400 ml-2 font-sans bg-stone-100 px-1.5 py-0.5 rounded">
                            共 {diaryCount} 篇
                          </span>
                        )}
                      </span>
                      {isDateExpanded ? (
                        <ChevronUp className="w-4 h-4 text-stone-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-stone-400" />
                      )}
                    </div>
                    <span className="text-[13px] text-stone-500 line-clamp-2 leading-relaxed pr-6 select-none">
                      {summary}
                    </span>
                  </button>

                  {/* Inner Reviews List */}
                  {isDateExpanded && (
                    <div className="px-4 pb-4 pt-1 border-t border-black/5 bg-stone-50/40 space-y-3">
                      {group.diaries.map((diary) => {
                        const isReviewExpanded = expandedReviewId === diary.id;
                        const isGenerating = isProcessingReviewMap[diary.id];
                        const errorMsg = diaryErrorMap[diary.diary_date];
                        
                        return (
                          <div 
                            key={diary.id} 
                            className="bg-white rounded-xl border border-black/[0.04] shadow-[0_1px_4px_rgba(0,0,0,0.01)] overflow-hidden"
                            onTouchStart={(e) => {
                              const touch = e.touches[0];
                              const x = touch.clientX;
                              const y = touch.clientY;
                              holdTimeoutRef.current = setTimeout(() => {
                                if (window.navigator?.vibrate) window.navigator.vibrate(50);
                                setActiveDiary(diary);
                                setContextMenuState({ isOpen: true, x, y });
                              }, 500);
                            }}
                            onTouchEnd={() => clearTimeout(holdTimeoutRef.current)}
                            onTouchMove={() => clearTimeout(holdTimeoutRef.current)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              if (window.navigator?.vibrate) window.navigator.vibrate(50);
                              setActiveDiary(diary);
                              setContextMenuState({ isOpen: true, x: e.clientX, y: e.clientY });
                            }}
                          >
                            {/* Inner Review Header */}
                            <button
                              onClick={() => setExpandedReviewId(isReviewExpanded ? null : diary.id)}
                              className="w-full px-3 py-2.5 hover:bg-stone-50/30 flex justify-between items-center text-[12px] font-semibold text-stone-700 select-none text-left"
                            >
                              <span>
                                回顾 ({diary.review_prompt_name || '默认'}) - <span className="font-mono font-normal text-stone-400">{format(new Date(diary.updated_at), 'HH:mm')}</span>
                              </span>
                              {isReviewExpanded ? (
                                <ChevronUp className="w-3.5 h-3.5 text-stone-450" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5 text-stone-450" />
                              )}
                            </button>

                            {/* Inner Review Content */}
                            {isReviewExpanded && (
                              <div className="px-3 pb-3 pt-1 border-t border-stone-100/50 bg-white">
                                {isGenerating ? (
                                  <div className="flex flex-col items-center justify-center py-6 text-stone-400 text-[12px] gap-2 font-medium">
                                    <div className="animate-spin rounded-full h-4.5 w-4.5 border-2 border-stone-400 border-t-transparent"></div>
                                    <span>AI 正在为您生成统计回顾与反思...</span>
                                  </div>
                                ) : diary.ai_review ? (
                                  <>
                                    <div className="markdown-body prose prose-stone prose-h1:text-[18px] prose-h2:text-[17px] prose-h3:text-[16px] prose-h1:leading-snug prose-headings:font-bold max-w-none text-[16px] leading-relaxed select-text pointer-events-auto">
                                      <ReactMarkdown 
                                        components={{
                                          a: ({ node, href, children, ...props }) => {
                                            const handleClick = (e: React.MouseEvent) => {
                                              e.preventDefault();
                                              if (href?.startsWith('#log_id_')) {
                                                const logId = href.replace('#log_id_', '');
                                                navigate(`/?date=${diary.diary_date}&logId=${logId}`);
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
                                        {diary.ai_review}
                                      </ReactMarkdown>
                                    </div>
                                    
                                    {errorMsg && (
                                      <div className="mt-3 text-[11px] text-rose-500 bg-rose-50 border border-rose-100 rounded-md py-1 px-2.5 leading-relaxed">
                                        {errorMsg}
                                      </div>
                                    )}

                                    <div className="mt-4 flex gap-2 w-full select-none">
                                      <button 
                                        onClick={() => handleGenerateReviewClick(diary)}
                                        className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] text-stone-600 hover:text-stone-800 bg-stone-100 hover:bg-stone-200/60 rounded-lg transition-colors font-medium border border-stone-200/30"
                                      >
                                        <RefreshCw className="w-3 h-3" />
                                        重新生成回顾
                                      </button>
                                      <button 
                                        onClick={() => setExpandedReviewId(null)}
                                        className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] text-stone-500 hover:text-stone-800 bg-stone-100 hover:bg-stone-200/40 rounded-lg transition-colors font-medium border border-stone-200/30"
                                      >
                                        <ChevronUp className="w-3.5 h-3.5" />
                                        收起
                                      </button>
                                    </div>
                                  </>
                                ) : (
                                  <div className="flex flex-col items-center justify-center py-6 px-3 text-center border border-dashed border-stone-200 rounded-lg bg-stone-50/50">
                                    <span className="text-[12px] text-stone-500 mb-3 font-medium">该日记尚未生成统计回顾与反思</span>
                                    {errorMsg && (
                                      <span className="text-[11px] text-rose-500 mb-2.5 block px-2 leading-relaxed bg-rose-50 border border-rose-100 rounded-md py-1">{errorMsg}</span>
                                    )}
                                    <button
                                      onClick={() => handleGenerateReviewClick(diary)}
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
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
      
      {showHeatmap && (
        <CalendarHeatmap 
          currentDate={targetDate} 
          onSelectDate={(date) => setSearchParams({ date })} 
          onClose={() => setShowHeatmap(false)} 
        />
      )}

      {showPromptMenu && (
        <div 
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[110] flex items-end justify-center animate-in fade-in duration-200"
          onClick={() => setShowPromptMenu(false)}
        >
          <div 
            className="w-full max-w-md bg-[#2a2a2a]/95 backdrop-blur-xl border border-white/10 rounded-t-3xl p-5 pb-8 flex flex-col gap-3.5 animate-in slide-in-from-bottom duration-250 z-[120]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <span className="text-[13.5px] font-semibold text-white/50 tracking-wider">选择 AI 整理模板 (回顾)</span>
              <button 
                onClick={() => setShowPromptMenu(false)}
                className="p-1 hover:bg-white/10 rounded-lg text-white/40 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="flex flex-col gap-2">
              {['默认 (系统)', '自定义一', '自定义二', '自定义三'].map((name, idx) => (
                <button
                  key={name}
                  onClick={() => {
                    setShowPromptMenu(false);
                    handleGenerateReviewWithPrompt(idx);
                  }}
                  className="w-full py-3 hover:bg-white/5 border border-white/5 rounded-2xl text-[12.5px] font-medium text-white/90 text-center active:scale-[0.99] transition-all"
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {contextMenuState.isOpen && activeDiary && (
        <div
          className="fixed inset-0 z-[100]"
          onClick={() => setContextMenuState({ ...contextMenuState, isOpen: false })}
          onTouchMove={(e) => { setContextMenuState({ ...contextMenuState, isOpen: false }) }}
          onWheel={(e) => { setContextMenuState({ ...contextMenuState, isOpen: false }) }}
        >
          <div
            className="absolute bg-[#2a2a2a]/95 backdrop-blur-xl rounded-xl shadow-2xl flex items-center p-1 animate-in zoom-in-95 duration-100 divide-x divide-white/10"
            style={{
              top: contextMenuState.y > 100 ? contextMenuState.y - 75 : contextMenuState.y + 20,
              left: Math.max(16, Math.min(contextMenuState.x - 40, window.innerWidth - 86)),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={async () => {
                 if (activeDiary && confirm('确认删除这篇日记的回顾和整篇记录吗？')) {
                   await db.daily_diaries.delete(activeDiary.id);
                 }
                 setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-rose-400 hover:text-rose-300 transition-colors hover:bg-white/10 rounded-lg disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5 mb-1.5" />
              <span className="text-[10px] font-medium tracking-wide">删除记录</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}