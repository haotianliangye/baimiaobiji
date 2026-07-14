export const meta = {
  name: 'baimiao-ui-ux-restructure',
  description: '白描笔记 UI/UX 重构：9 seams 串行，每 seam 实施+自检两阶段（失败停止；429 由主循环 Cron resume）',
  phases: [
    { title: 'Seam 9 i18n 文案修正' },
    { title: 'Seam 1 全局 Layout 与顶部栏' },
    { title: 'Seam 2 系统设置页重构' },
    { title: 'Seam 7 提示词配置合并与数据迁移' },
    { title: 'Seam 8 TTS 外部 API 配置' },
    { title: 'Seam 3 RAG+CHAT 导航重构' },
    { title: 'Seam 4 多媒体记录卡片渲染' },
    { title: 'Seam 5 沉思卡片限高与缩略图' },
    { title: 'Seam 6 输入工具栏与附件上传面板' },
  ],
};

const CONSTRAINTS = `硬约束（每个 seam 必须遵守）：
1. 只处理当前 seam，不跨 seam 改动。
2. 所有新增文案必须写入 src/i18n/zh.ts 和 src/i18n/en.ts，绝不硬编码中文/英文字符串到组件。
3. 全局 html/body 保持 overflow:hidden + overscroll-behavior:none；新滚动区域用局部 overflow-y-auto。
4. 图标：顶部栏/设置/面板用 lucide-react；TabBar 用 @phosphor-icons/react。
5. 绝不 git push，只本地 commit。
6. lint(tsc --noEmit) 或 build(vite build + esbuild server.ts) 失败则尝试修复最多 3 次；仍失败返回 success:false 并停止。
7. 开始前先 git status：若当前 seam 涉及文件有未提交半成品（上次中断残留），先 git checkout -- 清理；不动其他 commit。
8. 完成后写 docs/progress/progress-<ID>.md（改动摘要 / lint/build 结果 / 遗留问题）。
9. commit message：feat(ui): <seam名> (#<id>)，不 push。
10. 验证命令：npm run lint && npm run build，两者都过才能 commit。`;

