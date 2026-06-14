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

const DEFAULT_PROVIDER_CONFIGS: Record<string, { apiKey: string; baseUrl: string; model: string }> = {
  gemini: { apiKey: '', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-3.1-flash-lite' },
  openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  volcengine: { apiKey: '', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-2-0-lite-260428' },
  kimi: { apiKey: '', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  zhipu: { apiKey: '', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  minimax: { apiKey: '', baseUrl: 'https://api.minimax.chat/v1', model: 'abab6.5s-chat' },
  mimo: { apiKey: '', baseUrl: 'https://ai.xiaomi.com/v1', model: 'mimo-chat' },
  custom: { apiKey: '', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3' }
};

interface SettingsState {
  provider: 'gemini' | 'openai' | 'volcengine' | 'kimi' | 'zhipu' | 'minimax' | 'mimo' | 'custom';
  apiKey: string;
  baseUrl: string;
  model: string;
  configs: Record<string, { apiKey: string; baseUrl: string; model: string }>;
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
      apiKey: DEFAULT_PROVIDER_CONFIGS['gemini'].apiKey,
      baseUrl: DEFAULT_PROVIDER_CONFIGS['gemini'].baseUrl,
      model: DEFAULT_PROVIDER_CONFIGS['gemini'].model,
      configs: {},
      diaryPrompt: DEFAULT_DIARY_PROMPT,
      reviewPrompt: DEFAULT_REVIEW_PROMPT,
      insightPrompt: DEFAULT_INSIGHT_PROMPT,
      summaryPrompt: DEFAULT_SUMMARY_PROMPT,
      setSettings: (newSettings) => set((state) => {
         const nextConfigs = { ...state.configs };
         const providerToUpdate = state.provider;
         
         // 1. Save current provider state before any changes
         nextConfigs[providerToUpdate] = { 
           apiKey: state.apiKey, 
           baseUrl: state.baseUrl, 
           model: state.model 
         };

         // 2. Are we switching providers?
         if (newSettings.provider && newSettings.provider !== state.provider) {
           const nextProvider = newSettings.provider;
           // Grab the saved config for the new provider, or establish defaults
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
             configs: nextConfigs
           };
         }
         
         // 3. Normal update
         const nextState = { ...state, ...newSettings, configs: nextConfigs };
         nextConfigs[providerToUpdate] = { 
           apiKey: nextState.apiKey, 
           baseUrl: nextState.baseUrl, 
           model: nextState.model 
         };
         
         return nextState;
      }),
    }),
    { 
       name: 'whitewash-settings',
       version: 1,
       migrate: (persistedState: any, version) => {
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
         return persistedState;
       }
    }
  )
);
