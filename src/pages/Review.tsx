import React, { useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format, subMonths, startOfWeek, subDays, startOfDay, endOfDay, isSameDay, addDays, parse } from 'date-fns';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { db } from '../db/db';
import CalendarHeatmap from '../components/CalendarHeatmap';
import ActionSheet from '../components/ActionSheet';
import { Copy, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

export default function Review() {
  const navigate = useNavigate();
  const WEEKS_TO_SHOW = 15;
  const today = new Date();
  
  const [searchParams, setSearchParams] = useSearchParams();
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [expandedDiaryId, setExpandedDiaryId] = useState<string | null>(null);
  const [contextMenuState, setContextMenuState] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
  }>({
    isOpen: false,
    x: 0,
    y: 0,
  });
  const [activeDiary, setActiveDiary] = useState<any>(null);
  const holdTimeoutRef = useRef<any>(null);
  const dateParam = searchParams.get('date');

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

  const isTodayDate = isSameDay(targetDate, today);

  const endDate = startOfDay(today);
  const startDate = startOfWeek(subDays(endDate, (WEEKS_TO_SHOW - 1) * 7));

  const allLogs = useLiveQuery(() => db.raw_logs.toArray(), []);
  const allDiaries = useLiveQuery(() => db.daily_diaries.toArray(), []);

  return (
    <div className="flex flex-col h-full bg-transparent relative">
      <div className="flex h-[52px] items-center px-4 bg-[#f4f4f0]/80 backdrop-blur border-b border-stone-200/50 z-10 shrink-0 w-full justify-between">
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
      
      <div className="flex-1 overflow-y-auto thin-scrollbar p-6 flex flex-col items-center">
        
        {/* List of Previous Diaries */}
        <div className="w-full max-w-sm mb-20 flex flex-col gap-3">
          {!allDiaries || allDiaries.length === 0 ? (
            <div className="text-stone-400 text-[13px] py-4 text-center">暂无已生成的日记记录。</div>
          ) : (
            allDiaries.slice().reverse().map(diary => (
              <div key={diary.id} className="bg-white rounded-2xl border border-black/5 shadow-[0_2px_10px_rgb(0_0_0_/_0.02)] transition-all flex flex-col block w-full overflow-hidden">
                <button
                  onClick={() => setExpandedDiaryId(expandedDiaryId === diary.id ? null : diary.id)}
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
                  className="p-4 text-left hover:bg-stone-50 active:bg-stone-100 transition-colors flex flex-col gap-1.5 w-full relative"
                >
                  <div className="flex justify-between items-center w-full">
                    <span className="text-[14px] font-semibold text-stone-800 font-mono tracking-tight leading-none">
                      {diary.diary_date}
                    </span>
                    {expandedDiaryId === diary.id ? (
                      <ChevronUp className="w-4 h-4 text-stone-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-stone-400" />
                    )}
                  </div>
                  <span className="text-[13px] text-stone-500 line-clamp-2 leading-relaxed pr-6">
                    {(() => {
                      try {
                        return JSON.parse(diary.timeline_json)[0]?.summary || '暂无内容概要...';
                      } catch {
                        return '暂无内容概要...';
                      }
                    })()}
                  </span>
                </button>
                {expandedDiaryId === diary.id && (
                  <div className="px-4 pb-5 pt-2 border-t border-black/5 bg-stone-50/50">
                    <div className="markdown-body prose prose-stone prose-h1:text-[16px] prose-h2:text-[15px] prose-h3:text-[14px] prose-h1:leading-snug prose-headings:font-bold max-w-none text-[14px] leading-relaxed select-text pointer-events-auto">
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
                        {diary.ai_editorial || '生成的内容为空。'}
                      </ReactMarkdown>
                    </div>
                    <button 
                      onClick={() => setExpandedDiaryId(null)}
                      className="mt-4 w-full flex items-center justify-center gap-1.5 py-2 text-[13px] text-stone-500 hover:text-stone-800 bg-black/5 hover:bg-black/10 rounded-lg transition-colors font-medium"
                    >
                      <ChevronUp className="w-4 h-4" />
                      收起
                    </button>
                  </div>
                )}
              </div>
            ))
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
                 if (activeDiary) {
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
