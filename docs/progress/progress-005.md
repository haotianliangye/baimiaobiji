# Progress - Seam 4: 多媒体记录卡片渲染 (#005)

## 改动摘要

将拾微列表卡片中的多媒体附件从简单的"📎 N 个附件"文字占位，改造为完整的缩略图/播放器/摘要渲染。

### 渲染规范实现

| 需求 | 实现 |
|---|---|
| 图片/视频 2×2 网格 (16:9, cover, 最多4张) | `MultimediaAttachments` 组件按 `grid-cols-2 gap-1` 布局，每格 `aspect-video` + `object-cover` |
| 单张 16:9 撑满 | 单张时切换为 `w-full` 全宽布局 |
| 超出 +N 覆盖层 | 第4张叠加 `bg-black/50` 半透明层，显示 `+{count}` |
| 视频首帧缩略图叠播放图标 | `<video preload="metadata">` + 居中 `Play` 图标按钮，点击切换为 `controls autoPlay` |
| 音频纵向列表播放器 | 每个 `AudioAttachmentItem` 渲染 `<audio controls>`，纵向排列 |
| 摘要区在媒体下方，次要文本色，最多3行 | `text-stone-500 line-clamp-3`，位于媒体区 `mt-2` |
| 生成中"AI 摘要生成中…" | `Loader2` 旋转图标 + 文案 |
| 失败"摘要生成失败·重新生成" | 失败文案 + `·` 分隔 + 可点击"重新生成"按钮（批量重试所有失败附件） |
| 单附件重试：图片/视频右下角 | `MediaThumb` 内 `absolute bottom-1 right-1` 重试按钮 |
| 单附件重试：音频播放器右侧 | `AudioAttachmentItem` 内播放器右侧"重新转写"按钮 |
| 图片点击灯箱 | 全屏 `bg-black/80` overlay + `object-contain` 大图 + 关闭按钮 |

### 组件结构

新增 4 个模块级组件（定义在 `Record.tsx` 中 `fetchTranscriptionWithRetry` 与 `Record` 之间）：

- **`useAttachmentUrl(ref)`**：自定义 hook，从 IndexedDB `attachments` store 加载 Blob 并返回 object URL，卸载时自动 revoke。
- **`MediaThumb`**：单个图片/视频缩略图，管理视频播放状态，渲染单附件重试按钮。
- **`AudioAttachmentItem`**：单个音频播放器 + 重新转写按钮。
- **`MultimediaAttachments`**：多媒体渲染区容器，按类型分组（image/video → 网格，audio → 列表，link → 链接行），管理摘要状态（none/generating/failed/ready）。

### 状态管理

- `generatingSummaryIds: Set<string>`：追踪正在生成摘要的 logId（提交时加入，异步完成/失败时移除）。用于区分"生成中"与"失败"状态。
- `retryingAttachmentIds: Set<string>`：追踪正在重试的单附件（key 为 `${logId}-${attachmentIndex}`）。
- `lightboxUrl: string | null`：灯箱当前显示的图片 URL。

### 摘要状态判定逻辑

```
hasMedia = 存在 image/video 附件
attachment_summary 有值 → 'ready'（显示摘要文本）
attachment_summary 无值 + isGenerating → 'generating'（显示"AI 摘要生成中…"）
attachment_summary 无值 + 非 generating → 'failed'（显示"摘要生成失败·重新生成"）
```

### 单附件重试

- **图片/视频**：`handleRetryAttachmentSummary` — 从 IDB 加载 Blob → `blobToBase64` → `requestMultimediaSummary`（复用 `/api/multimedia-summarize`）→ 更新 `AttachmentMeta.summary` + 重算 `attachment_summary`。
- **音频**：`handleRetryAudioAttachment` — 从 IDB 加载 Blob → `blobToBase64` → `fetchTranscriptionWithRetry`（复用 `/api/transcribe`）→ 替换 content 中的失败标记或追加新转写文本。

### 新增 i18n key（zh + en 各 5 条）

| Key | 中文 | English |
|---|---|---|
| `record.aiSummaryGenerating` | AI 摘要生成中… | AI summary generating… |
| `record.summaryFailed` | 摘要生成失败 | Summary generation failed |
| `record.regenerateSummary` | 重新生成 | Regenerate |
| `record.retranscribe` | 重新转写 | Re-transcribe |
| `record.moreCount` | +{count} | +{count} |

## Lint / Build 结果

- `npm run lint`（tsc --noEmit）：**通过**（首次即过）
- `npm run build`（vite build + esbuild server.ts）：**通过**（首次即过；chunk size 警告为既有项，与本次无关）

## 变更文件

- `src/pages/Record.tsx` — 新增 `useAttachmentUrl` hook + 3 个渲染组件 + 2 个重试 handler + 3 个状态 + 灯箱 overlay；替换卡片附件区为 `MultimediaAttachments`；`handleSubmit` 增加摘要生成状态追踪
- `src/i18n/zh.ts` — 新增 5 条多媒体卡片 key
- `src/i18n/en.ts` — 新增 5 条多媒体卡片 key

## 遗留问题

1. **"生成中"与"失败"状态依赖会话内追踪**：`generatingSummaryIds` 为 React state，页面刷新后丢失。刷新后若有图片/视频附件但无 `attachment_summary`，会直接显示"失败"状态（而非"生成中"）。对于真正在生成中的记录（如刚提交后刷新页面），这会短暂误显为失败，但用户可通过"重新生成"恢复。根本修复需在 `RawLog` 上持久化生成状态字段，但 issue 明确要求"不改动附件存储 schema"。
2. **音频转写重试的 content 合并**：多个音频附件的 STT 结果统一合并到 `RawLog.content`，重试时通过字符串替换失败标记更新。若同一记录有多个音频附件且都失败，重试一个会替换第一个失败标记，需多次重试。这是现有数据模型的限制（无 per-audio-attachment summary 字段）。
3. **视频首帧显示依赖浏览器**：使用 `<video preload="metadata">` 显示首帧，部分浏览器可能不显示首帧直到播放。已叠加播放图标确保用户可辨识视频。
4. **既有 i18n key 成为孤儿**：`record.attachmentCount` 和 `record.hasMultimediaSummary` 在本 seam 后不再被引用（被 `MultimediaAttachments` 替代），但未删除以避免跨 seam 影响。可在 i18n 清理 seam 中处理。
5. **`Paperclip` 图标仍用于附件按钮**：底部输入栏的附件选择按钮仍使用 `Paperclip`，不受本 seam 影响。
