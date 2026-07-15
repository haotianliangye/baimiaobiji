export const meta = {
  name: 'ui-ux-v3-followup',
  description: 'Implement UI/UX v3 follow-up issues (#111-#116) sequentially with checkpoints and read-only verification. Session-bound, no remote operations.',
  phases: [
    { title: '111 设置页结构整理' },
    { title: '112 标签快捷操作菜单' },
    { title: '113 内容卡片折叠与交互恢复' },
    { title: '114 日历弹窗统计口径对齐' },
    { title: '115 Copilot RAG 与历史筛选' },
    { title: '116 随机漫步精简' }
  ]
}

const TASKS = [
  {
    id: 'task-111',
    issue: 'docs/issues/111-settings-page-cleanup.md',
    title: '设置页结构整理：语言入口平铺 + 抽屉毛玻璃 + 标签区收纳',
    prompt: `在 D:\\baimiaobiji 仓库中实现 issue docs/issues/111-settings-page-cleanup.md 与 PRD docs/prd-ui-ux-v3-2026-07-15.md 的需求 2/3/4。\n\n具体改动：\n1. 移除 Settings.tsx 中独立的 data-testid="language-section" 区域。\n2. 在“对话模型”模块上方平铺横向胶囊切换器：中文 / English，切换后立即生效，复用 settingsStore.setLanguage。\n3. 设置抽屉的遮罩层改为毛玻璃透底效果（约 70% 可见后方），保留点击遮罩关闭抽屉。\n4. “所有标签”区块支持点击标题行展开/收起；收起时只显示标题行与图标，展开时显示完整标签列表且内部滚动保留。\n5. “管理标签”入口由文字改为设置图标（Settings2 / SlidersHorizontal），点击仍进入标签设置全屏详情页。\n\n约束：\n- 全局 html/body 必须保持 overflow-hidden + overscroll-behavior-none；所有滚动用局部容器。\n- 图标优先用 lucide-react。\n- 不 push。\n\n验收后必须运行：npm run lint && npm run build && npx vitest run tests/foundation-migration.test.ts。`
  },
  {
    id: 'task-112',
    issue: 'docs/issues/112-tag-quick-actions.md',
    title: '标签快捷操作菜单：置顶、编辑、移除、删除',
    prompt: `在 D:\\baimiaobiji 仓库中实现 issue docs/issues/112-tag-quick-actions.md 与 PRD docs/prd-ui-ux-v3-2026-07-15.md 的需求 5。\n\n具体改动：\n1. 扩展 TagDef schema（src/db/db.ts）与 tags.store.ts，支持 pinned / sort_order / icon 字段持久化。\n2. 设置抽屉的“所有标签”列表中，每个标签右侧显示两个图标按钮：展开/收起子标签的 ChevronDown/ChevronUp，以及 MoreVertical “更多”菜单。\n3. “更多”菜单为弹出式动作菜单，含：置顶、编辑名称和图标、仅移除标签、删除标签和笔记。危险操作使用红色/玫瑰色警示。\n4. 点击菜单外部或滚动时关闭菜单。\n5. 置顶后标签排在列表最前，刷新后仍保持。\n6. “仅移除标签”从所有关联记录中移除该标签但不删除记录，需确认弹窗。\n7. “删除标签和笔记”级联删除标签定义及所有带该标签的记录，需二次确认。\n8. 新增 i18n key：tags.pinTop、tags.editNameAndIcon、tags.removeTagOnly、tags.deleteTagAndNotes。\n\n约束：\n- 全局 html/body 必须保持 overflow-hidden + overscroll-behavior-none。\n- 图标优先用 lucide-react。\n- 不 push。\n\n验收后必须运行：npm run lint && npm run build && npx vitest run tests/foundation-migration.test.ts。`
  },
  {
    id: 'task-113',
    issue: 'docs/issues/113-content-folding-interactions.md',
    title: '内容卡片折叠与交互恢复（拾微 + 回顾）',
    prompt: `在 D:\\baimiaobiji 仓库中实现 issue docs/issues/113-content-folding-interactions.md 与 PRD docs/prd-ui-ux-v3-2026-07-15.md 的需求 1/8。\n\n具体改动：\n1. 拾微页（Record.tsx）与回顾页（Review.tsx）内容卡片：纯文本按渲染行数达到 12 行后进入折叠态；图片、视频、音频、数字摘要块等多媒体不计入 12 行。\n2. 折叠态下文字截断显示省略；多媒体仅保留一行缩略展示，与 MultimediaAttachments 缩略逻辑一致。\n3. 点击折叠态区域展开，点击已展开区域收起；单击与双击通过事件互斥（延迟单击或双击取消延迟）。\n4. 拾微页复用现有 onDoubleClick + handleOpenEditModal 进入编辑弹窗；回顾页恢复 onDoubleClick 进入 inline 编辑（setEditingReviewId + setEditText）。\n5. 移动端恢复 onTouchStart 500ms 长按检测 + onTouchEnd/onTouchMove 清除；桌面端保留 onContextMenu。菜单内容保持一致：复制、编辑、重新生成、删除。\n6. 折叠/展开的单击事件不得与附件区单击冲突；双击编辑仍跳过附件区。\n\n约束：\n- 全局 html/body 必须保持 overflow-hidden + overscroll-behavior-none；所有滚动用局部容器。\n- 性能：折叠态不要预渲染完整 Markdown，可用 line-clamp-12 或最大高度截断。\n- 不 push。\n\n验收后必须运行：npm run lint && npm run build && npx vitest run tests/thoughts.test.ts tests/multimedia.test.ts。`
  },
  {
    id: 'task-114',
    issue: 'docs/issues/114-calendar-stats-alignment.md',
    title: '日历弹窗统计口径对齐数据合并',
    prompt: `在 D:\\baimiaobiji 仓库中实现 issue docs/issues/114-calendar-stats-alignment.md 与 PRD docs/prd-ui-ux-v3-2026-07-15.md 的需求 6。\n\n具体改动：\n1. CalendarHeatmap.tsx 中中间统计项标签由 calendarHeatmap.diary 改为 calendarHeatmap.review，即显示“回顾”。\n2. 中间数量 middleCount 改为统计 daily_reviews 全表记录数（含旧 entry_type='diary' 与 'review'）。\n3. 下方字数统计中对应“回顾”的字数，合并计算旧日记字段 ai_editorial 与旧回顾字段 ai_review 的字数。\n4. 左侧“拾微”与右侧“天”的统计保持不变。\n\n约束：\n- 只改统计文案与合并计算逻辑，不动日历整体布局与滚动行为。\n- 不 push。\n\n验收后必须运行：npm run lint && npm run build && npx vitest run tests/foundation-migration.test.ts。`
  },
  {
    id: 'task-115',
    issue: 'docs/issues/115-copilot-rag-history-filter.md',
    title: 'Copilot RAG 选择器文案对齐与历史页日期筛选',
    prompt: `在 D:\\baimiaobiji 仓库中实现 issue docs/issues/115-copilot-rag-history-filter.md 与 PRD docs/prd-ui-ux-v3-2026-07-15.md 的需求 7。\n\n具体改动：\n1. Copilot.tsx 中 RAG 选择器显示文案改为“识微 / 回顾 / 沉淀 / 洞察”，内部代码字段保持英文标识。\n2. 更新 CopilotRetrievalFilters、CopilotCitation 与 retrieveCopilotContext 中的模块联合类型，移除独立的 diary 分支，将日记与回顾合并到 review 分支。\n3. 检索索引映射：识微(record) → raw_logs；回顾(review) → daily_reviews 全表；沉淀(thoughts) → thoughts；洞察(insight) → mingwu。\n4. 历史页（navView === 'history'）顶部增加一行筛选区，仅保留“全部日期”日期选择器，复用 RAG 页现有日期选择器组件与样式。\n5. 历史列表默认按 updated_at 倒序，日期筛选后按选定范围过滤会话记录。\n6. 新增 i18n key：copilot.moduleShiwu、copilot.moduleHuigu、copilot.moduleChendian、copilot.moduleDongcha。\n\n约束：\n- 类型变更需同步更新类型定义与检索实现，避免前后端断裂。\n- 不 push。\n\n验收后必须运行：npm run lint && npm run build && npx vitest run tests/foundation-migration.test.ts。`
  },
  {
    id: 'task-116',
    issue: 'docs/issues/116-random-walk-simplification.md',
    title: '随机漫步精简与视觉调整',
    prompt: `在 D:\\baimiaobiji 仓库中实现 issue docs/issues/116-random-walk-simplification.md 与 PRD docs/prd-ui-ux-v3-2026-07-15.md 的需求 9。\n\n具体改动：\n1. RandomWalk.tsx 中 DRAW_COUNT 由 3 改为 7。\n2. 移除顶部细栏中的 1/N 计数展示。\n3. 移除顶部灯泡图标 Lightbulb 及其相关提示逻辑。\n4. 将设置图标 Settings2 从当前位置移到原灯泡位置（左上角），点击仍打开数据源/冷却期配置面板，面板展开方向与位置随图标移动而调整。\n5. 降低后方非当前卡片的透明度，避免前后文字重影。\n6. 卡片宽度缩小 1.2 倍，高度保持不变（仍 flex-1 填充可用空间）。\n7. 移除底部操作栏的“已阅”按钮 walk-read。\n8. 剩余 5 个底部按钮（标签、编辑、复制、删除、换一批）调整 icon/文字大小与间距，使整体与缩小后的卡片宽度协调。\n9. 已阅相关的 handleRead、randomWalk.read i18n、已阅状态过滤逻辑可保留在代码中供后续复用，但 UI 上不再展示。\n\n约束：\n- 全局 html/body 必须保持 overflow-hidden + overscroll-behavior-none；随机漫步卡片滚动在局部容器内完成。\n- 图标优先用 lucide-react。\n- 不 push。\n\n验收后必须运行：npm run lint && npm run build && npx vitest run tests/random-walk.test.ts。`
  }
]

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    taskId: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    lintPassed: { type: 'boolean' },
    buildPassed: { type: 'boolean' },
    testsPassed: { type: 'boolean' },
    committed: { type: 'boolean' },
    commitHash: { type: 'string' },
    queueUpdated: { type: 'boolean' },
    notes: { type: 'string' }
  },
  required: ['taskId', 'filesChanged', 'lintPassed', 'buildPassed', 'testsPassed', 'committed', 'queueUpdated', 'notes']
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    taskId: { type: 'string' },
    passed: { type: 'boolean' },
    findings: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' }
  },
  required: ['taskId', 'passed', 'findings', 'notes']
}

