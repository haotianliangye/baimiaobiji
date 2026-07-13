#!/bin/bash
set -e

REPO="haotianliangye/baimiaobiji"
PARENT=2
LABEL="ready-for-agent"
TMPDIR=$(mktemp -d)

# create_issue <title> <body_file> [blocked_by_csv]
create_issue() {
  local title="$1"
  local body_file="$2"
  local blockers="$3"
  local url
  if [ -n "$blockers" ]; then
    url=$(gh issue create --repo "$REPO" --title "$title" --body-file "$body_file" --label "$LABEL" --parent "$PARENT" --blocked-by "$blockers")
  else
    url=$(gh issue create --repo "$REPO" --title "$title" --body-file "$body_file" --label "$LABEL" --parent "$PARENT")
  fi
  echo "${url##*/}"
}

cat > "$TMPDIR/01-foundation.md" <<'EOF'
## What to build
重构本地数据库 schema，引入合并后的 `daily_reviews` 表、新增 `thoughts` 表、将 `insights` 升级为 `mingwu` 表。

应用启动时自动检测旧表；若存在，先导出完整备份到本地文件，再执行迁移。将旧 `daily_diaries` 记录按「日记」视角合并进 `daily_reviews`；将 `insights` 改名并扩展 `mingwu_type` 字段。迁移完成后删除旧表，释放 IndexedDB 空间。

底部导航从「记录 / 日记 / 回顾 / 洞察」改为「碎屑 / 回顾 / 沉思 / 明悟」；路由同步调整；Copilot 入口保持在 Header。

提供 Puppeteer E2E 测试验证迁移前后数据完整性与旧表清理。

## Acceptance criteria
- [ ] 旧版 IndexedDB（含 `daily_diaries` 与 `insights`）启动后自动迁移到新 schema
- [ ] 迁移前自动生成备份文件并可在设置中下载
- [ ] 底部导航显示「碎屑 / 回顾 / 沉思 / 明悟」四个 Tab
- [ ] 原 `/diary` 与 `/review` 合并为 `/review`，原 `/insights` 变为 `/mingwu`
- [ ] 迁移完成后旧 `daily_diaries` 与旧 `insights` 表被删除
- [ ] E2E 测试通过：构造旧数据 -> 启动应用 -> 验证新表数据完整
EOF

cat > "$TMPDIR/02-tags.md" <<'EOF'
## What to build
建立全局共享的标签数据模型，标签以完整路径字符串存储，支持 `parent/child` 层级语法。

碎屑与沉思输入时支持手动输入 `#标签` 或从建议中选择；回顾、明悟、洞察生成后由 AI 自动打标，用户可在卡片上删改。设置中新增「标签管理」页，以树形展示标签；支持重命名（级联更新所有记录）、合并（建立别名映射并自动纠正未来输入）、删除（解除关联）。搜索父标签时通过前缀匹配同时返回子标签内容。

提供 E2E 测试验证标签 CRUD、层级搜索与合并后的别名纠正。

## Acceptance criteria
- [ ] 碎屑/沉思创建时可输入层级标签并保存
- [ ] 标签管理页以树形展示标签
- [ ] 合并 `#工作/A` 到 `#工作/B` 后，原 `#工作/A` 的记录可被 `#工作` 搜索到
- [ ] 再次输入被合并标签名时自动纠正为合并目标
- [ ] E2E 测试覆盖标签创建、重命名、合并、删除
EOF

cat > "$TMPDIR/03-prompt-review.md" <<'EOF'
## What to build
将设置中的 Prompt 配置从「日记 / 回顾 / 洞察」三列独立改为「日记回顾生成 Prompt」5 槽结构：默认槽位「日记」「回顾」不可改名，「自定义 1/2/3」可改名。

每个 Prompt 区域维护独立的选中状态集合，默认选中「日记 + 回顾」；选中状态持久化并在手动生成与自动生成间共用。回顾页面生成面板改造为多选浮层：每个 Prompt 项显示 checkbox，只剩一项时不可取消；「全部生成」按钮文案随选中数量变为「生成 N 篇回顾」。

