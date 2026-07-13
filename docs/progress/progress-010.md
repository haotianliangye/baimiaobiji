# Progress - Seam 9: i18n 文案修正 (#010)

## 改动摘要

全量扫描 `src/i18n/zh.ts` / `en.ts` 字典与组件中 `t()` 调用，修复 key 直接暴露（缺失 key 回退为字面量）与硬编码中文问题。

### 修复的 key 暴露问题

| key | 文件 | 问题 | 修复 |
|---|---|---|---|
| `review.copyContent` | `Review.tsx:890` | 字典中不存在该 key，回退显示字面量 `review.copyContent`，与相邻 `编辑内容` 形成中英混编 | 新增 key（zh: `复制内容` / en: `Copy content`） |
| `layout.syncError` | `Layout.tsx:205` | 字典中不存在该 key，回退显示字面量 | 新增 key（zh: `同步出错` / en: `Sync error`） |

### 修复的硬编码中文

| 文件 | 行 | 原文案 | 修复 |
|---|---|---|---|
| `Settings.tsx` | 593 | `alert('导出失败')` | 改用已有 key `t('settings.exportFailed')` |
| `RandomWalk.tsx` | 全文 | ~30 处硬编码中文（标题、设置面板、卡片操作栏、空状态、标签 sheet、删除确认） | 引入 `useTranslation`，全部改用 `t()` 调用；新增 `randomWalk.*` 系列 key（23 条） |

### 回顾页生成弹窗标题修正

| key | 原文案 | 新文案 |
|---|---|---|
| `review.generateNReviews` (zh) | `生成 {count} 篇回顾` | `生成 {count} 篇` |
| `review.generateNReviews` (en) | `Generate {count} reviews` | `Generate {count}` |

去掉了"回顾"二字，因为选中项可能包含日记或自定义类型。

### RandomWalk.tsx 重构细节

- 引入 `useTranslation` hook，组件内使用响应式 `t()`。
- 模块级 `SOURCE_LABELS` 常量（硬编码中文）替换为 `SOURCE_LABEL_KEYS`（key 映射），运行时通过 `t()` 取值。
- 模块级 `toWalkItems()` 函数新增 `tf: TFunc` 参数，typeLabel 改用 `tf()` 调用已有 key（`tab.*`、`review.diary/review`、`mingwu.insight/mingwu`）。
- `draw` useCallback 依赖数组加入 `t`，保证语言切换后新抽取的卡片使用正确语言。
- 底部操作栏（已阅/标签/编辑/复制/删除）、空状态、标签 sheet、删除确认框全部 i18n 化。

### 新增 i18n key 清单（zh + en 各 25 条）

- `layout.syncError`
- `review.copyContent`
- `randomWalk.title` / `settingsTitle` / `dataSources` / `cooldown` / `cooldownUnit`
- `randomWalk.loading` / `emptyTitle` / `emptyDesc` / `shuffle` / `resetHistory` / `swipeHint`
- `randomWalk.read` / `tags` / `edit` / `delete` / `next`
- `randomWalk.tagSheetTitle` / `noTags` / `tagPlaceholder` / `addTag`
- `randomWalk.thoughtsTagHint` / `unsupportedTags` / `confirmDelete`

## Lint / Build 结果

- `npm run lint`（tsc --noEmit）：**通过**（首次即过）
- `npm run build`（vite build + esbuild server.ts）：**通过**（首次即过）

## 变更文件

- `src/i18n/zh.ts` — 新增 25 条 key，修改 `review.generateNReviews` 文案
- `src/i18n/en.ts` — 新增 25 条 key，修改 `review.generateNReviews` 文案
- `src/pages/Settings.tsx` — 1 处硬编码改用 `t()`
- `src/components/RandomWalk.tsx` — 引入 i18n，全量替换硬编码中文

## 遗留问题

1. **Insights.tsx 跨域 key 引用**：`Insights.tsx:350` 在明悟上下文菜单中使用 `t('review.editContent')`。该 key 存在且显示正确，非 bug；但跨域引用不够规范。后续 seam 可新增 `mingwu.editContent` 并替换。
2. **RandomWalk typeLabel 响应式延迟**：切换语言后，已渲染卡片的 typeLabel 不会立即更新，需用户点击"换一批"重新抽取才会刷新。这是 `toWalkItems` 在 `draw` 闭包中调用的设计限制，非本次引入。
3. **全量扫描覆盖范围**：本次扫描覆盖了所有 `.tsx`/`.ts` 中 `t()` 调用的 key 缺失情况，以及 `alert()`/`confirm()` 中的硬编码中文。其他组件中可能仍有少量 JSX 内联中文未纳入本次范围（非重点区域），后续 seam 可按需补充。
