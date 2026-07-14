# 白描笔记 -- Gemini 项目约定

> 本文件与 `CLAUDE.md` 同步，以 `CLAUDE.md` 为真身。修改请改 `CLAUDE.md`，勿直接编辑本文件。

## 项目概览

白描笔记 (Baimiao Notes) 是一个隐私优先的 AI 语音日记 PWA：录语音碎屑、AI 转写、整理成日记/回顾/洞察，并基于本地归档做语义检索问答。

- 仓库：`https://github.com/haotianliangye/baimiaobiji`
- 主技术栈：React 19 · TypeScript · Vite 6 · Tailwind CSS v4 · Zustand · Dexie.js (IndexedDB)
- 后端代理：Node.js · Express（`server.ts` 开发，`api/index.ts` Vercel）

## 开发约定

### 分支与提交

- **小改动**（单文件或几行修复）：直接改 `main`，验证后 `git push origin main`。
- **实验性/可能回滚的改动**：先切 `feat/<name>` 分支，推远程，合并后再清理分支。
- 提交前必须跑：
  ```bash
  npm run lint    # tsc --noEmit
  npm run build   # vite build + esbuild server.ts
  ```

### 代码风格

- 中文用户界面，代码注释/文档按用户当前语言输出。
- 状态管理用 Zustand；本地数据库用 Dexie.js。
- 图标优先用 `lucide-react`，TabBar 用 `@phosphor-icons/react`。
- 条件类名用 `clsx` + `tailwind-merge`。

### 移动端红线

- 全局 `html/body` 必须 `overflow-hidden` + `overscroll-behavior-none`，禁止依赖 body 原生滚动。
- 所有可滚动区域用局部 `overflow-y-auto` 容器实现，避免 iOS Safari 橡皮筋回弹导致布局截断。

### 复制按钮反馈模式

复制交互统一使用 `src/hooks/useCopyToClipboard.ts`：

- 按钮显示 `Copy` / `Check` 状态切换，文字 `复制` / `已复制`，颜色变 emerald。
- 不额外弹全局 Toast（避免一处动作两处通知）。
- 如需失败提示，仅在按钮附近做局部反馈。

## 环境变量

复制 `.env.example` 为 `.env.local` 后填写：

- `GOOGLE_API_KEY`（可选，用于 Gemini 转写/生成）
- `VOLCANO_API_KEY` / `VOLCANO_ACCESS_TOKEN`（可选，火山引擎 ASR）

服务端默认监听 `127.0.0.1:3000`；需要局域网访问时设 `HOST=0.0.0.0`。

## 深入文档

| 主题 | 文件 |
|---|---|
| 系统架构、数据流、API、Runbook | `docs/architecture.md` |
| 端侧 AI 迁移决策与调研 | `docs/on-device-ai-migration.md` |
| 外部接入与快速开始 | `README.md` |
| 端侧 AI 原始调研资料 | `D:\DProjects\bytenote\docs\前期调研\` |
