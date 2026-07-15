export const meta = {
  name: 'ui-ux-v2-fix',
  description: 'UI/UX v2 补漏：基于核对遗漏文档，串行补 11 条 gaps（5真没做+6形式不符），实施+自检两阶段，429 break',
  phases: [
    {title: '101补G1'},
    {title: '102补G2-4'},
    {title: '103补G6'},
    {title: '104补G7'},
    {title: '105补G8'},
    {title: '106补G9'},
    {title: '107补G10'},
    {title: '108补G12'},
    {title: '109补G13'},
  ]
}

const ISSUES = [
  {id: 101, name: '101补G1', gaps: ['G1'], issuePath: 'docs/issues/101-stats-relocate.md'},
  {id: 102, name: '102补G2-4', gaps: ['G2', 'G3', 'G4'], issuePath: 'docs/issues/102-random-walk-adaptive.md'},
  {id: 103, name: '103补G6', gaps: ['G6'], issuePath: 'docs/issues/103-record-edit-modal.md'},
  {id: 104, name: '104补G7', gaps: ['G7'], issuePath: 'docs/issues/104-double-click-edit.md'},
  {id: 105, name: '105补G8', gaps: ['G8'], issuePath: 'docs/issues/105-mingwu-sun-icon.md'},
  {id: 106, name: '106补G9', gaps: ['G9'], issuePath: 'docs/issues/106-header-restructure.md'},
  {id: 107, name: '107补G10', gaps: ['G10'], issuePath: 'docs/issues/107-media-fullscreen-preview.md'},
  {id: 108, name: '108补G12', gaps: ['G12'], issuePath: 'docs/issues/108-attachment-panel.md'},
  {id: 109, name: '109补G13', gaps: ['G13'], issuePath: 'docs/issues/109-settings-restructure.md'},
]

const IMPL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    issue: {type: 'string'},
    gapsAddressed: {type: 'array', items: {type: 'string'}},
    gapsSkipped: {type: 'array', items: {type: 'string'}},
    filesChanged: {type: 'array', items: {type: 'string'}},
    confirmation: {type: 'string'},
    i18nSelfCheck: {type: 'string'},
    lintPassed: {type: 'boolean'},
    committed: {type: 'boolean'},
    commitHash: {type: 'string'},
    notes: {type: 'string'}
  },
  required: ['issue', 'gapsAddressed', 'filesChanged', 'confirmation', 'lintPassed', 'committed', 'notes']
}

const CHECK_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    issue: {type: 'string'},
    passed: {type: 'boolean'},
    gapsStillRemaining: {type: 'array', items: {type: 'string'}},
    hardcodedRemaining: {type: 'array', items: {type: 'string'}},
    redlineViolations: {type: 'array', items: {type: 'string'}},
    committed: {type: 'boolean'},
    notes: {type: 'string'}
  },
  required: ['issue', 'passed', 'gapsStillRemaining', 'hardcodedRemaining', 'notes']
}