自动生成队列从 `type: 'diary' | 'review'` 改为 `type: 'review'`，扫描逻辑改为检查当前选中 Prompt 索引与已存在记录的 `prompt_index` 差集。生成的回顾卡片在 sub-header 显示对应 `prompt_name`。

提供 E2E 测试验证多选边界、多 Prompt 独立生成与自动队列。

## Acceptance criteria
- [ ] 设置中 Prompt 配置为 5 槽且自定义槽位可改名
- [ ] 生成面板至少保留一个 Prompt 被选中
- [ ] 选中「日记 + 自定义一」后点击生成，出现两篇独立回顾卡片
- [ ] 自动生成队列仅针对当前选中的 Prompt 索引补发
- [ ] E2E 测试覆盖多选边界与生成结果验证
EOF

cat > "$TMPDIR/04-multimedia.md" <<'EOF'
## What to build
扩展碎屑输入面板，支持附加图片、音频、视频、链接。多媒体原始文件以 Blob 形式存入 IndexedDB，不压缩。

语音附件继续走 STT 并保留原文；图片 / 视频附件调用多模态模型生成文本摘要。设置中新增「生成回顾/明悟时是否向模型提交多媒体」开关。在向量索引中对多媒体摘要做 Embedding，同时保留原始文件引用。

提供 E2E 测试验证多媒体附件上传、摘要生成与开关生效。

## Acceptance criteria
- [ ] 碎屑输入支持图片、音频、视频、链接附件
- [ ] 原始多媒体文件本地保存且不压缩
- [ ] 图片/视频生成文本摘要并可用于后续检索
- [ ] 设置开关可控制生成时是否提交多媒体
- [ ] E2E 测试覆盖多媒体创建与摘要
EOF

cat > "$TMPDIR/05-thoughts.md" <<'EOF'
## What to build
新增 `thoughts` 表与独立页面，数据单元为 Markdown 文本 + 标签数组 + 附件数组 + `created_at` + `original_created_at`。

列表默认瀑布流展示，顶部提供「瀑布流 / 时间线」切换；时间线按修改后的创建时间分组。底部快速输入框，点击展开为 Blinko 风格富文本编辑器（格式工具栏、标签入口、附件入口）。双击记录进入编辑页/弹窗；支持修改创建时间但保留初始时间用于溯源。标签使用全局标签系统；附件原始文件存 IndexedDB。

提供 E2E 测试验证沉思 CRUD、视图切换与时间修改。

## Acceptance criteria
- [ ] 沉思页可创建 Markdown 笔记并带标签/附件
- [ ] 默认瀑布流展示，可切换时间线视图
- [ ] 双击记录可编辑内容与创建时间
- [ ] 修改创建时间后时间线分组正确，初始时间仍保留
- [ ] E2E 测试覆盖创建、编辑、视图切换
EOF

cat > "$TMPDIR/06-mingwu.md" <<'EOF'
## What to build
将原「洞察」升级为「明悟」模块，路由改为 `/mingwu`。页面保留日/周/月/季度/半年时间维度选择。

Prompt 配置区分为「明悟生成 Prompt」与「洞察生成 Prompt」，各 5 槽（默认槽位 + 自定义 1/2/3）。数据源为所选时间范围内的 `raw_logs` + `thoughts`；生成时根据设置决定是否提交多媒体。输出卡片区分「明悟」与「洞察」两类，并自动打上全局标签。

提供 E2E 测试验证明悟/洞察生成、数据源混合与时间范围选择。

## Acceptance criteria
- [ ] 明悟页可选择当日/周/月/季度/半年时间范围
- [ ] 选择「明悟」Prompt 生成后卡片包含碎屑与沉思的内容
- [ ] 同时存在「明悟」与「洞察」两类输出卡片
- [ ] AI 产出自动打全局标签
- [ ] E2E 测试覆盖生成流程与数据源混合
EOF

cat > "$TMPDIR/07-llm-chat.md" <<'EOF'
## What to build
在现有 Copilot 面板中新增模式切换：「RAG 问答」/「通用 Chat」。通用 Chat 不走 `retrieveCopilotContext`，仅将 messages 提交到新增 `/api/chat` 端点。

