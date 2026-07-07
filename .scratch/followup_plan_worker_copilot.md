# 白描笔记 后续 Phase 实施计划：Web Worker 余弦 + Copilot RAG 面板

## 总览
两个独立 phase，按依赖顺序执行，各自独立提交，`npm run lint`（`tsc --noEmit`）每阶段必过。

- **Phase A — Web Worker 余弦计算**：把 `executeSearch` 语义分支的主线程余弦循环挪进 Web Worker，主线程只负责索引预过滤 + 候选收集 + 结果融合。PRD §2/§4.3.4。
- **Phase B — 白描 Copilot RAG 对话面板**：新建全屏 overlay 对话面板，按用户问题本地语义检索拼 RAG 上下文，复用 `processChatRequest` 走新 `/api/copilot-chat` 路由，引用可点击跳转。PRD §2 + 用户故事 3/4/7。

**A 先做**：B 的检索复用 A 产出的 worker helper；A 是 P3（已完成）的直接后续。

### 已确认决策
- Copilot 入口：头部 ✨ 按钮 → 全屏 overlay（同搜索面板形态，不动底部 4 tab）。
- Copilot 历史持久化：新建 Dexie 表 `copilot_conversations`，多会话。

---

## Phase A — Web Worker 余弦计算

### 目标
`executeSearch` 语义分支的余弦比对（最坏 1000 候选 × 768~1536 维 ≈ 1.5M 次乘加）移出主线程，避免大数据量搜索时 UI 卡顿。

### 设计要点
- **Worker 纯计算、无依赖**：worker 文件不 import `db`/`settings.store`（这些在 worker 里跑不起来）。主线程做完索引预过滤 + 候选收集后，把 `{requestId, queryEmbedding, candidates:[{key, embedding}], threshold}` postMessage 给 worker；worker 只算余弦 + 排序，回传 `{requestId, results:[{key, sim}]}`。
- **key 编码 `type:id`**：worker 不持有元数据，回传 `{key, sim}` 后由主线程映射回 `record/diary/review` 元数据，继续走现有 seenIds / top-20 / RRF 融合逻辑（不变）。
- **requestId 路由**：owner 侧维护 `Map<requestId, resolve>`，worker 回包带 requestId，按 id 路由给对应 promise；过期/取消的 requestId 命中不到 resolver 即丢弃。与现有 `searchRequestId` 序列号配合：`executeSearch` 在 worker await 后仍判 `myRequestId !== searchRequestId` 则 return。
- **懒加载单例 worker**：首次语义搜索时创建（Vite `import Worker from './cosine.worker?worker'`，`vite/client` 类型已就绪），缓存复用，不每次重建。
- **降级兜底**：worker 创建失败或 `onerror` 时，回退到现有主线程 `cosineSimilarity` 内联循环（保留 `embedding.ts` 的导出）。保证老 WebView 仍可用。
- **类型处理**：tsconfig `lib` 无 `WebWorker`。worker 文件内用 `const ctx = self as unknown as Worker;`（DOM lib 的 `Worker` 类型恰好有兼容的 `postMessage(msg, options?)`/`onmessage`/`addEventListener` 签名），规避 `DedicatedWorkerGlobalScope` 缺失与 DOM/WebWorker lib 冲突。**无 tsconfig 改动**。
- **传输**：v1 用结构化克隆传 `number[][]`（候选集经预过滤通常远小于 1000）。Transferable/Float32Array 打包列为后续优化（注释标注）。

### 改动文件
1. **新建 `src/lib/cosine.worker.ts`**
   - 内联余弦函数（纯 JS，不引外部依赖）。
   - `ctx.onmessage`：解构 `{requestId, queryEmbedding, candidates, threshold}`；遍历算余弦；过滤 `sim > threshold`；按 sim 降序；封顶 100（远超主线程 top-20 需求，留 RRF 余量）；`ctx.postMessage({requestId, results})`。
   - 顶部注释说明 cast 原因与传输策略。

2. **新建 `src/lib/cosineWorker.ts`**（owner 包装）
   - 懒创建单例 worker。
   - `export async function computeCosineBatch(requestId, queryEmbedding, candidates, threshold): Promise<{requestId, results}>`：
     - 确保 worker 存在（创建失败则 throw 标记错误，调用方据此降级）。
     - `Map<requestId, resolve>` 路由；`worker.onmessage` 按 requestId 取 resolve 并删除；`worker.onerror` reject 当前所有 pending。
     - `worker.postMessage(...)`；返回 promise。

