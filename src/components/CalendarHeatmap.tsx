import React, { useEffect, useState } from 'react';
import { startOfDay, endOfDay, subDays, format, getDay, addDays, startOfWeek, isSameDay, isSameMonth, parse } from 'date-fns';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';

interface CalendarHeatmapProps {
  currentDate: Date;
  onSelectDate: (date: string) => void;
  onClose: () => void;
}

export default function CalendarHeatmap({ currentDate, onSelectDate, onClose }: CalendarHeatmapProps) {
  // Go back 14 weeks to show a nice grid
  const WEEKS_TO_SHOW = 15;
  const today = new Date();
  
  // Starting point of the grid (Sunday of the week that is WEEKS_TO_SHOW ago)
  const endDate = startOfDay(today);
  const startDate = startOfWeek(subDays(endDate, (WEEKS_TO_SHOW - 1) * 7));

  // Count active logs per day
  const logs = useLiveQuery(
    () => db.raw_logs.where('created_at').between(startDate.getTime(), endOfDay(today).getTime()).toArray(),
    []
  );

  const stats = React.useMemo(() => {
    const map = new Map<string, number>();
    logs?.forEach(log => {
      const dateStr = format(new Date(log.created_at), 'yyyy-MM-dd');
      map.set(dateStr, (map.get(dateStr) || 0) + 1);
    });
    return map;
  }, [logs]);

  // Generate grid cells
  const gridCells = [];
  let currentGridDate = startDate;
  
  while (currentGridDate <= endOfDay(today)) {
    gridCells.push(currentGridDate);
    currentGridDate = addDays(currentGridDate, 1);
  }

  // Segment by week (columns)
  const columns = [];
  for (let i = 0; i < gridCells.length; i += 7) {
    columns.push(gridCells.slice(i, i + 7));
  }

  const getIntensityClass = (count: number, isSelected: boolean) => {
    if (isSelected) return 'bg-black border-2 border-black/50 scale-110 z-10 rounded-[4px] shadow-sm';
    if (count === 0) return 'bg-stone-100 rounded-[3px]';
    if (count < 3) return 'bg-[#e2dce3] rounded-[3px]';
    if (count < 8) return 'bg-[#a99fb1] rounded-[3px]';
    if (count < 15) return 'bg-[#706478] rounded-[3px]';
    return 'bg-[#2a2a2a] rounded-[3px]';
  };

  const allLogs = useLiveQuery(() => db.raw_logs.toArray());
  const allDiaries = useLiveQuery(() => db.daily_diaries.toArray());

  const totalLogsAllTime = allLogs?.length || 0;
  
  const firstLogMs = allLogs && allLogs.length > 0 ? allLogs.reduce((acc, log) => Math.min(acc, log.created_at), Date.now()) : Date.now();
  const firstDiaryMs = allDiaries && allDiaries.length > 0 ? allDiaries.reduce((acc, diary) => {
    const time = parse(diary.diary_date, 'yyyy-MM-dd', new Date()).getTime();
    return isNaN(time) ? acc : Math.min(acc, time);
  }, Date.now()) : Date.now();
  
  const earliestEntryMs = Math.min(firstLogMs, firstDiaryMs);
  const daysSinceEpoch = (allLogs?.length || allDiaries?.length) ? Math.max(1, Math.round((today.getTime() - earliestEntryMs) / (1000 * 60 * 60 * 24)) + 1) : 0;

  return (
    <div className="fixed inset-x-0 top-[52px] bottom-0 z-50 flex flex-col items-center p-4 bg-black/20 backdrop-blur-sm transition-all animate-in fade-in duration-200" onClick={onClose}>
      <div 
        className="w-full max-w-md bg-white rounded-2xl overflow-hidden shadow-2xl border border-stone-100 animate-in slide-in-from-top-4 duration-300 relative pb-6"
        onClick={e => e.stopPropagation()}
      >
        {/* Top Stats */}
        <div className="flex items-center justify-between w-full px-8 mb-4 mt-8 text-center border-b border-stone-50 pb-6">
          <div className="flex flex-col gap-1 items-center">
             <span className="text-[32px] font-bold text-stone-800 font-mono tracking-tighter leading-none">{totalLogsAllTime}</span>
             <span className="text-[13px] text-stone-500 font-medium">碎屑</span>
          </div>
          <div className="flex flex-col gap-1 items-center">
             <span className="text-[32px] font-bold text-stone-400 font-mono tracking-tighter leading-none">{allDiaries?.length || 0}</span>
             <span className="text-[13px] text-stone-500 font-medium">日记</span>
          </div>
          <div className="flex flex-col gap-1 items-center">
             <span className="text-[32px] font-bold text-stone-400 font-mono tracking-tighter leading-none">{daysSinceEpoch}</span>
             <span className="text-[13px] text-stone-500 font-medium">天</span>
          </div>
        </div>

        <div className="px-6 flex flex-col items-center">
           <div className="flex gap-[4px] items-start w-full overflow-x-auto no-scrollbar py-2">
             {columns.map((week, wIdx) => (
                <div key={wIdx} className="flex flex-col gap-[4px] shrink-0">
                  {week.map((date, dIdx) => {
                    const dateStr = format(date, 'yyyy-MM-dd');
                    const count = stats.get(dateStr) || 0;
                    const isSelected = isSameDay(date, currentDate);
                    const isFuture = date > today;
                    if (isFuture) return <div key={dIdx} className="w-[14px] h-[14px] bg-transparent" />;
                    return (
                      <button
                        key={dIdx}
                        onClick={() => {
                          onSelectDate(dateStr);
                          onClose();
                        }}
                        className={`w-[14px] h-[14px] transition-all transform active:scale-95 ${getIntensityClass(count, isSelected)}`}
                        title={`${dateStr}: ${count} 记录`}
                      />
                    );
                  })}
                </div>
             ))}
           </div>
           
           <div className="w-full flex justify-between mt-2 px-1 opacity-50">
              <span className="text-[10px] font-medium text-stone-500">
                 {format(startDate, 'MM月')}
              </span>
              <span className="text-[10px] font-medium text-stone-500">
                 {format(today, 'MM月')}
              </span>
           </div>
        </div>

        <div className="p-6 pt-2">
           <button 
             onClick={() => {
               onSelectDate(format(today, 'yyyy-MM-dd'));
               onClose();
             }}
             className="w-full bg-[#2a2a2a] text-white py-3.5 rounded-xl text-[14px] font-medium tracking-wide shadow-sm hover:bg-[#222222] transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
           >
             <svg className="w-4 h-4 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
             回到今天
           </button>
        </div>
      </div>
    </div>
  );
}