`copilot_conversations` 表新增 `mode` 字段；通用 Chat 会话标题从首条用户消息自动截取前 20 字。历史会话列表支持单条删除与单条导出（Markdown）。设置 -> 数据管理支持批量导入/导出所有聊天记录（Markdown + JSON），支持时间范围筛选。聊天记录不参与明悟/洞察数据源。

提供 E2E 测试验证模式切换、消息发送、历史标题生成与导出。

## Acceptance criteria
- [ ] Copilot 面板可在 RAG 问答与通用 Chat 间切换
- [ ] 通用 Chat 发送消息后收到模型回复
- [ ] 历史会话列表显示会话标题（首条消息前 20 字）
- [ ] 聊天记录可单独删除/导出，也可在数据管理中批量导入/导出
- [ ] E2E 测试覆盖聊天旅程
EOF

cat > "$TMPDIR/08-tts.md" <<'EOF'
## What to build
为回顾、明悟、洞察的 AI 产出以及 LLM Chat 的 AI 回复添加播放按钮。点击播放开始朗读，再次点击停止；播放状态在按钮上可见。

设置中选择 TTS 服务：浏览器 Web Speech API（默认）或外部 TTS API。朗读语言跟随当前内容语言检测，或允许用户指定默认朗读语言。不提供碎屑与沉思的自动朗读入口。

提供 E2E 测试验证 Web Speech API 被调用与设置切换。

## Acceptance criteria
- [ ] 回顾/明悟/洞察/Chat 的 AI 输出旁显示播放按钮
- [ ] 点击播放调用浏览器 Web Speech API 或外部 TTS API
- [ ] 设置中可切换 TTS 服务
- [ ] 碎屑与沉思不出现朗读按钮
- [ ] E2E 测试验证播放触发与服务切换
EOF

cat > "$TMPDIR/09-random-walk.md" <<'EOF'
## What to build
在沉思页面右上角添加灯泡图标作为随机漫步入口。默认数据源为 `thoughts` + `daily_reviews`；设置中可扩展为 `raw_logs` + `thoughts` + `daily_reviews` + `mingwu`。

每次随机抽取 3 条记录，过滤掉最近 7 天（可配置）已展示过的记录；展示历史存 `localStorage`。使用卡片堆叠滑动形态展示，参考 Blinko review 页。底部操作栏支持：已阅、标签、编辑、复制、删除。

提供 E2E 测试验证随机抽取、去重与操作。

## Acceptance criteria
- [ ] 沉思页右上角灯泡可进入随机漫步
- [ ] 每次展示 3 条近期未展示过的记录
- [ ] 卡片支持滑动浏览
- [ ] 已阅/标签/编辑/复制/删除操作可用
- [ ] E2E 测试覆盖随机抽取与去重
EOF

cat > "$TMPDIR/10-multilingual.md" <<'EOF'
## What to build
引入 i18n 框架，为中/英提供 UI 文案字典。设置中新增语言切换器；切换后 Prompt 配置也切换到对应语言版本（每种语言独立保存）。默认 Prompt 文案随语言切换自动更新。

内容输入不强制语言；语义检索继续使用 Gemini Embedding 的跨语言能力。

提供 E2E 测试验证语言切换后 UI 文案与 Prompt 名称同步变化。

## Acceptance criteria
- [ ] 设置可切换 UI 语言为中文或英文
- [ ] 切换语言后界面文案立即更新
- [ ] 切换语言后 Prompt 名称与默认文案切换到对应语言版本
- [ ] 中英混合输入可正常保存与检索
- [ ] E2E 测试覆盖语言切换旅程
EOF

cat > "$TMPDIR/11-data-management.md" <<'EOF'
## What to build
设置 -> 数据管理增加导出功能：选择时间范围、选择数据类型（碎屑/回顾/沉思/明悟/聊天记录）、选择格式（Markdown / JSON）。

导入功能：上传 JSON，按类型写入对应表；提供冲突策略「以导入为准」或「跳过」。聊天记录独立支持 Markdown + JSON 导入/导出。保留最近一次迁移的备份文件，用户可在设置中下载。

