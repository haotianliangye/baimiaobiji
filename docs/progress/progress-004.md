# Progress - Seam 3: RAG+CHAT（Copilot）导航重构 (#004)

## 改动摘要

将 Copilot 页面内导航从"对话 / 历史会话"二级标签 + "RAG 问答 / 通用 Chat"模式切换的两层结构，扁平化为单行横向导航：`RAG -> CHAT -> 历史`。

### 导航变更

| 变更前 | 变更后 |
|---|---|
| 顶部二级标签：对话 / 历史会话 | 移除 |
 | 对话视图内模式切换：RAG 问答 / 通用 Chat | 移除 |
 | — | 单行三按钮导航：RAG / CHAT / 历史 |

### 导航映射

- **RAG**：原 RAG 问答模式（基于本地向量检索 + LLM），保留筛选胶囊行（记录/日记/回顾/洞察、日期筛选、日记模板筛选）。
- **CHAT**：原通用 Chat 模式（纯 LLM 对话）。
- **历史**：原历史会话列表，列表项保留 mode 标签（RAG/CHAT）。

### 状态模型变更

- 移除 `activeTab: 'chat' | 'history'` 状态。
- 新增 `navView: 'rag' | 'chat' | 'history'` 状态，统一控制页面视图。
- 保留 `chatMode: 'rag' | 'chat'` 状态（用于 API endpoint 选择 `/api/copilot-chat` vs `/api/chat`），当 `navView` 为 `rag` 或 `chat` 时与 `navView` 同步。
- `handleSwitchMode(mode)`：切换 RAG/CHAT 时仍清空当前会话并新建（mode per conversation），同时设置 `navView`。
- 新增 `handleSwitchToHistory()`：切换到历史列表视图，不改变当前 mode。
- `handleSelectConversation(id)`：从历史列表选择会话时，根据会话的 `mode` 跳转到对应视图（RAG 会话 -> RAG 视图，CHAT 会话 -> CHAT 视图）。
- `handleNewConversation()`：新建对话时回到当前 chatMode 对应的视图。

### 下拉菜单定位调整

移除模式切换行后，页面垂直布局减少一行（~36px），日期/日记模板下拉菜单的 `top` 定位从 `180px` 调整为 `142px`（header 54px + nav 48px + filter row ~40px）。

### 新增 i18n key（zh + en 各 3 条）

- `copilot.navRag`：`RAG` / `RAG`
- `copilot.navChat`：`CHAT` / `CHAT`
- `copilot.navHistory`：`历史` / `History`

原有 `copilot.chat`（"对话"）、`copilot.history`（"历史会话"）、`copilot.ragMode`（"RAG 问答"）、`copilot.chatMode`（"通用 Chat"）key 保留（历史列表 mode 标签仍使用 `copilot.ragMode` / `copilot.chatMode`），`copilot.chat` / `copilot.history` 在本 seam 后不再被引用但未删除（避免跨 seam 影响）。

## Lint / Build 结果

- `npm run lint`（tsc --noEmit）：**通过**（首次即过）
- `npm run build`（vite build + esbuild server.ts）：**通过**（首次即过；chunk size 警告为既有项，与本次无关）

## 变更文件

- `src/pages/Copilot.tsx` - 替换二级标签+模式切换为单行三按钮导航，更新状态模型与处理器，调整下拉菜单定位
- `src/i18n/zh.ts` - 新增 3 条 nav key
- `src/i18n/en.ts` - 新增 3 条 nav key

## 遗留问题

1. **下拉菜单 `top` 定位为硬编码像素值**：日期和日记模板下拉菜单使用 `absolute top-[142px]` 定位，依赖 header(54px) + nav(48px) + filter row(~40px) 的固定高度。若后续 seam 调整这些行的高度，需同步更新此值。根本修复应改为相对定位（如 ref + getBoundingClientRect），但超出本 seam 范围。
2. **`copilot.chat` / `copilot.history` key 成为孤儿**：这两个 i18n key 在本 seam 后不再被任何组件引用，但未删除以避免跨 seam 影响。可在 Seam 9（i18n 文案修正）或专门清理中处理。
3. **Copilot 顶部栏与 Seam 1 全局栏的关系**：Copilot 作为全屏 overlay 模式（`isCopilotMode` 时 Layout 隐藏全局 header），保留了自己的 header（标题 + 新建 + 关闭）。这是既有设计，issue 中"顶部栏遵循 seam1 规则"在此语境下指视觉风格一致（渐变色 header），而非复用全局栏结构。Copilot overlay 的 header 结构未在本 seam 改动。
