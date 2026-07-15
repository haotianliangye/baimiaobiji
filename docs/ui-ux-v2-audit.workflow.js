export const meta = {
  name: 'ui-ux-v2-audit',
  description: 'UI/UX v2 核对：9 agent 并行核对四层映射（需求->PRD->issue->代码），输出遗漏，429 null 检测',
  phases: [{title: '核对四层映射'}]
}

const ISSUES = [
  {id: 101, title: '统计小字下移与统一', issuePath: 'docs/issues/101-stats-relocate.md'},
  {id: 102, title: '随机漫步屏幕自适应', issuePath: 'docs/issues/102-random-walk-adaptive.md'},
  {id: 103, title: '碎屑编辑弹窗多媒体化', issuePath: 'docs/issues/103-record-edit-modal.md'},
  {id: 104, title: '碎屑/回顾双击编辑', issuePath: 'docs/issues/104-double-click-edit.md'},
  {id: 105, title: '明悟 Tab 图标改 Sun', issuePath: 'docs/issues/105-mingwu-sun-icon.md'},
  {id: 106, title: '顶部标题栏重构', issuePath: 'docs/issues/106-header-restructure.md'},
  {id: 107, title: '图片/视频全屏预览', issuePath: 'docs/issues/107-media-fullscreen-preview.md'},
  {id: 108, title: '碎屑附件上传面板', issuePath: 'docs/issues/108-attachment-panel.md'},
  {id: 109, title: '设置页重构', issuePath: 'docs/issues/109-settings-restructure.md'},
]

const AUDIT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    需求编号: {type: 'string'},
    需求标题: {type: 'string'},
    userStories: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          us: {type: 'string'},
          inPRD: {type: 'boolean'},
          inIssue: {type: 'boolean'},
          inCode: {type: 'boolean'},
          status: {type: 'string'},
          note: {type: 'string'}
        },
        required: ['us', 'inPRD', 'inIssue', 'inCode', 'status', 'note']
      }
    },
    gaps: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          条目: {type: 'string'},
          来源原文: {type: 'string'},
          应进issue: {type: 'string'},
          状态: {type: 'string'},
          说明: {type: 'string'}
        },
        required: ['条目', '来源原文', '应进issue', '状态', '说明']
      }
    }
  },
  required: ['需求编号', '需求标题', 'userStories', 'gaps']
}

function auditPrompt(issue) {
  return [
    '你是 UI/UX v2 核对 agent。工作目录 D:/baimiaobiji（git 仓库，分支 main）。',
    '',
    '任务：核对需求 ' + issue.id + '「' + issue.title + '」的四层映射，找出遗漏。',
    '',
    '四层映射核对（每层都要读，不臆测）：',
    '1. 需求原文：读 docs/requirements-merged-2026-07-14.md，找需求 ' + issue.id + ' 的原文条目（含子需求/约束）',
    '2. PRD：读 docs/prd-ui-ux-2026-07-14.md，找该需求对应的 User Stories + Implementation Decisions',
    '3. issue：读 ' + issue.issuePath + '，找该 issue 的全部 User Stories + Implementation Decisions + Out of Scope',
    '4. 代码：读 issue 涉及的实际代码文件（issue 文档会指明改动文件），确认每个 User Story 是否真的实现',
    '',
    '输出：',
    '- userStories: 每个 User Story 的 inPRD(是否在PRD)/inIssue(是否在issue)/inCode(是否在代码实现)/status/note',
    '- gaps: 遗漏条目（status≠已做的都要进 gaps）。每条含：条目(简述)/来源原文(需求或PRD原文摘录)/应进issue(应进哪个issue)/状态/说明',
    '',
    'status 严格枚举（四选一）：',
    '- 已做：需求/PRD/issue 有，代码也正确实现',
    '- 真没做：需求/PRD/issue 有，但代码完全没实现',
    '- 形式不符：代码做了，但与需求/PRD 不一致（如位置/口径/交互不对）',
    '- 需求没写但做了：代码有，但需求/PRD 没要求（多余或合理扩展，需标记）',
    '',
    '严格：',
    '- 读代码确认 inCode（不臆测，看实际文件）',
    '- gaps 的「来源原文」必须摘录需求或 PRD 的原话，不要转述',
    '- 「应进issue」指明该遗漏应补进哪个 issue（通常是当前 issue 或相关 issue）',
    '- 不要把「已做」放进 gaps（gaps 只放需要补救的）'
  ].join('\n')
}

const results = await parallel(ISSUES.map(issue => () =>
  agent(auditPrompt(issue), {label: '核对:' + issue.id, phase: '核对四层映射', schema: AUDIT_SCHEMA, agentType: 'general-purpose'})
))

const interrupted = results.some(r => !r)
const valid = results.filter(Boolean)
log('核对完成：' + valid.length + '/9 agent 成功' + (interrupted ? '，有 429 中断（null）' : '，无中断'))
return {results: valid, interrupted, completed: !interrupted}
