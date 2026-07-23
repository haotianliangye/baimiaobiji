# 白描笔记 (Baimiao Notes)

> 隐私优先的 AI 语音笔记 · 本地存储 · 多模型 · 语义搜索

<img width="454" height="913" alt="ScreenShot_2026-07-07_151901_001" src="https://github.com/user-attachments/assets/368c38f1-f58a-4dc9-901c-556bc2fd7d50" />

随手用语音捕捉碎片，让 AI 把它们整理成日记、回顾与洞察。数据默认留在你的设备和网盘里——白描笔记只是一个跑在本地的工具，不托管任何数据。

---

## 这是什么

白描笔记是一个**本地优先的个人数据记录与思考辅助系统**。它的设计灵感来自丹尼尔·卡尼曼的《思考，快与慢》——把人的认知分成两个系统：

- **系统 1**：快速、直觉、自动化的认知过程（碎片拾微、随手记录、情绪感受）
- **系统 2**：慢速、刻意、逻辑性的认知过程（日记整合、统计回顾、深度洞察）

白描笔记的核心思想是：**让系统 1 负责"随手记"，让系统 2 借助 AI 完成"事后想"**。你不需要在记录时组织语言、不需要决定归类、不需要强迫自己思考意义——这些工作交给 AI 在合适的时机来做。

它解决的是**个人数据长期积累后无法消化**的问题：很多人记了几年的笔记，最终变成了一座无法翻阅的坟场。白描笔记通过 AI 定期整合、回顾、关联，让旧数据持续产生价值。

---

## 核心理念

| 认知系统 | 在白描笔记里的体现 |
|:---------|:------------------|
| 系统 1（快思考）| 语音拾微、随手记、情绪标签、一句话笔记 |
| 系统 2（慢思考）| 日记整合、统计回顾、跨周期洞察、长期记忆 |

**为什么这样设计**：

- 记录时**不**强迫思考（让系统 1 自由流动）
- 但**定期**触发系统 2 介入（AI 整合、回顾、洞察）
- 形成"记录 → 回顾 → 沉淀 → 洞察 → 新记录"的闭环

---

## 核心模块

### 1. 记录（Record）
- 一键语音录音，自动转写为文字
- 文本记录、时间戳、音频一同存入本地 IndexedDB
- 不做实时整理——保持"碎片"原貌

### 2. 回顾（Review）
- 独立数据表，可同一天追加多篇、选用不同 Prompt
- **同一页面同时管「日记」和「回顾」**——都是对当天碎片的系统 2 加工
  - **日记**：把当天碎片编织成一篇完整日记，默认采用柳比歇夫时间日志法（**系统 2 第一次介入**）
  - **回顾**：对情绪波动、行为模式做深度反思，默认融合 CBT（认知行为疗法）+ PERMA（积极心理学）模型（**系统 2 深度介入**）

### 3. 沉淀（Thoughts）
- 自由长文页面，承载需要展开写、反复修改的"非碎片"内容
- 支持富文本编辑（图片 / 链接 / 标签 / 列表）
- 与"记录"的数据结构一致：日期 + 内容 + 标签——但定位是「想清楚再写」，与记录的「随手记」互补
- 同步进入 Copilot 检索、标签系统与导出范围

### 4. 洞察（Insight）
- 跨周期习惯与精力分析
- 默认融合习惯回路与系统 1/2 理论
- **这是系统 2 长期介入**：从单次回顾升级到长期模式

### 5. 标签管理（Tags）
- 树形结构管理所有标签（含子标签）
- 输入 `#工作/项目A` 自动创建标签、关联到对应记录 / 沉淀 / 回顾 / 洞察
- 支持重命名、合并、删除（级联清理关联笔记）

### 6. Copilot（智能助理）
- 基于本地向量数据库的 RAG 检索对话
- 支持按模块（记录/沉淀/回顾/洞察）、日期范围、日记模板精准过滤上下文
- 跨时空查询你的全部笔记

### 7. 长期记忆（Facts）
- 手动录入关于自己的事实：生日、偏好、习惯、背景
- AI 在对话中会记住这些事实，下次不用重复说
- **未来计划**：AI 自动抽取、Copilot 提示注入

---

## 特性

**记录与转写**
- 一键语音录音，自动转写为文字（多模型可选）
- 文本拾微、时间戳、音频一同存入本地 IndexedDB
- 音视频附件、链接、摘要支持

**AI 加工（日记 / 回顾 / 洞察）**
- 三大模块均支持「默认 + 3 个自定义槽位」的多通道 Prompt
- 一键批量生成多套结果
- 卡片内可展开 AI 对话追问，上下文随卡片独立保存

**搜索（关键词 + 语义）**
- 覆盖拾微、日记、回顾、洞察四类
- 关键词高亮预览，按时间/模块过滤
- 向量语义搜索可单独开启（embedding 全程留本地）

**自动化与同步**
- 静默补发：启动时自动补齐昨日缺失的日记 / 回顾
- 云同步：WebDAV / OneDrive / Google Drive / Dropbox，端到端加密（AES-GCM）
- PWA：可添加到主屏幕，离线可用
- 本地自动备份：最近 4 周历史快照

**健康检查（开发者用）**
- `/api/ready` · `/api/health` · `/api/version` · `/api/storage`
- 用于部署监控和故障排查

**隐私**
- IndexedDB 本地存储，音频与笔记默认不离开设备
- AI 请求经后端代理透传，API Key 由前端注入、服务端不留存
- 数据可随时导出

---

## 版本管理

### 当前版本

| 项目 | 版本 | 说明 |
|:-----|:-----|:-----|
| 应用 | v0.1.0 | 首个公开预览版 |
| 数据 Schema | v17 | IndexedDB 当前最高迁移版本 |
| Node 要求 | ≥ 18 | 后端运行时 |