提供 E2E 测试验证导出文件结构与导入覆盖/跳过策略。

## Acceptance criteria
- [ ] 数据管理页可按时间范围与类型导出 Markdown/JSON
- [ ] 导入 JSON 时支持「以导入为准」和「跳过」两种冲突策略
- [ ] 聊天记录可单独导入/导出
- [ ] 最近一次迁移备份可在设置中下载
- [ ] E2E 测试覆盖导入/导出旅程
EOF

cat > "$TMPDIR/12-chunking.md" <<'EOF'
## What to build
重构所有文本内容的向量化流程，统一为清洗 -> 分块 -> Embedding -> 存储。分块基于 token 数，避免引入大型依赖；元数据统一携带 `source_type`、`source_id`、`created_at`、`tags`。

碎屑多媒体内容：对 AI 生成的文本摘要做 Embedding，同时保留原始文件引用以待未来多模态 Embedding。回顾/明悟/洞察的 AI 长文本按原文分块，不只索引摘要。

提供 E2E 测试验证分块元数据一致性与多媒体双索引。

## Acceptance criteria
- [ ] 所有文本内容进入同一分块 pipeline
- [ ] chunk 元数据包含 source_type、source_id、created_at、tags
- [ ] 碎屑多媒体摘要可被语义搜索命中
- [ ] 回顾/明悟/洞察正文细节可被语义搜索命中
- [ ] E2E 测试覆盖分块与检索
EOF

# Create issues sequentially; capture real issue numbers and feed into later blockers
FOUNDATION=$(create_issue "Foundation：Schema 迁移与导航重构" "$TMPDIR/01-foundation.md")
echo "Foundation: #$FOUNDATION"

TAGS=$(create_issue "全局标签系统" "$TMPDIR/02-tags.md" "$FOUNDATION")
echo "Tags: #$TAGS"

PROMPT_REVIEW=$(create_issue "Prompt 配置重构与回顾合并" "$TMPDIR/03-prompt-review.md" "$FOUNDATION")
echo "Prompt/Review: #$PROMPT_REVIEW"

MULTIMEDIA=$(create_issue "碎屑多媒体输入" "$TMPDIR/04-multimedia.md" "$FOUNDATION")
echo "Multimedia: #$MULTIMEDIA"

THOUGHTS=$(create_issue "沉思（Thoughts）笔记模块" "$TMPDIR/05-thoughts.md" "$FOUNDATION,$TAGS")
echo "Thoughts: #$THOUGHTS"

MINGWU=$(create_issue "明悟（Mingwu）模块" "$TMPDIR/06-mingwu.md" "$FOUNDATION,$TAGS,$THOUGHTS")
echo "Mingwu: #$MINGWU"

LLM_CHAT=$(create_issue "Copilot LLM Chat" "$TMPDIR/07-llm-chat.md" "$FOUNDATION")
echo "LLM Chat: #$LLM_CHAT"

TTS=$(create_issue "TTS 朗读" "$TMPDIR/08-tts.md" "$PROMPT_REVIEW,$MINGWU,$LLM_CHAT")
echo "TTS: #$TTS"

RANDOM_WALK=$(create_issue "随机漫步" "$TMPDIR/09-random-walk.md" "$FOUNDATION,$THOUGHTS")
echo "Random Walk: #$RANDOM_WALK"

MULTILINGUAL=$(create_issue "多语言 UI 与 Prompt" "$TMPDIR/10-multilingual.md" "$FOUNDATION,$PROMPT_REVIEW")
echo "Multilingual: #$MULTILINGUAL"

DATA_MGMT=$(create_issue "统一数据管理：导入/导出与迁移备份" "$TMPDIR/11-data-management.md" "$FOUNDATION,$LLM_CHAT")
echo "Data Management: #$DATA_MGMT"

CHUNKING=$(create_issue "统一分块与向量化 Pipeline" "$TMPDIR/12-chunking.md" "$FOUNDATION,$MULTIMEDIA,$THOUGHTS")
echo "Chunking: #$CHUNKING"

echo "---"
echo "All 12 child issues created under parent #$PARENT"