function implPrompt(task) {
  return [
    '你是白描笔记 UI/UX 重构 v3 的实施 agent。工作目录 D:/baimiaobiji（git 仓库，分支 main）。',
    '',
    '任务：' + task.id + ' ' + task.title,
    'issue 文件：' + task.issue,
    'PRD：docs/prd-ui-ux-v3-2026-07-15.md',
    '',
    '详细要求：',
    task.prompt,
    '',
    '步骤：',
    '1. 读 issue 文件和 PRD 对应章节，确认 acceptance criteria。',
    '2. 读相关代码文件，理解当前实现。',
    '3. 按 issue 实现改动。',
    '4. 遵守红线：',
    '   - 全局 html/body 必须保持 overflow-hidden + overscroll-behavior-none；新滚动区用局部 overflow-y-auto。',
    '   - 所有新增/修改的中文界面文案写入 src/i18n/zh.ts 和 src/i18n/en.ts，代码里用 t() / useTranslation()，不硬编码中文。',
    '   - 图标优先用 lucide-react；TabBar 维持 @phosphor-icons/react。',
    '   - 复制按钮统一用 src/hooks/useCopyToClipboard.ts。',
    '   - 不 push。',
    '5. 跑 npm run lint && npm run build && issue 要求的 npx vitest run ...。',
    '6. 更新 .claude/runbooks/ui-ux-v3-followup/task-queue.json 中 id="' + task.id + '" 的 status 为 completed，result 写一句摘要。',
    '7. git add -A && git commit -m "feat(' + task.id + '): ' + task.title + '"（末尾加 Co-Authored-By: Claude <noreply@anthropic.com>）。',
    '8. 返回结构化结果。',
    '',
    '注意：只实施本任务范围；不要修改 docs/ 下的 issue/PRD 文档。'
  ].join('\n')
}