const SEAMS = [
  { id: '010', title: 'Seam 9 i18n 文案修正', doc: 'docs/issues/010-seam-9-i18n-copy-fix.md',
    files: 'src/i18n/zh.ts, src/i18n/en.ts, src/lib/i18n.ts, 各组件右键/长按菜单',
    focus: '全量扫描 zh/en 字典，修正 view.copyContent编辑内容 等中英混编（key 直接暴露或值里夹中文）。重点：右键/长按菜单、卡片操作栏、导出导入按钮。回顾页生成弹窗标题"生成 N 篇回顾"->"生成 N 篇"（去"回顾"）。为后续 seam 建立新 key 规范：所有新文案先入字典。先读 010 文档。' },
  { id: '002', title: 'Seam 1 全局 Layout 与顶部栏', doc: 'docs/issues/002-seam-1-global-layout-header.md',
    files: 'src/components/Layout.tsx, src/i18n/zh.ts, src/i18n/en.ts',
    focus: 'Layout.tsx header(约185-241行)+TabBar(约697-700行)。header 改为：左 [≡]{页面标题}·{副标题} / 中 <日期>左右箭头 / 右 搜索->MessageSquare(RAG+CHAT)->灯泡。标题随路由(碎屑=白描/回顾/沉思/明悟)，不可点击；设置图标用 lucide Menu 图标导航 /settings。移除 TagsIcon(约225行)、随机漫步图标、标题点击触发 About(约188行)。副标题"今日 X 字"(明悟不显示)。TabBar：thoughts 换原明悟图标 HeadCircuit，mingwu 换 SunDim(@phosphor sun-dim)。About Modal(约313-366) 本 seam 暂保留，seam2 迁移。先读 002 文档。' },
  { id: '003', title: 'Seam 2 系统设置页重构', doc: 'docs/issues/003-seam-2-settings-page.md',
    files: 'src/pages/Settings.tsx, src/pages/TagManagement.tsx, src/components/Layout.tsx, src/i18n/zh.ts, src/i18n/en.ts',
    focus: 'Settings.tsx 当前横向 4 tab(model/embedding/data/prompt, 约89/710-742行)改为左侧竖排菜单+右侧内容区。菜单项顺序：对话模型/语音朗读/向量与语义/数据管理/提示词配置/标签设置/关于。桌面左菜单常驻，移动端 push 抽屉(0.3s，用 motion 实现，不必装 react-burger-menu)。语言切换改横向并排胶囊按钮，统一宽高，当前高亮。TagManagement 内容内嵌为"标签设置"面板，去掉其顶部返回栏。新增"关于"面板：应用图标/名称/版本/作者/简介/检查更新/反馈(GitHub Issues)，内容取自 Layout.tsx About Modal(约313-366)，迁完移除该 Modal。model tab 内 TTS 配置(约941行)暂留，seam8 抽出。先读 003 文档。' },
  { id: '008', title: 'Seam 7 提示词配置合并与数据迁移', doc: 'docs/issues/008-seam-7-prompt-merge.md',
    files: 'src/store/settings.store.ts, src/pages/Settings.tsx, src/i18n/zh.ts, src/i18n/en.ts',
    focus: 'settings.store.ts：persist name=whitewash-settings，version 当前 11(约662行)，migrate(约821行)。升 version 11->12，migrate 加 v11->v12 分支：mingwuPrompt+insightPrompt 合并到 mingwuInsightPrompt(对象 key: mingwu/insight/custom1/2/3)；diarySummaryPrompt+summaryPrompt(回顾摘要)合并到 diaryReviewSummaryPrompt；insightSummaryPrompt 改名 mingwuInsightSummaryPrompt 并补明悟默认摘要。保留旧字段只读兼容。per-language *ByLang 结构同步合并。Settings.tsx prompt tab(约1222-1540行)重构为 4 区块：日记回顾生成Prompt(5槽 日记/回顾/自定义1/2/3)/明悟和洞察生成Prompt(5槽 明悟/洞察/自定义1/2/3)/日记回顾一句话摘要/明悟和洞察一句话摘要，各保留"自动生成选中"复选框。先读 008 文档。' },
  { id: '009', title: 'Seam 8 TTS 外部 API 配置', doc: 'docs/issues/009-seam-8-tts-external-api.md',
    files: 'src/store/settings.store.ts, src/pages/Settings.tsx, src/lib/tts.ts, server.ts, api/index.ts, src/i18n/zh.ts, src/i18n/en.ts',
    focus: 'settings.store.ts：v12 默认 state 加 TTS 外部字段(ttsProvider: browser|external, ttsApiKey, ttsBaseUrl, ttsModel, ttsVoice, ttsLang, ttsSpeed)；migrate 为老用户补默认值(if not present)，不再升 version(已在 12)。Settings.tsx：把"语音朗读"做成左侧菜单独立项(seam2 已建菜单)，二选一 浏览器内置/外部API，选外部展开 Provider(Gemini/火山引擎)/APIKey/BaseURL/Model/Voice/默认语言/语速，UI 参考对话模型配置卡片；移除 model tab 内原 TTS 配置(约941行)。tts.ts：加外部 API 调用路径，Web Speech 保留 fallback。后端 server.ts + api/index.ts(镜像) 新增 app.post("/api/tts") 接收 {text,lang,settings} 返回音频 blob，按 Provider 调 Gemini/火山引擎。先读 009 文档。' },
  { id: '004', title: 'Seam 3 RAG+CHAT 导航重构', doc: 'docs/issues/004-seam-3-rag-chat-nav.md',
    files: 'src/pages/Copilot.tsx, src/components/ContextChat.tsx, src/i18n/zh.ts, src/i18n/en.ts',
    focus: 'Copilot.tsx：移除"对话/历史会话"二级标签，改顶部一行 RAG->CHAT->历史 横向导航。RAG=原 RAG 问答，CHAT=原通用 Chat，历史=原历史会话列表。切换 RAG/CHAT 仍清空当前会话新建(mode per conversation)。历史列表项保留 mode 标签(RAG/CHAT)。RAG 模式保留筛选胶囊行(记录/日记/回顾/洞察/日期/日记模板)。顶部栏遵循 seam1 规则。先读 004 文档。' },
  { id: '005', title: 'Seam 4 多媒体记录卡片渲染', doc: 'docs/issues/005-seam-4-multimedia-card.md',
    files: 'src/pages/Record.tsx, src/lib/multimedia.ts, src/i18n/zh.ts, src/i18n/en.ts',
    focus: 'Record.tsx 碎屑卡片：图片/视频 2x2 网格(16:9, object-fit cover, 最多4张, 超出 +N 覆盖层)，单张 16:9 撑满。视频首帧缩略图叠播放图标点击播放。音频纵向列表播放器控件，摘要用 RawLog.content(STT)。摘要区在媒体下方，次要文本色，最多3行截断。生成中显示"AI 摘要生成中…"，失败显示"摘要生成失败·重新生成"。单附件重试：图片/视频按钮在缩略图右下角，音频在播放器右侧下方，复用后端 /api/multimedia-summarize。数据已存在(AttachmentMeta.summary / RawLog.attachment_summary)，纯前端渲染。先读 005 文档。' },
  { id: '006', title: 'Seam 5 沉思卡片限高与缩略图', doc: 'docs/issues/006-seam-5-contemplation-card.md',
    files: 'src/pages/Thoughts.tsx, src/i18n/zh.ts, src/i18n/en.ts',
    focus: 'Thoughts.tsx 沉思卡片(时间线+瀑布流)：折叠态最大高度 时间线7行/瀑布流12行(line-clamp 或 max-h)，超出渐变遮罩+"展开"按钮。单击切换展开/折叠，双击进编辑(300ms 内第二次点击判双击，取消单击)。展开态不限高。多媒体缩略图统一 1:1：时间线一行3个，瀑布流一行2个，超出 +N 或进详情。先读 006 文档。' },
  { id: '007', title: 'Seam 6 输入工具栏与附件上传面板', doc: 'docs/issues/007-seam-6-input-toolbar-attachment-panel.md',
    files: 'src/components/RichEditor.tsx, src/pages/Record.tsx, src/components/ActionSheet.tsx, src/i18n/zh.ts, src/i18n/en.ts',
    focus: 'RichEditor.tsx 沉思富文本工具栏增加(从左到右)：通用上传(image/*,audio/*,video/* 多选,走现有附件流程)/超链接(弹框填 URL+文本插 Markdown 链接)/麦克风(点击录音再点结束,走 STT 插光标)/#标签(插入 # 或弹标签选择器)/…更多(表格/代码块/内联代码/导出/预览 Markdown)。Record.tsx 碎屑附件按钮：点击从底部上滑半屏面板(用 ActionSheet 或 motion 实现)，选项 相册(Image)/音频(Music)/视频(Video)/链接(Link)/文件(FileUp)/取消，网格 第一行3个第二行2个+取消，取消灰色，点遮罩/取消关闭。先读 007 文档。' },
];

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    success: { type: 'boolean', description: 'lint+build 是否全过并已 commit' },
    commit: { type: 'string', description: 'commit hash 或空字符串' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    lintPassed: { type: 'boolean' },
    buildPassed: { type: 'boolean' },
    progressDoc: { type: 'string', description: 'progress 文档路径' },
    summary: { type: 'string', description: '改动摘要' },
    issues: { type: 'string', description: '遗留问题或失败原因' },
  },
  required: ['success', 'lintPassed', 'buildPassed', 'summary', 'commit'],
};

