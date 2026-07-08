import React, { useState } from 'react';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameDay,
  isToday,
  format,
  addMonths,
  subMonths,
  parseISO,
  setMonth,
  setYear,
  getYear,
  getMonth,
} from 'date-fns';
import { ChevronLeft, ChevronRight, ArrowLeft, ChevronDown } from 'lucide-react';

interface MiniCalendarProps {
  value: string; // "YYYY-MM-DD"
  onChange: (val: string) => void;
  onBack: () => void;
  title: string;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

/**
 * MiniCalendar
 *
 * Light-themed embedded calendar (matches the DatePickerPopover / Insights style).
 * - Two views:
 *   1. "days"   – standard month grid with prev/next month arrows.
 *   2. "months" – 12-month quick-select grid with prev/next year arrows,
 *                 triggered by clicking the year/month header — for fast
 *                 year & month navigation.
 * - Colors: white background, baimiao-mysteria (brand purple) for highlights.
 */
export default function MiniCalendar({ value, onChange, onBack, title }: MiniCalendarProps) {
  const initialDate = value ? parseISO(value) : new Date();
  const [currentMonth, setCurrentMonth] = useState<Date>(initialDate);
  // 'days' = normal day grid  |  'months' = year-month quick picker
  const [pickerView, setPickerView] = useState<'days' | 'months'>('days');

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
  const currentYear = getYear(currentMonth);
  const currentMonthIndex = getMonth(currentMonth); // 0-indexed

  return (
    <div className="flex flex-col gap-2.5 w-full select-none text-stone-800 animate-in fade-in zoom-in-95 duration-150">
      {/* 头部控制区 */}
      <div className="flex items-center justify-between px-1">
        <button
          onClick={onBack}
          className="p-1 hover:bg-stone-100 rounded-lg text-stone-400 hover:text-stone-700 transition-colors active:scale-95 flex items-center gap-1 text-[11.5px] font-medium"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回
        </button>
        <span className="text-[12px] font-semibold tracking-wider text-stone-400">{title}</span>
      </div>

      {/* ====================================================
          VIEW: DAY GRID
      ==================================================== */}
      {pickerView === 'days' && (
        <>
          {/* 月份切换器 */}
          <div className="flex items-center justify-between bg-stone-50 rounded-xl px-2 py-1 border border-stone-100">
            <button
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              className="p-1 hover:bg-stone-200/60 rounded-lg text-stone-500 hover:text-stone-800 transition-colors active:scale-90"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPickerView('months')}
              className="px-2 py-0.5 hover:bg-stone-200/60 rounded-lg text-[12.5px] font-semibold tracking-tight text-stone-800 hover:text-baimiao-mysteria transition-colors flex items-center gap-1 active:scale-95"
            >
              {format(currentMonth, 'yyyy年 M月')}
              <ChevronDown className="w-3.5 h-3.5 opacity-60" />
            </button>
            <button
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              className="p-1 hover:bg-stone-200/60 rounded-lg text-stone-500 hover:text-stone-800 transition-colors active:scale-90"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* 星期表头 */}
          <div className="grid grid-cols-7 text-center text-[10px] font-semibold text-stone-400">
            {WEEKDAYS.map((day) => (
              <div key={day} className="py-0.5">{day}</div>
            ))}
          </div>

          {/* 天数网格 */}
          <div className="grid grid-cols-7 gap-y-1 text-center">
            {days.map((day, idx) => {
              const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
              const isSelected = selectedDate && isSameDay(day, selectedDate);
              const isTodayDay = isToday(day);

              return (
                <button
                  key={idx}
                  onClick={() => onChange(format(day, 'yyyy-MM-dd'))}
                  className={`h-[28px] w-[28px] mx-auto flex items-center justify-center text-[11.5px] font-medium transition-all rounded-full relative cursor-pointer active:scale-90 ${
                    isSelected
                      ? 'bg-baimiao-mysteria text-white font-bold shadow-md shadow-baimiao-mysteria/20'
                      : isTodayDay
                        ? 'text-baimiao-mysteria font-bold hover:bg-baimiao-mysteria/10'
                        : isCurrentMonth
                          ? 'text-stone-700 hover:bg-stone-100'
                          : 'text-stone-300 hover:bg-stone-50'
                  }`}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ====================================================
          VIEW: YEAR + MONTH QUICK PICKER
      ==================================================== */}
      {pickerView === 'months' && (
        <>
          {/* 年份切换器 */}
          <div className="flex items-center justify-between bg-stone-50 rounded-xl px-2 py-1 border border-stone-100">
            <button
              onClick={() => setCurrentMonth(setYear(currentMonth, currentYear - 1))}
              className="p-1 hover:bg-stone-200/60 rounded-lg text-stone-500 hover:text-stone-800 transition-colors active:scale-90"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[12.5px] font-semibold tracking-tight text-stone-800">{currentYear}年</span>
            <button
              onClick={() => setCurrentMonth(setYear(currentMonth, currentYear + 1))}
              className="p-1 hover:bg-stone-200/60 rounded-lg text-stone-500 hover:text-stone-800 transition-colors active:scale-90"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* 4×3 月份网格 */}
          <div className="grid grid-cols-4 gap-1.5">
            {MONTH_NAMES.map((name, i) => {
              const isCurrentMonth = i === currentMonthIndex;
              const isSelectedMonth =
                selectedDate &&
                getYear(selectedDate) === currentYear &&
                getMonth(selectedDate) === i;
              return (
                <button
                  key={i}
                  onClick={() => {
                    setCurrentMonth(setMonth(currentMonth, i));
                    setPickerView('days');
                  }}
                  className={`text-[12px] py-2 rounded-xl transition-colors font-medium active:scale-95 ${
                    isSelectedMonth
                      ? 'bg-baimiao-mysteria text-white'
                      : isCurrentMonth
                        ? 'bg-baimiao-mysteria/10 text-baimiao-mysteria'
                        : 'text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>

          {/* 返回日视图 */}
          <div className="flex justify-center pt-1.5 border-t border-stone-100">
            <button
              onClick={() => setPickerView('days')}
              className="text-[11.5px] text-stone-400 hover:text-stone-600 transition-colors px-2 py-0.5"
            >
              返回日历
            </button>
          </div>
        </>
      )}
    </div>
  );
}