3. **修改 `src/store/app.store.ts`** — `executeSearch` 语义分支（约 1018–1106 行）
   - 保留各 entity 候选收集逻辑（索引预过滤、`seenIds` 跳过、日期/prompt 过滤、`embedding` 非空、`slice(0, MAX_SEMANTIC_CANDIDATES)`），把候选 `{key:'record:'+id, embedding}` 推入 `candidates` 数组，同时 `Map<key,{type,record}>` 记元数据。
   - 三 entity 合并后 `try { const {requestId:rid, results} = await computeCosineBatch(myRequestId, queryEmbedding, candidates, SEMANTIC_THRESHOLD); ... } catch { /* 降级：内联 cosineSimilarity 循环 */ }`。
   - 回包后 `if (rid !== searchRequestId) return;`。
   - 遍历 `results` 用元数据 Map 构造 `semanticResults`（结构同现状）。
   - 后续 top-20 + RRF 融合不变。
   - `cosineSimilarity` import 保留（降级分支用），加注释。

### 验证
- `npm run lint` 通过。
- 开语义搜索查询：结果与改动前一致（同阈值/同 top-20/同 RRF 顺序）。
- 大数据量（全日期、>1000 候选）下搜索时 UI 不卡（输入可连打、动画不卡）。
- 快速连打（debounce 内多次触发）：最新查询生效，旧结果被 requestId 丢弃。
- Worker 不可用（手动 terminate / 老内核）：降级走主线程，结果仍正确。

### 风险
- 中。改检索核心路径。主要风险是 requestId 路由与降级分支正确性。try/catch + 保留内联 fallback 兜底，最坏退回现状。

---

## Phase B — 白描 Copilot RAG 对话面板

### 目标
独立 AI 对话界面，按问题本地语义检索最相关碎屑/日记/回顾拼 RAG 上下文，发给大模型；回答里的 `#log_id_UUID` 引用可点击跳转到对应日期的碎屑气泡。

### 设计要点
- **每问一次重新检索**：与 `ContextChat` 现有「固定 contextContent」不同，Copilot 每次发送前按当前问题跑语义检索，动态生成 `contextContent`。通过给 `ContextChat` 加可选 `getDynamicContext(userMessage): Promise<string>` 实现（向后兼容，现有 3 个调用方不动）。
- **检索函数**：新建 `retrieveCopilotContext(question, filters)`，复用 `requestEmbedding` + Phase A 的 `computeCosineBatch` + DB 索引预过滤（`getFilterRange`/`isDateInFilter` 同款逻辑），返回 `{contextContent, citationMap}`。`citationMap: Map<logId,{date,type}>` 供点击跳转。
  - 不走 `executeSearch` 的 RRF/关键词融合——Copilot 只要纯语义 top-K（如 8~12 条），跨 record/diary/review。
  - 多模板隔离（用户故事 3）：日记候选按 `prompt_index` 过滤（与 `executeSearch` 一致）。
- **上下文格式**：编号片段列表，每条带日期/类型/`#log_id_<UUID>`/内容，喂系统提示，让 LLM 用 `[文字](#log_id_<ID>)` 引用（与 `DEFAULT_WARM_DIARY_PROMPT` 第 4 条一致的契约，`washCitations` 兜底清洗）。
- **引用点击跳转**：给 `ContextChat` 加可选 `onCitationClick(logId)`；ReactMarkdown 的 `a` 组件覆盖拦截 `#log_id_` → `onCitationClick`。Copilot 侧用 `citationMap` 查日期：`record` → `/?date=...&logId=...`（Record.tsx:531 已支持高亮滚动），`diary` → `/diary?date=...`，`review` → `/review?date=...`。
- **后端路由**：新增 `/api/copilot-chat`，复用 `processChatRequest`，系统提示为 Copilot 角色 + 注入 `contextContent`（与 `diary-chat` 同模式）。`server.ts` 与 `api/index.ts` 同步加（项目双入口规约，GEMINI.md §2）。
- **多会话持久化**：DB v5 加 `copilot_conversations` 表。overlay 顶栏：当前会话标题（点开历史列表切换/删除）+「＋新会话」。首条用户消息自动生成标题（截前 ~20 字）。`ContextChat` 的 `onUpdateHistory` 写回当前会话行。
- **过滤器**：Copilot 用本地 filter 状态（默认全模块/全日期/语义开），不复用全局 `searchFilters`（避免与搜索面板耦合）。UI 复用 chip + 下拉模式（紧凑一行）。
- **云同步**：本次不改 `syncNow` 的 `exportPayload`，Copilot 会话不进云备份（注释标注为后续可选项）。

### 改动文件
1. **`src/db/db.ts`** — 加 `CopilotConversation` 接口 + v5
   ```ts
   export interface CopilotConversation {
     id: string;
     title: string;
     messages: InsightMessage[];
     created_at: number;
     updated_at: number;
   }
   // class 内：
   copilot_conversations!: Table<CopilotConversation>;
   this.version(5).stores({ copilot_conversations: 'id, updated_at' });
   ```

