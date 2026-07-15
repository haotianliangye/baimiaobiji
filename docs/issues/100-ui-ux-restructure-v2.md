---
id: "100"
title: "UI/UX 重构 v2：统计下移/随机漫步/编辑弹窗/双击/图标/顶部栏/预览/附件面板/设置页"
status: "ready-for-agent"
labels:
  - "ready-for-agent"
  - "prd"
created: "2026-07-14"
related_prd: "docs/prd-ui-ux-2026-07-14.md"
related_requirements: "docs/requirements-merged-2026-07-14.md"
supersedes: "docs/issues/001-ui-ux-restructure.md"
---

# UI/UX 重构 v2 · 总 Issue / PRD

> 本 issue 是 UI/UX 重构 v2 的总 issue。
> **完整 PRD**：`docs/prd-ui-ux-2026-07-14.md`
> **需求基线**：`docs/requirements-merged-2026-07-14.md`（合并自 requirements-draft.md + ui-ux-requirement-gaps-2026-07-14.md）
> **取代**：旧 PRD `docs/prd-ui-ux-2026-07-13.md` + 旧 issues 002-010（旧 9 seam 已本地实施，本 PRD 含推翻 Seam 2 的需求 9 及新需求 1/3/4/7）

---

## Problem Statement

白描笔记 UI/UX 存在 9 处体验断层：统计信息分散、随机漫步全屏覆盖层不适配、拾微编辑不支持多媒体、卡片编辑路径长、明悟图标语义不准、顶部栏与次级导航堆叠（沉淀/明悟缺下拉胶囊）、图片视频预览不适配、附件上传缺中间面板、设置页分栏不够紧凑。完整问题描述见 PRD。

## Solution

9 个解决方案：统计小字下移、随机漫步主内容区模式、拾微编辑弹窗多媒体化、拾微/回顾双击编辑、明悟图标改 Sun、顶部标题栏重构（含沉淀/明悟下拉胶囊）、图片视频全屏预览、拾微附件上传动画面板、设置页重构（抽屉+全页+横向导航，推翻 Seam 2 分栏）。完整方案见 PRD。

## 关键决策

- **需求 9 推翻 Seam 2**：之前实施的"左侧固定菜单+右侧分栏"被推翻，改抽屉+全页+横向导航。
- **G3 冲突**：随机漫步保留 header 灯泡入口（不迁设置）；顶部栏移除标签图标（TagsIcon），标签管理在设置抽屉。
- **跨需求约束**：移动端红线、图标库、v11->v12 migrate 协调、无障碍、性能、提示词字段名/默认值、混合媒体顺序、+N 详情内容、沉淀展开不限高。详见 PRD Further Notes + Implementation Decisions。

## 测试 Seams

4 个现有 E2E seam 覆盖 9 需求（不新建 seam）：
- `foundation-migration.test.ts`：需求 1/5/6/9
- `multimedia.test.ts`：需求 3/7/8
- `thoughts.test.ts`：需求 1/4
- `random-walk.test.ts`：需求 2

## 子 Issues

本 PRD 将拆分为以下 9 个子 issue（待构建）：

| ID | 需求 | 文件 |
|---|---|---|
| 101 | 需求 1：统计小字下移与统一 | `docs/issues/101-stats-relocate.md` |
| 102 | 需求 2：随机漫步屏幕自适应 | `docs/issues/102-random-walk-adaptive.md` |
| 103 | 需求 3：拾微编辑弹窗多媒体化 | `docs/issues/103-record-edit-modal.md` |
| 104 | 需求 4：拾微/回顾双击编辑 | `docs/issues/104-double-click-edit.md` |
| 105 | 需求 5：明悟 Tab 图标改 Sun | `docs/issues/105-mingwu-sun-icon.md` |
| 106 | 需求 6：顶部标题栏重构 | `docs/issues/106-header-restructure.md` |
| 107 | 需求 7：图片/视频全屏预览 | `docs/issues/107-media-fullscreen-preview.md` |
| 108 | 需求 8：拾微附件上传面板 | `docs/issues/108-attachment-panel.md` |
| 109 | 需求 9：设置页重构 | `docs/issues/109-settings-restructure.md` |

## Out of Scope

- 不改数据同步/云备份/OAuth
- 不涉端侧 AI 迁移
- 不改 AI 生成算法（仅提示词配置结构）
- 不新增 AI 服务商
- 不改生成调度/任务队列（US36 复选框接 generateMingwu 除外）
- 不改附件存储 schema

## Further Notes

移动端红线、图标库、数据兼容性、性能、无障碍等跨需求约束见 PRD Further Notes。
