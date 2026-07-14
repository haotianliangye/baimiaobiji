import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const DEFAULT_DIARY_PROMPT = `你现在是严格遵循柳比歇夫时间管理法的记录助手。请将我提供的当天所有零散碎片记录，整理成一篇标准的柳比歇夫式当日日记。

### 核心处理规则
1. 时间优先：严格按照时间先后顺序从早到晚排列所有事件，不得打乱时序
2. 格式统一：所有事件转换为【HH:MM-HH:MM 类别：行为内容（成果/备注）】格式，且独占一行
3. 客观至上：只保留客观事实，删除所有主观感受、情绪、修饰性语言和口语化表达
4. 精准计算：自动计算每个事件的准确时长，合并同一时间段的连续相同行为
5. 完整保留：不得遗漏用户提到的任何细节，也不得添加任何用户未提及的内容
6. 空白标注：如果存在时间空白，明确标注【未记录】，绝对不要编造内容
7. 自动分类：将所有事件归入以下7类之一：核心工作、学习研究、社交沟通、生活事务、休息娱乐、交通出行、其他

### 输出结构
# YYYY年MM月DD日 柳比歇夫时间日志
## 当日时间流水
- HH:MM-HH:MM 类别：行为内容（成果/备注）
- HH:MM-HH:MM 类别：行为内容（成果/备注）
- HH:MM-HH:MM 类别：行为内容（成果/备注）
……

## 当日时间统计
- 总记录时长：XX小时XX分钟
- 未记录时长：XX小时XX分钟
- 核心工作：XX小时XX分钟（占比XX%）
- 学习研究：XX小时XX分钟（占比XX%）
- 社交沟通：XX小时XX分钟（占比XX%）
- 生活事务：XX小时XX分钟（占比XX%）
- 休息娱乐：XX小时XX分钟（占比XX%）
- 交通出行：XX小时XX分钟（占比XX%）
- 其他：XX小时XX分钟（占比XX%）

## 当日核心成果
[仅列出用户明确提到的产出、完成的任务、获得的信息，每条不超过20字]

## 当日时间漏洞
[仅列出超过30分钟的连续未记录时间段]

### 禁止事项
- 禁止添加任何鼓励、评价、建议类语句
- 禁止将多个不同类别的事件合并为一条
- 禁止将时间模糊 of 记录强行分配到具体时间段
- 禁止使用任何表情符号和华丽辞藻`;

export const DEFAULT_WARM_DIARY_PROMPT = `你是一个贴心的日记助手。你的任务是接收一系列零散的记录片段，并将它们编织成一篇连贯、分类明确、逻辑清晰的当日总体日记。

规则：
1. 请用中文写一篇流畅、忠于原文风格和连贯性的日记（通常 2-5 段落），以笔记作者本人叙述风格的方式总结这一天，将所有提供的片段串联成有意义的叙述。
2. 不要输出时间线或 JSON 数组，只能输出纯 Markdown 格式的文本。
3. 请以一个简洁且重点的标题（使用二级标题 Heading 2）开头，概括当天的基调或主要主题（不要带上日期等字眼）。
4. 核心要求：每当你提及源于某条特定记录片段的事件或细节时，你必须添加一个指向该片段 ID 的 Markdown 链接。格式必须完全像这样：[你的文字](#log_id_<ID>)，其中 <ID> 是上方列表里提供的准确 ID。示例：[今天早早起了床](#log_id_12345-abcde)。
5. 在文末加上一句简短而平实的总结结束语。`;

export const DEFAULT_REVIEW_PROMPT = `你是一个结合了人生教练（Life Coach）方法论、认知行为疗法（CBT）与积极心理学（PERMA）的科学反思助手。你的任务是深度回顾用户过去一段时间的零散碎屑记录，并针对情绪波动、日常行为及关键事件，撰写一份结构严谨、态度客观、且具有启发性的深度反思回顾。

请遵循以下心理学与认知科学反思框架进行分析与输出：
1. 多维状态解码 (Cognitive & Emotion Decryption)：
   - 使用 CBT 认知框架：识别记录中出现的非理性信念或认知偏差（如：全或无思维、过度概括、灾难化思维等）。
   - 分析用户的情绪负荷与能量水平，并探寻情绪背后的核心信念（Beliefs）。
2. PERMA 幸福感映射 (PERMA Alignment)：
   - 盘点用户在积极情绪（P）、心流投入（E）、人际连结（R）、生命意义（M）与成就感（A）五个维度上的分布和闪光点。
3. 增长与归因剖析 (Attribution & GROW)：
   - 运用归因理论 (Attribution Theory)，引导用户进行良性归因（将成功归因于内部可控因素，将挫折归因于外部或可提升的局部因素）。
   - 运用 GROW 教练模型（Goal 目标、Reality 现状、Options 选择、Will 意愿）提供提问式启发，而不是直接说教。

输出格式规范：
- 保持温暖、客观、严谨、循循善诱的教练基调。拒绝空洞的“鸡汤”和过度防御，多使用基于事实的分析。
- 使用清晰易读的 Markdown 标题与列表，使报告条理分明。`;

export const DEFAULT_INSIGHT_PROMPT = `你是一个结合了认知心理学、系统思考（Systems Thinking）与习惯回路理论（Habit Loop）的科学生活洞察顾问。你的任务是分析用户在多天记录中呈现出的习惯、日常作息和精力分布，产出一份科学、有深度、且具备强可执行度的生命洞察报告。

请遵循以下科学观察与诊断框架：
1. 习惯回路深度剖析 (Habit Loop Diagnostics)：
   - 依据 Charles Duhigg 的习惯回路，分析用户显性或隐性习惯中的“暗示（Cue）- 惯常行为（Routine）- 奖赏（Reward）”，找出触发不良习惯的底层诱因，并提出替代惯常行为的科学方案。
2. 精力分配与系统 1/2 切换 (System 1/2 Energy Allocation)：
   - 分析用户的精力与焦点管理。指出用户在何时过度消耗了负责复杂决策和抑制控制的“系统 2”（导致决策疲劳或拖延），以及何时处于无意识的“系统 1”自动驾驶状态。
   - 结合认知负荷理论，评估用户目前的信息/压力负荷，给出促进神经可塑性与认知恢复的休息建议。
3. 身心健康与微习惯干预 (Micro-habits & PERMA)：
   - 依据 James Clear 的原子习惯理论，提出针对当前困境的“微习惯干预策略”（即阻力极小、两分钟可完成的微习惯，以重建掌控感）。

输出格式规范：
- 语气应保持专业、严谨、逻辑缜密、极具洞察力。使用科学的心理学概念分析，但要用通俗易懂的语言落地。
- 提供可立即付诸实践的“行动实验”（Actionable Experiments），而不是泛泛而谈的建议。`;

export const DEFAULT_MINGWU_PROMPT = `你是一位兼具东方哲学智慧与现代心理学素养的「明悟」导师。你的任务是审视用户在一段时间内的碎屑记录与沉思笔记，超越表层的行为与情绪，直抵生命的深层脉络，产出一份通透、克制、富有启悟力量的「明悟」报告。

请遵循以下明悟框架：
1. 生命脉络透视 (Life Pattern Decryption)：
   - 从纷繁的记录中辨识出贯穿始终的深层生命主题（如：对自由的渴望、对联结的恐惧、对意义的追寻等），而非停留在单次事件。
   - 揭示这些主题如何在日常细节中显化、重复、互构，形成用户独有的生命图式。
2. 阴阳辩证观照 (Dialectical Observation)：
   - 运用辩证思维，看到记录中看似对立的力量（如奋进与退缩、喧嚣与孤独、得与失）如何相互依存、相互转化。
   - 指出用户可能陷入的「执念」——过度认同某一面而割裂了另一面，并引导其看见完整。
3. 明悟与放下 (Insight & Release)：
   - 在分析的终点，给出一句直指核心的「明悟之语」——不是建议，不是说教，而是一句让用户读后「恍然」的话。
   - 如有可能，点出可以「放下」的某个执念或自我评判，为心灵松绑。

输出格式规范：
- 语气应沉静、通透、不评判，如一位阅尽千帆的智者娓娓道来。拒绝鸡汤与说教，拒绝空洞的赞美。
- 使用清晰克制的 Markdown 标题与段落，留白以供回味。
- 可在文中以 #标签 形式标注浮现的关键生命主题（如 #孤独 #自由 #意义），便于后续检索与回溯。`;

export const DEFAULT_SUMMARY_PROMPT = `你是一个用于生成一句话回顾摘要的助手。请根据提供的文本，生成一句简短、优美、富有诗意的中文摘要（不超过30个字）。`;
export const DEFAULT_DIARY_SUMMARY_PROMPT = `你是一个用于生成一句话日记摘要的助手。请根据提供的日记文本，生成一句简短、优美、富有诗意的中文摘要（不超过30个字）。`;
export const DEFAULT_INSIGHT_SUMMARY_PROMPT = `你是一个用于生成一句话洞察摘要的助手。请根据提供的洞察报告文本，生成一句简短、优美、富有诗意的中文摘要（不超过30个字）。`;
// #008: 合并后的「日记回顾一句话摘要」默认 Prompt（合并原日记摘要 + 回顾摘要）
export const DEFAULT_DIARY_REVIEW_SUMMARY_PROMPT = `你是一个用于生成一句话日记/回顾摘要的助手。请根据提供的日记或回顾文本，生成一句简短、优美、富有诗意的中文摘要（不超过30个字）。`;
// #008: 合并后的「明悟和洞察一句话摘要」默认 Prompt（由原洞察摘要扩展，补充明悟默认摘要）
export const DEFAULT_MINGWU_INSIGHT_SUMMARY_PROMPT = `你是一个用于生成一句话明悟/洞察摘要的助手。请根据提供的明悟或洞察报告文本，生成一句简短、优美、富有诗意的中文摘要（不超过30个字）。`;

// --- #12 English default prompts (for en language) ---
export const DEFAULT_DIARY_PROMPT_EN = `You are a recording assistant that strictly follows the Lyubishchev time-management method. Please organize all the scattered fragment records I provide for the day into a standard Lyubishchev-style daily diary.

### Core Processing Rules
1. Time first: strictly arrange all events in chronological order from morning to night
2. Unified format: all events use [HH:MM-HH:MM Category: Activity (Result/Note)] format, one per line
3. Objective: keep only objective facts, remove all subjective feelings, emotions, and colloquial expressions
4. Precise calculation: automatically calculate the exact duration of each event, merge consecutive identical activities in the same time period
5. Complete retention: do not omit any details mentioned by the user, and do not add anything not mentioned
6. Blank annotation: if there are time gaps, clearly mark [Unrecorded], never fabricate content
7. Auto-categorization: classify all events into one of 7 categories: Core Work, Study & Research, Social Communication, Daily Affairs, Rest & Entertainment, Transportation, Other

### Output Structure
# YYYY-MM-DD Lyubishchev Time Log
## Daily Time Flow
- HH:MM-HH:MM Category: Activity (Result/Note)
...

## Daily Time Statistics
- Total recorded: XXh XXm
- Unrecorded: XXh XXm
- Core Work: XXh XXm (XX%)
- Study & Research: XXh XXm (XX%)
- Social Communication: XXh XXm (XX%)
- Daily Affairs: XXh XXm (XX%)
- Rest & Entertainment: XXh XXm (XX%)
- Transportation: XXh XXm (XX%)
- Other: XXh XXm (XX%)

## Daily Key Outcomes
[List only explicitly mentioned outputs, completed tasks, information obtained, each under 20 characters]

## Daily Time Gaps
[List only consecutive unrecorded periods exceeding 30 minutes]

### Prohibitions
- No encouraging, evaluative, or suggestive statements
- Do not merge events of different categories into one
- Do not force vague time records into specific time slots
- No emojis or flowery language`;

