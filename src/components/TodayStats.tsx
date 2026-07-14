/**
 * 需求 1：统计小字下移与统一
 * 模块左上方显示「今日 {count} 条 {chars} 字」的共享统计组件。
 * 数据计算保留各页面内部，通过 props 传入。
 *
 * 样式：text-[11px] / text-stone-400 / font-medium / 模块左上方 mb-1.5。
 * 0 条、非今日、按钮禁用时均显示（布局稳定）。
 */
import { useTranslation } from '../lib/i18n';
import { cn } from '../lib/utils';

interface TodayStatsProps {
  count: number;
  chars: number;
  className?: string;
}

export default function TodayStats({ count, chars, className }: TodayStatsProps) {
  const { t } = useTranslation();
  return (
    <div className={cn('text-[11px] text-stone-400 font-medium mb-1.5', className)}>
      {t('common.todayStats', { count, chars })}
    </div>
  );
}
