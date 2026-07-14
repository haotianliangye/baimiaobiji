---
id: "102"
title: "需求 2：随机漫步屏幕自适应"
status: "ready-for-agent"
labels:
  - "ready-for-agent"
  - "seam"
created: "2026-07-14"
parent_issue: "docs/issues/100-ui-ux-restructure-v2.md"
related_prd: "docs/prd-ui-ux-2026-07-14.md"
---

# 需求 2：随机漫步屏幕自适应

## Problem Statement

随机漫步作为固定全屏覆盖层（`fixed inset-0`），卡片区域写死 `w-full max-w-md h-full max-h-[60vh]` 居中。桌面宽屏卡片过小、留白过多；手机端 `max-h-[60vh]` 空间利用不足。卡片尺寸写死导致不同屏幕尺寸下卡片与操作区占用比例不合理。

## Solution

随机漫步从固定全屏覆盖层改为主内容区模式：限制在应用容器（`max-w-md`）内渲染（类似 Copilot 模式），保留顶部 header 和底部 TabBar；卡片区域用 `swiper` + `EffectCards` 扇形堆叠滑动；编辑按钮弹 `RichEditor` 编辑弹窗（不跳转页面）。

## User Stories

7. 作为用户，我希望随机漫步在应用容器内显示（非全屏覆盖），以便保留顶部 header 和底部 TabBar。
8. 作为用户，我希望随机漫步卡片用扇形堆叠滑动效果，以便流畅浏览。
9. 作为用户，我希望点击灯泡/×/底部 Tab 都能退出随机漫步，以便灵活退出。
10. 作为用户，我希望随机漫步编辑按钮弹出 RichEditor 编辑弹窗（不跳转页面），以便快速编辑任意类型记录。
11. 作为用户，我希望随机漫步在手机和桌面都有合理的卡片占用比例，以便不同屏幕都舒适。
12. 作为用户，我希望底部操作栏是单排按钮（已阅/标签/编辑/复制/删除/换一批），"下一张"靠左右滑动，以便操作集中。

## Implementation Decisions

### 渲染模式
- 随机漫步从 `fixed` 全屏覆盖层改为 `<main>` 内容区渲染（类似 Copilot 模式），限制在 `max-w-md` 容器内，保留顶部 header 和底部 TabBar。
- `Layout.tsx` 把 `RandomWalk` 从 `fixed` 覆盖层改为 `<main>` 内容区渲染。

### 全局状态与入口
- 新增/复用全局状态控制显隐，入口仍为 header 灯泡按钮（不迁设置）。
- 激活时 header 标题显示随机漫步标题（`randomWalk.title`）、右侧 × 关闭。
- TabBar 切换 Tab 退出随机漫步。

### Swiper 卡片堆叠
- 新增依赖 `swiper ^11.2.6`，卡片区域用 `Swiper` + `EffectCards` 扇形堆叠滑动，包裹现有 `WalkItem` 卡片内容。
- 参考实现：Blinko review 页（`D:\DProjects\blinko\app\src\pages\review.tsx`），手机端 `w-[300px] h-[calc(100vh_-_300px)]`、桌面端 `md:w-[550px]`。

### 卡片尺寸
- 卡片宽度占满容器（父容器左右 `px-5` padding）。
- 高度父容器 `flex flex-col`，卡片区域 `flex-1` 填充 header 与底部操作栏之间。
- 空状态保持现有居中卡片式，仅限制在应用容器内。
- 卡片内文字字号保持现有字号，不做响应式调整。

### 底部操作栏
- 底部操作栏单排按钮：已阅 / 标签 / 编辑 / 复制 / 删除 / 换一批。
- "下一张"通过左右滑动实现，不单设按钮。

### 编辑弹窗
- 编辑按钮弹 `RichEditor` 编辑弹窗（不跳转页面），所有记录类型统一。
- `raw_logs`/`thoughts` 支持附件编辑；`daily_reviews`/`mingwu` 仅文本。
- 保存时根据记录类型写回对应表和字段。
- 不显示/不修改展示时间。

### 标签
- 标签保留底部"标签"按钮和现有 tag sheet，不在编辑弹窗内处理。

### G3 冲突澄清
- 随机漫步保留 header 灯泡入口（不迁设置）。
- 顶部栏移除的是标签图标（`TagsIcon`）非随机漫步。
- 标签管理在设置抽屉（见需求 9）。

### 跨需求约束（相关）
- **移动端红线**：全局 `html/body` 保持 `overflow:hidden` + `overscroll-behavior:none`；所有新滚动区用局部 `overflow-y-auto`，不依赖 body 滚动。
- **图标库**：顶部栏用 lucide-react（灯泡入口在顶部栏）；底部 TabBar 用 @phosphor-icons/react。
- **数据兼容性**：不改附件存储 schema（仅读取已有字段）。

## Testing Decisions

- seam: `random-walk.test.ts`
- 原则：只测外部可观察行为（UI 渲染/交互/可见结果），不测实现细节（CSS 类名/内部状态）
- 测试重点：
  - 容器内渲染（非 `fixed` 全屏覆盖）
  - swiper 扇形堆叠滑动
  - 三方式退出：点击灯泡 / 点击 × / 点击底部 Tab
  - 编辑按钮弹 RichEditor 编辑弹窗
  - 桌面/手机占用比例合理

## Out of Scope

- 不改数据同步/云备份/OAuth
- 不涉端侧 AI 迁移
- 不改 AI 生成算法
- 卡片内文字字号不做响应式调整（保持现有字号）
- 不改附件存储 schema（仅读取已有字段）
- 标签编辑不在随机漫步编辑弹窗处理（保留底部按钮 + 现有 tag sheet）
- 不改展示时间逻辑（编辑时不显示/不修改展示时间）
