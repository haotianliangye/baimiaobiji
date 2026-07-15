---
id: "101"
title: "需求 1：统计小字下移与统一"
status: "ready-for-agent"
labels:
  - "ready-for-agent"
  - "seam"
created: "2026-07-14"
parent_issue: "docs/issues/100-ui-ux-restructure-v2.md"
related_prd: "docs/prd-ui-ux-2026-07-14.md"
---

# 需求 1：统计小字下移与统一

## Problem Statement

当前顶部全局 header 显示"白描 · 今日 165 字"作为副标题，各页面内部 header 也重复显示类似统计。信息分散且占用顶部空间。

（PRD Problem Statement 第 1 条：顶部全局 header 的"今日 X 字"副标题与各页面内部 header 重复统计，信息分散且占用顶部空间。）

## Solution

把"今日 X 字"从顶部 header 移到各输入/操作模块左上方，统一格式为"今日 X 条 X 字"，清理重复展示。

（PRD Solution 第 1 条：统计小字下移——把"今日 X 字"从顶部 header 移到各输入/操作模块左上方，统一"今日 X 条 X 字"，清理重复展示。）

## User Stories

1. 作为用户，我希望顶部全局 header 不显示"今日 X 字"副标题，以便顶部简洁。
2. 作为用户，我希望拾微页底部输入框左上方显示"今日 X 条 X 字"，以便一眼看到当日输入量。
3. 作为用户，我希望回顾页卡片列表底部显示"今日 X 条 X 字"，以便看到当日回顾量。
4. 作为用户，我希望沉淀页输入框左上方显示"今日 X 条 X 字"，以便看到当日沉淀量。
5. 作为用户，我希望明悟页不显示任何"今日"统计，以便聚焦洞察内容。
6. 作为用户，我希望 0 条、非今日、按钮禁用时统计仍显示，以便布局稳定。

## Implementation Decisions

> 来源：PRD Implementation Decisions「需求 1」章节 + 需求基线「需求 1」具体改动。

- **共享组件**：新增共享统计组件，数据计算保留各页面内部，通过 props 传入。实现建议：新增 `src/components/TodayStats.tsx`。
- **顶部全局 header**（`Layout.tsx`）：移除标题旁的"今日 X 字"副标题。
- **拾微页**（`Record.tsx`）：
  - 移除页面内部 header 里的"今日 X 字"统计 pill。
  - 底部输入框左上方新增"今日 {count} 条 {chars} 字"。
  - 统计当前查看日期（`?date=`）的 `raw_logs`：`count` = 日志条目数；`chars` = `countChars(log.content)`，包含语音/音频转写文本，不包含图片/视频 AI 摘要。
- **回顾页**（`Review.tsx`）：
  - 移除页面内部 header 里的"今日 X 字"统计 pill。
  - 在当前查看日期（`review_date`）的日记+回顾卡片列表底部新增"今日 {count} 条 {chars} 字"：空状态时放在"AI 智能整理"按钮上方；有内容时放在底部"AI 智能整理(追加)"按钮上方。
  - 统计口径：`countChars(review.ai_editorial || review.ai_review)`。
- **沉淀页**（`Thoughts.tsx`）：
  - 移除页面内部 header 里的"总条数 · 总字数"统计。
  - 底部快速输入/富文本编辑器左上方新增"今日 {count} 条 {chars} 字"。
  - 按**真实今日**（`created_at`）统计 `thoughts`。
- **明悟页**（`Mingwu`）：不显示任何"今日 X 条 X 字"统计。
- **样式**：字号 `text-[11px]`、颜色 `text-stone-400`、字重 `font-medium`、位置模块左上方 `mb-1.5`。0 条、非今日、按钮禁用时均显示。
- **i18n**：新增 `common.todayStats`（zh: `今日 {count} 条 {chars} 字` / en: `Today {count} notes · {chars} chars`）。

### 相关跨需求约束

- **移动端红线**：全局 `html/body` 保持 `overflow:hidden` + `overscroll-behavior:none`；统计小字为静态展示，不产生新滚动区。
- **数据兼容性**：统计仅读取已有字段（`raw_logs.content` / `review.ai_editorial || review.ai_review` / `thoughts`），不改附件存储 schema，不改 Settings store 版本。

## Testing Decisions

- seam: `foundation-migration.test.ts`（跨页统计小字：拾微/回顾/沉淀/明悟）
- seam: `thoughts.test.ts`（沉淀页统计小字）
- 原则：只测外部可观察行为（UI 渲染/交互/可见结果），不测实现细节（CSS 类名/内部状态）
- 测试重点（PRD Testing 第 1 条）：四页统计显示位置/口径/明悟不显示/0 条仍显示。即：
  - 顶部全局 header 不再显示"今日 X 字"副标题。
  - 拾微页底部输入框左上方、回顾页卡片列表底部、沉淀页输入框左上方显示"今日 X 条 X 字"。
  - 明悟页不显示任何"今日"统计。
  - 各页统计口径正确（拾微 raw_logs / 回顾 ai_editorial||ai_review / 沉淀 thoughts 按 created_at）。
  - 0 条、非今日、按钮禁用时统计仍显示（布局稳定）。

## Out of Scope

- 不改数据同步/云备份/OAuth
- 不涉端侧 AI 迁移
- 不改 AI 生成算法
- 不改附件存储 schema（仅读取已有字段）
- 不改 `countChars` 算法本身（仅复用现有实现）
- 不改各页面数据查询/筛选逻辑（统计口径按现有字段，不改 schema）
- 不涉随机漫步/编辑弹窗/双击/图标/顶部栏/预览/附件面板/设置页（其他需求范围）
