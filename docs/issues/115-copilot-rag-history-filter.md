---
id: "115"
title: "Copilot RAG 选择器文案对齐与历史页日期筛选"
status: "done"
labels:
  - "done"
  - "ui-ux-v3"
created: "2026-07-15"
parent_issue: "110"
related_prd: "docs/prd-ui-ux-v3-2026-07-15.md"
---

# Copilot RAG 选择器文案对齐与历史页日期筛选

## Parent

- #110 UI/UX 重构 v3 跟进（需求补漏）

## What to build

对齐 Copilot 的 RAG 选择器文案与四大板块语义，并增强历史页筛选：

1. RAG 选择器显示文案由「记录 / 日记 / 回顾 / 洞察」改为「识微 / 回顾 / 沉淀 / 洞察」，内部代码字段仍保持英文标识以避免类型断裂。
2. 更新 `CopilotRetrievalFilters`、`CopilotCitation` 与 `retrieveCopilotContext` 中的模块联合类型，移除独立的 `diary` 分支，将日记与回顾合并到 `review` 分支。
3. 检索索引映射：
   - 识微（`record`） → `raw_logs`
   - 回顾（`review`） → `daily_reviews` 全表
   - 沉淀（`thoughts`） → `thoughts`
   - 洞察（`insight`） → `mingwu`
4. 历史页（`navView === 'history'`）顶部增加一行筛选区，仅保留「全部日期」日期选择器，复用 RAG 页现有日期选择器组件与样式。
5. 历史列表默认按 `updated_at` 倒序，日期筛选后按选定范围过滤会话记录。

该 slice 需要同步更新类型、检索逻辑、UI 文案、历史页筛选及测试。

## Acceptance criteria

- [ ] RAG 选择器显示「识微 / 回顾 / 沉淀 / 洞察」
- [ ] 选择「识微」时只检索 `raw_logs`
- [ ] 选择「回顾」时检索 `daily_reviews` 全表（含旧 `entry_type='diary'`）
- [ ] 选择「沉淀」时检索 `thoughts`
- [ ] 选择「洞察」时检索 `mingwu`
- [ ] `CopilotRetrievalFilters`、`CopilotCitation`、`retrieveCopilotContext` 的类型与实现同步更新
- [ ] 历史页顶部出现日期选择器
- [ ] 日期筛选后历史列表按范围过滤
- [ ] `tests/foundation-migration.test.ts` 覆盖 RAG 选择器文案与历史页日期筛选

## Blocked by

- None - can start immediately
