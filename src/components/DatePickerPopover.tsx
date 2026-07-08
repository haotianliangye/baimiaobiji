import React, { useState, useRef, useEffect } from 'react';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  isSameMonth,
  parseISO,
  isToday,
  format,
  setMonth,
  setYear,
  getYear,
  getMonth,
} from 'date-fns';
import { Calendar, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';

// ——— Constants ———
const WEEKDAYS_SHORT = ['一', '二', '三', '四', '五', '六', '日'];
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

interface DatePickerPopoverProps {
  value: string;             // "YYYY-MM-DD" or ""
  onChange: (v: string) => void;
  placeholder?: string;
  align?: 'left' | 'right';
}

/**
 * DatePickerPopover
 *
 * A fully custom date-picker that opens a popover calendar.
 * - Left/right alignment so the popover never overflows the app frame.
 * - Two views:
 *   1. "days"   – standard month grid with prev/next month arrows.
 *   2. "months" – 12-month quick-select grid with prev/next year arrows,
 *                 triggered by clicking the year/month header.
 * - Colors: white background, baimiao-mysteria (brand purple) for highlights.
 */
export default function DatePickerPopover({
  value,
  onChange,
  placeholder = '年/月/日',
  align = 'left',
}: DatePickerPopoverProps) {
  const [open, setOpen] = useState(false);
  // 'days' = normal day grid  |  'months' = year-month quick picker
  const [pickerView, setPickerView] = useState<'days' | 'months'>('days');
  const [viewDate, setViewDate] = useState<Date>(() =>
    value ? parseISO(value) : new Date()
  );
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setPickerView('days');
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Keep viewDate in sync when value changes externally
  useEffect(() => {
    if (value) setViewDate(parseISO(value));
  }, [value]);

  // ——— Day-view helpers ———
  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  while (days.length < 42) {
    days.push(new Date(days[days.length - 1].getTime() + 86400000));
  }

  const selectedDate = value ? parseISO(value) : null;
  const displayLabel = value ? value.replace(/-/g, '/') : placeholder;

  // ——— Month-view helpers ———
  const currentYear = getYear(viewDate);
  const currentMonth = getMonth(viewDate); // 0-indexed

  function handleMonthSelect(monthIndex: number) {
    setViewDate(d => setMonth(d, monthIndex));
    setPickerView('days');
  }

  function handleDaySelect(dayStr: string) {
    onChange(dayStr);
    setOpen(false);
    setPickerView('days');
  }

  return (
    <div ref={containerRef} className="relative">
      {/* ——— Trigger button ——— */}
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setPickerView('days'); }}
        className={`flex items-center gap-1.5 text-[12.5px] px-3 py-2 rounded-xl border transition-colors select-none ${
          value
            ? 'border-baimiao-mysteria/40 bg-baimiao-mysteria/5 text-baimiao-mysteria font-medium'
            : 'border-stone-200 bg-stone-50 text-stone-400'
        }`}
      >
        <Calendar className="w-3.5 h-3.5 shrink-0" />
        {displayLabel}
      </button>

      {/* ——— Popover ——— */}
      {open && (
        <div
          className={`absolute top-full mt-1.5 z-50 bg-white border border-stone-200 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] p-3 w-[256px] animate-in fade-in zoom-in-95 duration-150 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {/* ====================================================
              VIEW: DAY GRID
          ==================================================== */}
          {pickerView === 'days' && (
            <>
              {/* Header: clickable year/month → switch to month picker */}
              <div className="flex items-center justify-between mb-2.5 px-0.5">
                <button
                  type="button"
                  onClick={() => setPickerView('months')}
                  className="flex items-center gap-1 text-[13px] font-semibold text-stone-800 hover:text-baimiao-mysteria transition-colors rounded-lg px-1 py-0.5 hover:bg-stone-50"
                >
                  {format(viewDate, 'yyyy年M月')}
                  <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                </button>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setViewDate(d => addMonths(d, -1))}
                    className="p-1 rounded-lg hover:bg-stone-100 text-stone-500 hover:text-stone-800 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewDate(d => addMonths(d, 1))}
                    className="p-1 rounded-lg hover:bg-stone-100 text-stone-500 hover:text-stone-800 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Weekday headers */}
              <div className="grid grid-cols-7 mb-1">
                {WEEKDAYS_SHORT.map(d => (
                  <div key={d} className="text-center text-[10.5px] font-medium text-stone-400 py-0.5">
                    {d}
                  </div>
                ))}
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7 gap-y-0.5">
                {days.map((day, i) => {
                  const dayStr = format(day, 'yyyy-MM-dd');
                  const isSelected = selectedDate ? format(selectedDate, 'yyyy-MM-dd') === dayStr : false;
                  const isCurrentMonth = isSameMonth(day, viewDate);
                  const isTodayDay = isToday(day);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleDaySelect(dayStr)}
                      className={`text-[12px] h-7 w-full rounded-lg transition-colors ${
                        isSelected
                          ? 'bg-baimiao-mysteria text-white font-semibold'
                          : isTodayDay
                          ? 'text-baimiao-mysteria font-semibold hover:bg-baimiao-mysteria/10'
                          : isCurrentMonth
                          ? 'text-stone-800 hover:bg-stone-100'
                          : 'text-stone-300 hover:bg-stone-50'
                      }`}
                    >
                      {format(day, 'd')}
                    </button>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => { onChange(''); setOpen(false); }}
                  className="text-[12px] text-stone-400 hover:text-stone-600 transition-colors px-1"
                >
                  清除
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const today = format(new Date(), 'yyyy-MM-dd');
                    onChange(today);
                    setOpen(false);
                  }}
                  className="text-[12px] text-baimiao-mysteria hover:text-baimiao-mysteria/70 transition-colors font-medium px-1"
                >
                  今天
                </button>
              </div>
            </>
          )}

          {/* ====================================================
              VIEW: YEAR + MONTH QUICK PICKER
          ==================================================== */}
          {pickerView === 'months' && (
            <>
              {/* Year navigation */}
              <div className="flex items-center justify-between mb-3 px-0.5">
                <button
                  type="button"
                  onClick={() => setViewDate(d => setYear(d, getYear(d) - 1))}
                  className="p-1 rounded-lg hover:bg-stone-100 text-stone-500 hover:text-stone-800 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[13px] font-semibold text-stone-800">{currentYear}年</span>
                <button
                  type="button"
                  onClick={() => setViewDate(d => setYear(d, getYear(d) + 1))}
                  className="p-1 rounded-lg hover:bg-stone-100 text-stone-500 hover:text-stone-800 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* 4×3 month grid */}
              <div className="grid grid-cols-4 gap-1.5">
                {MONTH_NAMES.map((name, i) => {
                  const isCurrentMonth = i === currentMonth;
                  // Check if the selected date is in this year+month
                  const isSelectedMonth =
                    selectedDate &&
                    getYear(selectedDate) === currentYear &&
                    getMonth(selectedDate) === i;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleMonthSelect(i)}
                      className={`text-[12.5px] py-2 rounded-xl transition-colors font-medium ${
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

              {/* Back to day view */}
              <div className="flex justify-center mt-3 pt-2.5 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setPickerView('days')}
                  className="text-[12px] text-stone-400 hover:text-stone-600 transition-colors px-2 py-0.5"
                >
                  返回
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
