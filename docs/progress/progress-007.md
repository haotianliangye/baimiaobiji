# Progress 007 — Seam 6：输入工具栏与附件上传面板

## 改动摘要

### 1. RichEditor.tsx 沉淀富文本工具栏升级

在现有格式按钮组（粗体/斜体/标题/列表/引用/代码）之后，新增以下按钮（从左到右）：

- **通用上传**（Upload 图标）：唤起文件选择器，`accept="image/*,audio/*,video/*"`，多选，走现有 data URL 附件流程。替换原仅支持图片的 Image 按钮。
- **超链接**（Link 图标）：弹出弹框填写 URL + 显示文本，点击「插入」后在光标处插入 Markdown 链接 `[text](url)`，支持选区替换。
- **麦克风**（Mic 图标）：点击开始录音（MediaRecorder），再次点击结束并走 `/api/transcribe` STT，转写文本插入光标处。录音中显示红色脉冲，转写中显示 spinner，失败插入 `[转写失败]`。
- **#标签**（Hash 图标）：在光标处插入 `#`。
- **…更多**（MoreHorizontal 图标）：展开下拉菜单，包含：
  - 表格：插入 Markdown 表格模板（3 列）
  - 代码块：选区包裹 ``` 代码块
  - 内联代码：选区包裹 ` 反引号
  - 导出 Markdown：下载当前内容为 .md 文件
  - 预览 Markdown：切换预览/编辑模式

同时将所有硬编码中文文案迁移到 i18n（`editor.*` 命名空间），并使用 `useTranslation` hook。

### 2. Record.tsx 拾微附件上传面板

将原 ActionSheet（垂直列表）替换为自定义底部上滑网格面板：

- **布局**：3 列 × 2 行网格
  - 第一行：相册（Image）/ 音频（Music）/ 视频（Video）
  - 第二行：链接（Link）/ 文件（FileUp）/ 取消（X）
- 每个选项：圆形图标背景 + 文字标签
- **取消按钮**：灰色样式（text-stone-400）
- **关闭方式**：点击遮罩或取消按钮关闭面板
- 动画：底部上滑（`animate-in slide-in-from-bottom-full`）
- **新增「文件」选项**：`accept="*/*"`，通用文件上传，非媒体文件存储为 `kind: 'file'`

移除了不再使用的 `ActionSheet` 导入和 `isActionSheetOpen` 状态。

### 3. 数据模型扩展

- `AttachmentMeta.kind` 新增 `'file'` 类型（`src/db/db.ts`）
- `AttachmentBlob.type` 新增 `'file'` 类型
- `saveAttachmentBlob` 接受 `'file'` kind（`src/lib/multimedia.ts`）
- `generateAttachmentSummary` 跳过 `'file'` kind（不做多模态摘要）

### 4. i18n 文案

新增 `editor.*` 命名空间（35 个 key）和 `record.file`，中英文双语。

## Lint / Build 结果

- `npm run lint`（tsc --noEmit）：**通过**（无错误）
- `npm run build`（vite build + esbuild server.ts）：**通过**（18.80s）

## 遗留问题

1. **附件面板标签**：issue 文档提到「相册」作为图片选项标签，但现有 E2E 测试（`tests/multimedia.test.ts`）依赖按钮文本「图片」来定位。为保持测试兼容性，图片选项仍使用 `record.image`（图片/Image）。如需改为「相册」，需同步更新 E2E 测试。
2. **'file' 类型渲染**：`MultimediaAttachments`（Record.tsx）和 `ThumbTile`（Thoughts.tsx）的附件渲染过滤器尚未包含 `'file'` kind，文件附件虽已存储但不会在卡片中渲染缩略图。多媒体卡片渲染规范属于 Seam 4 范畴，此处仅做数据存储。
3. **RichEditor 麦克风 STT**：录音转写依赖 `/api/transcribe` 端点，与 Record.tsx 共用同一 API。RichEditor 中的 STT 是简化版（不含重试逻辑和 iOS 兼容处理），如需完善可后续补齐。
4. **通用上传 data URL**：RichEditor 中的通用上传仍使用 data URL 存储（最小实现），与原图片上传行为一致。Blob 存储完善属于后续工作。