function verifyPrompt(task, impl) {
  return [
    '你是白描笔记 UI/UX 重构 v3 的只读验证 agent。工作目录 D:/baimiaobiji。',
    '',
    '任务：验证 ' + task.id + ' ' + task.title + ' 的实施质量。',
    'issue 文件：' + task.issue,
    '',
    '实施者报告改动文件：' + JSON.stringify(impl.filesChanged),
    '',
    '步骤（必须实际执行工具，不要臆测）：',
    '1. 读 issue 文件，列出 acceptance criteria。',
    '2. 读 .claude/runbooks/ui-ux-v3-followup/task-queue.json，确认 id="' + task.id + '" 的 status 为 completed。',
    '3. 对实施者改动的每个文件，用 Grep 搜硬编码中文（排除 // 注释、/* */、console、src/i18n/ 下文件、纯英文、import 语句）。',
    '4. 检查移动端红线：新滚动区是否局部 overflow-y-auto（非 body 滚动）。',
    '5. 跑 npm run lint && npm run build && issue 要求的测试命令。',
    '6. 对照 issue acceptance criteria，核对外部可观察行为（DOM、文案、数量计算、交互）。',
    '7. 返回结构化结果。passed=true 仅当：无剩余硬编码中文 + 无红线违反 + lint/build/测试通过 + acceptance criteria 全满足。',
    '',
    '返回严格 JSON：{ taskId: "' + task.id + '", passed: boolean, findings: string[], notes: string }。未通过时 findings 必须列出具体失败项。'
  ].join('\n')
}

