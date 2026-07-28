# CURRENT_STATE — 断点恢复专用

> **场景**：你开了一个新窗口/重新打开了 Trae，想继续工作。
> **用法**：先读这个文件，了解当前进度，再读对应 issue 文件开工。

---

## 当前进度（截至 2026-07-28 P0 + v3 完成 + v0.3.x hotfix + 洞察 5 槽多选 v0.4.0 + 沉淀手动标签 v0.5.0 + 洞察自动生成 v0.6.0）

| # | 阶段 | 状态 |
|---|------|------|
| P0 (#001-#008) | ✅ 全部合并（v0.1.0 → v0.3.0）| backend infra（fetch / backoff / db / 备份 / 错误日志 / 存储压力 / 引用验证 / 转写过滤）|
| v1 UI (#001-#010) | ✅ 全部 done（功能已实现并合并）| 9 个 seam 拆分 |
| v3 UI (#100-#116) | ✅ 全部 done（功能已实现并合并）| 17 个 UI/UX 重构需求 |
| v0.3.x hotfix | ✅ 全部合并（见下方）| 设置重构 + 沉淀/洞察改造 + 标签系统 + 随机漫步升级 + 热力图统一 |
| v0.4.0 洞察 5 槽 | ✅ 全部合并（commits 67c9445/b559a6c/a872f6c/26304b8/4878850）| 详见下方「v0.4.0」 |
| v0.5.0 沉淀手动标签 | ✅ 全部合并（commit 027ec6e/64aec59）| ThoughtCard 手动加/删标签 |
| v0.6.0 洞察自动生成 | ✅ 全部合并（commits 678883c/aa1b747/c67a8dc）| 周报/月报独立开关 + 静默跳过 |
| 测试清理 | ✅ 6 个失效测试已删除 | 见下方「清理记录」|

| Issue | 标题 | 状态 | 分支 | 验收 |
|-------|------|------|------|------|
| #001 | 版本号与发布纪律 | ✅ 已合并 (commit `8fb380f`, tag `v0.1.0`) | feat/issue-001-versioning | bundle 含 `b6="0.1.0"` |
| #002 | 服务端超时 + 降级 | ✅ 已合并 (commit `8b5f671`, tag `v0.1.1`) | feat/issue-002-server-timeout | 5/5 fetch + 8/8 health 通过 |
| #003 | 任务队列指数退避 | ✅ 已合并 (commit `f08cef4`, tag `v0.1.2`) | feat/issue-003-backoff | 8/8 backoff 测试通过 |
| #004 | 转写幻觉检测升级 | ✅ 已合并 (commit `37a66bc`, tag `v0.2.0`) | feat/issue-004-hallucination-filters | 16/16 filter 测试通过 + db v15 |
| #005 | 引用回溯验证 | ✅ 已合并 (commit `586ae56`, tag `v0.2.1`) | feat/issue-005-cite-verification | 10/10 verify 测试通过 + 100KB 2ms |
| #006 | 错误日志环形缓冲 | ✅ 已合并 (commit `98047e7`, tag `v0.2.2`) | feat/issue-006-error-buffer | 10/10 buffer 测试通过 + 累积版本号修正 |
| #007 | 存储压力可视化 | ✅ 已合并 (commit `1b8c857`, tag `v0.2.3`) | feat/issue-007-storage-pressure | 13/13 pressure 测试通过 |
| #008 | 本地自动备份 | ✅ 已合并 (commit `30b110f`, tag `v0.3.0`) | feat/issue-008-auto-backup | 10/10 backup 测试通过 + db v16 |
| hotfix-2026-07-27 | TopBar 浅色化 + 全应用字体统一为系统默认(Logo LXGW WenKai) + 沉淀卡片字号对齐到 15.5px | ✅ 已合并 (commit `ea3eade`, tag `v0.3.1`) | - | UI 视觉一致性;沉淀/记录/回顾/洞察卡片正文均为 15.5px + 系统默认 sans |

## v0.3.x hotfix（2026-07-23 → 2026-07-28，按主题分组）

| 主题 | commit | 说明 |
|------|--------|------|
| **设置页重构**（URL 驱动 + 桌面分栏 + 移动抽屉） | `8d0cdc4` `746f17e` `ea2a0fb` `ac01333` | `/settings` 嵌套在 Layout 下，drawer/detail 由 URL `?view=` 驱动；桌面端左右分栏常驻，移动端保留滑出抽屉；`[≡]` 在设置内返回首页，`[←]` 回上一页；**4 个默认 prompt（日记/回顾/明悟/洞察）解锁可编辑** |
| **沉淀板块重构**（取消瀑布流 + 时间线 + 顶部日期导航 + 热力图） | `b87f774` `3da1213` `3e28956` | 编辑弹窗对齐记录页样式；移除瀑布流模式（统一时间线）；时间线分组头移到顶部 header（与记录/回顾一致），点击日期打开热力图；过滤模式由 URL `?date=` 显式驱动（默认全量） |
| **热力图区段感知** | `3e28956` `5527f44` | `CalendarHeatmap` 新增 `HeatmapSection='thoughts'`；70 天方格按各区段自身数据源着色（record→raw_logs / review→daily_reviews / thoughts→thoughts），强度阈值分档 |
| **洞察板块改造**（mingwu→insight 命名 + 取消自动打标签） | `d06fbe7` `06ae2dc` `8998fe1` | 内部字段从 `mingwu*` 重命名为 `insight*`；胶囊 dropdown 改用 portal 定位避免裁剪；**取消 AI 自动打标签**，改为用户手动添加（参照 Review.tsx 手动标签 UI） |
| **标签系统**（TagChip + TagAggregation 路由 + 标签管理 UI） | `d61405d` `beee170` `bfa85b1` | 新增 `TagChip` 组件（命名导出）；新增 `/tag` 路由（标签聚合页）+ Layout 胶囊入口；drawer 标签列表 + 记录页标签用 TagChip 渲染 |
| **随机漫步升级**（Footprints 图标 + 15.5px 富文本 + 双击精确定位） | `5f0eae1` `11f9f49` `3acd84a` | TabBar 图标换 Footprints；操作栏重排（删除移到最左减少误触）；卡片字号升 15.5px + 富文本渲染（DocumentView / VerifiedMarkdown）；双击跳转精确到对应页 + `?{recordId|reviewId|thoughtId|insightId}` 高亮 2s |
| **版本号自动 bump** | `7dd28f7` | `sync-version.js` 自动跑 → 0.3.1 → 0.3.2（patch）→ 0.3.3 |

## v0.4.0（2026-07-28 — 洞察 5 槽多选 prompt，与回顾一致）

**核心变更**：洞察页的「生成洞察」按钮现在会弹出 5 槽多选浮层（与回顾完全一致），用户可选择 1-5 个 prompt（明悟/洞察/自定义 1/2/3），每个被选中的槽独立生成一张 Insight 卡片。改造范围覆盖后端 API、客户端 store、UI 浮层、数据模型、E2E 测试。

| 步骤 | commit | 说明 |
|------|--------|------|
| C1 服务端 API 升级 | `67c9445` | `/api/generate-insight` 接受 `settings.prompts[]` 数组循环生成；抽 3 个 helper（buildInsightContext / runInsightOne / runInsightSummary）消除双报告路径的重复；旧请求（无 prompts[]）保留双报告路径向后兼容；`server.ts` 与 `api/index.ts` 1:1 同步 |
| C2 客户端 store + 类型放宽 | `b559a6c` | `useMingwuStore.generateMingwu` 按 `selectedIndices` 循环落库 1-5 张卡；`regenerateMingwu` 用 `oldInsight.prompt_index` 单槽重生成（比旧实现省一半 LLM）；`Insight.insight_type` 类型放宽为 `'mingwu' \| 'insight' \| 'custom'`（旧值仍合法） |
| C3 抽取共享浮层组件 | `a872f6c` | 新增 `src/lib/popover.ts`（calcPopoverTop / clampPopoverLeft）+ `src/components/MultiSlotPromptPopover.tsx`；改造 Review.tsx 复用，原内联 JSX 删除；视觉行为零变化 |
| C4 Insights 页接入 | `26304b8` | 浮层状态机 + 5 槽 toggle（至少保留 1 项）；按钮文案动态显示「生成 N 篇洞察」；InsightCard 徽章三态（mingwu/insight/custom，自定义用 emerald 色）；RandomWalk 三态 fallback；i18n 新增 3 个 key（insight.selectTemplate / generateNInsights / custom） |
| C5 E2E 测试更新 | `4878850` | `tests/insight.test.ts` mock 改造（按 prompts[] 动态返回 results[]）；交互流改走浮层；新增 7 条 5 槽断言（A0/D1-D7） |
| C6 版本号 | 见下条 commit | `0.3.3 → 0.4.0`（minor：新功能 + insight_type schema 变化） |

**风险与边界**：
- API 调用次数：默认 `[0,1]` 行为不变（1 fetch = 2 LLM）；用户主动选更多槽时变慢（5 槽约 30s）。服务端循环内 `await sleep(3000)` 防限流。
- 旧 Insight 卡兼容：insight_type 放宽到三态，旧值仍合法，徽章 / RandomWalk 三态 fallback 全覆盖。
- Regenerate 旧卡（无 prompt_index）：fallback 链 `prompt_index` → `prompt_name` 反查 → `insight_type` 推断，再降级到 slot 0。
- 自动队列未扩展：明悟/洞察按时间范围（不是按日），不在本次范围。
- `content_doc` 兼容未做：peer agent 提到 `buildMingwuPayload` 只读 `l.content` 不读 `content_doc`，列为 follow-up。
- 标签：本次不引入新版本号（CLAUDE.md minor 规则：新功能 + schema 变化）

## v0.5.0（2026-07-28 — 沉淀页手动标签编辑）

**核心变更**：Thoughts 卡片支持手动加/删标签（与 Insights/Review 手动标签同款 UI）。store 新增 `mergeThoughtTagsPreservingManual` 纯函数 seam，编辑正文时把旧正文解析集外的旧标签视为手动保留，避免覆盖用户手动加的 chip。

| commit | 说明 |
|--------|------|
| `027ec6e` | ThoughtCard 新增 chip + 「+ 添加标签」同框 UI；store seam 拆分；tests +28 覆盖；标签行 pl-0 左对齐 |
| 补 tag | v0.3.2 / v0.3.3 / v0.4.0 三个历史版本补打完毕（详见下方）|

## v0.3.2 / v0.3.3 / v0.4.0 补 tag 记录（2026-07-28）

此前 sync-version.js 自动 bump 之后未执行 `git tag`，CLAUDE.md 「版本号规则」要求每个合并主分支的版本都打 tag。本次补打：

| tag | commit | 说明 |
|-----|--------|------|
| `v0.3.2` | `7dd28f7` | chore: bump version 0.3.1 → 0.3.2（patch）|
| `v0.3.3` | `d06fbe7` | refactor(internal): rename mingwu → insight（顺手 0.3.2 → 0.3.3）|
| `v0.4.0` | `1c73fea` | chore(release): v0.4.0 — 洞察 5 槽多选 |

**今后规则建议**：`chore(release)` commit + `git tag v<version>` 在 commit 后立刻同次 push 走完（一次性命令即可），避免再次漂移。

## v0.6.0（2026-07-28 — 洞察周报/月报自动生成）

**核心变更**：洞察模块新增按周/按月自动生成能力（独立于回顾模块按日自动生成）。

| 步骤 | commit | 说明 |
|------|--------|------|
| C1 Settings + Dexie | `678883c` | settings.store 新增 4 字段（insightAutoGenWeeklyEnabled / insightAutoGenMonthlyEnabled / lastInsightWeeklyRun / lastInsightMonthlyRun），默认 false + 0；zustand persist v12 → v13；Dexie v18 → v19，insights 新增 [range_type+start_date+end_date] 复合索引 |
| C2 app.store 调度 | `aa1b747` | AutoGenTask.type 扩展为 'review' \| 'insight-weekly' \| 'insight-monthly'；新增 checkAndGenerateScheduledInsights（周一 00:01 / 月 1 号 00:01 锚点）；processNextQueueTask 按 type 分发；新增 autoGeneratedInsightNotification + clear；复用现有 retry/backoff 逻辑 |
| C3 Layout + Settings UI | `c67a8dc` | Layout 新增 useEffect 触发调度；新增 🔮 洞察 Toast（mysteria 渐变）；Settings 新增「🔮 洞察自动整理」section，2 个 checkbox 开关（testid: insight-auto-gen-{weekly,monthly}-checkbox）；i18n 新增 4 key |
| C4 版本号 | 见下条 commit | 0.5.0 → 0.6.0（minor：新功能 + Dexie v19 schema + settings 字段新增） |

**关键设计决策**：
- 调度方式：复用现有 AutoGenTask 队列 + Layout 顶部 chip + 保留两个独立时间戳（lastInsight{Weekly,Monthly}Run）做节流
- 用户开关：两个独立开关（周报 / 月报），默认 false（避免一开应用就烧 token）
- 无数据时：静默跳过，标记完成（更新 lastRun）；不弹 Toast，不重试该周期
- 去重：db.insights 用 [range_type+start_date+end_date] 复合索引判该周期是否已生成

**触发条件**（每周一）：
- `insightAutoGenWeeklyEnabled === true`
- `now >= 本周一 00:01`
- `lastInsightWeeklyRun < 本周一 00:01`（上次未跑过）
- 时间范围：上周一 00:00 ~ 上周日 23:59:59.999

**触发条件**（每月 1 号）：
- `insightAutoGenMonthlyEnabled === true`
- `now >= 本月 1 号 00:01`
- `lastInsightMonthlyRun < 本月 1 号 00:01`
- 时间范围：上月 1 号 ~ 上月末 23:59:59.999

**风险与边界**：
- 首次安装用户：默认 lastRun = 0 + 开关默认 false → 不会自动烧 token
- PWA 长时间未开：错过的周/月不会被补跑（每次只判「最近一个」），与「每周一/每月 1 号跑一次」语义一致
- API 错误：复用现有 retry 逻辑（4xx 不重试 / 5xx 最多 5 次 / 指数退避）
- 跨类型日期编码：AutoGenTask.dateStr 在 review 是 'YYYY-MM-DD'；insight-* 是 'week:YYYY-MM-DD..YYYY-MM-DD' 编码，避免混淆
- 每次 Layout 挂载都跑一次调度函数；触发条件命中才入队，否则只跑 initQueue + processNextQueueTask（推进现有任务）
- 完成任务后（成功 / 静默跳过）都会更新 lastRun，下次 Layout 挂载不再触发同一周期

## 🎉 P0 全部完成 (8/8)

P0 阶段所有 issue 已合并。端到端回归测试 + v3 失效测试清理已完成。

## P1 阶段（2026-07-23 启动）

P1 = 纯后端健壮工作（**0 新产品功能**），按价值/风险排序：

| # | Issue | 状态 | 分支 | 验收 |
|---|-------|------|------|------|
| P1-001 (MoN-7) | 测试接 CI | 🚧 已 commit 待 push | feat/p1-001-test-ci | .github/workflows/test.yml + 16 测试自动跑 |
| P1-002 (MoN-8) | 健康检查端点 | ⏳ 待开始 | — | /api/health 扩 + 监控 |
| P1-003 (ADR-0003) | API Key 真隔离 | ⏳ 待开始 | — | localStorage → IndexedDB |
| P1-004 (ADR-0004) | 长期记忆 facts 表 | ⏳ 待开始 | — | v17 schema + 简单 CRUD |

P1-001 当前阻塞：**GitHub PAT 缺 `workflow` scope**（push `.github/workflows/test.yml` 被拒）。需用户手动在 GitHub Web UI 启用 workflow 写入权限（Settings → Actions → General → Workflow permissions）。修好后 `git push` 即可。进入 P1。

**图例**：⏳ 待开始 / 🚧 进行中 / ✅ 已合并 / ❌ 已回滚

## 下一步动作

**如果你是新 session 接手，从这里开始**：

1. 读这个文件（CURRENT_STATE.md，了解当前进度 + 硬约束）
2. 检查上方进度表，找到第一个 ⏳ 的 issue
3. 读 `docs/issues/p0/NNN-xxx.md` 对应文件
4. 切分支：`git checkout -b feat/issue-NNN-<short-name>`
5. 跑 TDD 流程：`red → green → refactor → review → commit`

## 跨 issue 的硬约束（不要破坏）

### Schema 迁移顺序
- `#004` → db version 15（新增 `settings_kv` 表）
- `#008` → db version 16（新增 `backups` 表）
- **不能并行或倒序**，否则迁移冲突
- 注：原 spec 写 v13→v14，但 v14 已被 mingwu→insights 占用，故 #004 取 v15

### 渲染约定
- `#005` 完成后，所有 Markdown 渲染前必经 `verifyCitations`
- 新写页面时**默认**集成此约定，用 `<VerifiedMarkdown>` 而不是裸 `<ReactMarkdown>`
- 严禁绕过：LLM 编造的引用在 UI 不可见会误导用户

### 版本号
- `#001` 起 `0.1.0`
- `#004` 后 `0.2.0`（schema 变更 = minor）
- `#008` 后 `0.3.0`（schema 变更 = minor）
- 其余 patch bump

## 已建立的约定（Issue 实施中沉淀）

### src/lib/ 模块组织
- 纯函数模块放 `src/lib/<name>.ts`，零依赖、可独立测试
- 单测放 `tests/<name>.test.ts`，npx tsx 直接跑
- 涉及 IndexedDB 的模块要分两层：纯函数（againstIds）+ 包装层（查 db）
  - 例：`citationVerify.verifyCitationsAgainstIds(pure) + verifyCitations(wrapper)`
  - 例：`hallucinationFilter.matchPattern(pure) + db persistence(wrapper)`

### 后端 fetch 调用
- 所有外网 fetch 必走 `fetchWithTimeout`（Issue #002 引入）
- 按任务分档：embedding 15s / tts 30s / transcribe 60s / llm 45s
- 任何新增 /api/* 端点必读 `FETCH_TIMEOUTS`

### 任务队列重试
- 用 `getBackoffMs(retryCount)` 替代固定延时（Issue #003 引入）
- 用 `isRetryableError(err)` 区分 4xx（不重试）和 5xx（重试）
- 4xx 直接从队列移除，避免无限循环

### 客户端 settings 持久化
- 用 `db.settings_kv` 通用 KV 表（Issue #004 引入）
- key 命名约定：`'<domain>.<subKey>'`（如 `'transcription.hallucinationPatterns'`）
- value 字段存 `{ data, updated_at }` 结构
- 首次访问懒写入默认（避免 upgrade 长事务）

### 错误诊断
- 用 `src/lib/errorBuffer.ts`（Issue #006 引入）
- 内存 100 条 FIFO，不持久化（隐私优先）
- 自定义 JSON replacer 显式提取 Error.name/message/stack
- Settings → About tab 有 ErrorInspector 面板（不需要隐藏入口）
- 仍走 console.error（不破坏现有调试路径）

### 包版本号管理
- package.json 的 version 必须随每个 git tag 同步更新
- Issue #006 累积修正 0.1.0 → 0.2.2 的漂移（前 5 个 issue 没 bump）
- vite.config.ts 通过 `import pkg` 注入 VITE_APP_VERSION 到 bundle

### 存储压力检测
- 用 `src/lib/storagePressure.ts`（Issue #007 引入）
- 4 档判定：ok(<0.7) / warning(0.7-0.85) / critical(0.85-0.95) / danger(≥0.95)
- `src/hooks/useStorageMonitor.ts` 5 分钟轮询
- Settings 数据管理 tab 显示进度条（不挂全局 Toast — 改常驻）
- 故意不复用 `src/lib/storage.ts` 的 StorageEstimateInfo（不同维度）

## 已知的坑（来自 Karpathy 评估）

### issue #004 转写黑名单外置
- 风险：默认 pattern 缺失导致转写被错杀
- 缓解：保留旧硬编码逻辑作 fallback，pattern 为空时回退

### issue #005 引用回溯验证
- 风险：长日记几千引用导致性能问题
- 缓解：批量查询 + 100KB 实测 2ms
- 替代 path：`<VerifiedMarkdown>` 而非 `<ReactMarkdown>`

### issue #008 自动备份
- 风险：IndexedDB 存储压力加剧
- 缓解：backup 不带 attachments（音频 Blob 太大） + 自动 prune

## 跑 issue 的标准流程（Matt `/implement`）

每个 issue 一个 session：

```
1. 读 docs/issues/p0/NNN-xxx.md（5分钟）
2. 切分支
3. 写测试（red）—— 至少 1 个核心场景
4. 写实现（green）
5. 重构
6. /code-review 跑两轴审查
7. 修复 review 发现的问题
8. 跑 npm run lint && npm test && npm run build
9. git add + commit + push
10. 合并 main + 删分支
11. 如果是 minor 版本，git tag v<version>
12. 更新本文档进度表
```

## 不要做的事

- ❌ 跨 issue 写代码改动（一个 session 只做一个 issue）
- ❌ 跳过 TDD 直接写实现
- ❌ 把 schema 变更放在 minor version 之外（db version 必须跟 package.json version 同步）
- ❌ 在 main 分支直接改代码

## 进度更新模板

完成一个 issue 后，编辑本文件进度表对应行：
- ⏳ → 🚧：开始时改
- 🚧 → ✅：合并后改（带合并 commit SHA）
- 添加 `git tag v<version>` 备注

## 紧急恢复

如果完全不知道进度：
```bash
git log --oneline -20        # 看最近 20 个 commit
git branch -a                # 看所有分支
git tag -l                   # 看所有 tag
```

然后回头更新本文件。