/**
 * #tag-aggregation 统一标签 chip。
 * 所有"展示 + 点击跳转聚合页"的标签 UI 共用此组件。
 * 关键行为:
 *   - 默认点击 → navigate('/tag?path=...'),并 stopPropagation 防止冒泡触发卡片 click
 *   - removable=true 时,X 按钮单独处理 onRemove,自身 click 不冒泡
 *   - variant=compact 只显示末级名;full 显示完整路径
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hash, X } from 'lucide-react';
import clsx from 'clsx';

export interface TagChipProps {
  /** 完整标签路径(用于跳转,内部也会用于完整路径 variant 显示)。 */
  path: string;
  /** compact = 只显示末级名(默认);full = 显示完整路径。 */
  variant?: 'compact' | 'full';
  /** 自定义点击跳转;默认 navigate 到 /tag?path=... */
  onNavigate?: (path: string) => void;
  /** 是否显示 X 删除按钮(用于 Review 卡片)。 */
  removable?: boolean;
  /** X 点击回调,不影响 chip 自身 click。 */
  onRemove?: () => void;
  /** 尺寸;默认 xs。 */
  size?: 'xs' | 'sm';
  /** 额外 className 合并到 chip 根。 */
  className?: string;
  /** 给自动化测试用的 testid。 */
  testId?: string;
}

/** 渲染 chip 末级名 + 完整路径(用于 tooltip 等)。 */
export function getTagDisplayName(path: string): string {
  return path.split('/').pop() || path;
}

export function TagChip({
  path,
  variant = 'compact',
  onNavigate,
  removable,
  onRemove,
  size = 'xs',
  className,
  testId,
}: TagChipProps) {
  const navigate = useNavigate();
  const displayName = variant === 'compact' ? getTagDisplayName(path) : path;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // 阻止冒泡到卡片根节点的 click(展开/编辑判定)
      e.stopPropagation();
      e.preventDefault();
      if (onNavigate) {
        onNavigate(path);
      } else {
        navigate(`/tag?path=${encodeURIComponent(path)}`);
      }
    },
    [path, onNavigate, navigate],
  );

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onRemove?.();
    },
    [onRemove],
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid={testId}
      title={path}
      className={clsx(
        'inline-flex items-center gap-0.5 bg-baimiao-mysteria/8 text-baimiao-mysteria rounded-full select-none',
        'hover:bg-baimiao-mysteria/14 transition-colors',
        size === 'xs' ? 'text-[10.5px] px-1.5 py-0.5' : 'text-[11.5px] px-2 py-0.5',
        className,
      )}
    >
      <Hash className="opacity-60" size={size === 'xs' ? 10 : 12} />
      <span>{displayName}</span>
      {removable && (
        <span
          role="button"
          tabIndex={-1}
          aria-label="remove tag"
          onClick={handleRemove}
          className="hover:text-rose-500 transition-colors ml-0.5 inline-flex items-center"
        >
          <X size={size === 'xs' ? 10 : 12} />
        </span>
      )}
    </button>
  );
}