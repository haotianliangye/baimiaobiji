import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { startOfDay, endOfDay, format, parse, addDays, subDays, isSameDay } from 'date-fns';
import { countChars } from '../lib/wordCount';
import { Sparkles, Loader2, RefreshCw, ChevronLeft, ChevronRight, Copy, Trash2, Edit2, Save, X, ChevronDown, ChevronUp, MessageCircle } from 'lucide-react';
import { Notepad } from '@phosphor-icons/react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { db } from '../db/db';
import { useAppStore } from '../store/app.store';
import { useSettingsStore, getActivePromptIndices } from '../store/settings.store';
import CalendarHeatmap from '../components/CalendarHeatmap';
import { formatDiaryMarkdown } from '../lib/utils';
import { washCitations } from '../lib/citationWash';
import ActionSheet from '../components/ActionSheet';
import ContextChat from '../components/ContextChat';

export default function Diary() {
  const { isProcessingDiary, diaryErrorMap, generateDiaryTimeline, batchProgress, generateAllDiaries } = useAppStore();
  const { diaryPrompts } = useSettingsStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [contextMenuState, setContextMenuState] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
  }>({
    isOpen: false,
    x: 0,
    y: 0,
  });
  
  // States for handling multiple diaries
  const [expandedDiaryId, setExpandedDiaryId] = useState<string | null>(null);
  const [editingDiaryId, setEditingDiaryId] = useState<string | null>(null);
  const [chatDiaryId, setChatDiaryId] = useState<string | null>(null);
  const [activeDiary, setActiveDiary] = useState<any>(null);
  const [editText, setEditText] = useState('');
  const [showPromptMenu, setShowPromptMenu] = useState(false);
  const [diaryIdToOverwrite, setDiaryIdToOverwrite] = useState<string | undefined>(undefined);
  // Store the raw viewport-relative DOMRect of the triggering button
  const [popoverRect, setPopoverRect] = useState<DOMRect | null>(null);
  
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const [showFloatBtn, setShowFloatBtn] = useState(false);
  const floatBtnTimeoutRef = useRef<any>(null);
  const holdTimeoutRef = useRef<any>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();

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
  
  const today = new Date();
  const dateParam = searchParams.get('date');
  
  let targetDate = today;
  if (dateParam) {
     const parsed = parse(dateParam, 'yyyy-MM-dd', new Date());
     if (!isNaN(parsed.getTime())) {
        targetDate = parsed;
     }
  }

  const start = startOfDay(targetDate).getTime();
  const end = endOfDay(targetDate).getTime();
  const dateStr = format(targetDate, 'yyyy-MM-dd');
  const isTodayDate = isSameDay(targetDate, today);
  
  const errorMsg = diaryErrorMap[dateStr];

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

  // Fixed dependency array to update logs correctly when date changes
  const logs = useLiveQuery(
    () => db.raw_logs.where('created_at').between(start, end).sortBy('created_at'),
    [start, end]
  );

  // Fetch all diaries for the selected date
  const diaries = useLiveQuery(
    () => db.daily_diaries.where('diary_date').equals(dateStr).toArray(),
    [dateStr]
  ) || [];

  const sortedDiaries = React.useMemo(() => {
    if (!diaries) return [];
    return [...diaries].sort((a, b) => {
      const idxA = a.prompt_index ?? 0;
      const idxB = b.prompt_index ?? 0;
      if (idxA !== idxB) return idxA - idxB;
      return b.updated_at - a.updated_at;
    });
  }, [diaries]);

  const dailyChars = useMemo(() => {
    return (diaries || []).reduce((sum, diary) => sum + countChars(diary.ai_editorial), 0);
  }, [diaries]);

  const prevDateRef = useRef(dateStr);
  const prevDiariesLengthRef = useRef(sortedDiaries.length);

  // Automatically expand the first diary card or the newly added one
  useEffect(() => {
    const dateChanged = prevDateRef.current !== dateStr;
    const countIncreased = sortedDiaries.length > prevDiariesLengthRef.current;
    
    if (dateChanged) {
      // 切换日期时，自动展开列表排在首位的日记卡片（通常是默认日记）
      if (sortedDiaries.length > 0) {
        setExpandedDiaryId(sortedDiaries[0].id);
      }
      prevDateRef.current = dateStr;
    } else if (countIncreased) {
      // 当生成并追加新日记时，自动展开时间戳最新被更新的这篇日记
      if (sortedDiaries.length > 0) {
        const latestDiary = [...sortedDiaries].sort((a, b) => b.updated_at - a.updated_at)[0];
        if (latestDiary) {
          setExpandedDiaryId(latestDiary.id);
        }
      }
    }
    prevDiariesLengthRef.current = sortedDiaries.length;
  }, [dateStr, sortedDiaries]);
  
  const openPromptMenu = (rect: DOMRect, diaryId?: string) => {
    setPopoverRect(rect);
    setDiaryIdToOverwrite(diaryId);
    setShowPromptMenu(true);
  };

  const handleGenerateClick = (e: React.MouseEvent<HTMLButtonElement>) => {
     if (!logs || logs.length === 0) {
        alert('今天还没有记录任何碎屑，无法生成日记。');
        return;
     }
     openPromptMenu(e.currentTarget.getBoundingClientRect(), undefined);
  };

  const handleRegenerateClick = (diaryId: string, rect?: DOMRect) => {
     if (!logs || logs.length === 0) return;
     if (rect) {
        openPromptMenu(rect, diaryId);
     } else {
        setDiaryIdToOverwrite(diaryId);
        setShowPromptMenu(true);
     }
  };

  const handleGenerateWithPrompt = async (promptIndex: number) => {
     await generateDiaryTimeline(dateStr, logs, diaryIdToOverwrite, promptIndex);
  };

  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const handleSaveEdit = async (id: string) => {
     setIsSavingEdit(true);
     try {
       await db.daily_diaries.update(id, { ai_editorial: editText });
       setEditingDiaryId(null);
     } catch (err: any) {
       alert('保存失败：' + (err?.message || '请重试'));
     } finally {
       setIsSavingEdit(false);
     }
  };

  useEffect(() => {
     if (editingDiaryId && editTextareaRef.current) {
        editTextareaRef.current.style.height = 'auto';
        editTextareaRef.current.style.height = editTextareaRef.current.scrollHeight + 'px';
     }
  }, [editText, editingDiaryId]);

  const hasLogs = logs && logs.length > 0;

  return (
    <div className="flex flex-col h-full bg-transparent relative">
      <div className="flex h-[52px] items-center px-4 bg-[#faf9fc]/85 backdrop-blur border-b border-baimiao-border/40 z-20 shrink-0 w-full justify-between">
         <h2 className="text-[13.5px] font-bold tracking-wide text-baimiao-mysteria flex items-center gap-1.5 font-serif baimiao-editorial-title">
           <Notepad weight="regular" className="w-4 h-4 text-baimiao-mysteria/70 translate-y-[-0.8px] shrink-0" />
           日记整理
         </h2>
         <div className="flex items-center gap-3">
           <span className="inline-flex text-[11px] font-medium text-stone-500 bg-stone-100/80 px-2 py-1 rounded-full">
             今日 {dailyChars} 字
           </span>
           <button onClick={() => navigateToDate(-1)} className="p-1 hover:bg-stone-200/50 rounded-full transition-colors text-stone-400 hover:text-stone-700">
             <ChevronLeft className="w-4 h-4" />
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
             <ChevronRight className="w-4 h-4" />
           </button>
         </div>
      </div>

      <div
        className="flex-1 overflow-y-auto thin-scrollbar p-6 flex flex-col items-center pb-24 w-full"
        onClick={handleInteraction}
        onTouchStart={(e) => {
          handleInteraction();
          handleTouchStart(e);
        }}
        onTouchEnd={handleTouchEnd}
        onScroll={handleInteraction}
      >
         
         {/* 批量生成进度浮动条 */}
         {batchProgress && batchProgress.type === 'diary' && (
           <div className="mb-4 w-full max-w-[90%] mx-auto animate-in fade-in">
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

         {errorMsg && !isProcessingDiary && (
           <div className="mb-4 text-[13px] text-red-500 bg-red-50 border border-red-100 rounded-xl p-3 w-full max-w-[90%] mx-auto shadow-sm animate-in fade-in">
             <p className="font-medium mb-1">生成失败</p>
             <p className="opacity-90 leading-tight">{errorMsg}</p>
           </div>
         )}

         {diaries.length === 0 && !isProcessingDiary && (
            <div className="mt-8 flex flex-col items-center justify-center p-8 bg-gradient-to-br from-baimiao-mysteria/[0.03] to-[#2c2957]/[0.01] rounded-2xl border border-baimiao-mysteria/10 shadow-[0_8px_30px_rgba(27,25,56,0.03)] select-none text-center w-full max-w-[280px]">
              <div className="text-baimiao-mysteria mb-4 bg-white p-3 rounded-xl shadow-[0_2px_10px_rgba(27,25,56,0.05)] border border-baimiao-mysteria/5">
                <Sparkles className="w-6 h-6 stroke-[1.5px] text-baimiao-mysteria/70 animate-pulse" />
              </div>
              <p className="text-[15px] text-stone-900 font-medium tracking-tight mb-2 font-serif baimiao-editorial-title">今天你积累了 {hasLogs ? logs.length : 0} 条碎屑</p>
              <p className="text-[12.5px] text-stone-500 mb-6 leading-relaxed">让 AI 为你总结今天</p>
              <button
                disabled={!hasLogs}
                onClick={handleGenerateClick}
                className={`w-full px-5 py-2.5 rounded-full text-[13px] font-medium tracking-wide flex items-center justify-center gap-2 transition-all ${
                  hasLogs
                    ? "bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white hover:brightness-110 active:scale-[0.98] shadow-md shadow-baimiao-mysteria/10"
                    : "bg-stone-100 text-stone-400 cursor-not-allowed border border-stone-200/50"
                }`}
              >
                AI 智能整理
              </button>
            </div>
          )}
         
         {isProcessingDiary && (
           <div className="w-full mt-8 flex flex-col gap-6 max-w-[90%] mx-auto relative opacity-60 pointer-events-none pb-20">
             <div className="flex flex-col items-center justify-center absolute inset-0 z-10 m-auto h-[100px]">
               <Loader2 className="w-8 h-8 animate-spin text-black mb-4 drop-shadow-md" />
               <p className="text-[13px] text-stone-900 font-medium animate-pulse tracking-wide bg-white/50 px-2 py-1 rounded">正在让 AI 帮你写日记...</p>
             </div>
             
             <div className="h-6 bg-stone-50 rounded w-full" />
             <div className="h-6 bg-stone-50 rounded w-5/6" />
             <div className="h-6 bg-stone-50 rounded w-full mt-4" />
             <div className="h-6 bg-stone-50 rounded w-2/3" />
           </div>
         )}
         
         {sortedDiaries.length > 0 && (
           <div className="w-full flex flex-col gap-4">
             {sortedDiaries.map((diary) => {
               const isExpanded = expandedDiaryId === diary.id;
               const isEditing = editingDiaryId === diary.id;
               
               return (
                  <div 
                    key={diary.id} 
                    className="w-full overflow-hidden baimiao-card-diary"
                    onTouchStart={(e) => {
                      if (isEditing) return;
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
                      if (isEditing) return;
                      e.preventDefault();
                      if (window.navigator?.vibrate) window.navigator.vibrate(50);
                      setActiveDiary(diary);
                      setContextMenuState({ isOpen: true, x: e.clientX, y: e.clientY });
                    }}
                  >
                   {/* Card Header */}
                   <button
                     onClick={() => {
                       if (isEditing) return;
                       setExpandedDiaryId(isExpanded ? null : diary.id);
                     }}
                     className="p-4 text-left hover:bg-stone-50 active:bg-stone-100 transition-colors flex flex-col gap-1.5 w-full relative"
                   >
                     <div className="flex justify-between items-center w-full">
                       <span className="text-[15px] font-semibold text-stone-800 font-mono tracking-tight leading-none">
                         {diary.diary_date}
                       </span>
                       {isExpanded ? (
                         <ChevronUp className="w-4 h-4 text-stone-400" />
                       ) : (
                         <ChevronDown className="w-4 h-4 text-stone-400" />
                       )}
                     </div>
                     <span className="text-[13px] text-stone-500 line-clamp-2 leading-relaxed pr-6 select-none">
                       {diary.ai_summary || '暂无内容概要'}
                     </span>
                   </button>

                   {/* Prompt label sub-header */}
                   <div className="px-4 py-1.5 border-t border-black/[0.03] bg-stone-50/60">
                     <span className="text-[11px] text-stone-400 font-medium">
                       日记 ({diary.prompt_name || '默认'}) · {format(new Date(diary.updated_at), 'HH:mm')}
                     </span>
                   </div>

                   {/* Card Content */}
                   {isExpanded && (
                     <div 
                       className={`px-4 pb-4 pt-1 border-t border-black/[0.03] select-none -mx-2 ${isEditing ? 'p-4' : 'p-2 active:bg-stone-150/30'}`}
                     >
                       {isEditing ? (
                         <div className="flex flex-col gap-3 relative z-10 w-full animate-in fade-in zoom-in-95 duration-200">
                           <textarea
                             ref={editTextareaRef}
                             value={editText}
                             onChange={e => setEditText(e.target.value)}
                             className="w-full bg-white p-4 rounded-xl border border-stone-200 shadow-sm focus:outline-none focus:border-stone-300 focus:ring-2 focus:ring-stone-100 resize-none font-sans text-[15px] leading-relaxed text-stone-900 overflow-hidden min-h-[200px]"
                             placeholder="开始编辑日记..."
                             autoFocus
                           />
                           <div className="flex items-center justify-between gap-2">
                             <span className="text-[12px] text-stone-500 pl-1">共 {countChars(editText)} 字</span>
                             <div className="flex gap-2 pr-1">
                               <button
                                 onClick={() => setEditingDiaryId(null)}
                                 className="px-4 py-2 rounded-full text-[13px] font-medium text-stone-600 bg-white border border-stone-200 hover:bg-stone-50 transition-colors shadow-sm select-none"
                               >
                                 取消
                               </button>
                               <button
                                 onClick={() => handleSaveEdit(diary.id)}
                                 disabled={isSavingEdit}
                                 className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium text-white bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] border border-white/10 hover:brightness-110 transition-all shadow-sm select-none disabled:opacity-60"
                               >
                                 {isSavingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                 {isSavingEdit ? '保存中' : '保存'}
                               </button>
                             </div>
                           </div>
                         </div>
                       ) : (
                         <>
                            <div 
                              className="markdown-body prose prose-stone baimiao-editorial-body prose-h1:text-[19px] prose-h2:text-[17px] prose-h3:text-[16px] prose-h1:leading-snug prose-headings:font-medium prose-headings:font-serif baimiao-editorial-title max-w-none text-[15.5px] leading-relaxed select-text pointer-events-auto mt-2 px-2 cursor-pointer"
                             onClick={(e) => {
                               // 避免点击内部链接时触发收起
                               if ((e.target as HTMLElement).tagName.toLowerCase() === 'a') return;
                               setExpandedDiaryId(null);
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
                                       navigate(`/?date=${dateStr}&logId=${logId}`);
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
                               {washCitations(formatDiaryMarkdown(diary.ai_editorial) || '生成的内容为空。')}
                             </ReactMarkdown>
                           </div>

                           {/* Collapsed Inner Card Action Toolbar */}
                           <div className="flex flex-col gap-3 mt-4 pt-3 border-t border-stone-200/40 select-none px-2">
                             <div className="flex justify-between w-full">
                               <button 
                                 onClick={async (e) => {
                                   e.stopPropagation();
                                   if (confirm('确认删除这篇日记吗？')) {
                                      await db.daily_diaries.delete(diary.id);
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
                                   if (diary.ai_editorial) {
                                     navigator.clipboard.writeText(diary.ai_editorial);
                                     alert('日记已复制到剪贴板');
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
                                   setEditText(diary.ai_editorial || '');
                                   setEditingDiaryId(diary.id);
                                 }}
                                 className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
                               >
                                 <Edit2 className="w-4 h-4" />
                                 编辑
                               </button>
                               <button 
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   handleRegenerateClick(diary.id, e.currentTarget.getBoundingClientRect());
                                 }}
                                 className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
                               >
                                 <RefreshCw className="w-4 h-4" />
                                 重新生成
                               </button>
                               <button 
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   setExpandedDiaryId(null);
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
                                 setChatDiaryId(chatDiaryId === diary.id ? null : diary.id);
                               }}
                               className={`flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl text-[13px] font-medium transition-colors ${chatDiaryId === diary.id ? 'bg-stone-800 text-white' : 'bg-stone-100 hover:bg-stone-200 text-stone-700'}`}
                             >
                               <MessageCircle className="w-4 h-4" />
                               AI 追问
                             </button>
                           </div>
                           
                           {chatDiaryId === diary.id && (
                             <ContextChat
                               chatHistory={diary.chat_history || []}
                               contextContent={diary.ai_editorial || ''}
                               apiEndpoint="/api/diary-chat"
                               onUpdateHistory={async (newHistory) => {
                                 await db.daily_diaries.update(diary.id, { chat_history: newHistory });
                               }}
                             />
                           )}
                         </>
                       )}
                     </div>
                   )}
                 </div>
               );
             })}

             {/* Append dashed button at the bottom of the list */}
             {!isProcessingDiary && (
               <button
                 onClick={handleGenerateClick}
                 disabled={!hasLogs}
                 className="w-full py-4 border border-dashed border-stone-300 rounded-2xl bg-white/30 hover:bg-white/60 hover:border-stone-400 text-stone-500 hover:text-stone-700 transition-all flex items-center justify-center gap-1.5 text-[13px] font-medium active:scale-[0.99] disabled:opacity-40 disabled:hover:bg-white/30 disabled:hover:border-stone-300"
               >
                 <Sparkles className="w-4 h-4 stroke-[1.5px]" />
                 + AI 智能整理 (追加新日记)
               </button>
             )}
           </div>
         )}
      </div>

      {showHeatmap && (
        <CalendarHeatmap
          currentDate={targetDate}
          onSelectDate={(date) => setSearchParams({ date })}
          onClose={() => setShowHeatmap(false)}
          activeSection="diary"
        />
      )}

      {showPromptMenu && popoverRect && (
        <div 
          className="fixed inset-0 z-[110] bg-black/10 backdrop-blur-[1px]"
          onClick={() => { setShowPromptMenu(false); setPopoverRect(null); }}
        >
          <div 
            className="absolute bg-gradient-to-r from-baimiao-mysteria/95 to-[#2c2957]/95 backdrop-blur-xl border border-white/10 rounded-2xl p-2 flex flex-col gap-1 shadow-[0_10px_30px_rgba(0,0,0,0.3)] z-[120] animate-in zoom-in-95 duration-100"
            style={{
              top: (() => {
                const POPOVER_HEIGHT = 192;
                const GAP = 8;
                const spaceAbove = popoverRect.top;
                const spaceBelow = window.innerHeight - popoverRect.bottom;
                if (spaceAbove >= POPOVER_HEIGHT + GAP) {
                  return Math.max(8, popoverRect.top - POPOVER_HEIGHT - GAP);
                } else if (spaceBelow >= POPOVER_HEIGHT + GAP) {
                  return Math.min(popoverRect.bottom + GAP, window.innerHeight - POPOVER_HEIGHT - 8);
                } else {
                  return spaceAbove > spaceBelow
                    ? Math.max(8, popoverRect.top - POPOVER_HEIGHT - GAP)
                    : Math.min(popoverRect.bottom + GAP, window.innerHeight - POPOVER_HEIGHT - 8);
                }
              })(),
              left: Math.max(16, Math.min(popoverRect.left + (popoverRect.width - 200) / 2, window.innerWidth - 216)),
              width: '200px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[11px] font-semibold text-white/40 tracking-wider px-2.5 py-1.5 border-b border-white/5 flex justify-between items-center select-none">
              <span>选择 AI 整理模板</span>
              <button 
                onClick={() => { setShowPromptMenu(false); setPopoverRect(null); }}
                className="hover:bg-white/10 p-0.5 rounded text-white/40 hover:text-white transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            
            <div className="flex flex-col gap-0.5 mt-1">
              {/* 全部生成按钮 */}
              {(() => {
                const activeCount = getActivePromptIndices(diaryPrompts).length;
                return activeCount > 1 ? (
                  <button
                    onClick={() => {
                      setShowPromptMenu(false);
                      setPopoverRect(null);
                      if (logs && logs.length > 0) {
                        generateAllDiaries(dateStr, logs);
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
                const hasContent = diaryPrompts[idx]?.trim().length > 0;
                return (
                  <button
                    key={name}
                    onClick={() => {
                      setShowPromptMenu(false);
                      setPopoverRect(null);
                      handleGenerateWithPrompt(idx);
                    }}
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

      {contextMenuState.isOpen && activeDiary && (
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
              left: Math.max(16, Math.min(contextMenuState.x - 140, window.innerWidth - 296)),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                if (activeDiary?.ai_editorial) {
                   navigator.clipboard.writeText(activeDiary.ai_editorial);
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
                if (activeDiary) {
                   setEditText(activeDiary.ai_editorial || '');
                   setEditingDiaryId(activeDiary.id);
                   setExpandedDiaryId(activeDiary.id); // 自动展开日记卡片
                }
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-white/90 hover:text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <Edit2 className="w-3.5 h-3.5 mb-1.5 text-white/80" />
              <span className="text-[10px] font-medium tracking-wide">编辑日记</span>
            </button>
            <button
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setContextMenuState({ ...contextMenuState, isOpen: false });
                if (activeDiary) {
                  handleRegenerateClick(activeDiary.id, rect);
                }
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-white/90 hover:text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5 mb-1.5 text-white/80" />
              <span className="text-[10px] font-medium tracking-wide">重新生成</span>
            </button>

            <button
              onClick={async () => {
                if (activeDiary) {
                   await db.daily_diaries.delete(activeDiary.id);
                }
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-rose-400 hover:text-rose-300 transition-colors hover:bg-white/10 rounded-r-lg disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5 mb-1.5" />
              <span className="text-[10px] font-medium tracking-wide">删除日记</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}