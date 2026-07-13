# Progress - Seam 7: 提示词配置合并与数据迁移 (#008)

## 改动摘要

将提示词配置中重复/语义混淆的「明悟 / 洞察 / 日记 / 回顾」生成与摘要 Prompt 合并为统一结构，并提供 v11 -> v12 数据迁移。

### settings.store.ts

- **新增默认常量**：`DEFAULT_DIARY_REVIEW_SUMMARY_PROMPT`（zh/en）、`DEFAULT_MINGWU_INSIGHT_SUMMARY_PROMPT`（zh/en）；`DEFAULT_PROMPTS_BY_LANG` 同步增加 `diaryReviewSummary` / `mingwuInsightSummary` 键。
- **新增 5 槽标签常量** `DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG`（明悟/洞察/自定义1/2/3）。
- **SettingsState 新增字段**：
  - `mingwuInsightPrompts`（5 槽）、`mingwuInsightPromptNames`、`mingwuInsightPromptIndex`、`mingwuInsightSelectedIndices`、`mingwuInsightPrompt`
  - `diaryReviewSummaryPrompt`、`mingwuInsightSummaryPrompt`
  - 对应 per-language：`mingwuInsightPromptsByLang`、`mingwuInsightPromptNamesByLang`、`diaryReviewSummaryPromptByLang`、`mingwuInsightSummaryPromptByLang`
- **旧字段保留只读兼容**：`mingwuPrompt`/`mingwuPrompts`/`insightPrompt`/`insightPrompts`/`summaryPrompt`/`diarySummaryPrompt`/`insightSummaryPrompt` 均保留，由合并后字段反向同步（merge 与 setSettings 中统一派生），确保生成调度逻辑（server.ts / api/index.ts / app.store.ts）无需改动即可正常工作。
- **version 11 -> 12**；`migrate` 新增 v11->v12 分支：
  - `mingwuPrompt` + `insightPrompt` 合并到 `mingwuInsightPrompts`（slot0=明悟默认, slot1=洞察默认, slot2-4=共享自定义，优先保留明悟侧自定义）
  - `diarySummaryPrompt` + `summaryPrompt` 合并到 `diaryReviewSummaryPrompt`
  - `insightSummaryPrompt` 改名 `mingwuInsightSummaryPrompt` 并补明悟默认摘要
  - per-language *ByLang 结构同步合并
- **merge()** 新增合并后字段防污染（pad 5 槽、slot0/1 固定默认、init *ByLang）与旧字段反向同步。
- **setLanguage** 新增合并后字段的语言切换逻辑。
- **setSettings** 新增合并后字段的 per-language 同步 + 旧字段反向同步。

### Settings.tsx

- prompt tab 由 6 张卡片重构为 4 区块：
  1. **日记回顾生成 Prompt**（5 槽 日记/回顾/自定义1/2/3，保留自动生成选中复选框）— 原 Card 1，硬编码文案统一改用 i18n。
  2. **明悟和洞察生成 Prompt**（5 槽 明悟/洞察/自定义1/2/3，自动生成选中复选框）— 合并原明悟 Card + 洞察 Card。
  3. **日记回顾一句话摘要生成 Prompt** — 合并原日记摘要 + 回顾摘要。
  4. **明悟和洞察一句话摘要生成 Prompt** — 由原洞察摘要扩展，补明悟默认摘要。
- local state 由 `localMingwuPrompts`/`localInsightPrompts`/`localSummaryPrompt`/`localDiarySummaryPrompt`/`localInsightSummaryPrompt` 替换为 `localMingwuInsightPrompts`/`localMingwuInsightPromptNames`/`localMingwuInsightSelectedIndices`/`localMingwuInsightIndex`/`localDiaryReviewSummaryPrompt`/`localMingwuInsightSummaryPrompt`。
- 保存逻辑改写合并后字段；语言切换 useEffect 同步更新。

### i18n (zh.ts / en.ts)

- 新增键：`mingwuInsightPromptTitle`、`diaryReviewSummaryPromptTitle`、`mingwuInsightSummaryPromptTitle`、`promptMingwu`、`promptInsight`、`mingwuInsightPromptPlaceholder`、`diaryReviewSummaryPlaceholder`、`mingwuInsightSummaryPlaceholder`、`autoGenHintMingwuInsight`。

## lint / build 结果

- `npm run lint`（tsc --noEmit）：**通过**（首次即过）
- `npm run build`（vite build + esbuild server.ts）：**通过**（首次即过，仅有 chunk 体积与动态导入的预存警告，与本次改动无关）

## 遗留问题

1. **自动生成选中复选框未接入生成调度**：「明悟和洞察生成 Prompt」的 `mingwuInsightSelectedIndices` 复选框已存储选中状态，但按 issue Out of Scope 约定（不改动 AI 生成调度与任务队列逻辑），尚未将多选接入明悟/洞察的自动生成队列。当前明悟/洞察按需生成仍读取旧单字段（`mingwuPrompt`=slot0 明悟默认、`insightPrompt`=slot1 洞察默认），行为与升级前一致。后续 seam 可将复选框接入调度。
2. **旧自定义明悟 active prompt 行为变化**：v11 中若用户将 `mingwuPromptIndex` 设为自定义槽（如 1），则按需明悟生成使用该自定义 Prompt。v12 迁移后 active 明悟 Prompt 固定为 slot0（明悟默认），自定义内容保留在 slot2-4 但不再作为按需生成 active。这是合并设计的预期取舍（明悟/洞察共用一套配置），自定义内容未丢失。影响范围小（仅手动切换过明悟 active 槽的用户）。
3. 旧 i18n 键（`mingwuPromptTitle`/`insightPromptTitle`/`diarySummaryPromptTitle`/`reviewSummaryPromptTitle`/`insightSummaryPromptTitle` 等）已不再被 UI 引用，但保留在 zh.ts/en.ts 中以免破坏外部引用，可在后续清理。