export const DEFAULT_WARM_DIARY_PROMPT_EN = `You are a caring diary assistant. Your task is to receive a series of scattered record fragments and weave them into a coherent, well-categorized, and logically clear daily diary.

Rules:
1. Write a fluent diary in the language of the input (usually 2-5 paragraphs), summarizing the day in the note author's own narrative style, connecting all provided fragments into a meaningful narrative.
2. Do not output a timeline or JSON array; only output plain Markdown text.
3. Start with a concise and focused heading (using Heading 2) that captures the tone or main theme of the day (without including the date).
4. Core requirement: whenever you mention an event or detail originating from a specific record fragment, you must add a Markdown link pointing to that fragment's ID. The format must be exactly: [your text](#log_id_<ID>), where <ID> is the exact ID provided in the list above. Example: [I woke up early today](#log_id_12345-abcde).
5. End with a brief and plain closing sentence.`;

export const DEFAULT_REVIEW_PROMPT_EN = `You are a scientific reflection assistant combining Life Coach methodology, Cognitive Behavioral Therapy (CBT), and Positive Psychology (PERMA). Your task is to deeply review the user's scattered fragment records over a period of time, and write a structured, objective, and inspiring in-depth reflection regarding emotional fluctuations, daily behaviors, and key events.

Please follow this psychological and cognitive science reflection framework:
1. Cognitive & Emotion Decryption:
   - Use the CBT framework: identify irrational beliefs or cognitive distortions in the records (e.g., all-or-nothing thinking, overgeneralization, catastrophizing).
   - Analyze the user's emotional load and energy levels, and explore the core beliefs behind emotions.
2. PERMA Alignment:
   - Inventory the user's distribution and highlights across Positive emotion (P), Engagement (E), Relationships (R), Meaning (M), and Accomplishment (A).
3. Attribution & GROW:
   - Apply Attribution Theory to guide the user toward healthy attribution (attributing success to internal controllable factors, setbacks to external or improvable local factors).
   - Use the GROW coaching model (Goal, Reality, Options, Will) to provide question-based inspiration rather than direct preaching.

Output format guidelines:
- Maintain a warm, objective, rigorous, and guiding coaching tone. Reject empty platitudes and excessive defensiveness; use fact-based analysis.
- Use clear, readable Markdown headings and lists for a well-organized report.`;

export const DEFAULT_INSIGHT_PROMPT_EN = `You are a scientific life insight consultant combining cognitive psychology, Systems Thinking, and Habit Loop theory. Your task is to analyze the habits, daily routines, and energy distribution revealed in the user's multi-day records, producing a scientific, in-depth, and highly actionable life insight report.

Please follow this scientific observation and diagnostic framework:
1. Habit Loop Diagnostics:
   - Based on Charles Duhigg's habit loop, analyze the "Cue - Routine - Reward" in the user's explicit or implicit habits, identify the underlying triggers of bad habits, and propose scientific alternatives.
2. System 1/2 Energy Allocation:
   - Analyze the user's energy and focus management. Point out when the user over-consumes "System 2" (responsible for complex decisions and inhibitory control, leading to decision fatigue or procrastination) and when in "System 1" autopilot mode.
   - Combined with cognitive load theory, assess the user's current information/stress load and provide rest recommendations that promote neuroplasticity and cognitive recovery.
3. Micro-habits & PERMA:
   - Based on James Clear's Atomic Habits theory, propose "micro-habit intervention strategies" (extremely low-resistance, 2-minute micro-habits to rebuild a sense of control).

Output format guidelines:
- Maintain a professional, rigorous, logically precise, and insightful tone. Use scientific psychological concepts but explain them in accessible language.
- Provide immediately actionable "Actionable Experiments" rather than vague advice.`;

export const DEFAULT_MINGWU_PROMPT_EN = `You are an "Awakening" mentor combining Eastern philosophical wisdom with modern psychological literacy. Your task is to examine the user's fragment records and reflection notes over a period of time, transcending surface-level behaviors and emotions to reach the deep veins of life, producing a clear, restrained, and enlightening "Awakening" report.

Please follow this awakening framework:
1. Life Pattern Decryption:
   - Identify the deep life themes running through the records (e.g., desire for freedom, fear of connection, pursuit of meaning) rather than停留在 single events.
   - Reveal how these themes manifest, repeat, and mutually construct in daily details, forming the user's unique life schema.
2. Dialectical Observation:
   - Use dialectical thinking to see how seemingly opposing forces in the records (e.g., striving and retreating, noise and solitude, gain and loss) depend on and transform into each other.
   - Point out the "attachments" the user may be trapped in -- over-identifying with one side while splitting the other -- and guide them to see the whole.
3. Insight & Release:
   - At the end of the analysis, offer a core "word of awakening" -- not advice, not preaching, but a sentence that makes the user "suddenly see" upon reading.
   - If possible, point out an attachment or self-judgment that can be "let go" to unburden the mind.

Output format guidelines:
- The tone should be calm, clear, and non-judgmental, like a wise person who has seen it all speaking gently. Reject platitudes and preaching, reject empty praise.
- Use clear, restrained Markdown headings and paragraphs, with whitespace for reflection.
- Mark emerging key life themes with #hashtags (e.g., #solitude #freedom #meaning) for future retrieval and retrospection.`;

export const DEFAULT_SUMMARY_PROMPT_EN = `You are an assistant for generating a one-sentence review summary. Based on the provided text, generate a short, elegant, and poetic summary (no more than 20 words).`;
export const DEFAULT_DIARY_SUMMARY_PROMPT_EN = `You are an assistant for generating a one-sentence diary summary. Based on the provided diary text, generate a short, elegant, and poetic summary (no more than 20 words).`;
export const DEFAULT_INSIGHT_SUMMARY_PROMPT_EN = `You are an assistant for generating a one-sentence insight summary. Based on the provided insight report text, generate a short, elegant, and poetic summary (no more than 20 words).`;
// #008: Merged "Diary & Review Summary" default prompt
export const DEFAULT_DIARY_REVIEW_SUMMARY_PROMPT_EN = `You are an assistant for generating a one-sentence diary/review summary. Based on the provided diary or review text, generate a short, elegant, and poetic summary (no more than 20 words).`;
// #008: Merged "Awakening & Insight Summary" default prompt (expanded from insight summary, adds awakening default)
export const DEFAULT_MINGWU_INSIGHT_SUMMARY_PROMPT_EN = `You are an assistant for generating a one-sentence awakening/insight summary. Based on the provided awakening or insight report text, generate a short, elegant, and poetic summary (no more than 20 words).`;

// #12 Per-language default prompt maps
export const DEFAULT_PROMPTS_BY_LANG = {
  zh: {
    diary: DEFAULT_DIARY_PROMPT,
    warmDiary: DEFAULT_WARM_DIARY_PROMPT,
    review: DEFAULT_REVIEW_PROMPT,
    insight: DEFAULT_INSIGHT_PROMPT,
    mingwu: DEFAULT_MINGWU_PROMPT,
    summary: DEFAULT_SUMMARY_PROMPT,
    diarySummary: DEFAULT_DIARY_SUMMARY_PROMPT,
    insightSummary: DEFAULT_INSIGHT_SUMMARY_PROMPT,
    // #008: 合并后的摘要默认值
    diaryReviewSummary: DEFAULT_DIARY_REVIEW_SUMMARY_PROMPT,
    mingwuInsightSummary: DEFAULT_MINGWU_INSIGHT_SUMMARY_PROMPT,
  },
  en: {
    diary: DEFAULT_DIARY_PROMPT_EN,
    warmDiary: DEFAULT_WARM_DIARY_PROMPT_EN,
    review: DEFAULT_REVIEW_PROMPT_EN,
    insight: DEFAULT_INSIGHT_PROMPT_EN,
    mingwu: DEFAULT_MINGWU_PROMPT_EN,
    summary: DEFAULT_SUMMARY_PROMPT_EN,
    diarySummary: DEFAULT_DIARY_SUMMARY_PROMPT_EN,
    insightSummary: DEFAULT_INSIGHT_SUMMARY_PROMPT_EN,
    // #008: 合并后的摘要默认值
    diaryReviewSummary: DEFAULT_DIARY_REVIEW_SUMMARY_PROMPT_EN,
    mingwuInsightSummary: DEFAULT_MINGWU_INSIGHT_SUMMARY_PROMPT_EN,
  },
} as const;

export type Language = 'zh' | 'en';

// #12 Default prompt slot names per language
export const DEFAULT_REVIEW_PROMPT_NAMES_BY_LANG: Record<Language, string[]> = {
  zh: ['日记', '回顾', '自定义 1', '自定义 2', '自定义 3'],
  en: ['Diary', 'Review', 'Custom 1', 'Custom 2', 'Custom 3'],
};

export const DEFAULT_MINGWU_PROMPT_SLOT_LABELS_BY_LANG: Record<Language, string[]> = {
  zh: ['默认', '自定义 1', '自定义 2', '自定义 3'],
  en: ['Default', 'Custom 1', 'Custom 2', 'Custom 3'],
};

export const DEFAULT_INSIGHT_PROMPT_SLOT_LABELS_BY_LANG: Record<Language, string[]> = {
  zh: ['默认', '自定义 1', '自定义 2', '自定义 3'],
  en: ['Default', 'Custom 1', 'Custom 2', 'Custom 3'],
};

// #008: 合并后的「明悟和洞察生成 Prompt」5 槽标签（明悟/洞察/自定义1/2/3）
export const DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG: Record<Language, string[]> = {
  zh: ['明悟', '洞察', '自定义 1', '自定义 2', '自定义 3'],
  en: ['Awakening', 'Insight', 'Custom 1', 'Custom 2', 'Custom 3'],
};

