// 通用浮层定位工具 — 5 槽多选浮层（MultiSlotPromptPopover）与长按菜单共用。
// 抽出原因：C3 复用 Review.tsx 的浮层到 Insights.tsx，需要统一锚定算法避免漂移。

/** 5 槽多选浮层的近似高度（实测 ~280px，保留 10px buffer） */
export const POPOVER_HEIGHT_5_SLOT = 280;
/** 浮层与触发按钮之间的间距 */
export const POPOVER_GAP = 8;
/** 浮层左右边距最小值（防止贴边） */
export const POPOVER_EDGE_PADDING = 16;

/**
 * 计算浮层的 CSS top（fixed 定位）。
 * 优先级：优先 anchor 上方；若空间不足则下方；若都紧则选空间较大的一侧。
 */
export function calcPopoverTop(anchorRect: DOMRect): number {
  const spaceAbove = anchorRect.top;
  const spaceBelow = window.innerHeight - anchorRect.bottom;

  if (spaceAbove >= POPOVER_HEIGHT_5_SLOT + POPOVER_GAP) {
    return Math.max(POPOVER_EDGE_PADDING, anchorRect.top - POPOVER_HEIGHT_5_SLOT - POPOVER_GAP);
  } else if (spaceBelow >= POPOVER_HEIGHT_5_SLOT + POPOVER_GAP) {
    return Math.min(
      anchorRect.bottom + POPOVER_GAP,
      window.innerHeight - POPOVER_HEIGHT_5_SLOT - POPOVER_EDGE_PADDING,
    );
  } else {
    return spaceAbove > spaceBelow
      ? Math.max(POPOVER_EDGE_PADDING, anchorRect.top - POPOVER_HEIGHT_5_SLOT - POPOVER_GAP)
      : Math.min(
          anchorRect.bottom + POPOVER_GAP,
          window.innerHeight - POPOVER_HEIGHT_5_SLOT - POPOVER_EDGE_PADDING,
        );
  }
}

/**
 * 计算浮层的 CSS left（fixed 定位），让浮层居中于 anchor 但不超出视口左右边缘。
 */
export function clampPopoverLeft(anchorRect: DOMRect, popoverWidth: number): number {
  const centered = anchorRect.left + (anchorRect.width - popoverWidth) / 2;
  return Math.max(
    POPOVER_EDGE_PADDING,
    Math.min(centered, window.innerWidth - popoverWidth - POPOVER_EDGE_PADDING),
  );
}