function fixPrompt(issue) {
  return [
    '你是 UI/UX v2 补漏 agent。工作目录 D:/baimiaobiji（git 仓库，分支 main）。',
    '',
    '任务：补 issue ' + issue.id + ' 的核对遗漏 gaps：' + issue.gaps.join(','),
    '',
    '步骤：',
    '1. 读遗漏文档 docs/ui-ux-v2-gaps-audit-2026-07-15.md，找 ' + issue.gaps.join('/') + ' 的详细说明（条目/来源原文/应进issue/状态/说明）',
    '2. 读 issue 文档 ' + issue.issuePath + '（了解原需求上下文）',
    '3. **对照代码确认**每条 gap（关键，避免重复劳动）：',
    '   - 先读相关代码文件，确认是「真没做」还是「形式不符」还是「已做但核对误报」',
    '   - 真没做 -> 实现',
    '   - 形式不符 -> 修正',
    '   - 若核对误报（代码实际已符合）-> gapsSkipped 记录，说明原因，不改动',
    '   - 需求没写但做了（G5/G11）-> 跳过（本脚本未含这两条，但若遇到跳过）',
    '4. 红线（必须遵守）：',
    '   - i18n：新增中文文案写入 src/i18n/zh.ts + en.ts，用 t()，不硬编码',
    '   - 移动端：新滚动区局部 overflow-y-auto',
    '   - settings.store.ts：如涉及设置项，migrate v12',
    '   - 图标：lucide-react / @phosphor-icons/react',
    '   - 复制按钮：src/hooks/useCopyToClipboard.ts',
    '5. 测试类 gap（G3/G4/G8/G13）：补 E2E 测试断言到对应测试文件（tests/*.test.ts）',
    '6. 实施后自查：Grep 改动文件硬编码中文（排除注释/i18n/console/import），修复',
    '7. npm run lint（tsc --noEmit）验证，失败修复重跑',
    '8. git add + git commit（中文 message 含 gap 编号，末尾 Co-Authored-By: Claude <noreply@anthropic.com>）。不 push。',
    '9. 返回结构化结果。',
    '',
    '注意：',
    '- 只补本 issue 的 gaps，不碰其他 issue',
    '- confirmation 字段写明每条 gap 对照代码的确认结论（真没做/形式不符/误报）',
    '- 不修改 docs/ 下文档（遗漏文档/issue/PRD）'
  ].join('\n')
}

function checkPrompt(issue, impl) {
  return [
    '你是 UI/UX v2 补漏自检 agent。工作目录 D:/baimiaobiji。',
    '任务：验证 issue ' + issue.id + ' 的 gaps 补漏质量。',
    '补漏者报告：gapsAddressed=' + JSON.stringify(impl.gapsAddressed) + ', filesChanged=' + JSON.stringify(impl.filesChanged),
    '补漏者确认: ' + impl.confirmation,
    '',
    '步骤（必须实际执行 Grep/Read，不假设通过）：',
    '1. 读 docs/ui-ux-v2-gaps-audit-2026-07-15.md 找 ' + issue.gaps.join('/') + ' 的原始说明',
    '2. 对每条 gap，读代码确认是否真的补救了（不是补漏者说补了就信）:',
    '   - 真没做类: 代码是否新增了实现/测试断言',
    '   - 形式不符类: 代码是否修正为符合需求',
    '3. Grep 改动文件硬编码中文（排除注释/i18n/console/import）',
    '4. 检查移动端红线 / migrate（如涉及）',
    '5. 若发现问题: 修复 + 重新 Grep 验证 + git commit "fix(issue' + issue.id + '): 自检修复"',
    '6. 返回结构化结果。passed=true 仅当: 所有 gap 确认补救 + 无剩余硬编码 + 无红线违反 + lint 通过',
    '严格: 必须读代码实证，不因"看起来补了"就 passed=true。'
  ].join('\n')
}

const results = []
let interrupted = null

for (const issue of ISSUES) {
  phase(issue.name)
  log('开始 ' + issue.name + ': 补 ' + issue.gaps.join(','))

  const impl = await agent(fixPrompt(issue), {label: '补:' + issue.id, phase: issue.name, schema: IMPL_SCHEMA, agentType: 'general-purpose'})
  if (!impl) {
    log('中断 at 补 ' + issue.name + '（429/终端错误）')
    interrupted = issue.id
    break
  }
  log(issue.name + ' 补漏完成: ' + impl.gapsAddressed.length + ' gaps, lint=' + impl.lintPassed + ', commit=' + impl.committed)

  const check = await agent(checkPrompt(issue, impl), {label: '检:' + issue.id, phase: issue.name, schema: CHECK_SCHEMA, agentType: 'general-purpose'})
  if (!check) {
    log('中断 at 检 ' + issue.name + '（429/终端错误）')
    interrupted = issue.id
    break
  }
  log(issue.name + ' 自检: passed=' + check.passed + ', 剩余gap=' + check.gapsStillRemaining.length)

  results.push({issue: issue.id, gaps: issue.gaps, impl, check})
}

log('补漏 workflow 结束。已完成 ' + results.length + ' issue' + (interrupted ? '，中断 at issue ' + interrupted : '，全部完成'))
return {completed: results.map(r => r.issue), interrupted, results}
