

# 白描笔记 (Baimiao Notes)

> 隐私优先的 AI 语音笔记 · 本地存储 · 多模型 · 语义搜索

<img width="454" height="913" alt="ScreenShot_2026-07-07_151901_001" src="https://github.com/user-attachments/assets/368c38f1-f58a-4dc9-901c-556bc2fd7d50" />



随手用语音捕捉碎片，让 AI 把它们整理成日记、回顾与洞察。数据默认留在你的设备和网盘里——白描笔记只是一个跑在本地的工具，不托管任何数据。

---

## 特性

**记录与转写**
- 一键语音录音，自动转写为文字（Gemini / Whisper / 火山引擎，附 ffmpeg 格式转换）
- 文本碎屑、时间戳、音频一同存入本地 IndexedDB

**AI 加工（日记 / 回顾 / 洞察）**
- **日记整合**：把当天碎片编织成一篇完整日记，默认模板采用柳比歇夫时间日志法
- **统计回顾**：独立数据表，可同一天追加多篇、选用不同 Prompt；默认融合 CBT + PERMA
- **生命洞察**：跨周期习惯与精力分析，默认融合习惯回路与系统 1/2 理论
- 三大模块均支持「默认 + 3 个自定义槽位」的多通道 Prompt，可一键批量生成多套结果
- 日记 / 回顾 / 洞察卡片内均可展开 AI 对话追问，上下文随卡片独立保存
- 日记 / 回顾 / 洞察三类卡片视觉风格完全统一（折叠摘要 + 展开全文 + AI 追问）

**白描 Copilot（智能助理）**
- 基于本地向量数据库的 RAG 检索对话，支持跨时空的碎屑、日记、回顾、洞察内容查询
- 支持按模块（记录/日记/回顾/洞察）、日期范围（今日/本周/本月/自定义）及日记模板精准过滤 RAG 上下文
- 支持多轮对话、自动命名会话、历史会话记录的持久化管理
- 输入框支持长文本展开编辑模式：内容超过一行时，输入框内部自动浮现展开按钮，点击进入全屏专注编辑页

**搜索（关键词）**
- 覆盖碎屑、日记、回顾、洞察四类，关键词高亮预览，按时间/模块过滤
- 向量语义搜索功能可在设置页单独开启（embedding 全程留本地）

**自动化与同步**
- 静默补发：启动时自动补齐昨日缺失的日记 / 回顾
- 云同步：WebDAV / OneDrive / Google Drive / Dropbox，端到端加密（AES-GCM），支持手动 / 合并 / 覆盖三种策略
- PWA：可添加到主屏幕，离线可用

**隐私**
- IndexedDB 本地存储，音频与笔记默认不离开设备
- AI 请求经后端代理透传，API Key 由前端注入、服务端不留存
- 数据可随时导出

---

## 多模型支持

聊天 / 转写：Gemini · OpenAI · DeepSeek · 火山引擎（豆包）· Kimi · 智谱 · MiniMax · 小米 MIMO · Anthropic · SiliconFlow · 自定义（Ollama 等 OpenAI 兼容接口）

向量模型：Gemini embedding · OpenAI · SiliconFlow · 火山引擎 · 智谱 · 自定义本地模型

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

生产构建：

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

---

## 导航与图标设计

四个主模块图标经过语义对齐设计，确保辨识度与产品心智一致：

| 标签 | 图标 | 设计依据 |
|:---|:---|:---|
| 记录 | 🎙 麦克风 (`Mic`) | 核心交互是语音口述，而非手写文字 |
| 日记 | 📖 书本 (`Book`) | 记录整合成一篇完整日记 |
| 回顾 | 🕐 时钟 (`Clock`) | 时间轴回溯，跨日统计复盘 |
| 洞察 | 💡 灯泡 (`Lightbulb`) | AI 提炼生命洞见，区别于回顾的圆形钟表图标 |

底部导航与各页面标题栏使用完全相同的图标，保持全局一致。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 · TypeScript · Vite 6 · Tailwind CSS 4 · Zustand |
| 存储 | IndexedDB（Dexie.js）— raw_logs / daily_diaries / daily_reviews / insights，均含可选 embedding 字段 |
| 后端 | Node.js · Express（代理 AI 请求，`server.ts` 为开发端，`api/index.ts` 为 Vercel） |
| 原生化 | vite-plugin-pwa · Service Worker 离线缓存 |
| Markdown | react-markdown |

---

## 项目结构

```
server.ts              Express 开发服务端（融合 Vite 中间件）
api/index.ts           Vercel Serverless API（与 server.ts 同步）
src/
├── db/db.ts           IndexedDB 声明与迁移
├── lib/embedding.ts   向量队列、余弦相似度、语义搜索
├── store/             Zustand 状态（app / settings）
├── pages/             Record · Diary · Review · Insights · Settings · Copilot
└── components/        Layout · ContextChat · CalendarHeatmap · MiniCalendar · ActionSheet
```

后端路由：`generate-timeline` / `generate-review` / `generate-insights` / `*-chat` / `transcribe` / `generate-embedding` / `test-connection` / `webdav-proxy`。所有路由的 Key 均由请求体透传，服务端不保存。

---

## License

MIT
