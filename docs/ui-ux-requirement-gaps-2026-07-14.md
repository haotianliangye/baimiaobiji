# 白描笔记 UI/UX 重构 · 需求遗漏核对记录

> 核对日期：2026-07-14
> 核对范围：需求转换链「需求对齐 -> PRD -> 9 issue」完整性
> 核对方法：逐条对照 11 份文档（requirement-alignment / prd-ui-ux-2026-07-13 / issues 002-010）
> 目的：定位需求转换阶段遗漏的需求，供后续合并对照、重做 PRD
> 说明：本文档只核对「需求文档层」的转换遗漏，不核对代码实现（代码层另已核对补漏）

---

## 汇总

- **第一层 需求对齐 -> PRD**：8 条 missing + 2 条 partial
- **第二层 PRD -> issue**：9 条 missing + 3 条 partial
- PRD 41 条 User Stories 与 9 seam Implementation Decisions 已全部进入对应 issue，无遗漏
- 遗漏集中在：①需求对齐的交互细节未被 PRD 吸收 ②PRD 的 Further Notes / Testing / Out of Scope 跨 seam 约束未进入 issue

---

## 第一层：需求对齐 -> PRD（PRD 未吸收需求对齐的确认点）

| # | 需求对齐原文 | 状态 | 说明 |
|---|---|---|---|
| G1 | #3+#4：「沉思页副标题为'今日 X 字'；中间区域为**瀑布流/时间线下拉式胶囊切换器**」「两个选项居中合并成一个胶囊切换器」「下拉式胶囊：默认显示当前选中项（首次默认'瀑布流'），点击后展开两个选项；选择后收起复位为单个胶囊；切换后立即刷新内容。」 | missing | PRD Problem Statement 提到了"沉思页存在独立的'瀑布流/时间线'切换区"这一**问题**，但 Solution 12 条和 9 个 seam 中无任何一条包含下拉胶囊切换器的解决方案。Issue 006 (Seam 5) 更在 Out of Scope 中明确写"不改动瀑布流/时间线视图切换机制"，主动排除了此需求。**全链封死。** |
| G2 | #3：「明悟页无字数统计；中间区域为**时间范围下拉胶囊**（如'本周'），点击展开选择。」 | missing | PRD 仅在 Seam 1 写"明悟不显示字数副标题"，完全没有提及明悟页中间区域的时间范围下拉胶囊。9 个 seam 无一覆盖。 |
| G3 | #2扩展A 第一条：「顶部标题栏移除随机漫步（眼睛）图标，该功能入口**迁移到系统设置内**。」第二条更正：「顶部标题栏移除的是**标签**图标（Layout.tsx 中的 TagsIcon），**非随机漫步**。」 | discrepancy | PRD Seam 1 写"移除原顶部栏中的标签图标、**随机漫步图标**"，同时移除了两者。但需求对齐第二条已确认更正：移除的是标签图标非随机漫步。PRD 未吸收此更正。同时，需求对齐第一条说随机漫步入口迁移到系统设置内，但 PRD Seam 2 菜单项（对话模型/语音朗读/向量与语义/数据管理/提示词配置/标签设置/关于）不含随机漫步。**随机漫步的最终去向在 PRD 中完全未交代。** |
| G4 | #3：「日期居中：`< 日期 >`，左右箭头保留，点击箭头切换日期，点击日期弹出选择器；**日期字号比标题略小**。」 | missing | PRD Seam 1 Implementation Decisions 写"日期组件居中，保留左右箭头切换日期，点击日期打开日期选择器"，但遗漏了"日期字号比标题略小"这一样式约束。 |
| G5 | #5：「麦克风按钮：点击开始录音，再次点击结束；**录音中按钮显示'录音中'状态**；录音结束后走现有 STT 流程，转写文本插入光标处。」 | missing | PRD Seam 6 Implementation Decisions 写"麦克风按钮：点击开始录音，再次点击结束，走 STT 流程，转写文本插入光标处"，遗漏了"录音中按钮显示'录音中'状态"这一交互反馈。 |
| G6 | #7：「明悟生成 prompt + 洞察生成 prompt -> 合并为 `mingwuInsightPrompt` 对象（key: mingwu/insight/custom1/custom2/custom3）。日记摘要 prompt + 回顾摘要 prompt -> 合并为 `diaryReviewSummaryPrompt` 对象。洞察摘要 prompt -> 改名为 `mingwuInsightSummaryPrompt`，**并补充默认的明悟摘要 prompt（可先用洞察摘要副本作为默认值）**。」 | missing | PRD Seam 7 数据迁移仅写"将旧的 mingwuPrompt/insightPrompt 合并到新结构""将旧的 diarySummaryPrompt/summaryPrompt 合并到新结构"，未给出新字段名（mingwuInsightPrompt/diaryReviewSummaryPrompt/mingwuInsightSummaryPrompt），也未提及"补充默认的明悟摘要 prompt（可先用洞察摘要副本作为默认值）"这一默认值策略。 |
| G7 | #10：「展开后完全展开，**不限制高度**；再次单击收回。」 | missing | PRD Seam 5 Implementation Decisions 写"折叠态最大高度：时间线 7 行，瀑布流 12 行""单击卡片切换展开/折叠"，但未明确"展开后完全展开，不限制高度"。展开态行为约束丢失。 |
| G8 | #13：「图标库使用 lucide-react：相册 `Image`、音频 `Music`、视频 `Video`、链接 `Link`、文件 `FileUp`。」 | missing | PRD Seam 6 Implementation Decisions 仅写"使用 lucide-react 大图标 + 文字标签"，未给出具体图标名映射（Image/Music/Video/Link/FileUp）。 |
| G9 | #1：「混合媒体布局顺序：1. 图片/视频 2×2 网格（混排，单格 16:9，最多 4 格，超出 +N）。2. 音频纵向列表（每个独立播放器控件）。3. AI 摘要文本。」 | partial | PRD Seam 4 分别描述了图片/视频、音频、摘要区三个组件，暗示了顺序但未将"混合媒体布局顺序"作为显式约束写出。需求对齐的编号顺序（1->2->3）在 PRD 中弱化为隐含。 |
| G10 | #1：「点击 +N 覆盖层：进入该条碎屑的详情/完整视图（页面或底部模态层），**可查看全部附件、完整摘要、原始内容**。」 | partial | PRD Seam 4 写"点击 +N 进入该记录的详情页/完整视图"，但遗漏了详情视图中应包含"全部附件、完整摘要、原始内容"三部分内容的要求。 |

