---
id: "111"
title: "设置页结构整理：语言入口平铺 + 抽屉毛玻璃 + 标签区收纳"
status: "ready-for-agent"
labels:
  - "ready-for-agent"
  - "ui-ux-v3"
created: "2026-07-15"
parent_issue: "110"
related_prd: "docs/prd-ui-ux-v3-2026-07-15.md"
---

# 设置页结构整理：语言入口平铺 + 抽屉毛玻璃 + 标签区收纳

## Parent

- #110 UI/UX 重构 v3 跟进（需求补漏）

## What to build

完成设置页及设置抽屉的三项结构性体验优化：

1. 移除独立的「界面语言」模块，把 `中文 / English` 平铺到「对话模型」模块上方，作为横向胶囊切换器。
2. 设置抽屉展开时，后方遮罩改为毛玻璃透底效果（约 70% 透明度），让后方应用版面隐约可见，避免像跳转到新页面。
3. 设置抽屉内的「所有标签」区块支持点击标题行展开/收起；「管理标签」入口由文字改为设置图标，点击仍进入标签设置全屏详情页。

该 slice 需要同时改动设置页 UI、抽屉遮罩样式、标签区交互，并补充 `foundation-migration.test.ts` 中的相关断言，确保端到端可验证。

## Acceptance criteria

- [ ] 设置页不存在独立的 `data-testid="language-section"` 区块
- [ ] 「中文 / English」胶囊切换器位于「对话模型」模块上方，切换语言后立即生效
- [ ] 打开设置抽屉时，后方应用版面可见（遮罩为毛玻璃透底，非纯黑/灰色实底）
- [ ] 点击遮罩仍可关闭抽屉
- [ ] 点击「所有标签」标题行可展开/收起标签列表
- [ ] 收起时仅显示标题行与图标，展开时显示完整标签列表且内部滚动行为保留
- [ ] 「管理标签」入口显示为图标（如 `Settings2` / `SlidersHorizontal`），点击可进入标签设置全屏详情页
- [ ] `tests/foundation-migration.test.ts` 覆盖上述三项改动的外部可观察行为

## Blocked by

- None - can start immediately
