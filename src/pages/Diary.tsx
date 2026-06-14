import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { startOfDay, endOfDay, format, parse, addDays, subDays, isSameDay } from 'date-fns';
import { Sparkles, Loader2, RefreshCw, ChevronLeft, ChevronRight, Copy, Trash2, Edit2, Save, X } from 'lucide-react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { db } from '../db/db';
import { useAppStore } from '../store/app.store';
import CalendarHeatmap from '../components/CalendarHeatmap';
import ActionSheet from '../components/ActionSheet';

export default function Diary() {
  const { isProcessingDiary, diaryErrorMap, generateDiaryTimeline } = useAppStore();
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
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
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

  const logs = useLiveQuery(
    () => db.raw_logs.where('created_at').between(start, end).sortBy('created_at'),
    []
  );

  const diaryRes = useLiveQuery(
    () => db.daily_diaries.where('diary_date').equals(dateStr).first(),
    [dateStr]
  );
  
  const handleGenerate = async () => {
     if (!logs || logs.length === 0) {
        alert('今天还没有记录任何碎屑，无法生成日记。');
        return;
     }
     await generateDiaryTimeline(dateStr, logs);
  };

  const handleSaveEdit = async () => {
     if (diaryRes) {
        await db.daily_diaries.update(diaryRes.id!, { ai_editorial: editText });
     }
     setIsEditing(false);
  };

  useEffect(() => {
     if (isEditing && editTextareaRef.current) {
        editTextareaRef.current.style.height = 'auto';
        editTextareaRef.current.style.height = editTextareaRef.current.scrollHeight + 'px';
     }
  }, [editText, isEditing]);

  const hasLogs = logs && logs.length > 0;

  return (
    <div className="flex flex-col h-full bg-transparent relative">
      <div className="flex h-[52px] items-center px-4 bg-[#f4f4f0]/80 backdrop-blur border-b border-stone-200/50 z-10 shrink-0 w-full justify-between">
         <h2 className="text-[13px] font-medium tracking-wide text-stone-500 uppercase">
           日记整理
         </h2>
         <div className="flex items-center gap-3">
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
        className="flex-1 overflow-y-auto thin-scrollbar p-6 flex flex-col items-center pb-24"
        onClick={handleInteraction}
        onTouchStart={handleInteraction}
        onScroll={handleInteraction}
      >
         
         {errorMsg && !isProcessingDiary && (
           <div className="mb-4 text-[13px] text-red-500 bg-red-50 border border-red-100 rounded-xl p-3 w-full max-w-[90%] mx-auto shadow-sm animate-in fade-in">
             <p className="font-medium mb-1">生成失败</p>
             <p className="opacity-90 leading-tight">{errorMsg}</p>
           </div>
         )}

         {!diaryRes && !isProcessingDiary && (
           <div className="mt-8 flex flex-col items-center justify-center p-8 bg-white/60 rounded-2xl border border-black/[0.03] select-none text-center w-full max-w-[280px]">
             <div className="text-stone-400 mb-4 bg-white p-3 rounded-xl shadow-sm border border-stone-100">
               <Sparkles className="w-6 h-6 stroke-[1.5px]" />
             </div>
             <p className="text-[15px] text-stone-900 font-medium tracking-tight mb-2">今天你积累了 {hasLogs ? logs.length : 0} 条碎屑</p>
             <p className="text-[13px] text-stone-500 mb-6 leading-relaxed">让 AI 为你总结今天</p>
             <button
               disabled={!hasLogs}
               onClick={handleGenerate}
               className="w-full bg-[#2a2a2a] text-white px-5 py-2.5 rounded-full text-[13px] font-medium tracking-wide flex items-center justify-center gap-2 hover:bg-[#222222] disabled:opacity-30 disabled:hover:bg-[#2a2a2a] transition-all active:scale-[0.98]"
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
         
         {diaryRes && !isProcessingDiary && (
           <div 
             className={`w-full animate-in fade-in slide-in-from-bottom-2 duration-500 rounded-lg transition-colors select-none -mx-2 ${isEditing ? 'p-4' : 'p-2 active:bg-stone-200/50'}`}
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
             {isEditing ? (
               <div className="flex flex-col gap-3 relative z-10 w-full animate-in fade-in zoom-in-95 duration-200">
                 <textarea
                   ref={editTextareaRef}
                   value={editText}
                   onChange={e => setEditText(e.target.value)}
                   className="w-full bg-white p-4 rounded-xl border border-stone-200 shadow-sm focus:outline-none focus:border-stone-300 focus:ring-2 focus:ring-stone-100 resize-none font-sans text-[15px] leading-relaxed text-stone-900 overflow-hidden min-h-[300px]"
                   placeholder="开始编辑日记..."
                   autoFocus
                 />
                 <div className="flex justify-end gap-2 pr-1">
                   <button 
                     onClick={() => setIsEditing(false)}
                     className="px-4 py-2 rounded-full text-[13px] font-medium text-stone-600 bg-white border border-stone-200 hover:bg-stone-50 transition-colors shadow-sm select-none"
                   >
                     取消
                   </button>
                   <button 
                     onClick={handleSaveEdit}
                     className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium text-white bg-[#2a2a2a] border border-[#2a2a2a] hover:bg-[#222222] transition-colors shadow-sm select-none"
                   >
                     <Save className="w-3.5 h-3.5" />
                     保存
                   </button>
                 </div>
               </div>
             ) : (
               <div className="markdown-body prose prose-stone prose-h1:text-[18px] prose-h2:text-[16px] prose-h3:text-[15px] prose-h1:leading-snug prose-headings:font-bold max-w-none text-[15px] leading-relaxed select-text pointer-events-auto mt-2 px-2">
                 <ReactMarkdown 
                   components={{
                     a: ({ node, href, children, ...props }) => {
                       const handleClick = (e: React.MouseEvent) => {
                         e.preventDefault();
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
                   {diaryRes.ai_editorial || '生成的内容为空。'}
                 </ReactMarkdown>
               </div>
             )}
           </div>
         )}
         
      </div>
      
      {diaryRes && !isProcessingDiary && !isEditing && (
        <div 
          className={`fixed bottom-24 left-0 w-full flex justify-center pointer-events-none z-20 transition-opacity duration-500 max-w-md mx-auto right-0 ${showFloatBtn ? 'opacity-100' : 'opacity-0'}`}
        >
          <button
            onClick={handleGenerate}
            disabled={isProcessingDiary}
            className={`bg-[#2a2a2a]/95 backdrop-blur-md border border-white/10 text-white px-6 py-2.5 rounded-full text-[13px] font-medium tracking-wide transition-all shadow-lg hover:shadow-xl active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:active:scale-100 min-w-[160px] ${showFloatBtn ? 'pointer-events-auto' : 'pointer-events-none'}`}
          >
            <RefreshCw className="w-4 h-4" />
            重新生成日记
          </button>
        </div>
      )}

      {showHeatmap && (
        <CalendarHeatmap 
          currentDate={targetDate} 
          onSelectDate={(date) => setSearchParams({ date })} 
          onClose={() => setShowHeatmap(false)} 
        />
      )}

      {contextMenuState.isOpen && diaryRes && (
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
              left: Math.max(16, Math.min(contextMenuState.x - 140, window.innerWidth - 296)),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                if (diaryRes?.ai_editorial) {
                   navigator.clipboard.writeText(diaryRes.ai_editorial);
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
                if (diaryRes) {
                   setEditText(diaryRes.ai_editorial || '');
                   setIsEditing(true);
                }
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-white/90 hover:text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <Edit2 className="w-3.5 h-3.5 mb-1.5 text-white/80" />
              <span className="text-[10px] font-medium tracking-wide">编辑日记</span>
            </button>
            <button
              onClick={() => {
                handleGenerate();
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-white/90 hover:text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5 mb-1.5 text-white/80" />
              <span className="text-[10px] font-medium tracking-wide">重新生成</span>
            </button>
            <button
              onClick={async () => {
                 await db.daily_diaries.where('diary_date').equals(dateStr).delete();
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