### 版本号规则

采用语义化版本号（SemVer）：`MAJOR.MINOR.PATCH`。

- **PATCH**（如 v0.1.0 → v0.1.1）：仅修 bug，用户无需任何操作
- **MINOR**（如 v0.1.x → v0.2.0）：新增模块或功能，向下兼容旧数据
- **MAJOR**（如 v0.x → v1.0）：可能涉及 schema 不兼容升级，启动时会提示数据迁移并自动备份

### 更新日志

- **v0.3.0**（当前）
  - 拾微 / 日记 / 回顾 / 洞察 / Copilot / Facts 六大模块上线
  - 支持 10+ 家 LLM / Embedding 服务商
  - WebDAV / OneDrive / Google Drive / Dropbox 端到端加密同步
  - IndexedDB v17 schema，PWA 离线可用

### 升级策略

- **数据迁移**：启动时自动按 schema 版本号升级 IndexedDB，老数据不会丢失
- **配置兼容**：API Key、Prompt、云同步凭据存于 `settings_kv`，升级时自动保留
- **回滚**：通过「设置 → 数据管理 → 本地备份」恢复最近 4 周内的任意快照
- **手动导入/导出**：设置 → 数据管理 → 导出 / 导入 JSON 备份，跨设备迁移安全可控

> 建议在每次 `MAJOR` 升级前，使用「数据导出」功能手动备份一份 JSON 到本地。

---

## Git 分支管理

白描笔记采用 **Git Flow 简化版**：

- **`main`** —— 主分支，始终保持可发布状态。新功能开发完成后合并到这里。
- **`feat/<功能名>`** —— 功能分支，每个新功能单独一个分支，做完合入 `main` 后删除。

### 典型工作流

```bash
# 1. 从 main 拉新功能分支
git checkout main
git pull origin main
git checkout -b feat/new-feature

# 2. 提交工作
git add .
git commit -m "feat: 加新功能"

# 3. 推上去建 PR / 直接合入 main
git push origin feat/new-feature
# （在 GitHub 上 PR → 合并 → 删除远端 feat 分支）

# 4. 本地同步
git checkout main
git pull origin main
git branch -d feat/new-feature
```

**本地必备分支**：`main`。任何时候 `main` 都应该是最新可发布版本。

---

## 多模型支持

**聊天 / 转写**：Gemini · OpenAI · DeepSeek · 火山引擎（豆包）· Kimi · 智谱 · MiniMax · 小米 MIMO · Anthropic · SiliconFlow · 自定义（Ollama 等 OpenAI 兼容接口）

**向量模型**：Gemini embedding · OpenAI · SiliconFlow · 火山引擎 · 智谱 · 自定义本地模型

所有模型在设置页填写 Key 即用，内置「测试连接」。

---

## 快速开始

```bash
git clone https://github.com/haotianliangye/baimiaobiji.git
cd baimiaobiji
npm install
npm run dev        # http://localhost:3000
```

首次进入后在「设置」页选择服务商、填入 API Key 即可。如使用本地 Ollama，选「自定义」并填 Base URL（如 `http://127.0.0.1:11434/v1`）。

**生产构建**：

```bash
npm run build      # 输出 dist/ + dist/server.cjs
npm start
```

部署到 Vercel：已内置 `vercel.json`，连接 GitHub 仓库即可。`/api/*` 路由由 `api/index.ts` 处理，其余回落到 SPA。

> 服务端默认只监听 `127.0.0.1`（避免局域网未授权访问 AI 代理接口）。需要手机 PWA 连电脑时，设置环境变量 `HOST=0.0.0.0` 再启动。

---

## 配置说明

- **模型**：设置页选择服务商，填 Key / Base URL / Model；每家配置独立缓存，切换不丢失
- **Prompt**：日记 / 回顾 / 洞察各自可选「默认」或「自定义 1/2/3」，默认只读、自定义可编辑
- **语义搜索**：设置页开启向量功能并选择 embedding 模型，开启后自动扫描历史数据补建索引
- **云同步**：选服务商 → 授权 / 填凭据 → 设置加密密码 → 选择冲突策略
- **长期记忆**：设置 → 数据管理 → 长期记忆 section，手动录入关于自己的事实

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 · TypeScript · Vite 6 · Tailwind CSS 4 · Zustand |
| 存储 | IndexedDB（Dexie.js）— v17 schema，含 15+ 张表（raw_logs / daily_reviews / thoughts / insights / tags / tag_aliases / attachments / chunks / settings_kv / backups / facts 等）|
| 后端 | Node.js · Express（代理 AI 请求，`server.ts` 为开发端，`api/index.ts` 为 Vercel）|
| 原生化 | vite-plugin-pwa · Service Worker 离线缓存 |
| Markdown | react-markdown |

---

## 项目结构

```
server.ts              Express 开发服务端（融合 Vite 中间件）
api/index.ts           Vercel Serverless API（与 server.ts 同步）
src/
├── db/db.ts           IndexedDB 声明与迁移（v1-v17）
├── lib/               embedding · chunking · tts · multimedia · tags · i18n · dataExport/Import · factsStore · autoBackup
├── store/             Zustand 状态（app / settings / thoughts / insights / tags）
├── pages/             Record · Review · Thoughts · Insights · Settings · Copilot
└── components/        Layout · ContextChat · RichEditor · CalendarHeatmap · RandomWalk · ActionSheet
```

后端路由：`generate-timeline` / `generate-review` / `generate-insights` / `*-chat`（insight / diary / review / copilot） / `chat` / `transcribe` / `multimedia-summarize` / `generate-embedding` / `tts` / `test-connection` / `webdav-proxy` / `ready` / `health` / `version` / `storage`。

---

## License

MIT
