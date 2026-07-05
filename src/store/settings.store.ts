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

export const DEFAULT_SUMMARY_PROMPT = `你是一个用于生成一句话日记摘要的助手。请根据提供的日记文本，生成一句简短、优美、富有诗意的中文摘要（不超过30个字）。`;

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

const obfuscate = (str: string) => {
  if (!str) return str;
  try { return btoa(encodeURIComponent(str)); } catch(e) { return str; }
};

const deobfuscate = (str: string) => {
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
  syncRememberCredentials: boolean;
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
      diaryPrompts: [DEFAULT_DIARY_PROMPT, DEFAULT_WARM_DIARY_PROMPT, '', ''],
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
      syncRememberCredentials: false,
      syncLastTime: null,

      // OAuth 默认值
      syncOneDriveToken: '',
      syncOneDriveClientId: '',
      syncGDriveToken: '',
      syncGDriveClientId: '',
      syncDropboxToken: '',
      syncDropboxClientId: '',
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
        version: 4,
        partialize: (state) => {
          const { syncPassword, syncPasswordE2EE, ...rest } = state;
          if (state.syncRememberCredentials) {
            return { 
              ...rest, 
              syncPassword: obfuscate(syncPassword), 
              syncPasswordE2EE: obfuscate(syncPasswordE2EE) 
            };
          }
          return rest;
        },
        merge: (persistedState: any, currentState: SettingsState) => {
          if (persistedState.syncRememberCredentials) {
            if (persistedState.syncPassword) {
              persistedState.syncPassword = deobfuscate(persistedState.syncPassword);
              sessionStorage.setItem('baimiao_syncPassword', persistedState.syncPassword);
            }
            if (persistedState.syncPasswordE2EE) {
              persistedState.syncPasswordE2EE = deobfuscate(persistedState.syncPasswordE2EE);
              sessionStorage.setItem('baimiao_syncPasswordE2EE', persistedState.syncPasswordE2EE);
            }
          }
          
          const merged = { ...currentState, ...persistedState };
          
          // 强力防污染：0号槽位作为只读的默认出厂设置，每次合并时必须强行同步为代码中最新的默认常量
          if (merged.diaryPrompts && merged.diaryPrompts.length === 4) {
            merged.diaryPrompts[0] = DEFAULT_DIARY_PROMPT;
            if (merged.diaryPromptIndex === 0) {
              merged.diaryPrompt = DEFAULT_DIARY_PROMPT;
            }
            
            // 强力纠偏：如果 1 号槽位（自定义 1）依然残留着柳比歇夫提示词（与 0 号位重复），则强制将其纠正为最新的“贴心日记助手”
            const slot1 = merged.diaryPrompts[1];
            if (slot1 && (slot1.includes("柳比歇夫时间管理") || slot1.includes("柳比歇夫时间日志"))) {
              merged.diaryPrompts[1] = DEFAULT_WARM_DIARY_PROMPT;
              if (merged.diaryPromptIndex === 1) {
                merged.diaryPrompt = DEFAULT_WARM_DIARY_PROMPT;
              }
            }
          }
          if (merged.reviewPrompts && merged.reviewPrompts.length > 0) {
            merged.reviewPrompts[0] = DEFAULT_REVIEW_PROMPT;
            if (merged.reviewPromptIndex === 0) {
              merged.reviewPrompt = DEFAULT_REVIEW_PROMPT;
            }
          }
          if (merged.insightPrompts && merged.insightPrompts.length > 0) {
            merged.insightPrompts[0] = DEFAULT_INSIGHT_PROMPT;
            if (merged.insightPromptIndex === 0) {
              merged.insightPrompt = DEFAULT_INSIGHT_PROMPT;
            }
          }
          
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

         // Migrate insightPrompts (from 1-slot or 3-slot to 4-slot)
         if (!persistedState.insightPrompts) {
            persistedState.insightPrompts = [DEFAULT_INSIGHT_PROMPT, persistedState.insightPrompt || DEFAULT_INSIGHT_PROMPT, '', ''];
            persistedState.insightPromptIndex = 0;
         } else if (persistedState.insightPrompts.length === 3) {
            const oldSlots = persistedState.insightPrompts;
            persistedState.insightPrompts = [DEFAULT_INSIGHT_PROMPT, oldSlots[0] || '', oldSlots[1] || '', oldSlots[2] || ''];
            persistedState.insightPromptIndex = persistedState.insightPromptIndex !== undefined ? persistedState.insightPromptIndex + 1 : 0;
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
