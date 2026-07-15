# UI/UX v2 核对遗漏清单（2026-07-15）

> 来源：核对 workflow `wf_e66b3578-89d`（9 agent 并行四层映射，task `wp6ctpayk`，9/9 成功，0 429）
> 核对链路：需求文档(`requirements-merged-2026-07-14.md`) -> PRD(`prd-ui-ux-2026-07-14.md`) -> issues(101-109) -> 实际代码
> 总计 **13 条 gaps**：5 真没做 + 6 形式不符 + 2 需求没写但做了
> **需补救 11 条**（5 真没做 + 6 形式不符）；**无需补救 2 条**（G5/G11 标记）

## 状态统计

| 状态 | 数量 | 编号 | 处理 |
|---|---|---|---|
| 真没做 | 5 | G3, G4, G7, G8, G13 | 需补（功能/测试） |
| 形式不符 | 6 | G1, G2, G6, G9, G10, G12 | 需修 |
| 需求没写但做了 | 2 | G5, G11 | 标记，无需补救 |

---

## 需求 101 统计小字下移

### G1 [形式不符] 旧「今日 X 字」i18n key `record.todayChars` 未清理（orphan 死键）
- **应进 issue**: 101
- **来源原文**: 需求 1 目标「清理重复展示」；需求 1 具体改动 2「移除页面内部 header 里的『今日 X 字』统计 pill」
- **说明**: 旧统计 pill 显示已正确移除（src 无组件引用 record.todayChars），但 i18n key `record.todayChars`（zh.ts:90 / en.ts:89）仍残留为 orphan 死键。显示层清理完成但 i18n 资源层未同步。严重度低（不影响 UI），建议删除该 key。注：calendarHeatmap.todayChars/totalChars 属热力图独立 key，不在范围。

## 需求 102 随机漫步

### G2 [形式不符] 随机漫步模式下 [≡] 设置按钮点击不退出，URL 变 /settings 但界面仍渲染 RandomWalk
- **应进 issue**: 102
- **来源原文**: 退出方式：点击顶部 header 灯泡按钮（再次点击关闭）/ 点击 header 右侧 × / 点击底部任意 Tab。
- **说明**: Layout.tsx 随机漫步模式保留整个 header（含 [≡]），[≡] onClick 仅 navigate('/settings') 不重置 isRandomWalkMode（Layout.tsx:266）；`<main>` 渲染优先 isRandomWalkMode（:519），故点击 [≡] 后 URL 变 /settings 但界面仍是 RandomWalk，设置抽屉不可达。需求规定退出方式仅灯泡/×/Tab 三种，[≡] 既非退出入口又未禁用/隐藏，形成交互不一致。建议随机漫步模式下禁用或隐藏 [≡]，或点击时一并 setRandomWalkMode(false)。

### G3 [真没做] 随机漫步编辑按钮弹 RichEditor 编辑弹窗（US10）完全未 E2E 测试
- **应进 issue**: 102
- **来源原文**: 2. 随机漫步：容器内渲染（非 fixed）、swiper 滑动、三方式退出、编辑弹 RichEditor、桌面/手机占用。
- **说明**: tests/random-walk.test.ts 覆盖灯泡入口/滑动/去重/已阅/复制/删除/×关闭，但 walk-edit -> walk-edit-modal/walk-edit-textarea 均无任何断言；US10（编辑弹窗）测试零覆盖，issue 102 Testing Decisions 的「编辑按钮弹 RichEditor 编辑弹窗」测试重点未落实。

### G4 [真没做] 容器内非 fixed 断言、灯泡/Tab 退出、桌面/手机占用比例 测试覆盖缺失
- **应进 issue**: 102
- **来源原文**: 2. 随机漫步：容器内渲染（非 fixed）、swiper 滑动、三方式退出、编辑弹 RichEditor、桌面/手机占用。
- **说明**: tests/random-walk.test.ts 仅通过 data-testid=random-walk-overlay 存在性间接确认渲染，未断言非 fixed 定位；三方式退出仅测 ×（walk-close），灯泡 toggle 退出与底部 Tab 退出未测；视口固定 390×844，未做桌面宽屏占用比例断言。issue 102 Testing Decisions 列出的测试重点未落实。

