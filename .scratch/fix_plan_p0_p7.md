# 白描笔记 RAG 功能修复计划（P0 → P6）

## 范围与原则
基于 `/code-review` 两轴审核结果，对 86e9124→HEAD 的本地向量/RAG 功能做逐步修复。共 7 个阶段（P0–P6），按"依赖关系 + 风险递增"排序：先修规范硬伤与小重构（低风险），再做独立功能补全（中风险），最后做检索约束补全。

**已确认的决策**：
- P3：搜索 UI 加模板选择器（最灵活方案）
- P5：合并进 P1（加注释，不单独立阶段）
- P6：保留 `gemini-embedding-2`，更新 PRD §7
- P7（Web Worker）：列为后续 phase，**本次不做**

每阶段独立提交，`tsc --noEmit` 必须通过。前置依赖明确的阶段会标注。

---

## P0 — 修复 test-connection 接口规范违反【硬伤，立刻做】
**问题**：`/api/test-connection` 是唯一从 `req.body` 顶层取 `apiKey/baseUrl/model` 的接口，违反 `GEMINI.md` 规约第 2 条（必须经 `settings` 对象透传）。

**改动**：
- `api/index.ts:282` + `server.ts:288`：把 `const { type, provider = 'gemini', apiKey, baseUrl, model } = req.body;` 改为 `const { type, settings } = req.body; const { provider = 'gemini', apiKey, baseUrl, model } = settings || {};`
- `src/pages/Settings.tsx:272-278` 和 `:307-313`：两处请求体从 `{ type, provider, apiKey, baseUrl, model }` 改为 `{ type, settings: { provider, apiKey, baseUrl, model } }`

**验证**：`npm run lint` 通过；手动测试 Chat/Embed 两个测试连接按钮仍正常返回成功/失败。

**风险**：极低。纯结构调整，行为不变。

---

## P1 — 提取 Gemini 客户端 helper + 语义阈值常量 + provider 表注释【小重构】
**问题**：Gemini 客户端构造代码重复 6 次；`0.35` 阈值硬编码 4 次；provider 配置表三处重复（原 P5 合并进来）。

**改动**：
- 在 `api/index.ts` 和 `server.ts` 各加一个 `buildGeminiClient(apiKey, baseUrl)` 函数（封装 `genAiConfig` + base-URL 归一化 + `new GoogleGenAI`），替换 `generate-embedding` 和 `test-connection` 里的 6 处重复块。
- 在 `src/store/app.store.ts` 顶部加 `const SEMANTIC_THRESHOLD = 0.35;`，替换 `executeSearch` 里 4 处 `if (sim > 0.35)`。
- provider 配置表三处重复（`api/index.ts` `defConfigs`、`server.ts` `defConfigs`、`settings.store.ts` `DEFAULT_EMBED_PROVIDER_CONFIGS`）：前后端构建不同、无法共享 import，故在后端两份 `defConfigs` 上加注释说明"前端 `settings.store.ts` 是真源，此处仅兜底默认值，加新厂商需同步前端"。不大改。

**验证**：`npm run lint` 通过；语义搜索行为不变。

**风险**：低。纯重构，无行为变化。

---

## P2 — 实现 `#log_id_UUID` 占位符清洗管线【独立功能，风险低】
**问题**：PRD §4.3.3 + 用户故事 10 要求的三阶段清洗管线缺失，RAG/Copilot 回答里的 UUID 引用会渲染成乱码。目前 `ContextChat.tsx:171` 和各 `ReactMarkdown` 直接渲染原文。

**改动**：
- 新建 `src/lib/citationWash.ts`，导出 `washCitations(markdown: string): string`，实现 PRD 三阶段管线：
  1. 提取所有标准格式 `[文字](#log_id_UUID)` → 置换为 `__PRESERVED_LINK_x__` 占位符
  2. 正则匹配剩余裸露 `#log_id_UUID`（含 `[UUID]`、code 包裹、带空格变体）→ 重写为标准 `[引用](#log_id_UUID)`
  3. 还原占位符
- 在 `ContextChat.tsx:171`、`Diary.tsx:405`、`Review.tsx:431`、`Insights.tsx:136` 的 `ReactMarkdown` 包一层 `washCitations(msg.content)`。
- `src/main.tsx` 或 Layout 里注册一个全局点击处理器，拦截 `#log_id_*` 锚点跳转（跳转到对应日期 + 高亮碎屑气泡）。这步交互较复杂，若 P2 范围太大可只做清洗函数 + 渲染包裹，跳转交互留到后续。

**验证**：写几个 `washCitations` 测试用例覆盖裸 UUID / 中括号 / 已标准链接 / code 包裹；`npm run lint` 通过。

**风险**：低。纯函数，独立，不碰现有逻辑。点击跳转的交互部分略复杂，可拆分。

**依赖**：无。可与 P0/P1 并行。

---

## P3 — 补全语义搜索的 prompt_index 过滤 + 索引预过滤 + 1000 条上限【PRD 检索约束】
**问题**：PRD §4.3.2 要求日记语义搜索按 `dateRange ∧ prompt_index` 过滤（现缺）；§4.3.4 要求用 IndexedDB 日期索引预过滤、比对 ≤1000 条（现为全表 `toArray()`）。

