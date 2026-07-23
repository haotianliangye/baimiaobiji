---
id: "103"
title: "需求 3：拾微编辑弹窗多媒体化"
status: "done"
labels:
  - "done"
  - "seam"
created: "2026-07-14"
parent_issue: "docs/issues/100-ui-ux-restructure-v2.md"
related_prd: "docs/prd-ui-ux-2026-07-14.md"
---

# 需求 3：拾微编辑弹窗多媒体化

## Problem Statement

拾微编辑仍用底部全屏面板 + 纯文本 textarea，不支持多媒体附件增删，与创建时的多媒体能力不匹配。创建时已支持图片/音频/视频/链接/文件，但编辑流程仍停留在纯文本，拾微创建后无法追加或删除多媒体附件。

（PRD Problem Statement 第 3 条：拾微编辑仍用底部全屏面板 + 纯文本 textarea，不支持多媒体附件增删，与创建时的多媒体能力不匹配。）

## Solution

拾微编辑弹窗多媒体化：把拾微编辑从底部全屏面板改为居中弹窗，复用 `RichEditor` + 附件编辑能力，让拾微在创建后仍可追加、删除多媒体附件。

（PRD Solution 第 3 条：拾微编辑弹窗多媒体化--居中弹窗 + RichEditor，支持多媒体附件增删，复用创建时的附件处理流程。）

## User Stories

13. 作为用户，我希望编辑拾微时弹出居中弹窗（非底部全屏面板），以便专注编辑。
14. 作为用户，我希望编辑弹窗用 RichEditor（含 Markdown 工具栏/上传/超链接/录音/标签/预览），以便富文本编辑。
15. 作为用户，我希望编辑弹窗能新增图片/音频/视频/链接/文件附件，以便拾微创建后仍可补充多媒体。
16. 作为用户，我希望编辑弹窗能删除已有附件，以便管理拾微附件。
17. 作为用户，我希望编辑弹窗底部有删除（整条）/取消/保存按钮，以便操作。

## Implementation Decisions

> 来源：PRD Implementation Decisions「需求 3」章节 + 需求基线「需求 3」具体改动/实现要点。

### 形态变更
- 移除底部滑上全屏编辑面板，改为居中弹窗（`fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-3` + `bg-white rounded-2xl w-full max-w-md max-h-[88vh] flex flex-col`）。
- 内容区可滚动，底部操作栏固定。

### 编辑器
- 使用 `RichEditor` 组件，完整保留 Markdown 工具栏 / 上传 / 超链接 / 录音 / 标签提示 / 预览切换。
- 编辑时回显原 `raw_log.attachments` 数组。
- 原有 `audioBlob` 保留但不可在弹窗内编辑；删除整条记录时一并删除。

### 附件处理
- 新增附件走 `saveAttachmentBlob` + 异步摘要：图片/视频后台多模态摘要、音频走 STT 拼入 content、链接/文件仅元数据。
- 删除附件：从 `attachments` 数组移除并删 `attachments` store 的 Blob。
- 清空所有图片/视频附件时 `attachment_summary` 一并清空。
- `RichEditor` 需支持渲染已存附件缩略图（已存附件 `ref` 是 store id，需加载 Blob 转 object URL）。
- 新增附件 `RichEditor` 内部读 File 为 data URL。
- 保存时区分新附件（data URL/File）和旧附件（store id），仅新附件调 `saveAttachmentBlob`；删除旧附件调 `db.attachments.delete(ref)`。

### 保存条件
- `content.trim()` 非空 或 `attachments` 非空。
- 保存时 `processTags(editContent)` 重新解析 `#标签` 落库。

### 底部操作栏
- 左侧删除按钮（确认后删整条记录并关闭弹窗）。
- 右侧取消 / 保存。
- 字数统计保留操作栏左侧（`record.totalChars`）。

### 入口
- 保留长按 / 右键菜单"编辑记录"。
- 与需求 4 联动：双击拾微卡片也可打开此弹窗（双击触发逻辑由需求 4/issue 104 实现，本需求仅提供弹窗）。

### G5 补充
- `RichEditor` 麦克风按钮录音中显示"录音中"状态（点击开始录音，再次点击结束，录音中按钮反馈）。

### i18n
- 复用现有 key（`record.editTitle` / `save` / `saving` / `cancel` / `totalChars` / `saveFailed`），无需新增。

### 相关跨需求约束

- **移动端红线**：全局 `html/body` 保持 `overflow:hidden` + `overscroll-behavior:none`；弹窗内容区滚动用局部 `overflow-y-auto`，不依赖 body 滚动。
- **数据兼容性**：不改附件存储 schema（仅读取已有字段）。
- **性能**：多媒体摘要重试以单附件为单位。

## Testing Decisions

- seam: `multimedia.test.ts`
- 原则：只测外部可观察行为（UI 渲染/交互/可见结果），不测实现细节（CSS 类名/内部状态）
- 测试重点（PRD Testing 第 3 条）：拾微编辑弹窗：居中弹窗（非底部）、RichEditor 工具栏、附件增删、保存条件、删除整条。即：
  - 编辑拾微弹出居中弹窗（非底部全屏面板）。
  - RichEditor 工具栏可见（Markdown 工具栏/上传/超链接/录音/标签/预览）。
  - 编辑弹窗能新增图片/音频/视频/链接/文件附件。
  - 编辑弹窗能删除已有附件。
  - 保存条件正确（content 非空 或 attachments 非空才可保存）。
  - 底部删除整条记录（确认后删除并关闭）。

## Out of Scope

- 不改数据同步/云备份/OAuth
- 不涉端侧 AI 迁移
- 不改 AI 生成算法
- 不改附件存储 schema（仅读取已有字段）
- 双击编辑的触发逻辑由需求 4/issue 104 实现（本需求仅提供编辑弹窗，不实现双击监听）
- `audioBlob` 保留但不可在弹窗内编辑（仅随删整条记录一并删除，不新增录音编辑能力）
- 不改 `processTags` / `saveAttachmentBlob` / `countChars` 算法本身（仅复用现有实现）
- 不涉随机漫步/统计/双击/图标/顶部栏/预览/附件面板/设置页（其他需求范围）
