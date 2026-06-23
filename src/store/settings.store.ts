import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const DEFAULT_DIARY_PROMPT = `你是一个贴心的日记助手。你的任务是接收一系列零散的记录片段，并将它们编织成一篇连贯、分类明确、逻辑清晰的当日总体日记。

规则：
1. 请用中文写一篇流畅、忠于原文风格和连贯性的日记（通常 2-5 段落），以笔记作者本人叙述风格的方式总结这一天，将所有提供的片段串联成有意义的叙述。
2. 不要输出时间线或 JSON 数组，只能输出纯 Markdown 格式的文本。
3. 请以一个简洁且重点的标题（使用二级标题 Heading 2）开头，概括当天的基调或主要主题（不要带上日期等字眼）。
4. 核心要求：每当你提及源于某条特定记录片段的事件或细节时，你必须添加一个指向该片段 ID 的 Markdown 链接。格式必须完全像这样：[你的文字](#log_id_<ID>)，其中 <ID> 是上方列表里提供的准确 ID。示例：[今天早早起了床](#log_id_12345-abcde)。
5. 在文末加上一句简短而平实的总结结束语。`;

export const DEFAULT_LYUBISHCHEV_PROMPT = `你现在是严格遵循柳比歇夫时间管理法的记录助手。请将我提供的当天所有零散碎片记录，整理成一篇标准的柳比歇夫式当日日记。

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
- 禁止将时间模糊的记录强行分配到具体时间段
- 禁止使用任何表情符号和华丽辞藻`;

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
  diaryPrompts: string[];
  diaryPromptIndex: number;
  reviewPrompt: string;
  reviewPrompts: string[];
  reviewPromptIndex: number;
  insightPrompt: string;
  insightPrompts: string[];
  insightPromptIndex: number;
  summaryPrompt: string;
  
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
  syncLastTime: number | null;

  // OAuth Tokens & Client IDs
  syncOneDriveToken?: string;
  syncOneDriveClientId?: string;
  syncGDriveToken?: string;
  syncGDriveClientId?: string;
  syncDropboxToken?: string;
  syncDropboxClientId?: string;

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
      diaryPrompts: [DEFAULT_DIARY_PROMPT, DEFAULT_LYUBISHCHEV_PROMPT, '', ''],
      diaryPromptIndex: 0,
      reviewPrompt: DEFAULT_REVIEW_PROMPT,
      reviewPrompts: [DEFAULT_REVIEW_PROMPT, '', '', ''],
      reviewPromptIndex: 0,
      insightPrompt: DEFAULT_INSIGHT_PROMPT,
      insightPrompts: [DEFAULT_INSIGHT_PROMPT, '', '', ''],
      insightPromptIndex: 0,
      summaryPrompt: DEFAULT_SUMMARY_PROMPT,

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
      syncLastTime: null,

      // OAuth 默认值
      syncOneDriveToken: '',
      syncOneDriveClientId: '',
      syncGDriveToken: '',
      syncGDriveClientId: '',
      syncDropboxToken: '',
      syncDropboxClientId: '',
      setSettings: (newSettings) => set((state) => {
         if (newSettings.syncPassword !== undefined) {
           sessionStorage.setItem('baimiao_syncPassword', newSettings.syncPassword);
         }
         if (newSettings.syncPasswordE2EE !== undefined) {
           sessionStorage.setItem('baimiao_syncPasswordE2EE', newSettings.syncPasswordE2EE);
         }

         const nextConfigs = { ...state.configs };
         const providerToUpdate = state.provider;
         
         nextConfigs[providerToUpdate] = { 
           apiKey: state.apiKey, 
           baseUrl: state.baseUrl, 
           model: state.model 
         };

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
             configs: nextConfigs
           };
         }
         
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
        version: 2,
        partialize: (state) => {
          const { syncPassword, syncPasswordE2EE, ...rest } = state;
          return rest;
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
               persistedState.diaryPrompts = [DEFAULT_DIARY_PROMPT, persistedState.diaryPrompt || DEFAULT_LYUBISHCHEV_PROMPT, '', ''];
               persistedState.diaryPromptIndex = 0;
            } else if (persistedState.diaryPrompts.length === 3) {
               const oldSlots = persistedState.diaryPrompts;
               persistedState.diaryPrompts = [DEFAULT_DIARY_PROMPT, oldSlots[0] || DEFAULT_LYUBISHCHEV_PROMPT, oldSlots[1] || '', oldSlots[2] || ''];
               persistedState.diaryPromptIndex = persistedState.diaryPromptIndex !== undefined ? persistedState.diaryPromptIndex + 1 : 0;
            } else if (persistedState.diaryPrompts.length === 4) {
               if (!persistedState.diaryPrompts[1] || persistedState.diaryPrompts[1] === `你是一个贴心的日记助手。你的任务是接收一系列零散的记录片段，并将它们编织成一篇连贯、优美的当日总体日记。

规则：
1. 请用中文写一篇流畅、富有共情力和连贯性的日记（通常 2-4 段落），以自然生动的方式总结这一天，将所有提供的片段串联成有意义的叙述。
2. 不要输出时间线或 JSON 数组，只能输出纯 Markdown 格式的文本。
3. 请以一个优美、富有诗意的标题（使用二级标题 Heading 2）开头，概括当天的基调或主要主题。
4. 核心要求：每当你提及源于某条特定记录片段的事件或细节时，你必须添加一个指向该片段 ID 的 Markdown 链接。格式必须完全像这样：[你的文字](#log_id_<ID>)，其中 <ID> 是上方列表里提供的准确 ID。示例：[今天早早起了床](#log_id_12345-abcde)。
5. 在文末加上一句简短且令人鼓舞的结束语。`) {
                  persistedState.diaryPrompts[1] = DEFAULT_LYUBISHCHEV_PROMPT;
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
               persistedState.diaryPrompts[1] = DEFAULT_LYUBISHCHEV_PROMPT;
            }
            if (persistedState.diaryPrompt === oldLyubishchevPrompt) {
               persistedState.diaryPrompt = DEFAULT_LYUBISHCHEV_PROMPT;
            }
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
