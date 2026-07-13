---
id: "010"
title: "Seam 9：i18n 文案修正（消除中英混编 key）"
status: "ready-for-agent"
labels:
  - "ready-for-agent"
  - "seam"
  - "i18n"
  - "copy"
created: "2026-07-14"
parent_issue: "docs/issues/001-ui-ux-restructure.md"
related_prd: "docs/prd-ui-ux-2026-07-13.md"
related_alignment: "docs/requirement-alignment-2026-07-13.md"
---

# Seam 9：i18n 文案修正（消除中英混编 key）

## Problem Statement

卡片右键/长按菜单及多处按钮出现 `view.copyContent编辑内容` 等中英混编文案，严重影响中文用户体验；英文环境下也可能存在 key 直接暴露的问题。

## Solution

全量扫描 `zh.ts` / `en.ts` 中所有菜单、按钮、Tooltip 文案 key，修正所有 key 直接暴露导致的中英混编问题；新增需求中涉及的新文案统一写入 i18n 字典，不在组件中硬编码。

## User Stories

1. 作为中文用户，我希望右键/长按菜单显示纯中文，不出现 `view.copyContent编辑内容` 等混编文案。
2. 作为英文用户，我希望英文环境下所有菜单、按钮、Tooltip 显示纯英文。
3. 作为用户，我希望回顾页生成弹窗的标题从“生成 2 篇回顾”改为“生成 2 篇”，因为选中项可能包含日记或自定义类型。
4. 作为用户，我希望新增 UI 中的文案都通过 i18n 字典管理，而不是硬编码在组件中。

## Implementation Decisions

- 全量扫描 `zh.ts` / `en.ts` 中所有菜单、按钮、Tooltip 文案 key。
- 修正所有 key 直接暴露导致的中英混编问题（如 `view.copyContent编辑内容`）。
- 确保右键/长按菜单、卡片操作栏、导出导入按钮等严格按当前语言环境显示。
- 新增需求中涉及的新文案统一写入 i18n 字典，不在组件中硬编码。
- 本次改动优先保证中文/英文两种语言环境，其他语言可后续补充。

## Testing Decisions

- 验证中文环境下所有菜单/按钮显示中文，无 key 暴露。
- 验证英文环境下对应显示英文。
- 验证右键/长按菜单、卡片操作栏、导出导入按钮等重点区域无混编。
- 验证新增文案（附件面板、设置页菜单、关于页等）均已写入 i18n 字典。

## Out of Scope

- 不涉及新增语言（如日语、法语等）。
- 不改动业务逻辑，仅调整文案 key 与翻译内容。
- 顶部栏、设置页、附件面板等具体 UI 实现见对应 seams。
