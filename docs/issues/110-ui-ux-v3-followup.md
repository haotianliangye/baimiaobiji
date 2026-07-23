---
id: "110"
title: "UI/UX 重构 v3 跟进（需求补漏）"
status: "done"
labels:
  - "done"
  - "seam"
created: "2026-07-15"
parent_issue: ""
related_prd: "docs/prd-ui-ux-v3-2026-07-15.md"
---

# UI/UX 重构 v3 跟进（需求补漏）

## Problem Statement

在白描笔记 v2 UI/UX 重构落地后，真实使用过程中仍有多处体验断层：内容展示过长、设置页语言入口冗余、设置抽屉遮罩过实、标签区缺少收纳与管理入口、标签缺少快捷操作菜单、日历统计口径未随数据合并更新、Copilot 选择器文案未对齐新四类、回顾页双击/长按交互丢失、随机漫步视觉与操作冗余。

## Solution

汇总为 9 项需求补漏：内容智能折叠与移动端交互恢复、语言入口平铺、抽屉毛玻璃化、抽屉标签区收纳化、标签快捷菜单、日历统计对齐合并口径、Copilot 选择器与历史筛选、回顾交互恢复、随机漫步精简。

详见：`docs/prd-ui-ux-v3-2026-07-15.md`

## User Stories

详见 PRD「User Stories」章节。

## Implementation Decisions

详见 PRD「Implementation Decisions」章节。

## Testing Decisions

- **seams**：
  - `foundation-migration.test.ts`：设置页改动、日历统计、Copilot 选择器与历史筛选。
  - `thoughts.test.ts`：内容折叠、双击/长按交互恢复。
  - `random-walk.test.ts`：随机漫步调整。
  - `multimedia.test.ts`：折叠态多媒体缩略。
- **原则**：只测外部可观察行为，不测实现细节。

## Out of Scope

- 不改动数据同步、云备份、OAuth、端到端加密。
- 不涉端侧 AI 迁移。
- 不改 AI 生成算法、Prompt 内容本身。
- 不新增 AI 模型服务商。
- 不改生成调度与任务队列逻辑。
- 不改附件存储 schema。
