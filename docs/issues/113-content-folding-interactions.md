---
id: "113"
title: "内容卡片折叠与交互恢复（拾微 + 回顾）"
status: "done"
labels:
  - "done"
  - "ui-ux-v3"
created: "2026-07-15"
parent_issue: "110"
related_prd: "docs/prd-ui-ux-v3-2026-07-15.md"
---

# 内容卡片折叠与交互恢复（拾微 + 回顾）

## Parent

- #110 UI/UX 重构 v3 跟进（需求补漏）

## What to build

为拾微页与回顾页的内容卡片增加智能折叠，并恢复移动端交互：

1. 纯文本内容按渲染行数达到 12 行后进入折叠态；图片、视频、音频、数字摘要块等多媒体不计入 12 行。
2. 折叠态下文字截断并显示省略；多媒体仅保留一行缩略展示（如 +N 或滚动处理），与现有 `MultimediaAttachments` 缩略逻辑一致。
3. 点击折叠态区域展开，点击已展开区域收起；单击与双击通过事件互斥（延迟单击或双击取消延迟）。
4. 拾微页复用现有 `onDoubleClick` + `handleOpenEditModal` 进入编辑弹窗；回顾页恢复 `onDoubleClick` 进入 inline 编辑（`setEditingReviewId` + `setEditText`）。
5. 移动端恢复 `onTouchStart` 500ms 长按检测 + `onTouchEnd` / `onTouchMove` 清除，桌面端保留 `onContextMenu`；菜单内容保持一致（复制、编辑、重新生成、删除）。
6. 折叠/展开的单击事件不得与附件区单击（打开灯箱/详情）冲突；双击编辑仍跳过附件区。

该 slice 需要覆盖拾微与回顾两个页面的卡片 UI、交互事件、Markdown 渲染控制及对应测试。

## Acceptance criteria

- [ ] 拾微/回顾卡片纯文本超过 12 行后进入折叠态
- [ ] 折叠态点击展开，展开态点击收起
- [ ] 12 行统计不包含多媒体占位
- [ ] 折叠态下多媒体仅展示一行缩略，展开后完整展示
- [ ] 不超过 12 行时文字和多媒体正常完整展示
- [ ] 双击拾微卡片进入编辑弹窗
- [ ] 双击回顾卡片进入 inline 编辑
- [ ] 长按/右键拾微卡片弹出复制/编辑/多选/删除菜单
- [ ] 长按/右键回顾卡片弹出复制/编辑/重新生成/删除菜单
- [ ] 单击展开/收起与双击编辑互不影响
- [ ] `tests/thoughts.test.ts` 覆盖折叠态、展开/收起、双击编辑、长按/右键菜单的外部行为

## Blocked by

- None - can start immediately
