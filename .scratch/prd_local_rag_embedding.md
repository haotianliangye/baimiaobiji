# PRD: 本地化向量检索 (Local Embedding) 与智能问答 (RAG) 系统

**Triage Labels**: `ready-for-agent`

---

## 1. 痛点陈述 (Problem Statement)

随着用户在白描笔记中积累的碎屑记录（`raw_logs`）和生成的日记与回顾（`daily_diaries`, `daily_reviews`）日益增多，现有的搜索和反思机制面临以下技术与产品瓶颈：

1. **关键词匹配的局限性**：当前的搜索逻辑仅依赖普通的 JS 内存字面量查找（`.includes()`）。在以主观情感和意识流记录为主的日记应用中，用户搜索“抑郁”或“焦虑”时，无法匹配到包含“情绪低落”、“心里沉甸甸的”或“emo”等含有丰富情绪色彩但字面不重合的碎屑。
2. **全量内存加载的性能危机**：目前的搜索函数会将整张表通过 `toArray()` 一次性读入内存，当日志超过万级时，在移动端低端设备的 WebView 中进行大段文本的内存遍历极易触发 OOM 崩溃或引发页面严重卡顿，甚至导致 WebView 被系统强行中止。
3. **多 Prompt 模板导致的数据检索混淆**：白描笔记支持多 Prompt 模板同时启用。如果用户针对同一日期使用不同的 Prompt 模板生成了多篇不同风格的日记，普通的日期搜索（仅匹配 `diary_date`）会导致不同模板生成的内容在检索时互相混淆，破坏了多 Prompt 模板的独立性。
4. **大模型与向量模型厂商支持的脱节**：用户可能全局使用 DeepSeek 进行文本对话（Chat），但 **DeepSeek 官方目前不提供 Embedding 向量化 API**。若强制共用一套大模型配置，用户将无法使用向量检索。因此，文本生成模型与向量（Embedding）模型的厂商配置必须完全解耦、支持独立设置。
5. **移动端网络与后台生命周期的不稳定性**：移动端设备存在频繁的网络切换、休眠或切后台。如果将文本向量化的生成工作直接置于同步流程中，极易因网络断开或 App 被挂起而丢失任务，引起 UI 阻塞或死锁。
6. **RAG 输出引用链接的渲染故障**：大模型在返回 RAG 对话时，通常会输出 `#log_id_UUID` 格式的文本作为对原日志碎屑的引用。若直接渲染，会导致用户看到一串杂乱的代码，甚至因为 Markdown 括号嵌套冲突（例如 `[引用](#log_id_UUID)(#log_id_UUID)`）引发渲染排版错乱。

---

## 2. 解决方案 (Solution)

本方案在严格遵守白描笔记**「隐私优先与本地全掌控」**（所有明文与向量数据默认存在本地 IndexedDB 中，大模型配置由前端安全注入）的核心红线下，设计了**本地化向量存储与 RAG 架构**：

- **云端 API 转换 + 本地向量存储（双提供商独立配置）**：允许用户分别配置“对话大模型”与“向量大模型”。支持调用如 OpenAI、硅基流动（SiliconFlow），以及 **Google Gemini 的免费向量模型接口（如 `text-embedding-004`）**。计算出来的向量（浮点数组）和明文直接保存在本地 IndexedDB 中，大模型接口仅充当无状态的转换工具。
- **本地余弦距离检索**：在搜索和提问时，先通过 IndexedDB 已有索引做日期和模板范围过滤，再在 Web Worker 中利用纯 JS 计算 Query 向量与过滤后的向量之间的余弦相似度，避免主线程卡顿。
- **白描 Copilot 对话面板**：提供一个独立的 AI 对话界面，在本地匹配最相关的碎屑或日记作为 RAG 上下文发送给大模型，生成关于个人历史的整合性答复。
- **持久化任务队列（LocalStorage Task Queue）**：通过后台持久化队列自动在后台闲时、有网时增量补齐向量，对抗移动端的切后台和网络波动。
- **超链接占位符保护清洗**：引入强健壮的清洗模块，将大模型输出的裸 UUID 转换为可点击、可高亮跳转的碎屑气泡链接。

---

## 3. 用户故事 (User Stories)