---

## 第二层：PRD -> 9 issue（PRD 有写但 issue 未收录）

### Testing Decisions 对照

| PRD 原文 | 应进 issue | 状态 | 说明 |
|---|---|---|---|
| Testing Decisions > 测试类型与工具：「组件/单元测试：使用项目现有测试框架（Vitest + React Testing Library，若已配置）」「端到端测试（可选但推荐）：使用 Playwright/Cypress」「视觉回归测试：建议对顶部栏、设置页、多媒体卡片、沉思卡片、附件面板做快照对比」 | 所有 issue | missing | 9 个 issue 的 Testing Decisions 均只写"验证..."验收点，无一提及具体测试框架（Vitest+RTL）、E2E 工具（Playwright/Cypress）或视觉回归测试方法。PRD 的测试工具选型决策在 issue 层全部丢失。 |

### Further Notes（跨 seam 约束）对照

| PRD 原文 | 应进 issue | 状态 | 说明 |
|---|---|---|---|
| Further Notes > 无障碍：「顶部栏按钮保留 aria-label」 | 002 (Seam 1) | missing | Issue 002 Implementation Decisions 和 Testing Decisions 均未提及 aria-label。 |
| Further Notes > 无障碍：「折叠/展开按钮需可被屏幕阅读器识别」 | 006 (Seam 5) | missing | Issue 006 未提及屏幕阅读器可访问性。 |
| Further Notes > 无障碍：「附件面板选项需有清晰的焦点状态」 | 007 (Seam 6) | missing | Issue 007 未提及焦点状态（focus state）要求。 |
| Further Notes > 性能：「沉思卡片折叠态不应预渲染完整 Markdown，可使用 line-clamp 或最大高度截断」 | 006 (Seam 5) | missing | Issue 006 Implementation Decisions 写了折叠行数和渐变遮罩，但完全未提"不预渲染完整 Markdown"的性能约束和实现建议（line-clamp/最大高度截断）。 |
| Further Notes > 移动端红线：「附件上滑面板、设置抽屉、**日期选择器**均需遵守 [局部 overflow-y-auto]」 | 002 (Seam 1, 日期选择器) | missing | Issue 002 未提及日期选择器需使用局部 overflow-y-auto 容器。 |
| Further Notes > 移动端红线：「附件上滑面板…均需遵守 [局部 overflow-y-auto]」 | 007 (Seam 6, 附件面板) | partial | Issue 007 Testing 写"验证面板在移动端和桌面端均从底部弹出，不依赖 body 滚动"，提到了 body 滚动但未明确"局部 overflow-y-auto 容器"这一实现约束。 |
| Further Notes > 图标库：「顶部栏、设置页、附件面板等继续使用 lucide-react；底部 TabBar 继续使用 @phosphor-icons/react」 | 002 (Seam 1) | missing | Issue 002 提到"sun-dim 图标"和"原明悟图标"但未明确声明图标库归属规则（TabBar 用 @phosphor-icons/react，顶部栏用 lucide-react）。 |
| Further Notes > 数据兼容性：「Settings store 版本升级（从 v11 到 v12），需在 migrate 中处理 Prompt 合并与 TTS 外部配置字段的初始化」 | 008 + 009 (Seam 7 + Seam 8) | partial | Issue 008 写"Settings store 版本从 v11 升级到 v12"，Issue 009 写"Settings store 版本升级到 v12 时初始化 TTS 外部配置字段"，两者分别提及但无任何 issue 说明两者需在**同一次 v11->v12 migrate 函数**中协调处理。迁移协调点缺失。 |