### G5 [需求没写但做了] RandomWalk 内置数据源选择器/冷却期配置面板与 1/N 计数 sub-bar
- **应进 issue**: 102（既有功能保留，非本需求新增，**无需补救**）
- **来源原文**: 目标：修复随机漫步在手机端和桌面端的屏幕适配...
- **说明**: RandomWalk.tsx 内含 40px sub-bar（装饰 Lightbulb + 1/N 计数 + Settings2 齿轮）及数据源切换/冷却期配置面板，为重构前既有功能（test 已断言），需求 2/PRD/issue 102 均未涉及，属保留扩展。sub-bar 装饰 Lightbulb 与全局 header 灯泡入口视觉重复但功能不冲突。

## 需求 103 拾微编辑弹窗

### G6 [形式不符] 编辑弹窗不能新增「链接」和「文件」类型附件
- **应进 issue**: 103
- **来源原文**: 需求3「附件处理：新增附件走 saveAttachmentBlob + 异步摘要...链接/文件仅元数据」；US15「编辑弹窗能新增图片/音频/视频/链接/文件附件」
- **说明**: 编辑弹窗复用 RichEditor，其上传按钮 accept="image/*,audio/*,video/*"（RichEditor.tsx:483），仅支持图片/音频/视频。弹窗内无链接输入框、无通用文件选择入口（创建流程的 showLinkInput/handleSelectAttachmentKind 不接入编辑弹窗）。保存逻辑 handleSaveEdit 虽能处理 link/file，但 UI 无法新增这两类附件。需在 RichEditor 或编辑弹窗中增加链接附件输入与通用文件上传入口。

## 需求 104 双击编辑

### G7 [真没做] 回顾页双击编辑未做多选模式互斥
- **应进 issue**: 104
- **来源原文**: 需求 4 具体改动 2「回顾页 Review.tsx：回顾内容卡片绑定 onDoubleClick...多选模式不响应。」
- **说明**: Review.tsx 的 onDoubleClick（line 440-456）仅判断 isEditing/isGenerating 即 return，无多选模式判断；Review.tsx 整体无多选模式（无 isMultiSelectMode 状态）。拾微页已正确实现多选互斥（Record.tsx:1490）。当前回顾页因无多选模式故不可触发，但需求/PRD/issue 明确要求回顾页「多选模式不响应」。建议：在 Review.tsx onDoubleClick 增加防御性多选判断，或在 issue 中明确回顾页无多选模式、该条款 N/A 并回写需求。

## 需求 105 明悟图标

### G8 [真没做] foundation-migration.test.ts 未实现明悟 Sun 图标断言（TabBar Sun / header Sun / 全局替换无遗漏 三条均缺失）
- **应进 issue**: 105
- **来源原文**: PRD Seam 映射「foundation-migration.test.ts：需求 5（明悟 Tab 图标断言）」；PRD 测试重点「5. 明悟图标：TabBar Sun、header Sun、全局替换无遗漏」；issue 105 Testing Decisions 同。
- **说明**: tests/foundation-migration.test.ts 仅断言 4 个 tab 文字标签与 insights->mingwu 迁移、旧表删除，无任何图标（Sun/Sparkles/HeadCircuit/SunDim）相关断言。tests/mingwu.test.ts 同样无图标断言。issue 105 指定的 3 条图标测试重点均未落地，Sun 图标变更无 E2E 覆盖。

## 需求 106 顶部栏

### G9 [形式不符] 沉淀视图切换胶囊含 ChevronDown 图标，与"仅文字不显示图标"约束不符
- **应进 issue**: 106
- **来源原文**: 沉淀页视图切换胶囊：文案 `瀑布流`/`时间线`，仅文字不显示图标。（需求 6 第 6 条）
- **说明**: Layout.tsx 沉淀胶囊按钮（约 320-327 行）在文字后渲染了 `<ChevronDown className="w-3 h-3 opacity-60" />`。需求对沉淀胶囊明确写"仅文字不显示图标"，对明悟胶囊无此约束。当前沉淀与明悟胶囊均带 ChevronDown。若团队认定下拉箭头属通用 affordance 可保留则关闭此条；若严格遵循需求，应移除沉淀胶囊的 ChevronDown（明悟可保留）。

