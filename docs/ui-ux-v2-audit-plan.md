# UI/UX v2 核对补漏 4 阶段流水线（总看门狗驱动）

> 用户授权全自动执行（用户睡觉）。4 阶段计划固定在本文件，**不依赖主循环 context 记忆**。
> 总看门狗（recurring Cron）每 30 分钟读本文件，按「当前阶段」执行 + 推进。
> 全程**不通知用户**（醒来看 git log + 文档）。429/分类器静默。**不 push**。

## 当前状态

- 当前阶段: 4 done（流水线全部完成 ✅）
- 阶段0: 109 完成（commit c6fdafe），9 issue 全实施
- 阶段1: 核对完成（wp6ctpayk，9/9 agent，0 429，13 gaps）
- 阶段2: 遗漏文档 docs/ui-ux-v2-gaps-audit-2026-07-15.md 创建（13 gaps：5 真没做 + 6 形式不符 + 2 标记）
- 阶段3: 补漏完成（w60getf9f，9/9 issue，18 agent，11 gaps 补完，0 429）
- 阶段4: 验证通过（9 fix commit + lint 通过 + grep 抽查 G1/G10 确认）+ memory 更新 + 总看门狗自删
- audit_run_id: wf_e66b3578-89d
- fix_run_id: wf_353f92b3-701
- 遗漏文档: docs/ui-ux-v2-gaps-audit-2026-07-15.md

## 阶段 0：等 109 完成

**完成条件**：git log 有 109 commit（标题含 settings/设置页/issue 109 之一）。

**执行**：
- 109 完成 -> CronDelete 旧看门狗 96411439 -> 状态推进阶段 1
- 109 未完成 + TaskOutput(w409t0xss) running -> 跳过本轮
- 109 未完成 + TaskOutput(w409t0xss) completed(429) -> Workflow(scriptPath=docs/ui-ux-v2-implement.workflow.js, resumeFromRunId=wf_8c3202a2-0bf) resume，更新状态 task_id

## 阶段 1：核对 workflow（四层映射找遗漏）

**执行**：
- 若 audit_run_id 空 -> 创建 docs/ui-ux-v2-audit.workflow.js + Workflow 启动 -> 状态写回 audit_run_id/audit_task_id
- 若 audit_run_id 有 -> TaskOutput(audit_task_id) 查：running 跳过；completed -> 读 result：
  - interrupted=false（results 无 null）-> 全完成，推进阶段 2
  - interrupted=true（有 agent 429 返回 null）-> Workflow(scriptPath=docs/ui-ux-v2-audit.workflow.js, resumeFromRunId=audit_run_id) resume（走缓存，已完成 agent 不重跑），更新 audit_task_id

**核对 workflow 脚本设计**（创建时按此）：
- 9 agent **并行** parallel()（每需求一个，只读不冲突），agentType general-purpose
- 每 agent 核对一条需求的**四层映射**：需求原文(requirements-merged) -> PRD User Story(prd-ui-ux-2026-07-14) -> issue(docs/issues/10x) -> 代码实现(实际文件)
- 每 agent schema 输出：{需求编号, userStories:[{us编号, inPRD:bool, inIssue:bool, inCode:bool, status, note}], gaps:[{条目, 来源原文, 应进issue, 状态, 说明}]}
- status 枚举：`真没做` / `形式不符` / `需求没写但做了` / `已做`
- 9 需求编号对应 issue：101统计/102随机漫步/103编辑弹窗/104双击/105明悟/106顶部栏/107全屏预览/108附件面板/109设置页
- 输入文档：docs/requirements-merged-2026-07-14.md, docs/prd-ui-ux-2026-07-14.md, docs/issues/101-109-*.md
- **429 处理（关键）**：parallel() 的 agent() 撞 429 返回 null，但 parallel 是 barrier 不 break，会等所有 thunk 完成后才返回（含 null）。脚本必须检测 null：
  - `const results = await parallel(ISSUES.map(issue => () => agent(auditPrompt(issue), {schema, agentType:'general-purpose'})))`
  - `const interrupted = results.some(r => !r)`  // 有 null = 有 429
  - `return {results: results.filter(Boolean), interrupted, completed: !interrupted}`
  - interrupted=true 时总看门狗 resume（resumeFromRunId 走缓存，已成功 agent 不重跑，只重跑 null 的）

## 阶段 2：整理遗漏文档

**执行**：
- 读阶段 1 journal.jsonl（C:\Users\haoti\.claude\projects\D--baimiaobiji\01be79cf-a95c-48bf-b61a-e7640afa03f1\subagents\workflows\<audit_run_id>\journal.jsonl）取所有 agent 结果
- 整理所有 status≠已做 的条目到 docs/ui-ux-v2-gaps-audit-2026-07-15.md
- 每条：**来源原文 + 应进 issue + 状态(真没做/形式不符/需求没写但做了) + 说明**
- 按需求分组，编号 G1/G2/...
- 推进阶段 3

**完成条件**：遗漏文档创建且含所有遗漏条目（可为空，空则直接阶段4）

## 阶段 3：补漏 workflow（对照代码确认 + 写代码补齐）

**执行**：
- 若 fix_run_id 空 -> 创建 docs/ui-ux-v2-fix.workflow.js + Workflow 启动 -> 状态写回 fix_run_id/fix_task_id
- 若 fix_run_id 有 -> TaskOutput(fix_task_id) 查：running 跳过；completed -> 推进阶段 4；429 break -> Workflow resume

**补漏 workflow 脚本设计**（创建时按此）：
- 基于 docs/ui-ux-v2-gaps-audit-2026-07-15.md 的遗漏条目
- **串行**（共享文件冲突：Layout/Settings/settings.store/Record/Thoughts）
- 每条遗漏一个 agent（或按 issue 分组），两阶段（实施+自检）
- 每 agent **先对照代码确认**「真没做」vs「形式不符/需求没写」：真没做 -> 实现；形式不符 -> 修正；需求没写但做了 -> 标记跳过
- 红线：i18n 不硬编码(zh.ts+en.ts) / 移动端局部 overflow / settings.store migrate v12 / 图标库 / 复制按钮 hook / **不 push**
- 实施 agent 内 grep 自查 + 独立自检 agent Grep 实证
- npm run lint 验证 + git commit（中文 + Co-Authored-By，不 push）
- 429 break -> return {interrupted} 供总看门狗 resume

## 阶段 4：验证 + 收尾

**执行**：
- git log 确认补漏 commit（标题含 fix/补漏）
- 跑验证：再启动一轮核对 workflow（复用阶段1脚本，新 run）确认遗漏清零。**429 处理同阶段1**（interrupted=true -> Workflow resume 走缓存重跑 null agent）；或 grep 抽查关键硬编码（轻量，避开 workflow 429 风险）
- 更新 memory：C:\Users\haoti\.claude\projects\D--baimiaobiji\memory\ui-ux-restructure-orchestration.md（v2 实施 + 核对补漏完成）
- 状态 done + CronList 找总看门狗 + CronDelete

## 红线（全阶段）
- 不 push（用户铁律）
- i18n 不硬编码（补漏阶段）
- 移动端 overflow
- settings.store migrate v12
- 429/分类器静默，不通知用户
- 每步用 Edit 更新本文件「## 当前状态」
