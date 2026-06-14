import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const DEFAULT_DIARY_PROMPT = `你是一个贴心的日记助手。你的任务是接收一系列零散的记录片段，并将它们编织成一篇连贯、优美的当日总体日记。

规则：
1. 请用中文写一篇流畅、富有共情力和连贯性的日记（通常 2-4 段落），以自然生动的方式总结这一天，将所有提供的片段串联成有意义的叙述。
2. 不要输出时间线或 JSON 数组，只能输出纯 Markdown 格式的文本。
3. 请以一个优美、富有诗意的标题（使用二级标题 Heading 2）开头，概括当天的基调或主要主题。
4. 核心要求：每当你提及源于某条特定记录片段的事件或细节时，你必须添加一个指向该片段 ID 的 Markdown 链接。格式必须完全像这样：[你的文字](#log_id_<ID>)，其中 <ID> 是上方列表里提供的准确 ID。示例：[今天早早起了床](#log_id_12345-abcde)。
5. 在文末加上一句简短且令人鼓舞的结束语。`;

export const DEFAULT_REVIEW_PROMPT = `你是一个有深度的反思助手。你的任务是回顾过去一段时间的记录和日记，并针对用户的关注点、情绪状态以及取得的成就撰写一份有意义的总结。请保持鼓励性和建设性的基调。`;

export const DEFAULT_INSIGHT_PROMPT = `你是一个生产力与生活教练助手。根据用户的活动记录和日记，对他们的习惯提供深刻的洞察，突出积极的趋势、潜在的改进领域，并提供有助于提升身心健康和生产力的可行建议。`;

export const DEFAULT_SUMMARY_PROMPT = `你是一个用于生成一句话日记摘要的助手。请根据提供的日记文本，生成一句简短、优美、富有诗意的中文摘要（不超过30个字）。`;

interface SettingsState {
  provider: 'gemini' | 'openai' | 'deepseek' | 'kimi' | 'zhipu' | 'minimax' | 'mimo' | 'custom';
  apiKey: string;
  baseUrl: string;
  model: string;
  diaryPrompt: string;
  reviewPrompt: string;
  insightPrompt: string;
  summaryPrompt: string;
  setSettings: (settings: Partial<SettingsState>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      provider: 'gemini',
      apiKey: '',
      baseUrl: '',
      model: '',
      diaryPrompt: DEFAULT_DIARY_PROMPT,
      reviewPrompt: DEFAULT_REVIEW_PROMPT,
      insightPrompt: DEFAULT_INSIGHT_PROMPT,
      summaryPrompt: DEFAULT_SUMMARY_PROMPT,
      setSettings: (settings) => set(settings),
    }),
    { name: 'whitewash-settings' }
  )
);