const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean', description: 'true 当且仅当 无硬编码红线违反 + 无缺失 i18n key + overflow 红线未破坏' },
    redLineViolations: { type: 'array', items: { type: 'string' }, description: '硬编码文案 / overflow 破坏等硬约束违反' },
    missingKeys: { type: 'array', items: { type: 'string' }, description: 't(key) 在 zh.ts 或 en.ts 缺失的 key' },
    prdGaps: { type: 'array', items: { type: 'string' }, description: 'PRD 验收点遗漏（不阻断 passed）' },
    coveredPoints: { type: 'array', items: { type: 'string' }, description: '已覆盖的 PRD 验收点' },
    notes: { type: 'string' },
  },
  required: ['passed'],
};

function implPrompt(seam) {
  return `你是白描笔记 UI/UX 重构的实施 agent。项目路径 D:\\baimiaobiji（Windows，PowerShell + Git Bash 均可用）。

${CONSTRAINTS}

当前任务：${seam.title}（issue #${seam.id}）
先读 issue 文档：${seam.doc}
相关源码：${seam.files}
改动要点：${seam.focus}

执行步骤：
1. git status 检查并清理当前 seam 文件的未提交半成品（若有，git checkout -- 清理）。
2. 读 issue 文档 + 相关源码，理解现有实现。
3. 实施改动（文案进 i18n，遵守移动端红线）。
4. npm run lint && npm run build，失败则修复最多 3 次。
5. git add 相关文件 + git commit（feat(ui): ${seam.title} (#${seam.id})，绝不 push）。
6. 写 docs/progress/progress-${seam.id}.md（改动摘要 / lint/build 结果 / 遗留问题）。
7. 返回结构化结果（success/commit/filesChanged/lintPassed/buildPassed/summary/issues）。

绝不 push。失败返回 success:false 停止，不要硬撑。`;
}