**改动**（`src/store/app.store.ts` 的 `executeSearch` + `src/components/Layout.tsx` 搜索面板）：
- 把 `db.raw_logs.toArray()` 改为 `db.raw_logs.where('created_at').between(start, end).toArray()`（需从 `searchFilters` 算出 start/end；"全部"时回退全表但 `.slice(0,1000)`）。
- 同理改 `daily_diaries`（用 `diary_date` 字符串范围或 `toArray().slice`）、`daily_reviews`。
- **prompt_index 过滤（已确认用模板选择器方案）**：在搜索面板加一个日记模板下拉选择器（选项 = 当前激活的 `diaryPrompts` 槽位 + "全部模板"），选具体模板时日记语义搜索按该 `prompt_index` 过滤，选"全部"时不过滤。`searchFilters` 加 `diaryPromptIndex?: number` 字段，`executeSearch` 日记语义分支读取它。
- 候选向量数组在算余弦前 `.slice(0, 1000)`。

**验证**：`npm run lint` 通过；多模板日记场景下选某模板只返回该模板的语义结果；大数据量下手感不卡（Web Worker 留待后续 phase，本阶段是过渡方案）。

**风险**：中。改检索核心逻辑 + 加 UI 组件，需回归测试搜索结果。模板选择器的状态需持久化进 `searchFilters`。

**依赖**：无强依赖。本阶段是 Web Worker（后续 phase）的前置——它先把候选集收窄，后续 worker 收到的数据量才可控。

---

## P4 — 重构 embedding.ts：type 配置表驱动【中重构】
**问题**：`task.type === 'record'|'diary'|'review'` 级联在 `processEmbeddingQueue`（取数 + 写回）和 `enqueueAllMissingEmbeddings` 反复出现；6 个 Dexie hook 近乎复制粘贴。

**改动**（`src/lib/embedding.ts`）：
- 定义 `const ENTITY_CONFIG = { record: { table: db.raw_logs, textField: 'content' }, diary: { table: db.daily_diaries, textField: 'ai_editorial' }, review: { table: db.daily_reviews, textField: 'ai_review' } }`
- `processEmbeddingQueue` 用 `ENTITY_CONFIG[task.type]` 取 table/textField，消除两处级联。
- `enqueueAllMissingEmbeddings` 用 `Object.entries(ENTITY_CONFIG)` 循环，消除三块重复。
- 6 个 Dexie hook 用一个工厂函数 `makeHooks(type, textField)` 生成，循环注册。

**验证**：`npm run lint` 通过；新建/编辑碎屑、日记、回顾仍触发入队；手动 backfill 仍工作。

**风险**：中。Dexie hook 注册时机敏感（模块加载时），重构需保证 hook 仍只注册一次。建议改完手动验证"新建碎屑→队列 size+1→生成向量"全链路。

**依赖**：建议在 P2/P3 之后，避免与它们改同一文件冲突。

---

## P5 — 默认 embedding 模型与 PRD 对齐【文档同步】
**问题**：PRD §7 写 `text-embedding-004`，代码默认 `gemini-embedding-2`（commit a3f3584）。

**改动**（已确认方案 A）：保留代码现状 `gemini-embedding-2`（更新的模型），把 `.scratch/prd_local_rag_embedding.md` §7 同步更新为 `gemini-embedding-2`，并标注"原 text-embedding-004 已升级"。代码不动。

**验证**：`npm run lint` 通过（应无变化）。

**风险**：极低。仅改 PRD 文档。

---

## 后续 phase（本次不做）

**P6 / Web Worker 余弦计算**：PRD §2/§4.3.4 要求余弦比对在 Web Worker 中跑，避免主线程卡顿。现状主线程同步跑。改动包括新建 `src/lib/cosine.worker.ts`、配置 vite worker、`executeSearch` 语义分支改 `postMessage` + 与 `searchRequestId` 序列号配合。风险高、工作量大，列为独立后续 phase，本次不执行。P3 的索引预过滤 + 1000 条上限是它的前置（先收窄候选集，worker 收到的数据量才可控）。

**白描 Copilot RAG 对话面板**：PRD §2 + 用户故事 3/4/7 要求的独立 RAG 对话界面。脚手架已齐（`ContextChat.tsx` 可复用、`processChatRequest` + 三个 `*-chat` 路由已存在、`InsightMessage` 类型已定义）。需新建页面/组件，复用 `executeSearch` 检索逻辑拼上下文。列为独立后续 phase。

---

## 执行顺序与建议
1. **P0 → P1 → P5**：低风险、可快速连做。P5 仅改 PRD 文档。
2. **P2**：独立，可随时插入。
3. **P3**：改检索核心 + 加模板选择器 UI，做完后为后续 Web Worker phase 铺路。
4. **P4**：embedding.ts 重构，独立于搜索路径。

## 已确认的决策
- P3：搜索 UI 加模板选择器（最灵活方案）
- P5：原 P5（provider 表去重）合并进 P1，加注释；本 P5 重新编号为"PRD 模型对齐"
- P6（Web Worker）：列为后续 phase，本次不做
- Copilot 面板：列为后续 phase，本次不做

确认后我按 P0 开始逐阶段执行。
