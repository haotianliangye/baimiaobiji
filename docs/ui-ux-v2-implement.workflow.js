export const meta = {
  name: 'ui-ux-v2-implement',
  description: '基于 9 issues (101-109) 串行实施 UI/UX 重构 v2，每 issue 实施+自检两阶段，429 break 供主循环 resume',
  phases: [
    {title: '101 统计小字下移'},
    {title: '102 随机漫步'},
    {title: '103 编辑弹窗'},
    {title: '104 双击编辑'},
    {title: '105 明悟图标'},
    {title: '106 顶部栏'},
    {title: '107 全屏预览'},
    {title: '108 附件面板'},
    {title: '109 设置页'},
  ]
}

const ISSUES = [
  {id: 101, title: '统计小字下移与统一', path: 'docs/issues/101-stats-relocate.md', name: '101 统计小字下移'},
  {id: 102, title: '随机漫步屏幕自适应', path: 'docs/issues/102-random-walk-adaptive.md', name: '102 随机漫步'},
  {id: 103, title: '碎屑编辑弹窗多媒体化', path: 'docs/issues/103-record-edit-modal.md', name: '103 编辑弹窗'},
  {id: 104, title: '碎屑/回顾双击编辑', path: 'docs/issues/104-double-click-edit.md', name: '104 双击编辑'},
  {id: 105, title: '明悟 Tab 图标改 Sun', path: 'docs/issues/105-mingwu-sun-icon.md', name: '105 明悟图标'},
  {id: 106, title: '顶部标题栏重构', path: 'docs/issues/106-header-restructure.md', name: '106 顶部栏'},
  {id: 107, title: '图片/视频全屏预览', path: 'docs/issues/107-media-fullscreen-preview.md', name: '107 全屏预览'},
  {id: 108, title: '碎屑附件上传面板', path: 'docs/issues/108-attachment-panel.md', name: '108 附件面板'},
  {id: 109, title: '设置页重构', path: 'docs/issues/109-settings-restructure.md', name: '109 设置页'},
]

const IMPL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    issue: {type: 'string'},
    filesChanged: {type: 'array', items: {type: 'string'}},
    userStoriesImplemented: {type: 'array', items: {type: 'string'}},
    i18nSelfCheck: {
      type: 'object', additionalProperties: false,
      properties: {
        hardcodedFound: {type: 'boolean'},
        hardcodedFixed: {type: 'boolean'},
        details: {type: 'string'}
      },
      required: ['hardcodedFound', 'hardcodedFixed', 'details']
    },
    migrateApplied: {type: 'string'},
    lintPassed: {type: 'boolean'},
    committed: {type: 'boolean'},
    commitHash: {type: 'string'},
    notes: {type: 'string'}
  },
  required: ['issue', 'filesChanged', 'userStoriesImplemented', 'i18nSelfCheck', 'lintPassed', 'committed', 'notes']
}

const CHECK_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    issue: {type: 'string'},
    passed: {type: 'boolean'},
    hardcodedRemaining: {type: 'array', items: {type: 'string'}},
    hardcodedFixedByChecker: {type: 'number'},
    redlineViolations: {type: 'array', items: {type: 'string'}},
    migrateOk: {type: 'boolean'},
    userStoriesMissing: {type: 'array', items: {type: 'string'}},
    committed: {type: 'boolean'},
    notes: {type: 'string'}
  },
  required: ['issue', 'passed', 'hardcodedRemaining', 'redlineViolations', 'userStoriesMissing', 'notes']
}

