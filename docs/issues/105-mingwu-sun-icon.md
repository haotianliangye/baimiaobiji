---
id: "105"
title: "需求 5：明悟 Tab 图标改 Sun"
status: "done"
labels:
  - "done"
  - "seam"
created: "2026-07-14"
parent_issue: "docs/issues/100-ui-ux-restructure-v2.md"
related_prd: "docs/prd-ui-ux-2026-07-14.md"
---

# 需求 5：明悟 Tab 图标改 Sun

## Problem Statement

当前 TabBar"明悟"用发光/灯泡类图标（Sparkle/Lightbulb），与"明悟"语义不直观。Phosphor `Sun` 更贴合"明悟、点亮"的语义，图标需与文字含义一致。

## Solution

把 TabBar"明悟"图标替换为 `@phosphor-icons/react` 的 `Sun`。底部 TabBar 明悟 tab + 明悟页内部 header 图标 + 全局所有用旧明悟图标处（空状态/加载占位/生成按钮等）统一换 Sun，确保全局一致无遗漏。

## User Stories

22. 作为用户，我希望底部 TabBar 明悟 tab 用 Sun 图标，以便图标与"明悟"语义匹配。
23. 作为用户，我希望明悟页内部 header 图标也用 Sun，以便全局一致。
24. 作为用户，我希望所有用到旧明悟图标处（空状态/加载占位/生成按钮等）统一换 Sun，以便无遗漏。

## Implementation Decisions

### 图标替换
- `TabBar`（或同级导航组件）明悟 tab 图标改为 `@phosphor-icons/react` 的 `Sun`，粗细 `regular`，引入方式与其他 tab 一致。
- 明悟页内部 header 图标 + 全局所有旧明悟图标处（空状态/加载占位/生成按钮等）一并替换为 `Sun`，确保无遗漏。

### 样式保持
- 图标大小、描边粗细、颜色（active/inactive）与其他 tab 一致。
- 不改 TabBar 布局/间距/动画。

### i18n
- 复用 `tabs.mingwu`，无新增。

### 跨需求约束（相关）
- **图标库分工**：底部 TabBar 用 `@phosphor-icons/react`（本需求 `Sun` 即来自此库）；顶部栏/设置/面板用 `lucide-react`。本需求仅替换 TabBar 及明悟页相关图标，不涉及顶部栏图标库。
- **移动端红线**：全局 `html/body` 保持 `overflow:hidden` + `overscroll-behavior:none`；本需求仅替换图标，不新增滚动区。

## Testing Decisions

- seam: `foundation-migration.test.ts`
- 原则：只测外部可观察行为（UI 渲染/交互/可见结果），不测实现细节（CSS 类名/内部状态）
- 测试重点：
  - 底部 TabBar 明悟 tab 渲染为 Sun 图标
  - 明悟页内部 header 渲染为 Sun 图标
  - 全局旧明悟图标处（空状态/加载占位/生成按钮等）均替换为 Sun，无遗漏

## Out of Scope

- 不改数据同步/云备份/OAuth
- 不涉端侧 AI 迁移
- 不改 AI 生成算法
- 不改 TabBar 布局/间距/动画
- 不改明悟 tab 标签文案（i18n 复用 `tabs.mingwu`）
- 不改其他三个 tab（拾微/回顾/沉淀）的图标
- 不改明悟页功能逻辑，仅替换图标
- 不改附件存储 schema（仅读取已有字段）