2. **新建 `src/lib/copilotRetrieval.ts`**
   - `retrieveCopilotContext(question, filters): Promise<{contextContent: string, citationMap: Map<string,{date:string,type:'record'|'diary'|'review'}>}>`
   - 复用 `requestEmbedding`、`computeCosineBatch`（Phase A）、DB 索引预过滤。
   - 候选收集：record/diary/review 各按 filters（modules/dateRange/diaryPromptIndex）预过滤 + `embedding` 非空 + `slice(0, MAX_SEMANTIC_CANDIDATES)`。
   - 合并 candidates → worker 算余弦 → top-K（如 10）→ 拼 `contextContent`（编号列表）+ 建 `citationMap`。
   - 阈值复用 `SEMANTIC_THRESHOLD`（从 app.store 或 embedding.ts 导出复用）。

3. **`src/components/ContextChat.tsx`** — 向后兼容扩展
   - 加可选 prop：`getDynamicContext?: (userMessage: string) => Promise<string>`、`onCitationClick?: (logId: string) => void`。
   - `handleSend`/`handleRegenerate`：若 `getDynamicContext` 存在，`const contextContent = await getDynamicContext(userMsg.content);` 否则用 prop（现状）。
   - ReactMarkdown 加 `components={{ a: ... }}`：拦截 `href?.startsWith('#log_id_')` → `e.preventDefault(); onCitationClick?.(logId)`；无 `onCitationClick` 时退化为默认 `<a>`（现有调用方行为不变）。
   - 检索中提示：`getDynamicContext` 期间 `isTyping` 已 true，文案可区分「检索中…」（可选）。

4. **新建 `src/pages/Copilot.tsx`**（全屏 overlay 组件）
   - 顶栏：关闭 ✕ / 当前会话标题（点开历史列表 popover：按 `updated_at` 倒序列出，可切换/删除）/ ＋新会话。
   - 过滤行：模块 chip（记录/日记/回顾）+ 日期范围下拉（复用 Layout 同款子集）+ 日记模板下拉（语义+日记时显示）。
   - 主体：`ContextChat`，`chatHistory`=当前会话 messages，`getDynamicContext`=`(q)=>retrieveCopilotContext(q,filters).then(r=>{setCitationMap(r.citationMap);return r.contextContent;})`，`onCitationClick`=按 citationMap navigate，`onUpdateHistory`=写回 `copilot_conversations`（含 updated_at；首条消息生成 title）。
   - 无 embedding 配置时：提示去设置开启向量模型（与搜索面板同文案）。

5. **`src/components/Layout.tsx`** — 入口 + overlay
   - 头部 search 图标旁加 ✨（Sparkles）按钮 → `setCopilotMode(true)`。
   - `isCopilotMode`/`setCopilotMode` 放 `app.store`（与 `isSearchMode` 一致，便于后续搜索面板 handoff）。
   - `isCopilotMode && <Copilot />` 全屏 overlay（z 与搜索面板同级）。

6. **`src/store/app.store.ts`** — 加 `isCopilotMode: boolean` + `setCopilotMode`。

7. **`server.ts` + `api/index.ts`** — 新增路由（双入口同步）
   ```ts
   app.post('/api/copilot-chat', async (req, res) => {
     const { contextContent } = req.body;
     const systemPrompt = `你是「白描 Copilot」……以下是与用户问题最相关的本地记录片段（含 ID）：\n\n${contextContent}\n\n……引用格式 [文字](#log_id_<ID>)……`;
     await processChatRequest(req, res, systemPrompt);
   });
   ```

### 验证
- `npm run lint` 通过。
- 头部 ✨ 打开 Copilot；新会话提问 → 检索 → 回答含 `[引用](#log_id_...)` → 点击跳到对应日期/碎屑高亮。
- 多模板：选某日记模板时，上下文只含该模板日记。
- 多会话：新建/切换/删除，关闭重开仍在。
- 关 embedding：给出引导提示，不崩。
- 向量为空：提示先录入/等待生成。

### 风险
- 中高。新页面 + DB 迁移 + 后端路由双写。主要风险：DB v5 迁移（新增表，低风险）、`ContextChat` 扩展向后兼容（小心 3 个现有调用方）、引用跳转 `citationMap` 时序（检索完成后才有点击目标，需在状态里 hold 住当前会话 map）。
- 后端双入口同步（`server.ts` + `api/index.ts`）易漏，需同提交。

---

## 执行顺序
1. **Phase A（Web Worker）→ 提交**。
2. **Phase B（Copilot）→ 提交**。

两 phase 独立，A 是 B 检索的依赖。