function checkPrompt(seam, impl) {
  return `你是白描笔记 UI/UX 重构的自检 agent。项目 D:\\baimiaobiji。

刚完成 ${seam.title}（issue #${seam.id}），commit: ${impl.commit}。
issue 文档：${seam.doc}

自检任务：
1. 运行 git show ${impl.commit} --stat 看改动文件列表。
2. 运行 git diff ${impl.commit}~1 ${impl.commit} 读完整改动内容（若 diff 太大可分文件读）。
3. 读 issue 文档的 Testing Decisions 和 User Stories。
4. 逐项检查：
   a. 硬编码文案：改动里新增的 JSX/字符串是否有未走 t() 的中文或英文文案（注释、console、URL、技术常量除外）。重点看新加的 button/label/title/placeholder/heading 文本。
   b. overflow 红线：确认全局 html/body 仍 overflow:hidden + overscroll-behavior:none（查 src/index.css 或全局样式与 Layout 根容器）；新增滚动区域是否用局部 overflow-y-auto，不依赖 body 滚动。
   c. i18n key 齐全：改动里新增的 t('key') 调用，每个 key 是否在 src/i18n/zh.ts 和 src/i18n/en.ts 都有定义。
   d. PRD 验收点：逐条核对 issue 的 Testing Decisions，标记已覆盖(coveredPoints)与遗漏(prdGaps)。
5. 返回结构化结果。

passed=true 当且仅当：无硬编码红线违反(redLineViolations 空) + 无缺失 i18n key(missingKeys 空) + overflow 红线未破坏。prdGaps 不影响 passed（只标记）。`;
}

function fixPrompt(seam, impl, check) {
  return `你是白描笔记 UI/UX 重构的修复 agent。项目 D:\\baimiaobiji。

${seam.title}（#${seam.id}）自检发现问题（基于 commit ${impl.commit}）：
红线违反：${JSON.stringify(check.redLineViolations || [])}
缺失 i18n key：${JSON.stringify(check.missingKeys || [])}

请只针对这些问题修复，不要扩大改动范围：
- 硬编码文案：改成 t('key') 并在 src/i18n/zh.ts 和 en.ts 补齐对应翻译。
- overflow 红线：恢复 html/body 的 overflow:hidden + overscroll-behavior:none，或把误用的 body 滚动改回局部 overflow-y-auto 容器。
- 缺失 key：在 zh.ts/en.ts 补齐。

修完 npm run lint && npm run build，git add + git commit（feat(ui): ${seam.title} 自检修复 (#${seam.id})，绝不 push）。返回结构化结果（含新 commit hash）。`;
}

