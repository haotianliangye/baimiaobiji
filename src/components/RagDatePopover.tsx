import React, { useState, useRef, useEffect } from 'react';
import { Calendar as CalendarIcon, ChevronDown } from 'lucide-react';
import MiniCalendar from './MiniCalendar';
import { useTranslation } from '../lib/i18n';

/**
 * RAG 模块同款日期选择弹窗。
 *
 * 设计目标：
 * - 抽出 Copilot.tsx 中的内联弹窗为可复用组件，让 RAG tab 和「历史」tab 共用同一份 UI
 * - 选项：全部 / 本周 / 本月 / 本季度 / 自定义时间（含开始时间 / 结束时间 / 确定按钮）
 * - 视觉与现有 RAG 模块完全一致（白底 + 紫色高亮）
 * - 父容器需提供 `position: relative` 上下文，弹窗使用 absolute 定位到右下
 *
 * 外部状态：
 * - dateRange: '全部' | '本周' | '本月' | '本季度' | '自定义'（中文串作为内部标识符，依赖 Copilot 的过滤逻辑）
 * - customStartDate / customEndDate: 'YYYY-MM-DD'
 * - onDateRangeChange: 选中预设 / 提交自定义时调用
 * - onCustomStartDateChange / onCustomEndDateChange: 自定义时间输入时调用
 *
 * 可选 prop:
 * - displayLabel: 自定义下拉显示文字（不传则按内部计算）
 * - testId: data-testid
 */
export interface RagDatePopoverProps {
  dateRange: string;
  customStartDate: string;
  customEndDate: string;
  onDateRangeChange: (range: string) => void;
  onCustomStartDateChange: (v: string) => void;
  onCustomEndDateChange: (v: string) => void;
  displayLabel?: string;
  testId?: string;
  className?: string;
  buttonClassName?: string;
}

const DATE_PRESETS = ['全部', '本周', '本月', '本季度'] as const;
const DATE_PRESET_KEY: Record<string, string> = {
  '全部': 'search.allDates',
  '本周': 'search.thisWeek',
  '本月': 'search.thisMonth',
  '本季度': 'search.thisQuarter',
  '自定义': 'search.custom',
};

export default function RagDatePopover({
  dateRange,
  customStartDate,
  customEndDate,
  onDateRangeChange,
  onCustomStartDateChange,
  onCustomEndDateChange,
  displayLabel,
  testId,
  className,
  buttonClassName,
}: RagDatePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [calendarTarget, setCalendarTarget] = useState<'none' | 'start' | 'end'>('none');
  const containerRef = useRef<HTMLDivElement>(null);

  // 关闭弹窗（点击外部）
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCalendarTarget('none');
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // 自定义时间下：展示「7-13~7-19」格式
  const computedLabel = (() => {
    if (dateRange === '自定义' && customStartDate && customEndDate) {
      const formatShort = (s: string) => {
        const [_, m, d] = s.split('-');
        return `${parseInt(m, 10)}.${parseInt(d, 10)}`;
      };
      return `${formatShort(customStartDate)}~${formatShort(customEndDate)}`;
    }
    return t(DATE_PRESET_KEY[dateRange] || 'search.allDates');
  })();

  const label = displayLabel ?? computedLabel;

  return (
    <div ref={containerRef} className={`relative shrink-0 ${className ?? ''}`}>
      <button
        data-testid={testId}
        onClick={() => { setOpen(v => !v); setCalendarTarget('none'); }}
        className={`flex items-center gap-1 bg-stone-100 hover:bg-stone-200/80 text-stone-750 px-2.5 py-1 rounded-xl text-[12px] font-medium border border-stone-200/40 outline-none transition-colors cursor-pointer active:scale-95 ${buttonClassName ?? ''}`}
      >
        <span className="whitespace-nowrap">{label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
      </button>

      {open && (
        <div className="absolute top-full mt-1.5 right-0 w-52 bg-white border border-stone-200 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 text-stone-800">
          {calendarTarget === 'none' ? (
            <>
              {DATE_PRESETS.map(range => (
                <button
                  key={range}
                  onClick={() => {
                    onDateRangeChange(range);
                    onCustomStartDateChange('');
                    onCustomEndDateChange('');
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[12px] font-medium rounded-xl transition-colors ${
                    dateRange === range
                      ? 'bg-baimiao-mysteria/10 text-baimiao-mysteria'
                      : 'text-stone-600 hover:text-stone-800 hover:bg-stone-100'
                  }`}
                >
                  {t(DATE_PRESET_KEY[range] || 'search.allDates')}
                </button>
              ))}
              <div className="border-t border-stone-100 my-1" />
              <div className="px-3 py-1.5 flex flex-col gap-2">
                <span className="text-[10.5px] font-semibold text-stone-400 uppercase tracking-wider">{t('search.customTime')}</span>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11.5px] text-stone-500 shrink-0">{t('search.startDate')}</span>
                    <button
                      onClick={() => setCalendarTarget('start')}
                      className="bg-stone-50 border border-stone-200 text-stone-700 rounded-lg px-2 py-1 text-[11px] font-mono text-left w-32 outline-none hover:border-baimiao-mysteria/40 active:bg-stone-100 transition-colors"
                    >
                      {customStartDate || t('copilot.selectDate')}
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11.5px] text-stone-500 shrink-0">{t('search.endDate')}</span>
                    <button
                      onClick={() => setCalendarTarget('end')}
                      className="bg-stone-50 border border-stone-200 text-stone-700 rounded-lg px-2 py-1 text-[11px] font-mono text-left w-32 outline-none hover:border-baimiao-mysteria/40 active:bg-stone-100 transition-colors"
                    >
                      {customEndDate || t('copilot.selectDate')}
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (!customStartDate || !customEndDate) {
                      alert(t('search.alertSelectDates'));
                      return;
                    }
                    if (customStartDate > customEndDate) {
                      alert(t('search.alertStartAfterEnd'));
                      return;
                    }
                    onDateRangeChange('自定义');
                    setOpen(false);
                    setCalendarTarget('none');
                  }}
                  disabled={!customStartDate || !customEndDate}
                  className="w-full mt-1.5 py-1.5 bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white rounded-xl text-[11.5px] font-semibold flex items-center justify-center gap-1 active:scale-[0.98] disabled:opacity-40"
                >
                  <CalendarIcon className="w-3 h-3" />
                  {t('search.confirm')}
                </button>
              </div>
            </>
          ) : (
            <div className="p-1">
              <MiniCalendar
                value={calendarTarget === 'start' ? customStartDate : customEndDate}
                onChange={(val) => {
                  if (calendarTarget === 'start') onCustomStartDateChange(val);
                  else onCustomEndDateChange(val);
                  setCalendarTarget('none');
                }}
                onBack={() => setCalendarTarget('none')}
                title={calendarTarget === 'start' ? t('search.selectStart') : t('search.selectEnd')}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