async function readQueueStatuses() {
  const result = await agent(
    '读取 D:/baimiaobiji/.claude/runbooks/ui-ux-v3-followup/task-queue.json，返回每个 task id 的 status 映射。不要修改文件。返回严格 JSON：{ statuses: { "task-111": "pending", ... } }。',
    {
      label: 'read-queue-state',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          statuses: { type: 'object' }
        },
        required: ['statuses']
      }
    }
  )
  return result ? result.statuses : {}
}

async function writeWorkflowState(status, taskId) {
  await agent(
    '将以下内容写入 D:/baimiaobiji/.claude/runbooks/ui-ux-v3-followup/.workflow-state.txt，完全覆盖原文件：\n\n' +
    'current_task_id=' + (taskId || 'none') + '\n' +
    'status=' + status + '\n' +
    'script_path=D:\\\\baimiaobiji\\\\.claude\\\\workflows\\\\ui-ux-v3-followup.js\n',
    { label: 'write-state-' + status + '-' + (taskId || 'none') }
  )
}

const queueStatuses = await readQueueStatuses()
const completedTasks = new Set(
  Object.entries(queueStatuses)
    .filter(([id, status]) => status === 'completed')
    .map(([id]) => id)
)

const results = []
let interrupted = null
let stuckTask = null

for (const task of TASKS) {
  if (completedTasks.has(task.id)) {
    log(task.id + ' 已在 task-queue.json 中标记为 completed，跳过')
    results.push({ task: task.id, title: task.title, passed: true, skipped: true, impl: null, verify: null, retries: 0 })
    continue
  }

  await writeWorkflowState('running', task.id)

  phase(task.title)
  log('开始 ' + task.id + ': ' + task.title)

  let passed = false
  let retries = 0
  let lastFindings = []
  let sameErrorStreak = 0
  let impl = null
  let verify = null

  while (!passed && retries <= 3) {
    const attempt = retries + 1
    log(task.id + ' 实施尝试 ' + attempt + '/4')

    impl = await agent(implPrompt(task), {
      label: '实施:' + task.id + ':' + attempt,
      phase: task.title,
      schema: IMPL_SCHEMA,
      agentType: 'general-purpose'
    })

    if (!impl) {
      log('中断 at 实施 ' + task.id + '（429/终端错误）')
      interrupted = task.id
      break
    }

    log(task.id + ' 实施完成：' + impl.filesChanged.length + ' 文件, lint=' + impl.lintPassed + ', build=' + impl.buildPassed + ', tests=' + impl.testsPassed + ', commit=' + impl.committed)

    verify = await agent(verifyPrompt(task, impl), {
      label: '验证:' + task.id + ':' + attempt,
      phase: task.title,
      schema: VERIFY_SCHEMA,
      agentType: 'general-purpose'
    })

    if (!verify) {
      log('中断 at 验证 ' + task.id + '（429/终端错误）')
      interrupted = task.id
      break
    }

    log(task.id + ' 验证：passed=' + verify.passed + ', findings=' + verify.findings.length)

    if (verify.passed) {
      passed = true
    } else {
      const findingsKey = verify.findings.sort().join('|')
      const lastKey = lastFindings.sort().join('|')
      sameErrorStreak = findingsKey && findingsKey === lastKey ? sameErrorStreak + 1 : 1
      lastFindings = verify.findings

      if (sameErrorStreak >= 3) {
        stuckTask = { task: task.id, findings: verify.findings }
        log(task.id + ' STUCK：同一失败连续 3 次')
        break
      }

      retries++
      if (retries > 3) {
        log(task.id + ' 验证失败，已用完 4 次尝试')
        break
      }
    }
  }

  results.push({
    task: task.id,
    title: task.title,
    passed,
    impl,
    verify,
    retries
  })

  if (interrupted || stuckTask) {
    break
  }

  if (!passed) {
    log(task.id + ' 最终未通过，继续下一任务')
  }
}

const finalStatus = stuckTask ? 'stuck' : (interrupted ? 'interrupted' : 'done')
await writeWorkflowState(finalStatus, interrupted || (stuckTask ? stuckTask.task : null))

log('workflow 结束。已完成 ' + results.filter(r => r.passed).length + '/' + TASKS.length + ' 任务' + (interrupted ? '，中断 at ' + interrupted : '') + (stuckTask ? '，STUCK at ' + stuckTask.task : ''))

return {
  completed: results.filter(r => r.passed).map(r => r.task),
  interrupted,
  stuck: stuckTask,
  results
}