const completed = [];
let failed = null;

for (const seam of SEAMS) {
  phase(seam.title);

  // 阶段 1：实施
  const impl = await agent(implPrompt(seam), {
    label: seam.id + '-impl',
    phase: seam.title,
    schema: IMPL_SCHEMA,
    agentType: 'general-purpose',
  });
  if (!impl || !impl.success) {
    failed = { id: seam.id, title: seam.title, stage: 'impl', reason: impl ? impl.issues : 'impl agent null（疑似 429 或终端错误）' };
    log('X ' + seam.id + ' 实施失败：' + failed.reason);
    break;
  }
  log('1/2 ' + seam.id + ' 实施完成 ' + impl.commit);

  // 阶段 2：自检
  const check = await agent(checkPrompt(seam, impl), {
    label: seam.id + '-check',
    phase: seam.title,
    schema: CHECK_SCHEMA,
    agentType: 'general-purpose',
  });
  if (!check) {
    failed = { id: seam.id, title: seam.title, stage: 'check', reason: 'check agent null（疑似 429）' };
    log('X ' + seam.id + ' 自检 agent null');
    break;
  }

  if (check.passed) {
    completed.push({ id: seam.id, title: seam.title, commit: impl.commit, coveredPoints: check.coveredPoints, prdGaps: check.prdGaps });
    log('2/2 ' + seam.id + ' 自检通过' + (check.prdGaps && check.prdGaps.length ? '（PRD 遗漏 ' + check.prdGaps.length + ' 项，已标记）' : ''));
    continue;
  }

  // 自检不过：修复一轮
  const problems = (check.redLineViolations || []).concat(check.missingKeys || []);
  log('! ' + seam.id + ' 自检发现问题，修复一轮：' + problems.join('; '));
  const fix = await agent(fixPrompt(seam, impl, check), {
    label: seam.id + '-fix',
    phase: seam.title,
    schema: IMPL_SCHEMA,
    agentType: 'general-purpose',
  });
  if (!fix || !fix.success) {
    failed = { id: seam.id, title: seam.title, stage: 'fix', reason: fix ? fix.issues : 'fix agent null（疑似 429）' };
    log('X ' + seam.id + ' 修复失败：' + failed.reason);
    break;
  }

  // 复检
  const recheck = await agent(checkPrompt(seam, fix), {
    label: seam.id + '-recheck',
    phase: seam.title,
    schema: CHECK_SCHEMA,
    agentType: 'general-purpose',
  });
  if (!recheck) {
    failed = { id: seam.id, title: seam.title, stage: 'recheck', reason: 'recheck agent null（疑似 429）' };
    log('X ' + seam.id + ' 复检 agent null');
    break;
  }
  if (recheck.passed) {
    completed.push({ id: seam.id, title: seam.title, commit: fix.commit, coveredPoints: recheck.coveredPoints, prdGaps: recheck.prdGaps, fixed: true });
    log('2/2 ' + seam.id + ' 修复后自检通过');
    continue;
  }

  // 修复后仍不过：停止
  failed = {
    id: seam.id,
    title: seam.title,
    stage: 'recheck-failed',
    reason: '修复后自检仍不过。红线: ' + JSON.stringify(recheck.redLineViolations) + '; 缺失key: ' + JSON.stringify(recheck.missingKeys),
  };
  log('X ' + seam.id + ' 修复后自检仍不过，停止后续 seam');
  break;
}

return { completed, failed, totalCompleted: completed.length, totalSeams: SEAMS.length };
