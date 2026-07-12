import React, { useMemo } from 'react';
import { startOfDay, format, addDays, subDays, parse, isSameDay } from 'date-fns';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { countChars } from '../lib/wordCount';

export type HeatmapSection = 'record' | 'diary' | 'review';

interface CalendarHeatmapProps {
  currentDate: Date;
  onSelectDate: (date: string) => void;
  onClose: () => void;
  activeSection?: HeatmapSection;
}

export default function CalendarHeatmap({ currentDate, onSelectDate, onClose, activeSection = 'record' }: CalendarHeatmapProps) {
  const today = new Date();
  
  // End of period is target currentDate (selected date)
  const baseDate = startOfDay(currentDate);
  // Total of 70 days (14 columns * 5 rows)
  const startDate = subDays(baseDate, 69);

  // Count active logs per day dynamically for the selected 70-day period
  const logs = useLiveQuery(
    () => db.raw_logs.where('created_at').between(startDate.getTime(), baseDate.getTime() + 86400000).toArray(),
    [startDate.getTime(), baseDate.getTime()]
  );

  const stats = useMemo(() => {
    const map = new Map<string, number>();
    logs?.forEach(log => {
      const dateStr = format(new Date(log.created_at), 'yyyy-MM-dd');
      map.set(dateStr, (map.get(dateStr) || 0) + 1);
    });
    return map;
  }, [logs]);

  // Generate exactly 70 days cells chronologically (from left to right, top to bottom)
  const gridCells = [];
  for (let i = 0; i < 70; i++) {
    gridCells.push(addDays(startDate, i));
  }

  // Segment into 14 columns, each containing 5 cells (rows)
  const columns = [];
  for (let i = 0; i < gridCells.length; i += 5) {
    columns.push(gridCells.slice(i, i + 5));
  }

  const getIntensityClass = (count: number, isSelected: boolean) => {
    if (isSelected) return 'bg-baimiao-mysteria border-2 border-baimiao-mysteria/40 scale-110 z-10 rounded-[5px] shadow-[0_2px_8px_rgba(27,25,56,0.35)]';
    if (count === 0) return 'bg-[#f0edf4] border border-black/[0.005] rounded-[4px]';
    if (count < 3) return 'bg-baimiao-mysteria/15 rounded-[4px]';
    if (count < 8) return 'bg-baimiao-mysteria/40 rounded-[4px]';
    if (count < 15) return 'bg-baimiao-mysteria/65 rounded-[4px]';
    return 'bg-baimiao-mysteria rounded-[4px]';
  };

  const allLogs = useLiveQuery(() => db.raw_logs.toArray());
  const allDiaries = useLiveQuery(() => db.daily_reviews.filter(d => d.entry_type === 'diary').toArray());
  const allReviews = useLiveQuery(() => db.daily_reviews.filter(r => r.entry_type === 'review').toArray());

  const totalLogsAllTime = allLogs?.length || 0;
  const middleCount = activeSection === 'review' ? (allReviews?.length || 0) : (allDiaries?.length || 0);
  const middleLabel = activeSection === 'review' ? '回顾' : '日记';

  const sectionNameMap = {
    record: '碎屑',
    diary: '日记',
    review: '回顾',
  };
  const sectionName = sectionNameMap[activeSection];

  const currentDateStr = format(currentDate, 'yyyy-MM-dd');

  const wordCountStats = useMemo(() => {
    if (activeSection === 'record') {
      const daily = (allLogs || [])
        .filter(log => format(new Date(log.created_at), 'yyyy-MM-dd') === currentDateStr)
        .reduce((sum, log) => sum + countChars(log.content), 0);
      const total = (allLogs || []).reduce((sum, log) => sum + countChars(log.content), 0);
      return { daily, total };
    }
    if (activeSection === 'diary') {
      const daily = (allDiaries || [])
        .filter(diary => diary.review_date === currentDateStr)
        .reduce((sum, diary) => sum + countChars(diary.ai_editorial || ''), 0);
      const total = (allDiaries || []).reduce((sum, diary) => sum + countChars(diary.ai_editorial || ''), 0);
      return { daily, total };
    }
    // review
    const daily = (allReviews || [])
      .filter(review => review.review_date === currentDateStr)
      .reduce((sum, review) => sum + countChars(review.ai_review), 0);
    const total = (allReviews || []).reduce((sum, review) => sum + countChars(review.ai_review), 0);
    return { daily, total };
  }, [activeSection, allLogs, allDiaries, allReviews, currentDateStr]);
  
  const firstLogMs = allLogs && allLogs.length > 0 ? allLogs.reduce((acc, log) => Math.min(acc, log.created_at), Date.now()) : Date.now();
  const firstDiaryMs = allDiaries && allDiaries.length > 0 ? allDiaries.reduce((acc, diary) => {
    const time = parse(diary.review_date, 'yyyy-MM-dd', new Date()).getTime();
    return isNaN(time) ? acc : Math.min(acc, time);
  }, Date.now()) : Date.now();
  
  const earliestEntryMs = Math.min(firstLogMs, firstDiaryMs);
  const daysSinceEpoch = (allLogs?.length || allDiaries?.length) ? Math.max(1, Math.round((today.getTime() - earliestEntryMs) / (1000 * 60 * 60 * 24)) + 1) : 0;

  return (
    <div className="fixed inset-x-0 top-[52px] bottom-0 z-50 flex flex-col items-center p-4 bg-black/20 backdrop-blur-sm transition-all animate-in fade-in duration-200" onClick={onClose}>
      <div
        className="w-[360px] h-[370px] bg-gradient-to-br from-white via-white to-[#faf9fc] rounded-3xl overflow-hidden shadow-[0_20px_50px_rgba(27,25,56,0.12)] border border-baimiao-border/70 p-6 flex flex-col justify-between"
        onClick={e => e.stopPropagation()}
      >
        {/* Top Stats */}
        <div className="flex items-center justify-between w-full px-2 mt-1 text-center">
          <div className="flex flex-col items-center">
             <span className={`text-[32px] font-bold font-mono tracking-tight leading-none ${activeSection === 'record' ? 'text-baimiao-mysteria' : 'text-stone-400'}`}>{totalLogsAllTime}</span>
             <span className="text-[12px] text-stone-400 font-medium mt-1">碎屑</span>
          </div>
          <div className="flex flex-col items-center">
             <span className={`text-[32px] font-bold font-mono tracking-tight leading-none ${activeSection === 'diary' || activeSection === 'review' ? 'text-baimiao-mysteria' : 'text-stone-400'}`}>{middleCount}</span>
             <span className="text-[12px] text-stone-400 font-medium mt-1">{middleLabel}</span>
          </div>
          <div className="flex flex-col items-center">
             <span className="text-[32px] font-bold text-stone-400 font-mono tracking-tight leading-none">{daysSinceEpoch}</span>
             <span className="text-[12px] text-stone-400 font-medium mt-1">天</span>
          </div>
        </div>

        {/* Word Count Stats */}
        <div className="flex items-end justify-between w-full px-2 mt-3 mb-1">
          <div className="flex flex-col items-start">
            <span className="text-[11px] text-stone-400 font-medium">今日{sectionName}字数</span>
            <span className="text-[18px] font-bold text-baimiao-mysteria font-mono tracking-tight leading-none mt-0.5">
              {wordCountStats.daily.toLocaleString()}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[11px] text-stone-400 font-medium">{sectionName}总字数</span>
            <span className="text-[18px] font-bold text-baimiao-mysteria font-mono tracking-tight leading-none mt-0.5">
              {wordCountStats.total.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Heatmap Area */}
        <div className="py-2 flex flex-col items-center justify-center flex-1">
           {/* The 14x5 Grid: cells of 18px */}
           <div className="flex gap-[4px] items-start w-full overflow-x-auto no-scrollbar py-0.5 justify-center">
             {columns.map((week, wIdx) => (
                <div key={wIdx} className="flex flex-col gap-[4px] shrink-0">
                  {week.map((date, dIdx) => {
                    const dateStr = format(date, 'yyyy-MM-dd');
                    const count = stats.get(dateStr) || 0;
                    const isSelected = isSameDay(date, currentDate);
                    const isFuture = date > today;
                    if (isFuture) return <div key={dIdx} className="w-[18px] h-[18px] bg-transparent" />;
                    return (
                      <button
                        key={dIdx}
                        onClick={() => {
                           onSelectDate(dateStr);
                           onClose();
                        }}
                        className={`w-[18px] h-[18px] transition-all transform active:scale-[0.85] ${getIntensityClass(count, isSelected)}`}
                        title={`${dateStr}: ${count} 记录`}
                      />
                    );
                  })}
                </div>
             ))}
           </div>
           
           {/* Bottom Month Labels */}
           <div className="flex justify-between w-full mt-2 px-1 text-[11px] text-stone-400 font-semibold font-sans">
             <span>{format(startDate, 'MM月')}</span>
             <span>{format(baseDate, 'MM月')}</span>
           </div>
        </div>

        {/* Action Button */}
        <div className="select-none w-full mb-[6px]">
            <button
              onClick={() => {
                onSelectDate(format(today, 'yyyy-MM-dd'));
                onClose();
              }}
              className="w-full bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white py-3 rounded-2xl text-[13px] font-semibold tracking-wide shadow-md shadow-baimiao-mysteria/10 hover:brightness-110 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4 opacity-95" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
              回到今天
            </button>
        </div>
      </div>
    </div>
  );
}