## 需求 107 全屏预览

### G10 [形式不符] video 元素缺少 playsInline 属性，iOS Safari 视频会跳转设备原生全屏
- **应进 issue**: 107
- **来源原文**: 视频点击后应用容器内全屏播放，非仅缩略图。/ 预览层范围：应用本身显示范围内全屏（max-w-md 容器内），不超设备屏幕。
- **说明**: MediaPreview.tsx 第252-261行 `<video autoPlay loop controls>` 缺少 playsInline 属性。iOS Safari 对未设 playsInline 的 video 会在 autoPlay 时强制进入设备原生全屏播放器，导致：(1) 视频脱离 max-w-md 容器，违背"应用容器内全屏播放"；(2) 自定义关闭按钮(×/遮罩/ESC)失效；(3) 违背"不超设备屏幕"。本 PWA 移动优先，应补 playsInline 使视频容器内内联播放。

### G11 [需求没写但做了] video 元素添加了 controls 属性（原生播放控件）
- **应进 issue**: 107（合理扩展，**无需补救**）
- **来源原文**: 视频播放：自动播放、不静音、循环播放。
- **说明**: MediaPreview.tsx 第257行 `<video>` 含 controls，显示原生播放/暂停/进度条/音量。需求/PRD/issue 仅要求"自动播放、不静音、循环"，未提 controls。属合理扩展（用户需可暂停/拖动进度），不与任何需求冲突，仅标记。

## 需求 108 附件面板

### G12 [形式不符] 附件面板选项缺少设计态焦点样式（无障碍约束未显式实现）
- **应进 issue**: 108
- **来源原文**: 需求跨需求约束与 issue 108 Implementation Decisions「附件面板选项需有清晰焦点状态。」
- **说明**: Record.tsx 面板内 6 个按钮（line 1767-1833）className 仅含 hover:bg-stone-100 active:bg-stone-200 transition-colors，无 focus:/focus-visible: 样式；键盘焦点依赖浏览器默认 outline，hover/active 有设计态而 focus 无设计态，与「清晰焦点状态」要求不一致。建议补 focus-visible:bg-stone-100 或 focus-visible:ring 等显式焦点样式。

## 需求 109 设置页

### G13 [真没做] foundation-migration.test.ts 缺少需求 9 设置页测试（抽屉滑出/菜单+标签区块/点项跳全页/横向导航切换/胶囊高亮/桌面同模式/标签滚动）
- **应进 issue**: 109
- **来源原文**: PRD Seam 映射「foundation-migration.test.ts：...需求 9（设置页抽屉 + 全页 + 横向导航）」；PRD 测试重点第 9 条「设置页：抽屉滑出、菜单 + 标签区块、点项跳全页、横向导航切换、胶囊高亮、桌面同模式、标签滚动。」
- **说明**: PRD 与 issue Testing Decisions 均指定 foundation-migration.test.ts 覆盖需求 9 设置页测试。实际 tests/foundation-migration.test.ts 仅含旅程 A（导航 4 Tab/重定向）、B（v7->v8 迁移）、C（回顾合并），无任何设置页抽屉/横向导航/胶囊高亮/标签滚动断言。其余 11 个测试文件也均未覆盖设置页展示方式。需在 foundation-migration.test.ts 中新增设置页 E2E 旅程。

---

## 补漏分组（按 issue）

| issue | gaps | 状态 |
|---|---|---|
| 101 | G1 | 形式不符（删 orphan i18n key） |
| 102 | G2, G3, G4 | 1 形式不符 + 2 真没做（[≡]退出 + 2 组测试） |
| 103 | G6 | 形式不符（编辑弹窗补链接/文件附件入口） |
| 104 | G7 | 真没做（回顾页双击多选互斥，或回写 N/A） |
| 105 | G8 | 真没做（foundation-migration 补 Sun 图标断言） |
| 106 | G9 | 形式不符（沉淀胶囊去 ChevronDown，或认定 N/A） |
| 107 | G10 | 形式不符（video 补 playsInline） |
| 108 | G12 | 形式不符（附件面板补 focus 样式） |
| 109 | G13 | 真没做（foundation-migration 补设置页 E2E） |

G5/G11 无需补救（需求没写但做了，标记跳过）。
