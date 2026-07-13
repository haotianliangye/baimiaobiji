# Progress 003 -- Seam 2 系统设置页重构

## 改动摘要

将系统设置页从横向 4 tab 重构为左侧竖排菜单 + 右侧内容区布局。

### Settings.tsx 重构
- 横向 tab（model/embedding/data/prompt）替换为左侧竖排菜单，菜单项顺序：对话模型 / 语音朗读 / 向量与语义 / 数据管理 / 提示词配置 / 标签设置 / 关于。
- 桌面端（md+）左侧菜单常驻，容器宽度 `md:max-w-3xl`；移动端菜单为 push 抽屉，使用 `motion`（`motion/react`）实现 0.3s 滑入动画，点击菜单项后抽屉自动关闭。
- 语言切换改为统一宽高胶囊按钮（`flex-1 w-16`），当前语言高亮，保留 `data-testid="language-zh/en"` 供 E2E 测试。
- TTS 配置从 model tab 抽出为独立"语音朗读"面板，硬编码中文替换为 i18n key（`settings.ttsDesc`、`settings.ttsWebspeech`、`settings.ttsExternal`、`settings.ttsExternalHint`）。
- 新增"标签设置"面板，内嵌 `<TagManagement embedded />`。
- 新增"关于"面板，迁移原 Layout About Modal 内容（应用图标/名称/版本/作者/简介/检查更新/反馈），`handleForceUpdate` + `isUpdating` 状态迁至 Settings。
- 保存按钮从滚动区底部移至 sticky footer（`shrink-0` + `border-t`），不随内容滚动。

### TagManagement.tsx
- 新增 `embedded?: boolean` prop（默认 false）。`embedded=true` 时隐藏顶部返回栏（back 按钮 + 标题 + 标签计数），由 Settings 提供导航。`/tags` 独立路由仍保留，渲染带 header 的完整页面。

### Layout.tsx
- 移除 About Modal（`showAboutModal`/`isUpdating` 状态、`handleForceUpdate` 函数、Modal JSX），内容已迁移至 Settings 关于面板。

### i18n（zh.ts / en.ts）
- 新增 key：`settings.tabTts`、`settings.tabTags`、`settings.tabAbout`、`settings.menuToggle`。

## Lint / Build 结果

- `npm run lint`（tsc --noEmit）：通过
- `npm run build`（vite build + esbuild server.ts）：通过

## 遗留问题

1. **TTS 外部 API 配置**：当前仅 UI 迁移至"语音朗读"面板，外部 TTS API 逻辑未改动，留待 Seam 8 抽出。
2. **Settings.tsx 内仍有大量历史硬编码中文**（数据管理、向量语义、提示词配置面板的 section 标题、按钮文案等），i18n key 已存在但组件未引用。本次仅处理了 TTS 面块的硬编码替换，其余留待后续清理或对应 Seam 处理。
3. **`/tags` 路由保留**：`tests/tags.test.ts` 直接导航到 `/tags`，故保留独立路由。如后续需移除，需同步更新测试。
4. **`about.close` i18n key 变为未使用**：About Modal 移除后，`about.close` 不再被任何组件引用，保留在字典中不影响构建。
5. **桌面端宽度**：Settings 容器从 `max-w-md` 改为 `md:max-w-3xl` 以容纳左侧菜单 + 右侧内容，移动端仍全宽。