1. **As a** privacy-conscious Baimiao user, **I want** my log and diary embeddings to be stored only in my browser's local IndexedDB, **so that** my private thoughts are never uploaded to any public or third-party cloud vector database.
2. **As a** mobile user on an unstable network, **I want** my pending embedding tasks to be stored in a LocalStorage queue, **so that** the conversion resumes automatically when the network re-establishes without blocking the UI.
3. **As a** user with multiple custom diary styles, **I want** the RAG search to filter context records based on the active `prompt_index`, **so that** the Copilot's answers don't mix up content from unrelated templates (e.g., "gentle review" vs. "work notes").
4. **As a** user who wants to track self-growth, **I want** to query my diary history using conceptual prompts (e.g., "when did I feel motivated?"), **so that** I can retrieve all emotionally relevant logs even if they don't contain the exact word "motivated".
5. **As a** Baimiao user seeking a low-cost solution, **I want** to configure Google Gemini's Free Tier embedding API, **so that** I can generate vector indexes for all my historical diaries completely free of charge.
6. **As a** user who prefers DeepSeek for diary generation, **I want** to configure a separate provider (such as SiliconFlow or Google Gemini) for the vector search, **so that** the search still works even though DeepSeek does not offer an embedding API.
7. **As a** Copilot user reviewing AI insights, **I want** all citations to be rendered as clickable links, **so that** I can click them to navigate directly to the specific raw log bubble on its historical date.
8. **As a** developer, **I want** the backend proxy server `/api/generate-embedding` to remain stateless and accept provider configurations dynamically from the client's store, **so that** no sensitive API keys are ever hardcoded or stored on the server side.
9. **As a** mobile phone user, **I want** the vector similarity search to restrict its calculation scope by date and category before comparing embeddings, **so that** my phone's processor doesn't overheat and the app doesn't lag.
10. **As a** user reading long conversations in Copilot, **I want** the AI output to undergo placeholder protection washing, **so that** standard Markdown links are preserved while messy raw UUID strings are cleanly formatted.

---

## 4. 实施决策 (Implementation Decisions)

### 4.1 数据库与设置状态升级 (Schema & Settings State)