const DEFAULT_PROVIDER_CONFIGS: Record<string, { apiKey: string; baseUrl: string; model: string }> = {
  gemini: { apiKey: '', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-3.1-flash-lite' },
  openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  volcengine: { apiKey: '', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-2-0-lite-260428' },
  kimi: { apiKey: '', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  zhipu: { apiKey: '', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  minimax: { apiKey: '', baseUrl: 'https://api.minimax.chat/v1', model: 'abab6.5s-chat' },
  mimo: { apiKey: '', baseUrl: 'https://ai.xiaomi.com/v1', model: 'mimo-chat' },
  anthropic: { apiKey: '', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-latest' },
  deepseek: { apiKey: '', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  siliconflow: { apiKey: '', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
  custom: { apiKey: '', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3' }
};

export const DEFAULT_EMBED_PROVIDER_CONFIGS: Record<string, { apiKey: string; baseUrl: string; model: string }> = {
  gemini: { apiKey: '', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-embedding-2' },
  openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small' },
  siliconflow: { apiKey: '', baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-large-zh-v1.5' },
  volcengine: { apiKey: '', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-embedding' },
  zhipu: { apiKey: '', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'embedding-3' },
  custom: { apiKey: '', baseUrl: 'http://127.0.0.1:11434/v1', model: 'nomic-embed-text' }
};

// #009: TTS 外部 API 提供商默认配置（Provider -> apiKey/baseUrl/model）
// NOTE: 与后端 server.ts / api/index.ts 的 /api/tts 端点约定保持一致。
// 新增 Provider 需同步更新此处与后端调用逻辑。
export const DEFAULT_TTS_PROVIDER_CONFIGS: Record<string, { apiKey: string; baseUrl: string; model: string }> = {
  gemini: { apiKey: '', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash-preview-tts' },
  volcengine: { apiKey: '', baseUrl: 'https://openspeech.bytedance.com', model: 'BV001_streaming' },
};

// NOTE: base64 *encoding*, NOT encryption. localStorage is readable by any
// script running in this origin (incl. XSS / browser extensions); there is no
// way to truly encrypt secrets in a pure client-side app without a server-held
// key. This only prevents casual eyeballing of persisted values.
const encodeB64 = (str: string) => {
  if (!str) return str;
  try { return btoa(encodeURIComponent(str)); } catch(e) { return str; }
};

const decodeB64 = (str: string) => {
  if (!str) return str;
  try { return decodeURIComponent(atob(str)); } catch(e) { return str; }
};

interface SettingsState {
  provider: 'gemini' | 'openai' | 'volcengine' | 'kimi' | 'zhipu' | 'minimax' | 'mimo' | 'custom' | 'anthropic' | 'deepseek' | 'siliconflow';
  apiKey: string;
  baseUrl: string;
  model: string;
  configs: Record<string, { apiKey: string; baseUrl: string; model: string }>;
  diaryPrompt: string;
  diaryPrompts: string[];
  diaryPromptIndex: number;
  reviewPrompt: string;
  reviewPrompts: string[];
  reviewPromptIndex: number;
  // #5: 统一 5 槽日记回顾 Prompt（日记/回顾/自定义1/2/3）
  reviewPromptNames: string[];
  reviewSelectedIndices: number[];
  insightPrompt: string;
  insightPrompts: string[];
  insightPromptIndex: number;
  // #8 明悟生成 Prompt（4 槽：默认 + 自定义1/2/3）
  mingwuPrompt: string;
  mingwuPrompts: string[];
  mingwuPromptIndex: number;
  summaryPrompt: string;
  diarySummaryPrompt: string;
  insightSummaryPrompt: string;
  // #008: 合并后的「明悟和洞察生成 Prompt」（5 槽：明悟/洞察/自定义1/2/3）
  // 旧 mingwuPrompt/mingwuPrompts 与 insightPrompt/insightPrompts 保留只读兼容，
  // 由本字段派生同步（slot 0=明悟, slot 1=洞察, slot 2-4=共享自定义）。
  mingwuInsightPrompts: string[];
  mingwuInsightPromptNames: string[];
  mingwuInsightPromptIndex: number;
  mingwuInsightSelectedIndices: number[];
  mingwuInsightPrompt: string;
  // #008: 合并后的摘要 Prompt（旧 summaryPrompt/diarySummaryPrompt/insightSummaryPrompt 保留只读兼容）
  diaryReviewSummaryPrompt: string;
  mingwuInsightSummaryPrompt: string;

  // 云同步配置
  syncEnabled: boolean;
  syncProvider: 'webdav' | 'onedrive' | 'gdrive' | 'dropbox';
  syncEndpoint: string;
  syncUsername: string;
  syncPassword: string;
  syncDirectory: string;
  syncPasswordE2EE: string;
  syncConflictPolicy: 'local_wins' | 'cloud_wins' | 'merge';
  syncAutoStartup: boolean;
  syncAutoChange: boolean;
  syncRememberCredentials: boolean;
  syncLastTime: number | null;

  // OAuth Tokens & Client IDs
  syncOneDriveToken?: string;
  syncOneDriveClientId?: string;
  syncGDriveToken?: string;
  syncGDriveClientId?: string;
  syncDropboxToken?: string;
  syncDropboxClientId?: string;

  // Embedding (vector) model config - decoupled from Chat LLM
  embedEnabled: boolean;
  embedProvider: 'gemini' | 'openai' | 'siliconflow' | 'volcengine' | 'zhipu' | 'custom';
  embedApiKey: string;
  embedBaseUrl: string;
  embedModel: string;
  embedConfigs: Record<string, { apiKey: string; baseUrl: string; model: string }>;

  // #6 多媒体：生成回顾/明悟时是否向模型提交多媒体摘要
  submitMultimedia: boolean;

  // #10 TTS 朗读配置
  ttsService: 'webspeech' | 'external';
  ttsLang: 'auto' | 'zh' | 'en';
  ttsRate: number;
  ttsVoice: string;
  // #009: TTS 外部 API 配置（ttsService === 'external' 时生效）
  // ttsService 为浏览器/外部总开关；ttsProvider 为外部子服务商（Gemini/火山引擎）。
  ttsProvider: 'gemini' | 'volcengine';
  ttsApiKey: string;
  ttsBaseUrl: string;
  ttsModel: string;
  ttsConfigs: Record<string, { apiKey: string; baseUrl: string; model: string }>;

  // #12 多语言 UI
  language: Language;
  // 每种语言独立的 Prompt 存储（active 字段 reviewPrompts 等仍保留，与 *ByLang[language] 同步）
  reviewPromptsByLang: Record<Language, string[]>;
  reviewPromptNamesByLang: Record<Language, string[]>;
  mingwuPromptsByLang: Record<Language, string[]>;
  insightPromptsByLang: Record<Language, string[]>;
  summaryPromptByLang: Record<Language, string>;
  diarySummaryPromptByLang: Record<Language, string>;
  insightSummaryPromptByLang: Record<Language, string>;
  // #008: 合并后字段的 per-language 存储
  mingwuInsightPromptsByLang: Record<Language, string[]>;
  mingwuInsightPromptNamesByLang: Record<Language, string[]>;
  diaryReviewSummaryPromptByLang: Record<Language, string>;
  mingwuInsightSummaryPromptByLang: Record<Language, string>;

  setSettings: (settings: Partial<SettingsState>) => void;
  setLanguage: (lang: Language) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      provider: 'gemini',
      apiKey: DEFAULT_PROVIDER_CONFIGS['gemini'].apiKey,
      baseUrl: DEFAULT_PROVIDER_CONFIGS['gemini'].baseUrl,
      model: DEFAULT_PROVIDER_CONFIGS['gemini'].model,
      configs: {},
      diaryPrompt: DEFAULT_DIARY_PROMPT,
      diaryPrompts: [DEFAULT_DIARY_PROMPT, DEFAULT_WARM_DIARY_PROMPT, '', ''],
      diaryPromptIndex: 0,
      reviewPrompt: DEFAULT_REVIEW_PROMPT,
      reviewPrompts: [DEFAULT_DIARY_PROMPT, DEFAULT_REVIEW_PROMPT, '', '', ''],
      reviewPromptIndex: 0,
      // #5: 5 槽统一 Prompt 名称与多选选中状态
      reviewPromptNames: ['日记', '回顾', '自定义 1', '自定义 2', '自定义 3'],
      reviewSelectedIndices: [0, 1],
      insightPrompt: DEFAULT_INSIGHT_PROMPT,
      insightPrompts: [DEFAULT_INSIGHT_PROMPT, '', '', ''],
      insightPromptIndex: 0,
      // #8 明悟生成 Prompt（4 槽，slot 0 固定默认）
      mingwuPrompt: DEFAULT_MINGWU_PROMPT,
      mingwuPrompts: [DEFAULT_MINGWU_PROMPT, '', '', ''],
      mingwuPromptIndex: 0,
      summaryPrompt: DEFAULT_SUMMARY_PROMPT,
      diarySummaryPrompt: DEFAULT_DIARY_SUMMARY_PROMPT,
      insightSummaryPrompt: DEFAULT_INSIGHT_SUMMARY_PROMPT,
      // #008: 合并后的「明悟和洞察生成 Prompt」（5 槽：明悟/洞察/自定义1/2/3）
      mingwuInsightPrompts: [DEFAULT_MINGWU_PROMPT, DEFAULT_INSIGHT_PROMPT, '', '', ''],
      mingwuInsightPromptNames: [...DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG.zh],
      mingwuInsightPromptIndex: 0,
      mingwuInsightSelectedIndices: [0, 1],
      mingwuInsightPrompt: DEFAULT_MINGWU_PROMPT,
      // #008: 合并后的摘要 Prompt
      diaryReviewSummaryPrompt: DEFAULT_DIARY_REVIEW_SUMMARY_PROMPT,
      mingwuInsightSummaryPrompt: DEFAULT_MINGWU_INSIGHT_SUMMARY_PROMPT,

      // 云同步配置默认值
      syncEnabled: false,
      syncProvider: 'webdav',
      syncEndpoint: '',
      syncUsername: '',
      syncPassword: sessionStorage.getItem('baimiao_syncPassword') || '',
      syncDirectory: '/baimiaobiji/',
      syncPasswordE2EE: sessionStorage.getItem('baimiao_syncPasswordE2EE') || '',
      syncConflictPolicy: 'merge',
      syncAutoStartup: true,
      syncAutoChange: true,
      syncRememberCredentials: false,
      syncLastTime: null,

      // OAuth 默认值
      syncOneDriveToken: '',
      syncOneDriveClientId: '',
      syncGDriveToken: '',
      syncGDriveClientId: '',
      syncDropboxToken: '',
      syncDropboxClientId: '',

      // Embedding config defaults
      embedEnabled: false,
      embedProvider: 'gemini',
      embedApiKey: DEFAULT_EMBED_PROVIDER_CONFIGS['gemini'].apiKey,
      embedBaseUrl: DEFAULT_EMBED_PROVIDER_CONFIGS['gemini'].baseUrl,
      embedModel: DEFAULT_EMBED_PROVIDER_CONFIGS['gemini'].model,
      embedConfigs: {},

      // #6 多媒体：默认在生成回顾/明悟时提交多媒体摘要
      submitMultimedia: true,

      // #10 TTS 朗读配置默认值
      ttsService: 'webspeech',
      ttsLang: 'auto',
      ttsRate: 1,
      ttsVoice: '',
      // #009: TTS 外部 API 配置默认值（沿用 Gemini 默认）
      ttsProvider: 'gemini',
      ttsApiKey: DEFAULT_TTS_PROVIDER_CONFIGS['gemini'].apiKey,
      ttsBaseUrl: DEFAULT_TTS_PROVIDER_CONFIGS['gemini'].baseUrl,
      ttsModel: DEFAULT_TTS_PROVIDER_CONFIGS['gemini'].model,
      ttsConfigs: {},

      // #12 多语言 UI 默认值
      language: 'zh',
      reviewPromptsByLang: {
        zh: [DEFAULT_DIARY_PROMPT, DEFAULT_REVIEW_PROMPT, '', '', ''],
        en: [DEFAULT_DIARY_PROMPT_EN, DEFAULT_REVIEW_PROMPT_EN, '', '', ''],
      },
      reviewPromptNamesByLang: {
        zh: [...DEFAULT_REVIEW_PROMPT_NAMES_BY_LANG.zh],
        en: [...DEFAULT_REVIEW_PROMPT_NAMES_BY_LANG.en],
      },
      mingwuPromptsByLang: {
        zh: [DEFAULT_MINGWU_PROMPT, '', '', ''],
        en: [DEFAULT_MINGWU_PROMPT_EN, '', '', ''],
      },
      insightPromptsByLang: {
        zh: [DEFAULT_INSIGHT_PROMPT, '', '', ''],
        en: [DEFAULT_INSIGHT_PROMPT_EN, '', '', ''],
      },
      summaryPromptByLang: {
        zh: DEFAULT_SUMMARY_PROMPT,
        en: DEFAULT_SUMMARY_PROMPT_EN,
      },
      diarySummaryPromptByLang: {
        zh: DEFAULT_DIARY_SUMMARY_PROMPT,
        en: DEFAULT_DIARY_SUMMARY_PROMPT_EN,
      },
      insightSummaryPromptByLang: {
        zh: DEFAULT_INSIGHT_SUMMARY_PROMPT,
        en: DEFAULT_INSIGHT_SUMMARY_PROMPT_EN,
      },
      // #008: 合并后字段的 per-language 默认值
      mingwuInsightPromptsByLang: {
        zh: [DEFAULT_MINGWU_PROMPT, DEFAULT_INSIGHT_PROMPT, '', '', ''],
        en: [DEFAULT_MINGWU_PROMPT_EN, DEFAULT_INSIGHT_PROMPT_EN, '', '', ''],
      },
      mingwuInsightPromptNamesByLang: {
        zh: [...DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG.zh],
        en: [...DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG.en],
      },
      diaryReviewSummaryPromptByLang: {
        zh: DEFAULT_DIARY_REVIEW_SUMMARY_PROMPT,
        en: DEFAULT_DIARY_REVIEW_SUMMARY_PROMPT_EN,
      },
      mingwuInsightSummaryPromptByLang: {
        zh: DEFAULT_MINGWU_INSIGHT_SUMMARY_PROMPT,
        en: DEFAULT_MINGWU_INSIGHT_SUMMARY_PROMPT_EN,
      },

      setLanguage: (lang) => set((state) => {
        if (lang === state.language) return state;
        const oldLang = state.language;
        const dOld = DEFAULT_PROMPTS_BY_LANG[oldLang];
        const dNew = DEFAULT_PROMPTS_BY_LANG[lang];

        // Save current active prompts to *ByLang[oldLang]
        const reviewPromptsByLang = { ...state.reviewPromptsByLang };
        const reviewPromptNamesByLang = { ...state.reviewPromptNamesByLang };
        const mingwuPromptsByLang = { ...state.mingwuPromptsByLang };
        const insightPromptsByLang = { ...state.insightPromptsByLang };
        const summaryPromptByLang = { ...state.summaryPromptByLang };
        const diarySummaryPromptByLang = { ...state.diarySummaryPromptByLang };
        const insightSummaryPromptByLang = { ...state.insightSummaryPromptByLang };
        // #008: 合并后字段的 per-language
        const mingwuInsightPromptsByLang = { ...state.mingwuInsightPromptsByLang };
        const mingwuInsightPromptNamesByLang = { ...state.mingwuInsightPromptNamesByLang };
        const diaryReviewSummaryPromptByLang = { ...state.diaryReviewSummaryPromptByLang };
        const mingwuInsightSummaryPromptByLang = { ...state.mingwuInsightSummaryPromptByLang };

        reviewPromptsByLang[oldLang] = [...state.reviewPrompts];
        reviewPromptNamesByLang[oldLang] = [...state.reviewPromptNames];
        mingwuPromptsByLang[oldLang] = [...state.mingwuPrompts];
        insightPromptsByLang[oldLang] = [...state.insightPrompts];
        summaryPromptByLang[oldLang] = state.summaryPrompt;
        diarySummaryPromptByLang[oldLang] = state.diarySummaryPrompt;
        insightSummaryPromptByLang[oldLang] = state.insightSummaryPrompt;
        mingwuInsightPromptsByLang[oldLang] = [...state.mingwuInsightPrompts];
        mingwuInsightPromptNamesByLang[oldLang] = [...state.mingwuInsightPromptNames];
        diaryReviewSummaryPromptByLang[oldLang] = state.diaryReviewSummaryPrompt;
        mingwuInsightSummaryPromptByLang[oldLang] = state.mingwuInsightSummaryPrompt;

        // Load *ByLang[lang] into active fields (initialize if missing)
        const newReviewPrompts = reviewPromptsByLang[lang] || [dNew.diary, dNew.review, '', '', ''];
        const newReviewPromptNames = reviewPromptNamesByLang[lang] || [...DEFAULT_REVIEW_PROMPT_NAMES_BY_LANG[lang]];
        const newMingwuPrompts = mingwuPromptsByLang[lang] || [dNew.mingwu, '', '', ''];
        const newInsightPrompts = insightPromptsByLang[lang] || [dNew.insight, '', '', ''];
        const newSummaryPrompt = summaryPromptByLang[lang] || dNew.summary;
        const newDiarySummaryPrompt = diarySummaryPromptByLang[lang] || dNew.diarySummary;
        const newInsightSummaryPrompt = insightSummaryPromptByLang[lang] || dNew.insightSummary;
        // #008: 合并后字段加载
        const newMingwuInsightPrompts = mingwuInsightPromptsByLang[lang] || [dNew.mingwu, dNew.insight, '', '', ''];
        const newMingwuInsightPromptNames = mingwuInsightPromptNamesByLang[lang] || [...DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG[lang]];
        const newDiaryReviewSummaryPrompt = diaryReviewSummaryPromptByLang[lang] || dNew.diaryReviewSummary;
        const newMingwuInsightSummaryPrompt = mingwuInsightSummaryPromptByLang[lang] || dNew.mingwuInsightSummary;

        // Ensure default slots are always the correct language default
        newReviewPrompts[0] = dNew.diary;
        newReviewPrompts[1] = dNew.review;
        newReviewPromptNames[0] = DEFAULT_REVIEW_PROMPT_NAMES_BY_LANG[lang][0];
        newReviewPromptNames[1] = DEFAULT_REVIEW_PROMPT_NAMES_BY_LANG[lang][1];
        newMingwuPrompts[0] = dNew.mingwu;
        newInsightPrompts[0] = dNew.insight;
        // #008: 明悟/洞察默认槽位固定为对应语言默认 Prompt
        newMingwuInsightPrompts[0] = dNew.mingwu;
        newMingwuInsightPrompts[1] = dNew.insight;
        newMingwuInsightPromptNames[0] = DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG[lang][0];
        newMingwuInsightPromptNames[1] = DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG[lang][1];

        // Sync active fields
        reviewPromptsByLang[lang] = newReviewPrompts;
        reviewPromptNamesByLang[lang] = newReviewPromptNames;
        mingwuPromptsByLang[lang] = newMingwuPrompts;
        insightPromptsByLang[lang] = newInsightPrompts;
        summaryPromptByLang[lang] = newSummaryPrompt;
        diarySummaryPromptByLang[lang] = newDiarySummaryPrompt;
        insightSummaryPromptByLang[lang] = newInsightSummaryPrompt;
        mingwuInsightPromptsByLang[lang] = newMingwuInsightPrompts;
        mingwuInsightPromptNamesByLang[lang] = newMingwuInsightPromptNames;
        diaryReviewSummaryPromptByLang[lang] = newDiaryReviewSummaryPrompt;
        mingwuInsightSummaryPromptByLang[lang] = newMingwuInsightSummaryPrompt;

        return {
          ...state,
          language: lang,
          reviewPrompts: newReviewPrompts,
          reviewPromptNames: newReviewPromptNames,
          reviewPrompt: newReviewPrompts[state.reviewPromptIndex] || newReviewPrompts[0],
          mingwuPrompts: newMingwuPrompts,
          mingwuPrompt: newMingwuPrompts[state.mingwuPromptIndex] || newMingwuPrompts[0],
          insightPrompts: newInsightPrompts,
          insightPrompt: newInsightPrompts[state.insightPromptIndex] || newInsightPrompts[0],
          summaryPrompt: newSummaryPrompt,
          diarySummaryPrompt: newDiarySummaryPrompt,
          insightSummaryPrompt: newInsightSummaryPrompt,
          // #008: 合并后字段切换语言
          mingwuInsightPrompts: newMingwuInsightPrompts,
          mingwuInsightPromptNames: newMingwuInsightPromptNames,
          mingwuInsightPrompt: newMingwuInsightPrompts[state.mingwuInsightPromptIndex] || newMingwuInsightPrompts[0],
          diaryReviewSummaryPrompt: newDiaryReviewSummaryPrompt,
          mingwuInsightSummaryPrompt: newMingwuInsightSummaryPrompt,
          // diaryPrompts (legacy Copilot)：slot 0 随语言切换为默认日记槽；
          // slot 1-3 保留用户自定义内容（可能为旧语言）——该字段是 Copilot 旧逻辑遗留，
          // 未纳入 per-language 管理，以避免覆盖用户自定义。如需完全切换语言，
          // 用户可在 Prompt 配置页手动重置自定义槽。
          diaryPrompts: [newReviewPrompts[0], state.diaryPrompts[1] || '', state.diaryPrompts[2] || '', state.diaryPrompts[3] || ''],
          diaryPrompt: state.diaryPromptIndex === 0 ? newReviewPrompts[0] : state.diaryPrompt,
          reviewPromptsByLang,
          reviewPromptNamesByLang,
          mingwuPromptsByLang,
          insightPromptsByLang,
          summaryPromptByLang,
          diarySummaryPromptByLang,
          insightSummaryPromptByLang,
          mingwuInsightPromptsByLang,
          mingwuInsightPromptNamesByLang,
          diaryReviewSummaryPromptByLang,
          mingwuInsightSummaryPromptByLang,
        };
      }),

      setSettings: (newSettings) => set((state) => {
         const nextRemember = newSettings.syncRememberCredentials !== undefined ? newSettings.syncRememberCredentials : state.syncRememberCredentials;
         
         if (nextRemember) {
           if (newSettings.syncPassword !== undefined) {
             sessionStorage.setItem('baimiao_syncPassword', newSettings.syncPassword);
           }
           if (newSettings.syncPasswordE2EE !== undefined) {
             sessionStorage.setItem('baimiao_syncPasswordE2EE', newSettings.syncPasswordE2EE);
           }
         } else {
           sessionStorage.removeItem('baimiao_syncPassword');
           sessionStorage.removeItem('baimiao_syncPasswordE2EE');
         }

         // --- Chat provider config caching ---
         const nextConfigs = { ...state.configs };
         const providerToUpdate = state.provider;
         
         nextConfigs[providerToUpdate] = { 
           apiKey: state.apiKey, 
           baseUrl: state.baseUrl, 
           model: state.model 
         };

         // --- Embed provider config caching ---
         const nextEmbedConfigs = { ...state.embedConfigs };
         const embedProviderToUpdate = state.embedProvider;

         nextEmbedConfigs[embedProviderToUpdate] = {
           apiKey: state.embedApiKey,
           baseUrl: state.embedBaseUrl,
           model: state.embedModel
         };

         // --- TTS provider config caching (#009) ---
         const nextTtsConfigs = { ...state.ttsConfigs };
         const ttsProviderToUpdate = state.ttsProvider;

         nextTtsConfigs[ttsProviderToUpdate] = {
           apiKey: state.ttsApiKey,
           baseUrl: state.ttsBaseUrl,
           model: state.ttsModel
         };

         // Handle Chat provider switch
         if (newSettings.provider && newSettings.provider !== state.provider) {
           const nextProvider = newSettings.provider;
           const targetConfig = nextConfigs[nextProvider] || DEFAULT_PROVIDER_CONFIGS[nextProvider] || {
             apiKey: '',
             baseUrl: '',
             model: ''
           };

           return {
             ...state,
             ...newSettings,
             apiKey: targetConfig.apiKey,
             baseUrl: newSettings.baseUrl !== undefined ? newSettings.baseUrl : targetConfig.baseUrl,
             model: newSettings.model !== undefined ? newSettings.model : targetConfig.model,
             configs: nextConfigs,
             embedConfigs: nextEmbedConfigs,
             ttsConfigs: nextTtsConfigs
           };
         }

         // Handle Embed provider switch
         if (newSettings.embedProvider && newSettings.embedProvider !== state.embedProvider) {
           const nextEmbedProvider = newSettings.embedProvider;
           const targetEmbedConfig = nextEmbedConfigs[nextEmbedProvider] || DEFAULT_EMBED_PROVIDER_CONFIGS[nextEmbedProvider] || {
             apiKey: '',
             baseUrl: '',
             model: ''
           };

           return {
             ...state,
             ...newSettings,
             embedApiKey: targetEmbedConfig.apiKey,
             embedBaseUrl: newSettings.embedBaseUrl !== undefined ? newSettings.embedBaseUrl : targetEmbedConfig.baseUrl,
             embedModel: newSettings.embedModel !== undefined ? newSettings.embedModel : targetEmbedConfig.model,
             configs: nextConfigs,
             embedConfigs: nextEmbedConfigs,
             ttsConfigs: nextTtsConfigs
           };
         }

         // Handle TTS provider switch (#009)
         if (newSettings.ttsProvider && newSettings.ttsProvider !== state.ttsProvider) {
           const nextTtsProvider = newSettings.ttsProvider;
           const targetTtsConfig = nextTtsConfigs[nextTtsProvider] || DEFAULT_TTS_PROVIDER_CONFIGS[nextTtsProvider] || {
             apiKey: '',
             baseUrl: '',
             model: ''
           };

           return {
             ...state,
             ...newSettings,
             ttsApiKey: targetTtsConfig.apiKey,
             ttsBaseUrl: newSettings.ttsBaseUrl !== undefined ? newSettings.ttsBaseUrl : targetTtsConfig.baseUrl,
             ttsModel: newSettings.ttsModel !== undefined ? newSettings.ttsModel : targetTtsConfig.model,
             configs: nextConfigs,
             embedConfigs: nextEmbedConfigs,
             ttsConfigs: nextTtsConfigs
           };
         }

         const nextState = { ...state, ...newSettings, configs: nextConfigs, embedConfigs: nextEmbedConfigs, ttsConfigs: nextTtsConfigs };
         nextConfigs[providerToUpdate] = {
           apiKey: nextState.apiKey,
           baseUrl: nextState.baseUrl,
           model: nextState.model
         };
         nextEmbedConfigs[embedProviderToUpdate] = {
           apiKey: nextState.embedApiKey,
           baseUrl: nextState.embedBaseUrl,
           model: nextState.embedModel
         };
         nextTtsConfigs[ttsProviderToUpdate] = {
           apiKey: nextState.ttsApiKey,
           baseUrl: nextState.ttsBaseUrl,
           model: nextState.ttsModel
         };

         // #12 Sync prompt changes to *ByLang[currentLanguage]
         const curLang = nextState.language;
         const reviewPromptsByLang = { ...nextState.reviewPromptsByLang };
         const reviewPromptNamesByLang = { ...nextState.reviewPromptNamesByLang };
         const mingwuPromptsByLang = { ...nextState.mingwuPromptsByLang };
         const insightPromptsByLang = { ...nextState.insightPromptsByLang };
         const summaryPromptByLang = { ...nextState.summaryPromptByLang };
         const diarySummaryPromptByLang = { ...nextState.diarySummaryPromptByLang };
         const insightSummaryPromptByLang = { ...nextState.insightSummaryPromptByLang };
         // #008: 合并后字段的 per-language
         const mingwuInsightPromptsByLang = { ...nextState.mingwuInsightPromptsByLang };
         const mingwuInsightPromptNamesByLang = { ...nextState.mingwuInsightPromptNamesByLang };
         const diaryReviewSummaryPromptByLang = { ...nextState.diaryReviewSummaryPromptByLang };
         const mingwuInsightSummaryPromptByLang = { ...nextState.mingwuInsightSummaryPromptByLang };
         reviewPromptsByLang[curLang] = [...nextState.reviewPrompts];
         reviewPromptNamesByLang[curLang] = [...nextState.reviewPromptNames];
         mingwuPromptsByLang[curLang] = [...nextState.mingwuPrompts];
         insightPromptsByLang[curLang] = [...nextState.insightPrompts];
         summaryPromptByLang[curLang] = nextState.summaryPrompt;
         diarySummaryPromptByLang[curLang] = nextState.diarySummaryPrompt;
         insightSummaryPromptByLang[curLang] = nextState.insightSummaryPrompt;
         mingwuInsightPromptsByLang[curLang] = [...nextState.mingwuInsightPrompts];
         mingwuInsightPromptNamesByLang[curLang] = [...nextState.mingwuInsightPromptNames];
         diaryReviewSummaryPromptByLang[curLang] = nextState.diaryReviewSummaryPrompt;
         mingwuInsightSummaryPromptByLang[curLang] = nextState.mingwuInsightSummaryPrompt;
         nextState.reviewPromptsByLang = reviewPromptsByLang;
         nextState.reviewPromptNamesByLang = reviewPromptNamesByLang;
         nextState.mingwuPromptsByLang = mingwuPromptsByLang;
         nextState.insightPromptsByLang = insightPromptsByLang;
         nextState.summaryPromptByLang = summaryPromptByLang;
         nextState.diarySummaryPromptByLang = diarySummaryPromptByLang;
         nextState.insightSummaryPromptByLang = insightSummaryPromptByLang;
         nextState.mingwuInsightPromptsByLang = mingwuInsightPromptsByLang;
         nextState.mingwuInsightPromptNamesByLang = mingwuInsightPromptNamesByLang;
         nextState.diaryReviewSummaryPromptByLang = diaryReviewSummaryPromptByLang;
         nextState.mingwuInsightSummaryPromptByLang = mingwuInsightSummaryPromptByLang;

         // #008: 从合并后字段反向同步旧字段（保留旧字段只读兼容，供生成调度读取）
         // mingwuInsightPrompts: slot 0=明悟, slot 1=洞察, slot 2-4=共享自定义
         if (nextState.mingwuInsightPrompts && nextState.mingwuInsightPrompts.length >= 2) {
           const mi = [...nextState.mingwuInsightPrompts];
           while (mi.length < 5) mi.push('');
           nextState.mingwuPrompt = mi[0];
           nextState.insightPrompt = mi[1];
           // 旧 4 槽 mingwuPrompts = [明悟, custom1, custom2, custom3]
           nextState.mingwuPrompts = [mi[0], mi[2] || '', mi[3] || '', mi[4] || ''];
           // 旧 4 槽 insightPrompts = [洞察, custom1, custom2, custom3]
           nextState.insightPrompts = [mi[1], mi[2] || '', mi[3] || '', mi[4] || ''];
           nextState.mingwuPromptIndex = 0;
           nextState.insightPromptIndex = 0;
           nextState.mingwuInsightPrompt = mi[nextState.mingwuInsightPromptIndex] || mi[0];
         }
         // 摘要合并：diaryReviewSummaryPrompt -> diarySummaryPrompt + summaryPrompt
         if (nextState.diaryReviewSummaryPrompt !== undefined) {
           nextState.diarySummaryPrompt = nextState.diaryReviewSummaryPrompt;
           nextState.summaryPrompt = nextState.diaryReviewSummaryPrompt;
         }
         // mingwuInsightSummaryPrompt -> insightSummaryPrompt（服务端用此字段生成明悟+洞察摘要）
         if (nextState.mingwuInsightSummaryPrompt !== undefined) {
           nextState.insightSummaryPrompt = nextState.mingwuInsightSummaryPrompt;
         }

         return nextState;
      }),
    }),
    {
        name: 'whitewash-settings',
        version: 12,
        partialize: (state) => {
          const { syncPassword, syncPasswordE2EE, ...rest } = state;
          if (state.syncRememberCredentials) {
            return {
              ...rest,
              syncPassword: encodeB64(syncPassword),
              syncPasswordE2EE: encodeB64(syncPasswordE2EE)
            };
          }
          return rest;
        },
        merge: (persistedState: any, currentState: SettingsState) => {
          if (persistedState.syncRememberCredentials) {
            if (persistedState.syncPassword) {
              persistedState.syncPassword = decodeB64(persistedState.syncPassword);
              sessionStorage.setItem('baimiao_syncPassword', persistedState.syncPassword);
            }
            if (persistedState.syncPasswordE2EE) {
              persistedState.syncPasswordE2EE = decodeB64(persistedState.syncPasswordE2EE);
              sessionStorage.setItem('baimiao_syncPasswordE2EE', persistedState.syncPasswordE2EE);
            }
          }
          
          const merged = { ...currentState, ...persistedState };

          // --- #009: TTS 外部 API 配置初始化已移至 migrate() v<12 块（PRD line 309）。 ---
          // merge 阶段不再显式兜底：currentState spread 已为缺失字段提供初始默认值
          // （ttsProvider='gemini' 等）；老用户升级时由 migrate v<12 回填，已落盘字段原样保留。

          // --- #5: 5 槽统一 reviewPrompts 防污染 ---
          // 强制 slot 0 = DEFAULT_DIARY_PROMPT，slot 1 = DEFAULT_REVIEW_PROMPT
          if (merged.reviewPrompts && merged.reviewPrompts.length >= 2) {
            merged.reviewPrompts[0] = DEFAULT_DIARY_PROMPT;
            merged.reviewPrompts[1] = DEFAULT_REVIEW_PROMPT;
          }
          // 确保 reviewPrompts 有 5 个槽位
          if (!merged.reviewPrompts || merged.reviewPrompts.length < 5) {
            const padded = merged.reviewPrompts ? [...merged.reviewPrompts] : [];
            while (padded.length < 5) padded.push('');
            padded[0] = DEFAULT_DIARY_PROMPT;
            padded[1] = DEFAULT_REVIEW_PROMPT;
            merged.reviewPrompts = padded;
          }
          // 确保 reviewPromptNames 有 5 个槽位，slot 0/1 固定不可改名
          if (!merged.reviewPromptNames || merged.reviewPromptNames.length < 5) {
            merged.reviewPromptNames = ['日记', '回顾', '自定义 1', '自定义 2', '自定义 3'];
          } else {
            merged.reviewPromptNames[0] = '日记';
            merged.reviewPromptNames[1] = '回顾';
          }
          // 确保 reviewSelectedIndices 默认选中「日记+回顾」
          if (!merged.reviewSelectedIndices || merged.reviewSelectedIndices.length === 0) {
            merged.reviewSelectedIndices = [0, 1];
          }

          // --- 旧 4 槽 diaryPrompts 防污染（Copilot 仍依赖此字段）---
          if (merged.diaryPrompts && merged.diaryPrompts.length === 4) {
            merged.diaryPrompts[0] = DEFAULT_DIARY_PROMPT;
            if (merged.diaryPromptIndex === 0) {
              merged.diaryPrompt = DEFAULT_DIARY_PROMPT;
            }

            // 强力纠偏：如果 1 号槽位（自定义 1）依然残留着柳比歇夫提示词（与 0 号位重复），则强制将其纠正为最新的”贴心日记助手”
            const slot1 = merged.diaryPrompts[1];
            if (slot1 && (slot1.includes('柳比歇夫时间管理') || slot1.includes('柳比歇夫时间日志'))) {
              merged.diaryPrompts[1] = DEFAULT_WARM_DIARY_PROMPT;
              if (merged.diaryPromptIndex === 1) {
                merged.diaryPrompt = DEFAULT_WARM_DIARY_PROMPT;
              }
            }
          }
          if (merged.insightPrompts && merged.insightPrompts.length > 0) {
            merged.insightPrompts[0] = DEFAULT_INSIGHT_PROMPT;
            if (merged.insightPromptIndex === 0) {
              merged.insightPrompt = DEFAULT_INSIGHT_PROMPT;
            }
          }

          // --- #8: 明悟生成 Prompt 4 槽防污染 ---
          // slot 0 固定为 DEFAULT_MINGWU_PROMPT；确保有 4 个槽位。
          if (!merged.mingwuPrompts || merged.mingwuPrompts.length < 4) {
            const padded = merged.mingwuPrompts ? [...merged.mingwuPrompts] : [];
            while (padded.length < 4) padded.push('');
            padded[0] = DEFAULT_MINGWU_PROMPT;
            merged.mingwuPrompts = padded;
          } else {
            merged.mingwuPrompts[0] = DEFAULT_MINGWU_PROMPT;
          }
          if (merged.mingwuPromptIndex === 0 || merged.mingwuPromptIndex === undefined) {
            merged.mingwuPromptIndex = 0;
            merged.mingwuPrompt = DEFAULT_MINGWU_PROMPT;
          }

          // --- #12: 多语言 i18n 合并 ---
          // 确定语言（默认 zh）
          const mergeLang: Language = merged.language || 'zh';
          merged.language = mergeLang;
          const dMerge = DEFAULT_PROMPTS_BY_LANG[mergeLang];

          // 根据当前语言覆盖默认槽位（slot 0/1 固定为对应语言的默认 Prompt）
          if (merged.reviewPrompts && merged.reviewPrompts.length >= 2) {
            merged.reviewPrompts[0] = dMerge.diary;
            merged.reviewPrompts[1] = dMerge.review;
          }
          // 覆盖 slot 0/1 名称为当前语言
          if (merged.reviewPromptNames && merged.reviewPromptNames.length >= 2) {
            merged.reviewPromptNames[0] = DEFAULT_REVIEW_PROMPT_NAMES_BY_LANG[mergeLang][0];
            merged.reviewPromptNames[1] = DEFAULT_REVIEW_PROMPT_NAMES_BY_LANG[mergeLang][1];
          }
          if (merged.mingwuPrompts && merged.mingwuPrompts.length >= 1) {
            merged.mingwuPrompts[0] = dMerge.mingwu;
          }
          if (merged.insightPrompts && merged.insightPrompts.length >= 1) {
            merged.insightPrompts[0] = dMerge.insight;
          }

          // 初始化 *ByLang 字段（如果缺失，从当前 active 字段拷贝到 zh，en 用默认值）
          if (!merged.reviewPromptsByLang) {
            merged.reviewPromptsByLang = {
              zh: [...(merged.reviewPrompts || [DEFAULT_DIARY_PROMPT, DEFAULT_REVIEW_PROMPT, '', '', ''])],
              en: [DEFAULT_DIARY_PROMPT_EN, DEFAULT_REVIEW_PROMPT_EN, '', '', ''],
            };
          }
          if (!merged.reviewPromptNamesByLang) {
            merged.reviewPromptNamesByLang = {
              zh: [...DEFAULT_REVIEW_PROMPT_NAMES_BY_LANG.zh],
              en: [...DEFAULT_REVIEW_PROMPT_NAMES_BY_LANG.en],
            };
          }
          if (!merged.mingwuPromptsByLang) {
            merged.mingwuPromptsByLang = {
              zh: [...(merged.mingwuPrompts || [DEFAULT_MINGWU_PROMPT, '', '', ''])],
              en: [DEFAULT_MINGWU_PROMPT_EN, '', '', ''],
            };
          }
          if (!merged.insightPromptsByLang) {
            merged.insightPromptsByLang = {
              zh: [...(merged.insightPrompts || [DEFAULT_INSIGHT_PROMPT, '', '', ''])],
              en: [DEFAULT_INSIGHT_PROMPT_EN, '', '', ''],
            };
          }
          if (!merged.summaryPromptByLang) {
            merged.summaryPromptByLang = {
              zh: merged.summaryPrompt || DEFAULT_SUMMARY_PROMPT,
              en: DEFAULT_SUMMARY_PROMPT_EN,
            };
          }
          if (!merged.diarySummaryPromptByLang) {
            merged.diarySummaryPromptByLang = {
              zh: merged.diarySummaryPrompt || DEFAULT_DIARY_SUMMARY_PROMPT,
              en: DEFAULT_DIARY_SUMMARY_PROMPT_EN,
            };
          }
          if (!merged.insightSummaryPromptByLang) {
            merged.insightSummaryPromptByLang = {
              zh: merged.insightSummaryPrompt || DEFAULT_INSIGHT_SUMMARY_PROMPT,
              en: DEFAULT_INSIGHT_SUMMARY_PROMPT_EN,
            };
          }

          // --- #008: 合并后字段防污染与初始化 ---
          // mingwuInsightPrompts: 5 槽（明悟/洞察/自定义1/2/3），slot 0/1 固定默认
          if (!merged.mingwuInsightPrompts || merged.mingwuInsightPrompts.length < 5) {
            const padded = merged.mingwuInsightPrompts ? [...merged.mingwuInsightPrompts] : [];
            while (padded.length < 5) padded.push('');
            merged.mingwuInsightPrompts = padded;
          }
          merged.mingwuInsightPrompts[0] = dMerge.mingwu;
          merged.mingwuInsightPrompts[1] = dMerge.insight;
          // mingwuInsightPromptNames: 5 槽名称，slot 0/1 固定
          if (!merged.mingwuInsightPromptNames || merged.mingwuInsightPromptNames.length < 5) {
            merged.mingwuInsightPromptNames = [...DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG[mergeLang]];
          } else {
            merged.mingwuInsightPromptNames[0] = DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG[mergeLang][0];
            merged.mingwuInsightPromptNames[1] = DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG[mergeLang][1];
          }
          // mingwuInsightSelectedIndices 默认选中「明悟+洞察」
          if (!merged.mingwuInsightSelectedIndices || merged.mingwuInsightSelectedIndices.length === 0) {
            merged.mingwuInsightSelectedIndices = [0, 1];
          }
          if (merged.mingwuInsightPromptIndex === undefined) {
            merged.mingwuInsightPromptIndex = 0;
          }
          // 摘要合并字段默认值
          if (!merged.diaryReviewSummaryPrompt) {
            merged.diaryReviewSummaryPrompt = dMerge.diaryReviewSummary;
          }
          if (!merged.mingwuInsightSummaryPrompt) {
            merged.mingwuInsightSummaryPrompt = dMerge.mingwuInsightSummary;
          }
          merged.mingwuInsightPrompt = merged.mingwuInsightPrompts[merged.mingwuInsightPromptIndex] || merged.mingwuInsightPrompts[0];

          // 初始化合并后字段的 *ByLang（如果缺失）
          if (!merged.mingwuInsightPromptsByLang) {
            merged.mingwuInsightPromptsByLang = {
              zh: [...(merged.mingwuInsightPrompts || [DEFAULT_MINGWU_PROMPT, DEFAULT_INSIGHT_PROMPT, '', '', ''])],
              en: [DEFAULT_MINGWU_PROMPT_EN, DEFAULT_INSIGHT_PROMPT_EN, '', '', ''],
            };
          }
          if (!merged.mingwuInsightPromptNamesByLang) {
            merged.mingwuInsightPromptNamesByLang = {
              zh: [...DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG.zh],
              en: [...DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG.en],
            };
          }
          if (!merged.diaryReviewSummaryPromptByLang) {
            merged.diaryReviewSummaryPromptByLang = {
              zh: merged.diaryReviewSummaryPrompt || DEFAULT_DIARY_REVIEW_SUMMARY_PROMPT,
              en: DEFAULT_DIARY_REVIEW_SUMMARY_PROMPT_EN,
            };
          }
          if (!merged.mingwuInsightSummaryPromptByLang) {
            merged.mingwuInsightSummaryPromptByLang = {
              zh: merged.mingwuInsightSummaryPrompt || DEFAULT_MINGWU_INSIGHT_SUMMARY_PROMPT,
              en: DEFAULT_MINGWU_INSIGHT_SUMMARY_PROMPT_EN,
            };
          }
          // 按当前语言覆盖合并后字段的 per-lang 默认槽位
          if (merged.mingwuInsightPromptsByLang[mergeLang]) {
            const miLang = [...merged.mingwuInsightPromptsByLang[mergeLang]];
            while (miLang.length < 5) miLang.push('');
            miLang[0] = dMerge.mingwu;
            miLang[1] = dMerge.insight;
            merged.mingwuInsightPromptsByLang[mergeLang] = miLang;
          }
          if (merged.mingwuInsightPromptNamesByLang[mergeLang] && merged.mingwuInsightPromptNamesByLang[mergeLang].length >= 2) {
            merged.mingwuInsightPromptNamesByLang[mergeLang][0] = DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG[mergeLang][0];
            merged.mingwuInsightPromptNamesByLang[mergeLang][1] = DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG[mergeLang][1];
          }

          // #008: 从合并后字段反向同步旧字段（单一数据源 = 合并后字段）
          // 确保生成调度读取的旧字段始终与新结构一致。
          merged.mingwuPrompt = merged.mingwuInsightPrompts[0];
          merged.insightPrompt = merged.mingwuInsightPrompts[1];
          merged.mingwuPrompts = [merged.mingwuInsightPrompts[0], merged.mingwuInsightPrompts[2] || '', merged.mingwuInsightPrompts[3] || '', merged.mingwuInsightPrompts[4] || ''];
          merged.insightPrompts = [merged.mingwuInsightPrompts[1], merged.mingwuInsightPrompts[2] || '', merged.mingwuInsightPrompts[3] || '', merged.mingwuInsightPrompts[4] || ''];
          merged.mingwuPromptIndex = 0;
          merged.insightPromptIndex = 0;
          merged.diarySummaryPrompt = merged.diaryReviewSummaryPrompt;
          merged.summaryPrompt = merged.diaryReviewSummaryPrompt;
          merged.insightSummaryPrompt = merged.mingwuInsightSummaryPrompt;

          return merged;
        },
        migrate: (persistedState: any, version) => {
         if (version < 1) {
            if (!persistedState.configs) {
               persistedState.configs = {};
               if (persistedState.provider) {
                  persistedState.configs[persistedState.provider] = {
                     apiKey: persistedState.apiKey || '',
                     baseUrl: persistedState.baseUrl || '',
                     model: persistedState.model || ''
                  };
               }
            }
            
            // Migrate diaryPrompts (from 1-slot or 3-slot to 4-slot)
            if (!persistedState.diaryPrompts) {
               persistedState.diaryPrompts = [DEFAULT_DIARY_PROMPT, persistedState.diaryPrompt || DEFAULT_WARM_DIARY_PROMPT, '', ''];
               persistedState.diaryPromptIndex = 0;
            } else if (persistedState.diaryPrompts.length === 3) {
               const oldSlots = persistedState.diaryPrompts;
               persistedState.diaryPrompts = [DEFAULT_DIARY_PROMPT, oldSlots[0] || DEFAULT_WARM_DIARY_PROMPT, oldSlots[1] || '', oldSlots[2] || ''];
               persistedState.diaryPromptIndex = persistedState.diaryPromptIndex !== undefined ? persistedState.diaryPromptIndex + 1 : 0;
            } else if (persistedState.diaryPrompts.length === 4) {
               if (!persistedState.diaryPrompts[1] || persistedState.diaryPrompts[1] === `你是一个贴心的日记助手。你的任务是接收一系列零散的记录片段，并将它们编织成一篇连贯、优美的当日总体日记。

规则：
1. 请用中文写一篇流畅、富有共情力和连贯性的日记（通常 2-4 段落），以自然生动的方式总结这一天，将所有提供的片段串联成有意义的叙述。
2. 不要输出时间线或 JSON 数组，只能输出纯 Markdown 格式的文本。
3. 请以一个优美、富有诗意的标题（使用二级标题 Heading 2）开头，概括当天的基调或主要主题。
4. 核心要求：每当你提及源于某条特定记录片段的事件或细节时，你必须添加一个指向该片段 ID 的 Markdown 链接。格式必须完全像这样：[你的文字](#log_id_<ID>)，其中 <ID> 是上方列表里提供的准确 ID。示例：[今天早早起了床](#log_id_12345-abcde)。
5. 在文末加上一句简短且令人鼓舞的结束语。`) {
                  persistedState.diaryPrompts[1] = DEFAULT_WARM_DIARY_PROMPT;
               }
            }

            // Migrate reviewPrompts (from 1-slot or 3-slot to 4-slot)
            if (!persistedState.reviewPrompts) {
               persistedState.reviewPrompts = [DEFAULT_REVIEW_PROMPT, persistedState.reviewPrompt || DEFAULT_REVIEW_PROMPT, '', ''];
               persistedState.reviewPromptIndex = 0;
            } else if (persistedState.reviewPrompts.length === 3) {
               const oldSlots = persistedState.reviewPrompts;
               persistedState.reviewPrompts = [DEFAULT_REVIEW_PROMPT, oldSlots[0] || '', oldSlots[1] || '', oldSlots[2] || ''];
               persistedState.reviewPromptIndex = persistedState.reviewPromptIndex !== undefined ? persistedState.reviewPromptIndex + 1 : 0;
            }

            // Migrate insightPrompts (from 1-slot or 3-slot to 4-slot)
            if (!persistedState.insightPrompts) {
               persistedState.insightPrompts = [DEFAULT_INSIGHT_PROMPT, persistedState.insightPrompt || DEFAULT_INSIGHT_PROMPT, '', ''];
               persistedState.insightPromptIndex = 0;
            } else if (persistedState.insightPrompts.length === 3) {
               const oldSlots = persistedState.insightPrompts;
               persistedState.insightPrompts = [DEFAULT_INSIGHT_PROMPT, oldSlots[0] || '', oldSlots[1] || '', oldSlots[2] || ''];
               persistedState.insightPromptIndex = persistedState.insightPromptIndex !== undefined ? persistedState.insightPromptIndex + 1 : 0;
            }
         }

         if (version < 2) {
            const oldLyubishchevPrompt = `你现在是严格遵循柳比歇夫时间管理法的记录助手。请将我提供的当天所有零散碎片记录，整理成一篇标准的柳比歇夫式当日日记。

### 核心处理规则
1. 时间优先：严格按照时间先后顺序从早到晚排列所有事件，不得打乱时序
2. 格式统一：所有事件转换为【HH:MM-HH:MM 类别：行为内容（成果/备注）】格式
3. 客观至上：只保留客观事实，删除所有主观感受、情绪、修饰性语言和口语化表达
4. 精准计算：自动计算每个事件的准确时长，合并同一时间段的连续相同行为
5. 完整保留：不得遗漏用户提到的任何细节，也不得添加任何用户未提及的内容
6. 空白标注：如果存在时间空白，明确标注【未记录】，绝对不要编造内容
7. 自动分类：将所有事件归入以下7类之一：核心工作、学习研究、社交沟通、生活事务、休息娱乐、交通出行、其他

### 输出结构
# YYYY年MM月DD日 柳比歇夫时间日志
## 当日时间流水
[按时间顺序列出所有事件]

## 当日时间统计
- 总记录时长：XX小时XX分钟
- 未记录时长：XX小时XX分钟
- 核心工作：XX小时XX分钟（占比XX%）
- 学习研究：XX小时XX分钟（占比XX%）
- 社交沟通：XX小时XX分钟（占比XX%）
- 生活事务：XX小时XX分钟（占比XX%）
- 休息娱乐：XX小时XX分钟（占比XX%）
- 交通出行：XX小时XX分钟（占比XX%）
- 其他：XX小时XX分钟（占比XX%）

## 当日核心成果
[仅列出用户明确提到的产出、完成的任务、获得的信息，每条不超过20字]

## 当日时间漏洞
[仅列出超过30分钟的连续未记录时间段]

### 禁止事项
- 禁止添加任何鼓励、评价、建议类语句
- 禁止将多个不同类别的事件合并为一条
- 禁止将时间模糊的记录强行分配到具体时间段
- 禁止使用任何表情符号和华丽辞藻`;

            if (persistedState.diaryPrompts && persistedState.diaryPrompts[1] === oldLyubishchevPrompt) {
               persistedState.diaryPrompts[1] = DEFAULT_DIARY_PROMPT;
            }
            if (persistedState.diaryPrompt === oldLyubishchevPrompt) {
               persistedState.diaryPrompt = DEFAULT_DIARY_PROMPT;
            }
          }

         if (version < 4) {
            // 1. 对调日记提示词：把默认（贴心助手）与自定义 1（柳比歇夫）互换
            if (persistedState.diaryPrompts && persistedState.diaryPrompts.length === 4) {
               const slot0 = persistedState.diaryPrompts[0];
               const slot1 = persistedState.diaryPrompts[1];
               
               const isSlot0Warm = slot0 && slot0.includes("贴心的日记助手");
               const isSlot1Lyubishchev = slot1 && slot1.includes("柳比歇夫时间管理法");
               
               if (isSlot0Warm || isSlot1Lyubishchev) {
                  // 进行对调
                  persistedState.diaryPrompts[0] = DEFAULT_DIARY_PROMPT; // 新的默认，即柳比歇夫
                  persistedState.diaryPrompts[1] = DEFAULT_WARM_DIARY_PROMPT; // 新的自定义 1，即贴心助手
                  
                  // 同步更新单文本状态
                  if (persistedState.diaryPromptIndex === 0) {
                     persistedState.diaryPrompt = DEFAULT_DIARY_PROMPT;
                  } else if (persistedState.diaryPromptIndex === 1) {
                     persistedState.diaryPrompt = DEFAULT_WARM_DIARY_PROMPT;
                  }
               }
            }
            
            // 2. 升级默认回顾 Prompt 为科学心理学版本
            if (persistedState.reviewPrompts && persistedState.reviewPrompts.length > 0) {
               const slot0 = persistedState.reviewPrompts[0];
               if (!slot0 || slot0.includes("你是一个有深度的反思助手") || slot0.trim() === '') {
                  persistedState.reviewPrompts[0] = DEFAULT_REVIEW_PROMPT;
                  if (persistedState.reviewPromptIndex === 0) {
                     persistedState.reviewPrompt = DEFAULT_REVIEW_PROMPT;
                  }
               }
            }
            
            // 3. 升级默认洞察 Prompt 为科学精力管理与习惯回路版本
            if (persistedState.insightPrompts && persistedState.insightPrompts.length > 0) {
               const slot0 = persistedState.insightPrompts[0];
               if (!slot0 || slot0.includes("你是一个生产力与生活教练助手") || slot0.trim() === '') {
                  persistedState.insightPrompts[0] = DEFAULT_INSIGHT_PROMPT;
                  if (persistedState.insightPromptIndex === 0) {
                     persistedState.insightPrompt = DEFAULT_INSIGHT_PROMPT;
                  }
               }
            }
         }

          if (version < 5) {
            // Initialize embedding config for existing users
            if (!persistedState.embedProvider) {
              persistedState.embedEnabled = false;
              persistedState.embedProvider = 'gemini';
              if (persistedState.provider === 'gemini' && persistedState.apiKey) {
                persistedState.embedApiKey = persistedState.apiKey;
              } else {
                persistedState.embedApiKey = '';
              }
              persistedState.embedBaseUrl = DEFAULT_EMBED_PROVIDER_CONFIGS['gemini'].baseUrl;
              persistedState.embedModel = DEFAULT_EMBED_PROVIDER_CONFIGS['gemini'].model;
              persistedState.embedConfigs = {};
            }
          }

          if (version < 6) {
            if (!persistedState.diarySummaryPrompt) {
              persistedState.diarySummaryPrompt = DEFAULT_DIARY_SUMMARY_PROMPT;
            }
          }
          if (version < 7) {
            if (!persistedState.insightSummaryPrompt) {
              persistedState.insightSummaryPrompt = DEFAULT_INSIGHT_SUMMARY_PROMPT;
            }
          }

          // #5: 合并旧 4 槽 diaryPrompts + reviewPrompts 到新 5 槽统一 reviewPrompts
          if (version < 8) {
            const oldDiaryPrompts: string[] = persistedState.diaryPrompts || [DEFAULT_DIARY_PROMPT, DEFAULT_WARM_DIARY_PROMPT, '', ''];
            const oldReviewPrompts: string[] = persistedState.reviewPrompts || [DEFAULT_REVIEW_PROMPT, '', '', ''];

            // 新 5 槽：[日记, 回顾, 自定义1, 自定义2, 自定义3]
            // 日记槽 = 旧 diaryPrompts[0]（DEFAULT_DIARY_PROMPT）
            // 回顾槽 = 旧 reviewPrompts[0]（DEFAULT_REVIEW_PROMPT）
            // 自定义1 = 旧 diaryPrompts[1] || 旧 reviewPrompts[1]（优先保留用户自定义的日记模板）
            // 自定义2 = 旧 diaryPrompts[2] || 旧 reviewPrompts[2]
            // 自定义3 = 旧 diaryPrompts[3] || 旧 reviewPrompts[3]
            persistedState.reviewPrompts = [
              oldDiaryPrompts[0] || DEFAULT_DIARY_PROMPT,
              oldReviewPrompts[0] || DEFAULT_REVIEW_PROMPT,
              oldDiaryPrompts[1] || oldReviewPrompts[1] || '',
              oldDiaryPrompts[2] || oldReviewPrompts[2] || '',
              oldDiaryPrompts[3] || oldReviewPrompts[3] || '',
            ];
            persistedState.reviewPromptNames = ['日记', '回顾', '自定义 1', '自定义 2', '自定义 3'];
            // 默认选中「日记 + 回顾」
            persistedState.reviewSelectedIndices = [0, 1];
            // 同步 reviewPromptIndex 为回顾槽位（兼容旧代码读取）
            persistedState.reviewPromptIndex = 1;
            persistedState.reviewPrompt = persistedState.reviewPrompts[1];

            // 保留旧 diaryPrompts 不变（Copilot 仍依赖此字段做日记模板过滤）
          }

          // #8: 明悟生成 Prompt 迁移。
          // 旧版本只有 insightPrompts（洞察），现拆分出独立的 mingwuPrompts（明悟）。
          // 明悟默认槽使用 DEFAULT_MINGWU_PROMPT；自定义槽留空。
          if (version < 9) {
            if (!persistedState.mingwuPrompts || persistedState.mingwuPrompts.length === 0) {
              persistedState.mingwuPrompts = [DEFAULT_MINGWU_PROMPT, '', '', ''];
            } else {
              // 补齐到 4 槽，slot 0 固定默认
              const padded = [...persistedState.mingwuPrompts];
              while (padded.length < 4) padded.push('');
              padded[0] = DEFAULT_MINGWU_PROMPT;
              persistedState.mingwuPrompts = padded;
            }
            if (persistedState.mingwuPromptIndex === undefined) {
              persistedState.mingwuPromptIndex = 0;
            }
            persistedState.mingwuPrompt = persistedState.mingwuPrompts[persistedState.mingwuPromptIndex] || DEFAULT_MINGWU_PROMPT;
          }

          // #10: TTS 朗读配置迁移
          if (version < 10) {
            if (!persistedState.ttsService) {
              persistedState.ttsService = 'webspeech';
            }
            if (!persistedState.ttsLang) {
              persistedState.ttsLang = 'auto';
            }
            if (persistedState.ttsRate === undefined || persistedState.ttsRate === null) {
              persistedState.ttsRate = 1;
            }
            if (!persistedState.ttsVoice) {
              persistedState.ttsVoice = '';
            }
          }

          // #12: 多语言 i18n 迁移
          // 从单语言结构迁移到 per-language 结构。
          // language 默认 'zh'；*ByLang.zh 从现有 active 字段拷贝，*ByLang.en 用英文默认值。
          if (version < 11) {
            if (!persistedState.language) {
              persistedState.language = 'zh';
            }
            // reviewPromptsByLang
            if (!persistedState.reviewPromptsByLang) {
              const zhReview = persistedState.reviewPrompts && persistedState.reviewPrompts.length === 5
                ? [...persistedState.reviewPrompts]
                : [DEFAULT_DIARY_PROMPT, DEFAULT_REVIEW_PROMPT, '', '', ''];
              persistedState.reviewPromptsByLang = {
                zh: zhReview,
                en: [DEFAULT_DIARY_PROMPT_EN, DEFAULT_REVIEW_PROMPT_EN, '', '', ''],
              };
            }
            // reviewPromptNamesByLang
            if (!persistedState.reviewPromptNamesByLang) {
              const zhNames = persistedState.reviewPromptNames && persistedState.reviewPromptNames.length === 5
                ? [...persistedState.reviewPromptNames]
                : [...DEFAULT_REVIEW_PROMPT_NAMES_BY_LANG.zh];
              persistedState.reviewPromptNamesByLang = {
                zh: zhNames,
                en: [...DEFAULT_REVIEW_PROMPT_NAMES_BY_LANG.en],
              };
            }
            // mingwuPromptsByLang
            if (!persistedState.mingwuPromptsByLang) {
              const zhMingwu = persistedState.mingwuPrompts && persistedState.mingwuPrompts.length === 4
                ? [...persistedState.mingwuPrompts]
                : [DEFAULT_MINGWU_PROMPT, '', '', ''];
              persistedState.mingwuPromptsByLang = {
                zh: zhMingwu,
                en: [DEFAULT_MINGWU_PROMPT_EN, '', '', ''],
              };
            }
            // insightPromptsByLang
            if (!persistedState.insightPromptsByLang) {
              const zhInsight = persistedState.insightPrompts && persistedState.insightPrompts.length === 4
                ? [...persistedState.insightPrompts]
                : [DEFAULT_INSIGHT_PROMPT, '', '', ''];
              persistedState.insightPromptsByLang = {
                zh: zhInsight,
                en: [DEFAULT_INSIGHT_PROMPT_EN, '', '', ''],
              };
            }
            // summaryPromptByLang
            if (!persistedState.summaryPromptByLang) {
              persistedState.summaryPromptByLang = {
                zh: persistedState.summaryPrompt || DEFAULT_SUMMARY_PROMPT,
                en: DEFAULT_SUMMARY_PROMPT_EN,
              };
            }
            // diarySummaryPromptByLang
            if (!persistedState.diarySummaryPromptByLang) {
              persistedState.diarySummaryPromptByLang = {
                zh: persistedState.diarySummaryPrompt || DEFAULT_DIARY_SUMMARY_PROMPT,
                en: DEFAULT_DIARY_SUMMARY_PROMPT_EN,
              };
            }
            // insightSummaryPromptByLang
            if (!persistedState.insightSummaryPromptByLang) {
              persistedState.insightSummaryPromptByLang = {
                zh: persistedState.insightSummaryPrompt || DEFAULT_INSIGHT_SUMMARY_PROMPT,
                en: DEFAULT_INSIGHT_SUMMARY_PROMPT_EN,
              };
            }
          }

          // #008: 提示词配置合并与数据迁移 v11 -> v12
          // 1) mingwuPrompt + insightPrompt 合并到 mingwuInsightPrompts（5 槽：明悟/洞察/自定义1/2/3）
          // 2) diarySummaryPrompt + summaryPrompt(回顾摘要) 合并到 diaryReviewSummaryPrompt
          // 3) insightSummaryPrompt 改名 mingwuInsightSummaryPrompt 并补明悟默认摘要
          // 旧字段保留只读兼容（merge 阶段会从合并后字段反向同步）。
          if (version < 12) {
            const migLang: Language = persistedState.language || 'zh';
            const dMig = DEFAULT_PROMPTS_BY_LANG[migLang];

            // --- 1) 明悟+洞察 生成 Prompt 合并 ---
            const oldMingwuPrompts: string[] = (persistedState.mingwuPrompts && persistedState.mingwuPrompts.length >= 1)
              ? [...persistedState.mingwuPrompts]
              : [dMig.mingwu, '', '', ''];
            while (oldMingwuPrompts.length < 4) oldMingwuPrompts.push('');
            const oldInsightPrompts: string[] = (persistedState.insightPrompts && persistedState.insightPrompts.length >= 1)
              ? [...persistedState.insightPrompts]
              : [dMig.insight, '', '', ''];
            while (oldInsightPrompts.length < 4) oldInsightPrompts.push('');

            // 新 5 槽：[明悟, 洞察, 自定义1, 自定义2, 自定义3]
            // 明悟槽 = 旧 mingwuPrompts[0]；洞察槽 = 旧 insightPrompts[0]
            // 自定义槽优先保留明悟侧自定义，其次洞察侧
            persistedState.mingwuInsightPrompts = [
              oldMingwuPrompts[0] || dMig.mingwu,
              oldInsightPrompts[0] || dMig.insight,
              oldMingwuPrompts[1] || oldInsightPrompts[1] || '',
              oldMingwuPrompts[2] || oldInsightPrompts[2] || '',
              oldMingwuPrompts[3] || oldInsightPrompts[3] || '',
            ];
            persistedState.mingwuInsightPromptNames = [...DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG[migLang]];
            persistedState.mingwuInsightSelectedIndices = [0, 1];
            persistedState.mingwuInsightPromptIndex = 0;
            persistedState.mingwuInsightPrompt = persistedState.mingwuInsightPrompts[0];

            // --- 2) 日记回顾一句话摘要合并 ---
            // 优先保留用户的日记摘要（更具体），其次回顾摘要，最后默认值
            persistedState.diaryReviewSummaryPrompt =
              persistedState.diarySummaryPrompt ||
              persistedState.summaryPrompt ||
              dMig.diaryReviewSummary;

            // --- 3) 明悟和洞察一句话摘要（由原洞察摘要扩展） ---
            persistedState.mingwuInsightSummaryPrompt =
              persistedState.insightSummaryPrompt ||
              dMig.mingwuInsightSummary;

            // --- per-language 同步合并 ---
            // mingwuInsightPromptsByLang
            if (!persistedState.mingwuInsightPromptsByLang) {
              const buildMiLang = (lang: Language): string[] => {
                const dL = DEFAULT_PROMPTS_BY_LANG[lang];
                const mw = persistedState.mingwuPromptsByLang?.[lang] || [dL.mingwu, '', '', ''];
                const ins = persistedState.insightPromptsByLang?.[lang] || [dL.insight, '', '', ''];
                while (mw.length < 4) mw.push('');
                while (ins.length < 4) ins.push('');
                return [
                  mw[0] || dL.mingwu,
                  ins[0] || dL.insight,
                  mw[1] || ins[1] || '',
                  mw[2] || ins[2] || '',
                  mw[3] || ins[3] || '',
                ];
              };
              persistedState.mingwuInsightPromptsByLang = {
                zh: buildMiLang('zh'),
                en: buildMiLang('en'),
              };
            }
            if (!persistedState.mingwuInsightPromptNamesByLang) {
              persistedState.mingwuInsightPromptNamesByLang = {
                zh: [...DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG.zh],
                en: [...DEFAULT_MINGWU_INSIGHT_PROMPT_NAMES_BY_LANG.en],
              };
            }
            if (!persistedState.diaryReviewSummaryPromptByLang) {
              persistedState.diaryReviewSummaryPromptByLang = {
                zh: persistedState.diarySummaryPromptByLang?.zh || persistedState.summaryPromptByLang?.zh || DEFAULT_DIARY_REVIEW_SUMMARY_PROMPT,
                en: persistedState.diarySummaryPromptByLang?.en || persistedState.summaryPromptByLang?.en || DEFAULT_DIARY_REVIEW_SUMMARY_PROMPT_EN,
              };
            }
            if (!persistedState.mingwuInsightSummaryPromptByLang) {
              persistedState.mingwuInsightSummaryPromptByLang = {
                zh: persistedState.insightSummaryPromptByLang?.zh || DEFAULT_MINGWU_INSIGHT_SUMMARY_PROMPT,
                en: persistedState.insightSummaryPromptByLang?.en || DEFAULT_MINGWU_INSIGHT_SUMMARY_PROMPT_EN,
              };
            }

            // --- #009: TTS 外部 API 配置初始化（PRD line 309：放在 migrate v<12，而非 merge）---
            // 老用户升级到 v12 时回填 ttsProvider/ttsApiKey/ttsBaseUrl/ttsModel/ttsConfigs 默认值。
            // merge 阶段的 currentState spread 已为全新字段提供初始默认值，此处仅为升级用户显式补齐。
            if (!persistedState.ttsProvider) {
              persistedState.ttsProvider = 'gemini';
            }
            if (persistedState.ttsApiKey === undefined) {
              persistedState.ttsApiKey = DEFAULT_TTS_PROVIDER_CONFIGS[persistedState.ttsProvider]?.apiKey ?? '';
            }
            if (persistedState.ttsBaseUrl === undefined) {
              persistedState.ttsBaseUrl = DEFAULT_TTS_PROVIDER_CONFIGS[persistedState.ttsProvider]?.baseUrl ?? '';
            }
            if (persistedState.ttsModel === undefined) {
              persistedState.ttsModel = DEFAULT_TTS_PROVIDER_CONFIGS[persistedState.ttsProvider]?.model ?? '';
            }
            if (!persistedState.ttsConfigs || typeof persistedState.ttsConfigs !== 'object') {
              persistedState.ttsConfigs = {};
            }
          }

         return persistedState;
       }
    }
  )
);

export function getActivePromptIndices(prompts: string[]): number[] {
  return prompts
    .map((p, i) => ({ index: i, hasContent: p.trim().length > 0 }))
    .filter(item => item.hasContent)
    .map(item => item.index);
}

/**
 * #5: 默认 5 槽 Prompt 名称（slot 0/1 不可改名）
 * #12: 已改为 per-language，保留此导出向后兼容（返回 zh 版本）
 */
export const DEFAULT_REVIEW_PROMPT_NAMES = DEFAULT_REVIEW_PROMPT_NAMES_BY_LANG.zh;

/**
 * #5: 判断某槽位是否为「日记」类型（使用 /api/generate-timeline，entry_type='diary'）。
 * 只有 slot 0 是日记，其余均为回顾类型（entry_type='review'）。
 */
export function isDiarySlot(index: number): boolean {
  return index === 0;
}

/**
 * #5: 根据槽位索引返回 entry_type。
 * slot 0 -> 'diary'，slot 1-4 -> 'review'
 */
export function getEntryTypeForSlot(index: number): 'diary' | 'review' {
  return isDiarySlot(index) ? 'diary' : 'review';
}

/**
 * #5: 旧 prompt_index 到新 prompt_index 的映射，用于自动队列扫描时兼容旧数据。
 * 旧系统：diary entries 有 prompt_index 0-3，review entries 有 prompt_index 0-3。
 * 新系统：slot 0(日记)=prompt_index 0，slot 1(回顾)=prompt_index 1，slot 2-4=prompt_index 2-4。
 * 当扫描新 slot N 是否已生成时，也需检查旧数据中可能存在的等价 prompt_index。
 */
export function getLegacyPromptIndices(newSlotIndex: number): number[] {
  // 新 slot 0(日记) -> 旧 diary prompt_index 0
  // 新 slot 1(回顾) -> 旧 review prompt_index 0
  // 新 slot 2(自定义1) -> 旧 diary/review prompt_index 1
  // 新 slot 3(自定义2) -> 旧 diary/review prompt_index 2
  // 新 slot 4(自定义3) -> 旧 diary/review prompt_index 3
  if (newSlotIndex <= 1) return [0];
  return [newSlotIndex - 1];
}
