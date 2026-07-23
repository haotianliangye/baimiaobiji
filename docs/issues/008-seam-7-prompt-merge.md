---
id: "008"
title: "Seam 7：提示词配置合并与数据迁移"
status: "done"
labels:
  - "done"
  - "seam"
  - "settings"
  - "prompt"
  - "migration"
created: "2026-07-14"
parent_issue: "docs/issues/001-ui-ux-restructure.md"
related_prd: "docs/prd-ui-ux-2026-07-13.md"
related_alignment: "docs/requirement-alignment-2026-07-13.md"
---

# Seam 7：提示词配置合并与数据迁移

## Problem Statement

提示词配置中“明悟 / 洞察 / 日记 / 回顾”的摘要与生成 prompt 存在重复和语义混淆，用户需要在多个相似配置间切换，增加认知负担。

## Solution

合并相关 Prompt 配置项：
- 明悟与洞察生成 Prompt 合并为“明悟和洞察生成 Prompt”。
- 日记与回顾一句话摘要合并为“日记回顾一句话摘要生成 Prompt”。
- 洞察摘要改为“明悟和洞察一句话摘要生成 Prompt”。

同时提供数据迁移逻辑，确保旧设置能平滑过渡到新结构。

## User Stories

1. 作为用户，我希望明悟和洞察共用一套生成 Prompt 配置，减少重复设置。
2. 作为用户，我希望日记和回顾的一句话摘要合并为一个 Prompt，因为摘要逻辑本质相同。
3. 作为用户，我希望设置中“明悟和洞察生成 Prompt”的标签为明悟/洞察/自定义 1/2/3，并保留自动生成选中复选框，以便灵活控制哪些类型自动产出。
4. 作为用户，我希望升级应用后旧 Prompt 设置不会丢失，而是自动合并到新结构。

## Implementation Decisions

- 设置 → 提示词配置中调整区块：
  1. **日记回顾生成 Prompt**（合并原日记生成 + 回顾生成）：5 槽标签 `日记 / 回顾 / 自定义 1 / 自定义 2 / 自定义 3`，保留“自动生成选中”复选框。
  2. **明悟和洞察生成 Prompt**（合并原明悟生成 + 洞察生成）：5 槽标签 `明悟 / 洞察 / 自定义 1 / 自定义 2 / 自定义 3`，保留“自动生成选中”复选框。
  3. **日记回顾一句话摘要生成 Prompt**（合并原日记摘要 + 回顾摘要）。
  4. **明悟和洞察一句话摘要生成 Prompt**（由原洞察摘要扩展，补充明悟默认摘要）。
- 数据迁移：
  - 读取 persisted settings 时，将旧的 `mingwuPrompt`/`insightPrompt` 合并到新结构。
  - 将旧的 `diarySummaryPrompt`/`summaryPrompt`（回顾摘要）合并到新结构。
  - 旧的单字段保留只读兼容，保存时写入新结构。
- Zustand store 中引入新的统一字段，并更新 `merge`/`migrate` 逻辑。
- Settings store 版本从 v11 升级到 v12。

## Testing Decisions

- 验证旧设置迁移后，新配置页正确显示合并后的 Prompt。
- 验证保存后自动生成逻辑读取新字段。
- 验证切换语言后 Prompt 仍按 per-language 正确显示。
- 验证旧字段保留只读兼容，不会导致旧版本应用崩溃。
- 验证 v11 → v12 迁移脚本覆盖所有旧字段。

## Out of Scope

- 不改动 Prompt 内容本身，仅调整配置结构。
- 不改动 AI 生成调度与任务队列逻辑。
- 设置页布局重构见 Seam 2。