#### 1. 数据库升级
对 IndexedDB 表结构进行升级，向 `raw_logs`, `daily_diaries`, `daily_reviews` 表中追加可选的 `embedding` 字段与版本控制字段。以 [db.ts](file:///d:/baimiaobiji/src/db/db.ts) 中的表定义为基础进行升级：

```typescript
export interface RawLog {
  id: string;
  content: string;
  created_at: number;
  timezone: string;
  audioBlob?: Blob;
  audioDuration?: number;
  // --- 向量检索扩展字段 ---
  embedding?: number[];          // 浮点型向量数组 (如 1536 或 768 维)
  embedding_version?: string;    // 模型提供商与版本，格式为 "provider:model_name" (例: "gemini:text-embedding-004")
}
```

#### 2. 设置 Store 升级
在 [settings.store.ts](file:///d:/baimiaobiji/src/store/settings.store.ts) 的 `SettingsState` 状态中，将 Chat 模型与 Embedding 模型完全解耦：

```typescript
interface SettingsState {
  // --- 文本生成配置 (Chat) ---
  provider: 'gemini' | 'openai' | 'deepseek' | ...;
  apiKey: string;
  baseUrl: string;
  model: string;

  // --- 新增向量模型独立配置 (Embedding) ---
  embedProvider: 'gemini' | 'openai' | 'siliconflow' | 'volcengine' | 'zhipu' | 'custom';
  embedApiKey: string;
  embedBaseUrl: string;
  embedModel: string;
  embedConfigs: Record<string, { apiKey: string; baseUrl: string; model: string }>;
}
```

### 4.2 后端代理接口扩展 (API Contracts)

由于大模型配置采用纯透传设计，后端 `/api/generate-embedding` 路由作为无状态代理。如果选择的 Provider 为 `gemini`，后端代理在向上游转发时应适配 Google AI Studio 的 Embed API（如 `/v1beta/models/text-embedding-004:embedContent` 路径映射）。

- **请求 Payload (`POST /api/generate-embedding`)**:
  ```json
  {
    "text": "今天跑了五公里，出了一身汗，感觉压力释放了许多。",
    "settings": {
      "provider": "gemini",
      "apiKey": "AIzaSy...",
      "baseUrl": "https://generativelanguage.googleapis.com",
      "embeddingModel": "text-embedding-004"
    }
  }
  ```
- **成功响应 (200 OK)**:
  ```json
  {
    "embedding": [0.00234, -0.0456, 0.08912, ...]
  }
  ```

### 4.3 核心处理逻辑与算法决策

#### 1. 持久化队列机制 (Task Queue)
- **数据结构**：在 LocalStorage 中存放 `baimiao_pending_embeddings: Array<{ id: string, type: 'record' | 'diary' | 'review' }>`。
- **触发逻辑**：用户新建或编辑碎屑/日记后，对应 ID 压入队列。后台启动一个带指数退避重试（Exponential Backoff）的同步线程：
  1. 检查是否有网络连接（`navigator.onLine`）。
  2. 获取队列头部任务，读取本地 IndexedDB 里的对应文本。
  3. 调用后端 `/api/generate-embedding` 得到向量。
  4. 写回本地数据库，并打上 `embedding_version` 标记，最后移出队列。
  5. 注册浏览器 `online` 事件监听，一旦恢复网络连接，立刻唤醒队列自动补齐。

#### 2. 多模板隔离矩阵
在进行 RAG 检索组装上下文时，若匹配目标是 `daily_diaries`，查询条件必须强制注入：
$$\text{Filter} = \{ \text{dateRange} \land \text{prompt\_index} \}$$
这能精确避免当用户切换 Prompt 模板时，在对话上下文中注入其它模板生成的日记，破坏人格设定的连贯性。

#### 3. 「占位符保护清洗算法」执行管线
RAG 吐出的回答中往往会提及相关碎屑的 ID。我们需在渲染 ReactMarkdown 前对其进行清洗：
```mermaid
graph TD
    A[RAG Markdown 文本] --> B[第一阶段: 提取所有标准格式 [文字](#log_id_UUID) 并置换为占位符 __PRESERVED_LINK_x__]
    B --> C[第二阶段: 正则匹配其余所有裸露的 #log_id_UUID 或是 `code` 包裹的 UUID]
    C --> D[将非标 UUID 统一重写为标准格式 [引用](#log_id_UUID)]
    D --> E[第三阶段: 将第一阶段保存的 __PRESERVED_LINK_x__ 占位符按索引还原还原回来]
    E --> F[安全的 Markdown 渲染]
```

#### 4. 前置范围收窄余弦计算
为保护移动端 CPU 功耗，系统在计算余弦相似度前：
1. 必须使用 IndexedDB 的日期主键索引，将数据限制在用户当前选择的搜索范围（例如最近3个月）或 RAG 深度范围。
2. 将比对条数控制在 1000 条以内。由于余弦计算为纯数学乘加，单次搜索耗时通常控制在 5ms 以内，无需启用复杂的本地向量库。

---

## 5. 测试决策 (Testing Decisions)

- **离线与断网测试**：
  - 模拟手动断开网络连接，在保存日记后验证 `LocalStorage` 待向量化队列是否能正确压入，并在网络恢复的一瞬间自动执行补齐任务。
- **边界向量测试**：
  - 针对大模型返回的空文本或极短文本，测试向量化请求是否能进行合理的兜底规避（不向 API 发起空请求），并妥善处理全零向量的余弦比对。
- **超链接清洗模块鲁棒性测试**：
  - 编写多组测试用例验证清洗算法：包含裸 UUID、中括号 UUID `[UUID]`、带空格 of UUID、以及已经写好的标准引用链接，验证清洗后输出结果是否无任何客观存在的渲染 bug。

---

## 6. 不在本次迭代范围内 (Out of Scope)

- **离线 WASM 推理兜底**：为了保证包体积小（移动端加载体验），第一阶段不引入 `@huggingface/transformers` 的本地 WASM 运行环境，完全依赖 API Key 进行无状态转换。
- **语音二进制直接 Embedding**：不支持直接将录音 Blob 传入多模态向量接口，一律先转为文本后计算文本向量。

---

## 7. 补充说明 (Further Notes)

- **首批大模型提供商扩展**：
  - **Google Gemini**: 支持 `gemini-embedding-2` (新版嵌入模型；提供极具诱惑力的免费层额度，特别适合白描笔记这种本地轻量级、个人级应用，实现零成本向量化。*注：原 PRD 此处为 `text-embedding-004`，已升级为 `gemini-embedding-2`。*)
  - **OpenAI**: 支持 `text-embedding-3-small` (1536 维，业界标杆)。
  - **SiliconFlow (硅基流动)**: 支持 `BAAI/bge-large-zh-v1.5` (1024 维，国内极速，对中文语义有极强感知)。
- **页面微调**：设置页面 [Settings.tsx](file:///d:/baimiaobiji/src/pages/Settings.tsx) 的“模型设置”卡片中，提供对话模型（Chat）与向量模型（Embedding）各自独立的配置项。