### Out of Scope 对照

| PRD 原文 | 应进 issue | 状态 | 说明 |
|---|---|---|---|
| Out of Scope：「不改动数据同步、云备份、OAuth 相关逻辑」 | 全局 | missing | 9 个 issue 的 Out of Scope 均未提及此全局边界约束。 |
| Out of Scope：「不涉及端侧 AI（Capacitor/LiteRT-LM）迁移」 | 全局 | missing | 9 个 issue 的 Out of Scope 均未提及此全局边界约束。 |

---

## 最严重的 3 条遗漏（按影响排序）

### 1. 沉思页瀑布流/时间线下拉式胶囊切换器（#3 + #4 -> PRD -> issue 全链缺失）
需求对齐有极详细的交互设计（下拉式胶囊、默认瀑布流、点击展开两选项、选择后收起、切换后刷新内容），PRD Problem Statement 识别了问题但 9 个 seam 无一包含解决方案，Issue 006 (Seam 5) 更在 Out of Scope 中主动写入"不改动瀑布流/时间线视图切换机制"将其封死。**这是唯一一条被 issue 主动排除的需求，影响最大。**

### 2. 明悟页中间区域时间范围下拉胶囊（#3 -> PRD -> issue 全链缺失）
需求对齐明确写「明悟页…中间区域为时间范围下拉胶囊（如'本周'），点击展开选择」，PRD 和 9 个 issue 完全未提及。这是明悟页核心交互元素之一，全链丢失。

### 3. 无障碍约束全部丢失（PRD Further Notes -> 9 issue 全部缺失）
PRD Further Notes 明确列了三条无障碍要求（aria-label、屏幕阅读器、焦点状态），分别应进 Seam 1 / Seam 5 / Seam 6 三个 issue，但三个 issue 均未收录。作为跨 seam 的全局约束，丢失后将影响顶部栏按钮、沉思折叠/展开、附件面板三个关键交互区域的可访问性。

---

## 备注：待对照代码确认

以下遗漏"需求没写"，但代码可能已经实现（只是形式可能不符，或需求文档没记录）。合并 PRD 前建议对照代码确认每条是「真没做」还是「做了但形式不符/需求没写」：

- G1 沉思瀑布流/时间线切换：Thoughts.tsx 已有切换机制，但形式是否为"下拉胶囊"待确认
- G2 明悟时间范围选择：V2 重构 #8 明悟模块已做时间范围选择，形式是否为"下拉胶囊"待确认
- G3 随机漫步：顶部栏是否还有随机漫步图标、设置菜单是否含入口，待确认
- G5 麦克风录音中状态：RichEditor.tsx 麦克风按钮是否有"录音中"反馈，待确认
- G7 沉思展开不限高：Thoughts.tsx 展开态是否限高，待确认

---

## 关联文档

- 需求对齐：`docs/requirement-alignment-2026-07-13.md`
- 总 PRD：`docs/prd-ui-ux-2026-07-13.md`
- 9 个 issue：`docs/issues/002..010`
- 代码层核对结果（7 missing + 20 partial，已补漏）：见 workflow `wnsnozumu` 输出 + 9 个 fix commit（07ec28d..f878458）
