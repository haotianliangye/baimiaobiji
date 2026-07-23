# 白描笔记 CONTEXT

> Matt flow 的核心 state file。所有 ADR、issue 状态、决策上下文都汇聚在这里。
> 任何新 session 接手工作，先读这个文件，再读 `docs/handoff/CURRENT_STATE.md`。

## 当前版本
- `0.3.0`（2026-07-19 起算，issue #001 起；P0 全部完成于 2026-07-23）
- 完整版本谱系：v0.1.0 → v0.1.1 → v0.1.2 → v0.2.0 → v0.2.1 → v0.2.2 → v0.2.3 → v0.3.0
- db 版本：v1 → v16（4 次 schema 迁移：v14→v15→v16；v15 由 #004 占用，#008 取 v16）

## 仓库定位
- 名称：白描笔记 (Baimiao Notes)
- 仓库：`https://github.com/haotianliangye/baimiaobiji`
- 哲学：隐私优先 · 本地存储 · Iron Man 套装（非机器人）
- 技术栈：React 19 · TypeScript · Vite 6 · Zustand · Dexie.js · Express（代理）

## 进行中的工作流

### P0 实施（2026-07-19 启动）
- 8 个 issue 全部合并（#001-#008）
- 详情见 `docs/handoff/CURRENT_STATE.md` 和 `docs/issues/p0/`
- 端到端回归测试通过：73/73 通过（17 个 P0 相关测试 + 56 个历史测试）
- 已知遗留：llm-chat / multimedia / prompt-review / random-walk / thoughts / tts 6 个历史测试失败（非 P0 引入，待 P1 修复）

### 下一阶段：P1（启动中）
- 见 `docs/issues/p1/`（待创建）
- 候选：MoN-7 测试 CI / MoN-8 健康检查 / Jag-3 反馈闭环 / Jag-4 多通道一致性

### 并行轨道
- 端侧 AI 迁移（Capacitor + LiteRT-LM）：决策见 ADR-0001，实施暂停中

## ADR 索引

| 编号 | 标题 | 状态 | 文档 |
|------|------|------|------|
| ADR-0001 | 端侧 AI 采用原生混合应用 | 已决策 | `docs/on-device-ai-migration.md` |
| ADR-0002 | P0 实施计划与 8 issue 排序 | 已决策 | `docs/adr/0002-p0-implementation-plan.md` |
| ADR-0003 | API Key 真隔离（路径选 A/B/C） | **待决策**（P2） | — |
| ADR-0004 | 长期记忆修正（facts 表） | **待决策**（P2） | — |

## 已建立的约定

### 工程纪律（issue #001 之后生效）
- 版本号严格 patch/minor/major
- 每次合并 main 后立即 `git tag v<version>`
- 提交前必须 `npm run lint && npm test && npm run build`

### 渲染约定（issue #005 之后生效）
- 所有 Markdown 渲染前必经 `verifyCitations`
- Broken 引用加 `<!--broken-citation-->` 标记，UI 高亮
- 用 `<VerifiedMarkdown>` 组件（不是裸 `<ReactMarkdown>`）

### 数据约定（issue #004/#008 之后生效）
- `settings_kv` 表（v15）：键值配置，黑名单等可用户编辑项
- `backups` 表（v16）：本地自动备份快照
  - 5 个被备份的表：raw_logs / daily_reviews / thoughts / insights / tags
  - 故意不备份 attachments（太大）/ chunks（可重建）/ settings_kv（云覆盖）/ copilot_conversations（经常变）
  - 24h 节流 + 28 天保留 + 启动时 + visibilitychange 触发

### 错误诊断约定（issue #006 之后生效）
- 用 `src/lib/errorBuffer.ts` 100 条 FIFO
- 自定义 JSON replacer 显式提取 Error.name/message/stack
- Settings → About tab 有 ErrorInspector 面板
- 仍走 console.error（不破坏现有调试路径）

### 存储压力约定（issue #007 之后生效）
- 4 档判定：ok(<0.7) / warning(0.7-0.85) / critical(0.85-0.95) / danger(≥0.95)
- `src/hooks/useStorageMonitor.ts` 5 分钟轮询
- Settings 数据管理 tab 显示进度条（不挂全局 Toast）

### 包版本号管理（issue #006 之后强制）
- package.json version 必须随每个 git tag 同步更新
- vite.config.ts 通过 `import pkg` 注入 VITE_APP_VERSION 到前端 bundle
- server.ts 通过 `import pkg` 暴露到 `/api/health`
- #006 累积修正 0.1.0 → 0.2.2 的漂移（前 5 个 issue 没 bump）

### 启动入口（事实）
- 启动逻辑在 `src/main.tsx`（不是 App.tsx）
- App.tsx 只是路由定义

## 关键决策的待办

### P1（接收 P0 反馈后再做）
- MoN-7 测试接进 CI
- MoN-8 健康检查端点
- Jag-3 用户反馈闭环（feedback 表）
- Jag-4 多通道一致性检查
- Jag-5 ~~Confidence Scoring~~：**已决定不做**（理由见 ADR-0002）

### P2（需先 grill）
- ADR-0003：API Key 真隔离（路径 A/B/C）
- ADR-0004：长期记忆修正

## 关键人/对话

### Karpathy 视角评估（2026-07-19）
- 已完成对项目的全面评估
- 详细判断见 `docs/handoff/KARPATHY_SESSION_LOG.md`
- 核心结论：
  - 产品哲学（Iron Man 套装）：极强
  - 工程现实主义：中等偏上，P0 全部完成后到「强」
  - AI 能力边界处理：中等偏上，P0 完成后到「强」

## 文件索引（按使用频率排序）

| 文档 | 何时读 |
|------|--------|
| `docs/handoff/CURRENT_STATE.md` | **每次重新启动时** |
| `docs/handoff/KARPATHY_SESSION_LOG.md` | 重新启用 Karpathy 视角时 |
| `docs/adr/0002-p0-implementation-plan.md` | 决策有疑问时 |
| `docs/issues/p0/*.md` | 准备做该 issue 时 |
| `docs/architecture.md` | 系统级问题 |
| `docs/on-device-ai-migration.md` | 端侧 AI 相关 |
| `CLAUDE.md` | 项目开发约定 |