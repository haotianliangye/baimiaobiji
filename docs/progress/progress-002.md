# Progress - Seam 1: 全局 Layout 与顶部标题栏 (#002)

## 改动摘要

统一四个主 Tab（拾微 / 回顾 / 沉淀 / 明悟）的全局顶部标题栏结构，规范入口与图标语义。本次仅改动 `src/components/Layout.tsx` 与 i18n 字典，不触碰各页面内部实现（遵循 seam 边界）。

### 顶部栏新结构

```
左: [≡] {页面标题} · {副标题}      中: < 日期 > (仅拾微/回顾)      右: 同步状态 -> 搜索 -> RAG+CHAT -> 灯泡
```

- **左侧 `[≡]`**：lucide `Menu` 图标，点击导航 `/settings`（系统设置页）。
- **页面标题**：随路由映射，**不可点击**。
  - 拾微(`/`) -> `白描`（新增 key `layout.titleBaimiao`）
  - 回顾(`/review`) -> `回顾`（复用 `tab.review`）
  - 沉淀(`/thoughts`) -> `沉淀`（复用 `tab.thoughts`）
  - 明悟(`/mingwu`) -> `明悟`（复用 `tab.mingwu`）
- **副标题**：`· 今日 X 字`（复用 `record.todayChars`，取今日 `raw_logs` 字数）。明悟不显示；AI 整理任务进行中时改显示 AI 进度徽标（与副标题互斥，避免溢出）。
- **中间日期导航**：仅拾微/回顾两个按日期浏览的 Tab 显示。左右箭头切换日期（写 `?date=` 查询参数，与各页面共用），点击日期打开 `CalendarHeatmap` 日期选择器。沉淀/明悟无单日概念，不显示。
- **右侧**：保留同步状态按钮（条件渲染）-> `Search`(搜索) -> `MessageSquare`(RAG+CHAT/Copilot) -> `Lightbulb`(灯泡=随机漫步)。

### 移除项

| 移除内容 | 原位置 | 说明 |
|---|---|---|
| 标题点击触发 About 弹窗 | header `h1` onClick | 标题改为不可点击；About Modal 代码保留（seam 2 迁移到设置页） |
| 标签图标 `TagsIcon` | header 右侧 | 标签管理入口将迁至系统设置（seam 2） |
| 设置图标 `SlidersHorizontal` | header 右侧 | 改由左侧 `[≡]` Menu 图标承担 |
| 随机漫步独占图标 | （原在 Thoughts 子栏） | 灯泡入口上提到全局顶部栏 |

### TabBar 图标替换

| Tab | 原图标 | 新图标 |
|---|---|---|
| 沉淀 `/thoughts` | `Notepad` | `HeadCircuit`（原明悟图标，更贴合沉淀语义） |
| 明悟 `/mingwu` | `HeadCircuit` | `SunDim`（@phosphor-icons `sun-dim`） |

两处 TabBar（主导航 + 搜索面板内导航）同步替换。

### 新增 i18n key（zh + en 各 3 条）

- `layout.titleBaimiao`：`白描` / `Baimiao`
- `layout.prevDay`：`前一天` / `Previous day`
- `layout.nextDay`：`后一天` / `Next day`

其余文案均复用已有 key（`tab.*`、`record.todayChars`、`settings.title`、`thoughts.randomWalk`、`layout.copilot` 等），无硬编码新增文案。

## Lint / Build 结果

- `npm run lint`（tsc --noEmit）：**通过**（首次即过）
- `npm run build`（vite build + esbuild server.ts）：**通过**（首次即过；chunk size 警告为既有项，与本次无关）

## 变更文件

- `src/components/Layout.tsx` - 重写 header（~185-241）、TabBar 图标（两处）、新增日期/标题/今日字数/随机漫步逻辑与 CalendarHeatmap/RandomWalk 渲染
- `src/i18n/zh.ts` - 新增 3 条 key
- `src/i18n/en.ts` - 新增 3 条 key

## 遗留问题

1. **顶部栏与各页面子栏的临时重复**：拾微/回顾页面仍各自保留 52px 子栏（页面标题 + 今日字数 + 日期导航），与新的全局顶部栏在标题/副标题/日期上存在视觉重复。这是 seam 化迁移的预期中间态——各页面子栏的清理将在后续对应 seam（如 Seam 4 多媒体卡片、Seam 5 沉淀卡片）或专门清理中处理。功能上无冲突：全局栏与页面子栏共用 `?date=` 查询参数，日期切换双向同步。
2. **`CalendarHeatmap` 定位偏移**：该组件以 `fixed top-[52px]` 定位（原为页面内 52px 子栏下方设计）。从 Layout 层渲染时，全局栏高 54px，顶部会有约 2px 未遮罩缝隙；属轻微视觉问题，可在后续 seam 统一调整。
3. **`CalendarHeatmap` 内硬编码中文**：该组件内 "拾微/日记/回顾/天" 等标签为既有硬编码中文（非本次引入），按 seam 边界未在本 seam 修正，留待 Seam 9（i18n 文案修正）统一处理。
4. **About Modal 暂不可达**：移除标题点击触发后，About 弹窗在当前 seam 无入口（代码保留）。seam 2 将其迁移至系统设置「关于」标签页后恢复可达。
5. **窄屏（~360px）顶部栏偏紧凑**：左侧标题+副标题与居中日期、右侧四个图标在 360px 宽度下较为紧凑，副标题靠 `truncate` 收缩。待各页面子栏移除后整体留白会改善。
6. **同步按钮保留**：issue 右侧规格为「搜索 -> RAG+CHAT -> 灯泡」，同步状态按钮作为条件渲染的状态指示器保留在搜索之前，未在 issue 明确移除清单中，予以保留以免功能回退。