function implPrompt(issue) {
  return [
    '你是白描笔记 UI/UX 重构 v2 的实施 agent。工作目录 D:/baimiaobiji（git 仓库，分支 main）。',
    '',
    '任务：实施 issue ' + issue.id + ' ' + issue.title,
    '',
    '步骤：',
    '1. 读 issue 文档: ' + issue.path,
    '2. 读 issue 指定的相关代码文件。可参考 PRD: docs/prd-ui-ux-2026-07-14.md',
    '3. 严格按 issue 的 Solution + Implementation Decisions + User Stories 实施',
    '4. 红线（必须遵守）：',
    '   - i18n：所有新增/修改的中文界面文案必须写入 src/i18n/zh.ts 和 src/i18n/en.ts，代码里用 t() 或 useTranslation() 或 translate()，绝不硬编码中文。已存在的 key 可复用。',
    '   - 移动端：新滚动区用局部 overflow-y-auto 容器，不依赖 body 滚动',
    '   - settings.store.ts：如新增/改设置项，migrate 版本 v11 -> v12（version 字段 + migrate 函数）',
    '   - 图标：lucide-react 或 @phosphor-icons/react（TabBar 用 phosphor）',
    '   - 复制按钮：src/hooks/useCopyToClipboard.ts',
    '5. 实施后自查：用 Grep 搜你改动的文件里的硬编码中文（排除 // 注释、/* */、console、src/i18n/ 文件本身、纯英文、import 语句）。发现则修复（移到 i18n）。',
    '6. 跑 npm run lint（tsc --noEmit）验证。失败则修复后重跑。',
    '7. git add 相关文件 + git commit（中文 message，末尾 Co-Authored-By: Claude <noreply@anthropic.com>）。不要 push。',
    '8. 返回结构化结果。',
    '',
    '注意：',
    '- 只实施本 issue 范围，不碰其他 issue 的功能（边界见 issue 文档）。',
    '- 如 issue 推翻之前 Seam 实现（如 109 推翻 Seam 2），以新 issue 为准。',
    '- 不要修改 docs/ 下的 issue/PRD 文档。'
  ].join('\n')
}

function checkPrompt(issue, impl) {
  return [
    '你是白描笔记 UI/UX 重构 v2 的自检 agent。工作目录 D:/baimiaobiji。',
    '',
    '任务：验证 issue ' + issue.id + ' ' + issue.title + ' 的实施质量。',
    '',
    '实施者报告改动文件: ' + JSON.stringify(impl.filesChanged),
    '实施者自检: ' + JSON.stringify(impl.i18nSelfCheck),
    '',
    '步骤（必须实际执行 Grep/Read，不要假设通过）：',
    '1. 读 issue: ' + issue.path + '，列出全部 User Stories 编号',
    '2. 对实施者改动的每个文件，用 Grep 搜硬编码中文：',
    '   - 排除：// 注释、/* */、console.*、src/i18n/ 下文件、纯英文、import 语句',
    '   - 关注：JSX 文本、placeholder、title、aria-label、button 文案、Toast/提示 等用户可见中文',
    '3. 检查移动端红线：新滚动区是否局部 overflow-y-auto（非 body 滚动）',
    '4. 如涉及 settings.store.ts：检查 migrate v12 是否正确（version + migrate 函数）',
    '5. 检查 User Stories 是否都实现（读代码确认，非臆测）',
    '6. 如发现硬编码：修复（移到 i18n zh.ts+en.ts，代码用 t()），重新 Grep 验证，git commit "fix(issue' + issue.id + '): 自检修复硬编码+i18n"',
    '7. 返回结构化结果。passed=true 仅当：无剩余硬编码 + 无红线违反 + User Stories 全实现 + lint 通过。',
    '',
    '严格：不要因"看起来没问题"就 passed=true。必须 Grep 实证。每项检查写进 notes。'
  ].join('\n')
}

const results = []
let interrupted = null

for (const issue of ISSUES) {
  phase(issue.name)
  log('开始 ' + issue.name + ': ' + issue.title)

  const impl = await agent(implPrompt(issue), {label: '实施:' + issue.id, phase: issue.name, schema: IMPL_SCHEMA, agentType: 'general-purpose'})
  if (!impl) {
    log('中断 at 实施 ' + issue.name + '（429/终端错误）')
    interrupted = issue.id
    break
  }
  log(issue.name + ' 实施完成: ' + impl.filesChanged.length + ' 文件, lint=' + impl.lintPassed + ', commit=' + impl.committed)

  const check = await agent(checkPrompt(issue, impl), {label: '自检:' + issue.id, phase: issue.name, schema: CHECK_SCHEMA, agentType: 'general-purpose'})
  if (!check) {
    log('中断 at 自检 ' + issue.name + '（429/终端错误）')
    interrupted = issue.id
    break
  }
  log(issue.name + ' 自检: passed=' + check.passed + ', 剩余硬编码=' + check.hardcodedRemaining.length + ', 缺失US=' + check.userStoriesMissing.length)

  results.push({issue: issue.id, title: issue.title, impl, check})
}

log('workflow 结束。已完成 ' + results.length + ' issue' + (interrupted ? '，中断 at issue ' + interrupted : '，全部完成'))
return {completed: results.map(r => r.issue), interrupted, results}
