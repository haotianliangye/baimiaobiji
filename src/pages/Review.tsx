import React, { useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format, subMonths, startOfWeek, subDays, startOfDay, endOfDay, isSameDay, addDays, parse } from 'date-fns';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../db/db';
import CalendarHeatmap from '../components/CalendarHeatmap';
import ActionSheet from '../components/ActionSheet';
import { Copy, Trash2 } from 'lucide-react';

export default function Review() {
  const navigate = useNavigate();
  const WEEKS_TO_SHOW = 15;
  const today = new Date();
  
  const [searchParams, setSearchParams] = useSearchParams();
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [isActionSheetOpen, setIsActionSheetOpen] = useState(false);
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
    <div className="flex flex-col h-full bg-white relative">
      <div className="flex h-[52px] items-center px-4 bg-stone-50/80 backdrop-blur border-b border-stone-100 z-10 shrink-0 w-full justify-between">
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
      
      <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center">
        
        {/* List of Previous Diaries */}
        <div className="w-full max-w-sm mb-20 flex flex-col gap-3">
          {!allDiaries || allDiaries.length === 0 ? (
            <div className="text-stone-400 text-[13px] py-4 text-center">暂无已生成的日记记录。</div>
          ) : (
            allDiaries.slice().reverse().map(diary => (
              <button
                key={diary.id} 
                onClick={() => navigate(`/diary?date=${diary.diary_date}`)}
                onTouchStart={() => {
                  holdTimeoutRef.current = setTimeout(() => {
                    if (window.navigator?.vibrate) window.navigator.vibrate(50);
                    setActiveDiary(diary);
                    setIsActionSheetOpen(true);
                  }, 500);
                }}
                onTouchEnd={() => clearTimeout(holdTimeoutRef.current)}
                onTouchMove={() => clearTimeout(holdTimeoutRef.current)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (window.navigator?.vibrate) window.navigator.vibrate(50);
                  setActiveDiary(diary);
                  setIsActionSheetOpen(true);
                }}
                className="bg-white hover:bg-stone-50 rounded-2xl border border-stone-100 shadow-sm p-4 text-left transition-all active:scale-[0.98] flex flex-col gap-1.5"
              >
                <span className="text-[14px] font-semibold text-stone-800 font-mono tracking-tight leading-none">
                  {diary.diary_date}
                </span>
                <span className="text-[13px] text-stone-500 line-clamp-2 leading-relaxed">
                  {(() => {
                    try {
                      return JSON.parse(diary.timeline_json)[0]?.summary || '暂无内容概要...';
                    } catch {
                      return '暂无内容概要...';
                    }
                  })()}
                </span>
              </button>
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

      {/* Action Sheet */}
      <ActionSheet 
        isOpen={isActionSheetOpen}
        onClose={() => setIsActionSheetOpen(false)}
        actions={[
          {
            label: '删除此日记',
            icon: <Trash2 className="w-4 h-4" />,
            danger: true,
            onClick: async () => {
               if (activeDiary) {
                 await db.daily_diaries.delete(activeDiary.id);
               }
            }
          }
        ]}
      />
    </div>
  );
}
