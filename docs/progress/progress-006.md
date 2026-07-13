# Progress - Seam 5: 沉思卡片限高折叠与缩略图规范 (#006)

## 改动摘要

为沉思页（Thoughts）卡片引入折叠态/展开态与统一的多媒体缩略图规范，解决长文卡片无限延伸、缩略图比例与数量不统一的问题。

### 折叠/展开规范实现

| 需求 | 实现 |
|---|---|
| 折叠态最大高度：时间线 7 行 / 瀑布流 12 行 | 按正文行高 ~22px 估算，时间线 `maxHeight=160px`，瀑布流 `maxHeight=270px`（常量 `COLLAPSED_MAX_H_TIMELINE` / `COLLAPSED_MAX_H_MASONRY`） |
| 超出渐变遮罩 + "展开"按钮 | 折叠态在内容区底部叠加 `bg-gradient-to-t from-[#fdfdfc]` 渐变层（匹配卡片底色）；内容区下方显示 `展开`/`收起` 按钮配 ChevronUp/Down 图标 |
| 展开态不限高 | `expanded` 为 true 时移除 `maxHeight`，内容完整显示 |
| 单击切换展开/折叠 | 卡片 `onClick={handleCardClick}`，首次点击启动 300ms 计时器，超时后切换 `expanded` |
| 双击进入编辑（300ms 内第二次点击判双击，取消单击） | 计时器未触发时收到第二次点击 → `clearTimeout` 并调用 `onEdit`，不触发展开 |
| 溢出检测 | `useLayoutEffect` + `ResizeObserver` 测量 `contentRef.scrollHeight > collapsedMaxH + 2`，兼顾图片加载后的高度变化 |

### 缩略图规范实现

| 需求 | 实现 |
|---|---|
| 统一 1:1 比例 | 每个缩略图 `aspect-square` |
| 时间线一行 3 个 / 瀑布流一行 2 个 | `grid gap-1.5` + `grid-cols-3`（时间线）/ `grid-cols-2`（瀑布流） |
| 超出显示 +N 或进详情 | 最多展示 2 行（时间线 6 / 瀑布流 4，常量 `THUMB_CAP_*`）；超出时末位替换为 `+N` 瓷砖，点击触发 `toggleExpand` 展开卡片 |
| image/video/audio 均支持 | `ThumbTile` 组件：image 渲染 `<img>`（RichEditor 以 data URL 存 `ref`，可直接用）；video 用 `Film` 图标占位；audio 用 `Music` 图标占位；link 不计入缩略图网格 |

### 交互细节

- 卡片 `title` 提示由 `thoughts.doubleClickEdit`（"双击编辑"）改为 `thoughts.cardHint`（"单击展开/收起，双击编辑"）。
- 展开按钮、+N 瓷砖、复制按钮均 `stopPropagation`，不触发卡片单击/双击逻辑。
- `toggleExpand` 内额外清理 `clickTimer`，避免按钮点击与卡片单击计时器互相干扰。
- 短卡片（内容未溢出）不施加 `maxHeight`、不显示展开按钮，单击为无视觉效果操作（双击仍可编辑）。
- 卸载时清理单击计时器，防止内存泄漏。

### 新增 i18n key（zh + en 各 4 条）

| Key | 中文 | English |
|---|---|---|
| `thoughts.cardHint` | 单击展开/收起，双击编辑 | Click to expand/collapse, double-click to edit |
| `thoughts.expand` | 展开 | Expand |
| `thoughts.collapse` | 收起 | Collapse |
| `thoughts.moreCount` | +{count} | +{count} |

## Lint / Build 结果

- `npm run lint`（tsc --noEmit）：**通过**（首次即过）
- `npm run build`（vite build + esbuild server.ts）：**通过**（首次即过；chunk size 警告为既有项，与本次无关）

## 变更文件

- `src/pages/Thoughts.tsx`
  - 新增导入：`useLayoutEffect`、`ChevronUp`/`ChevronDown`/`Film`/`Music`（lucide-react）
  - 两处 `<ThoughtCard>` 调用新增 `view={view}` 传参
  - `ThoughtCardProps` 新增 `view: ViewMode`
  - 重写 `ThoughtCard`：折叠/展开状态、单击/双击判别、溢出检测、渐变遮罩、展开按钮
  - 新增模块级常量 `COLLAPSED_MAX_H_*` / `THUMB_CAP_*`
  - 新增 `ThumbTile` 组件：1:1 多媒体缩略图（image/video/audio）
- `src/i18n/zh.ts` - 新增 4 条沉思卡片折叠/缩略图 key
- `src/i18n/en.ts` - 新增 4 条沉思卡片折叠/缩略图 key

## 遗留问题

1. **折叠高度按固定像素估算**：7 行 / 12 行以正文行高 ~22px 换算为 160px / 270px。Markdown 渲染含标题、列表、引用等多级块元素，prose 默认外边距会使实际行数与像素的对应略有偏差，但渐变遮罩 + 展开/收起机制保证了可用性，不依赖精确行数。
2. **单击有 300ms 响应延迟**：为区分单击/双击，单击展开/折叠需等待 300ms 计时器超时后才生效，这是 issue 规定的交互代价。展开按钮与 +N 瓷砖走 `toggleExpand` 直通路径，无此延迟。
3. **video/audio 缩略图为图标占位**：未抽取视频首帧（需加载 `<video>` 元素，开销较大），用 `Film`/`Music` 图标占位。当前 RichEditor 仅支持图片附件（`accept="image/*"`），实际沉思数据中 video/audio 附件暂不会出现，占位为前瞻性兼容。
4. **`thoughts.doubleClickEdit` 成为孤儿 key**：改用 `thoughts.cardHint` 后不再引用，但未删除以避免影响其他可能的引用与 i18n 清理节奏，可在后续 i18n 清理 seam 中处理。
5. **多媒体缩略图上限为 2 行**：时间线 6 个 / 瀑布流 4 个，超出以 +N 提示。issue 未指定总行数，此处取 2 行以兼顾预览信息量与卡片紧凑度。
