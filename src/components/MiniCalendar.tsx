import React, { useState } from 'react';
import { 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameDay, 
  format,
  addMonths,
  subMonths,
  parseISO
} from 'date-fns';
import { ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react';

interface MiniCalendarProps {
  value: string; // "YYYY-MM-DD"
  onChange: (val: string) => void;
  onBack: () => void;
  title: string;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export default function MiniCalendar({ value, onChange, onBack, title }: MiniCalendarProps) {
  const initialDate = value ? parseISO(value) : new Date();
  const [currentMonth, setCurrentMonth] = useState<Date>(initialDate);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

  // 生成日历天数网格
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  
  // 补齐 42 个格子 (6行)，保持高度一致防抖动
  while (days.length < 42) {
    const lastDay = days[days.length - 1];
    const nextDay = new Date(lastDay.getTime() + 86400000);
    days.push(nextDay);
  }

  const selectedDate = value ? parseISO(value) : null;

  return (
    <div className="flex flex-col gap-2.5 w-full select-none text-white animate-in fade-in zoom-in-95 duration-150">
      {/* 头部控制区 */}
      <div className="flex items-center justify-between px-1">
        <button 
          onClick={onBack}
          className="p-1 hover:bg-white/10 rounded-lg text-stone-400 hover:text-white transition-colors active:scale-95 flex items-center gap-1 text-[11.5px] font-medium"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回
        </button>
        <span className="text-[12px] font-semibold tracking-wider text-white/50">{title}</span>
      </div>

      {/* 月份切换器 */}
      <div className="flex items-center justify-between bg-white/5 rounded-xl px-2 py-1">
        <button 
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          className="p-1 hover:bg-white/10 rounded-lg text-stone-400 hover:text-white transition-colors active:scale-90"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-[12.5px] font-semibold font-mono tracking-tight text-white/90">
          {format(currentMonth, 'yyyy年 M月')}
        </span>
        <button 
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          className="p-1 hover:bg-white/10 rounded-lg text-stone-400 hover:text-white transition-colors active:scale-90"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* 星期表头 */}
      <div className="grid grid-cols-7 text-center text-[10px] font-semibold text-white/40">
        {WEEKDAYS.map((day) => (
          <div key={day} className="py-0.5">{day}</div>
        ))}
      </div>

      {/* 天数网格 */}
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {days.map((day, idx) => {
          const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
          const isSelected = selectedDate && isSameDay(day, selectedDate);
          
          return (
            <button
              key={idx}
              onClick={() => onChange(format(day, 'yyyy-MM-dd'))}
              className={`h-[28px] w-[28px] mx-auto flex items-center justify-center text-[11.5px] font-medium transition-all rounded-full relative cursor-pointer active:scale-90 ${
                isSelected 
                  ? 'bg-white text-black font-bold shadow-md' 
                  : isCurrentMonth
                    ? 'text-white/80 hover:bg-white/10 hover:text-white'
                    : 'text-white/20 hover:bg-white/5 hover:text-white/40'
              }`}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
