# UI/UX v3 需求补漏 —— 长时间任务编排手册

> 生成日期：2026-07-15
> 目标：按依赖顺序实现 6 个垂直 slice（issues #111 ~ #116），全部本地完成，不 push。
> 仓库：`D:\baimiaobiji`
> PRD：`docs/prd-ui-ux-v3-2026-07-15.md`
> 父 issue：`docs/issues/110-ui-ux-v3-followup.md`

---

## 1. 推荐层级

**主执行器：Dynamic Workflow（`.claude/workflows/ui-ux-v3-followup.js`）**

理由：
- 涉及 6 个 issue、多文件、多 agent，属于“跨文件/跨模块改造”。
- 用户明确要求 **session 级别**，不需要跨睡眠/重启。
- Dynamic Workflow 支持断点恢复（`resumeFromRunId`）、检查点提交、独立验证 agent，最适合本场景。

**辅助触发：CronCreate（可选）**

如果希望 workflow 中断后自动恢复，可注册一个 session 内 recurring cron（见下方“启动命令”）。该 cron 随 session 结束而消失，不会留下 OS 级任务。

---

## 2. 任务队列

文件：`.claude/runbooks/ui-ux-v3-followup/task-queue.json`

| 顺序 | 任务 ID | Issue | 标题 | 依赖 |
|---|---|---|---|---|
| 1 | `task-111` | #111 | 设置页结构整理：语言入口平铺 + 抽屉毛玻璃 + 标签区收纳 | 无 |
| 2 | `task-112` | #112 | 标签快捷操作菜单：置顶、编辑、移除、删除 | #111 |
| 3 | `task-113` | #113 | 内容卡片折叠与交互恢复（拾微 + 回顾） | 无 |
| 4 | `task-114` | #114 | 日历弹窗统计口径对齐数据合并 | 无 |
| 5 | `task-115` | #115 | Copilot RAG 选择器文案对齐与历史页日期筛选 | 无 |
| 6 | `task-116` | #116 | 随机漫步精简与视觉调整 | 无 |

执行顺序：
- `#111` 必须先完成（为 `#112` 准备设置抽屉/标签区）。
- `#112` 紧随其后（依赖标签区结构）。
- `#113`、`#114`、`#115`、`#116` 理论可并行，但 `#114` 与 `#115` 都会修改 `tests/foundation-migration.test.ts`，为避免冲突，按 `#113` → `#114` → `#115` → `#116` 串行执行。

---

## 3. 失败协议

### 三态判定

| 状态 | 条件 | 处理 |
|---|---|---|
| **RETRY** | 语法/类型/lint/测试断言失败，错误信息明确 | agent 结构化修复 → 重跑验证，最多 3 次 |
| **BLOCKED** | 某任务卡住但其他任务可继续（如某依赖装不上） | 标记为 `failed`，记录原因，继续下一任务 |
| **STUCK** | 同一错误连续 3 次；修复后失败集合不变或变多；需求歧义 | 停止整个 workflow，通知用户 |

### 检查点 + 回滚

每个任务写代码前：

```bash
git add -A
git commit -m "checkpoint: before <task-id>" || true
```

任务验证失败且需要回滚时：

```bash
git reset --hard HEAD~1
```

> 检查点只提交到本地，不 push。

### 独立 evaluator

每个任务完成后，由独立的只读 agent 验证：
- 不修改任何文件。
- 运行对应测试 seam。
- 核对 acceptance criteria（DOM 结构、文案、交互）。
- 输出 `{ passed: boolean, findings: string[] }`。

实施 agent 与验证 agent 分离。

### 429 与配额

- 429 静默处理：workflow 返回 `{ interrupted: true }`，由 CronCreate 看门狗下次再试。
- 不因为 429 通知用户。

---

## 4. 成本护栏

| 项目 | 上限 |
|---|---|
| 总时间 | `max_total_hours: 8` |
| 总 token | `max_tokens: 2_000_000` |
| 单任务 agent 调用 | 最多 20 次 |
| 单任务 RETRY | 最多 3 轮 |
| 全程 STUCK 阈值 | 同一错误连续 3 次 |

任一护栏触发 → workflow 停止，更新 `task-queue.json`，通知用户当前状态。

---

## 5. 启动与恢复

### 首次启动

```text
Workflow({
  scriptPath: "D:\\baimiaobiji\\.claude\\workflows\\ui-ux-v3-followup.js"
})
```

### 中断后恢复（同 session）

```text
Workflow({
  scriptPath: "D:\\baimiaobiji\\.claude\\workflows\\ui-ux-v3-followup.js",
  resumeFromRunId: "<上一次的 runId>"
})
```

`runId` 可在 workflow 返回结果或 `.workflow-state.txt` 中找到。

### Session 内自动看门狗（可选）

```text
CronCreate({
  cron: "13,43 * * * *",
  recurring: true,
  durable: false,
  prompt: "读取 D:\\baimiaobiji\\.claude\\runbooks\\ui-ux-v3-followup\\task-queue.json 与 .workflow-state.txt。若全部完成 → CronDelete 自己并通知用户。若当前任务运行中 → 跳过。若当前任务已完成 → Workflow 恢复。若下一个任务 pending → 启动下一个任务。429 静默；不 push；不询问用户。"
})
```

该 cron 仅存在于当前 session，Claude 关闭后自动消失。

---

## 6. 产物清单

| 文件 | 说明 |
|---|---|
| `.claude/runbooks/ui-ux-v3-followup/runbook.md` | 本手册 |
| `.claude/runbooks/ui-ux-v3-followup/task-queue.json` | 任务队列与状态 |
| `.claude/workflows/ui-ux-v3-followup.js` | Dynamic Workflow 执行脚本 |
| `.claude/runbooks/ui-ux-v3-followup/.workflow-state.txt` | 运行时由 workflow 写入当前任务/runId |

---

## 7. 停止条件

workflow 在以下任一条件触发时停止并通知用户：
1. 全部 6 个任务状态为 `completed`。
2. 某任务被判定为 `STUCK`（连续 3 次同类错误或需求歧义）。
3. 成本护栏触发（时间/token/agent 数超限）。
4. 用户手动停止。

---

## 8. 不 Push 铁律

- 所有检查点 commit 只保留在本地。
- 任何 agent 不得执行 `git push`。
- 阶段收尾时可提醒用户“本地有 X 个未 push commit”，但不自动 push。

---

## 9. 监控方式

- 实时：`/workflows` 查看 workflow 进度。
- 状态：读取 `task-queue.json` 或 `.workflow-state.txt`。
- 日志：每个任务完成后在 `task-queue.json` 的 `result` 字段留摘要。
