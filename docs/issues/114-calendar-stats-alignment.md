---
id: "114"
title: "日历弹窗统计口径对齐数据合并"
status: "ready-for-agent"
labels:
  - "ready-for-agent"
  - "ui-ux-v3"
created: "2026-07-15"
parent_issue: "110"
related_prd: "docs/prd-ui-ux-v3-2026-07-15.md"
---

# 日历弹窗统计口径对齐数据合并

## Parent

- #110 UI/UX 重构 v3 跟进（需求补漏）

## What to build

日历弹窗（`CalendarHeatmap`）的中间统计项需要随 v2 数据合并更新：

1. 中间统计项标签由「日记」改为「回顾」，复用现有 i18n key `calendarHeatmap.review`。
2. 中间数量 `middleCount` 改为统计 `daily_reviews` 全表记录数（含旧 `entry_type='diary'` 与 `'review'`）。
3. 下方字数统计中对应「回顾」的字数，合并计算旧日记字段 `ai_editorial` 与旧回顾字段 `ai_review` 的字数。
4. 左侧「拾微」与右侧「天」的统计保持不变。

该 slice 涉及统计文案、合并计算逻辑及测试断言更新，范围较窄但需保证数据口径正确。

## Acceptance criteria

- [ ] 日历弹窗中间统计项显示「回顾」而非「日记」
- [ ] 中间数量等于旧日记与旧回顾记录总数（即 `daily_reviews` 全表数量）
- [ ] 下方「回顾」字数统计合并 `ai_editorial` 与 `ai_review` 字数
- [ ] 左侧「拾微」与右侧「天」统计保持原有逻辑不变
- [ ] `tests/foundation-migration.test.ts` 覆盖统计文案与合并口径的外部可观察行为

## Blocked by

- None - can start immediately
