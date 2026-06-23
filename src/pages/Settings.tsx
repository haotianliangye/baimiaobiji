import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound, Server, Cpu, FileDown, Settings2, RotateCcw, Eye, EyeOff, Upload, Shield, Cloud, ShieldCheck, Loader2, CloudLightning } from 'lucide-react';
import { useSettingsStore, DEFAULT_DIARY_PROMPT, DEFAULT_LYUBISHCHEV_PROMPT, DEFAULT_REVIEW_PROMPT, DEFAULT_INSIGHT_PROMPT, DEFAULT_SUMMARY_PROMPT } from '../store/settings.store';
import { db } from '../db/db';
import { checkStorageStatus, requestStoragePersistence, StorageEstimateInfo } from '../lib/storage';
import { useAppStore } from '../store/app.store';

export default function Settings() {
  const navigate = useNavigate();
  const settingsStore = useSettingsStore();
  const { 
    provider, 
    apiKey, 
    baseUrl, 
    model, 
    diaryPrompt, 
    diaryPrompts, 
    diaryPromptIndex, 
    reviewPrompt, 
    reviewPrompts, 
    reviewPromptIndex, 
    insightPrompt, 
    insightPrompts, 
    insightPromptIndex, 
    summaryPrompt, 
    setSettings 
  } = settingsStore;

  const { syncStatus, syncErrorMessage, syncNow } = useAppStore();
  
  const [activeTab, setActiveTab] = useState<'model' | 'data' | 'prompt'>('model');
  const [showApiKey, setShowApiKey] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [storageInfo, setStorageInfo] = useState<StorageEstimateInfo | null>(null);
  const [isPersisting, setIsPersisting] = useState(false);
  const [showSyncPass, setShowSyncPass] = useState(false);
  const [showE2eePass, setShowE2eePass] = useState(false);

  // Cloud Sync Form States
  const [localSyncEnabled, setLocalSyncEnabled] = useState(settingsStore.syncEnabled);
  const [localSyncEndpoint, setLocalSyncEndpoint] = useState(settingsStore.syncEndpoint);
  const [localSyncUsername, setLocalSyncUsername] = useState(settingsStore.syncUsername);
  const [localSyncPassword, setLocalSyncPassword] = useState(settingsStore.syncPassword);
  const [localSyncDirectory, setLocalSyncDirectory] = useState(settingsStore.syncDirectory || '/baimiaobiji/');
  const [localSyncPasswordE2EE, setLocalSyncPasswordE2EE] = useState(settingsStore.syncPasswordE2EE);

  useEffect(() => {
    async function loadStorageInfo() {
      const info = await checkStorageStatus();
      setStorageInfo(info);
    }
    loadStorageInfo();
  }, []);

  const handlePersist = async () => {
    setIsPersisting(true);
    const success = await requestStoragePersistence();
    const info = await checkStorageStatus();
    setStorageInfo(info);
    setIsPersisting(false);
    if (success) {
      alert("成功激活永久存储保护！");
    } else {
      alert("永久存储申请被浏览器拒绝。某些浏览器（如在无痕浏览模式下）不支持此特性。");
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const [exportDateRange, setExportDateRange] = useState<'all' | 'custom'>('all');
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');

  const [exportOptions, setExportOptions] = useState({
    logs: true,
    diaries: true,
    insights: true,
  });

  const [localDiaryPrompts, setLocalDiaryPrompts] = useState<string[]>(() => {
    if (diaryPrompts && diaryPrompts.length === 4) return [...diaryPrompts];
    return [diaryPrompt || DEFAULT_DIARY_PROMPT, DEFAULT_LYUBISHCHEV_PROMPT, '', ''];
  });
  const [localDiaryIndex, setLocalDiaryIndex] = useState<number>(diaryPromptIndex ?? 0);

  const [localReviewPrompts, setLocalReviewPrompts] = useState<string[]>(() => {
    if (reviewPrompts && reviewPrompts.length === 4) return [...reviewPrompts];
    return [reviewPrompt || DEFAULT_REVIEW_PROMPT, '', '', ''];
  });
  const [localReviewIndex, setLocalReviewIndex] = useState<number>(reviewPromptIndex ?? 0);

  const [localInsightPrompts, setLocalInsightPrompts] = useState<string[]>(() => {
    if (insightPrompts && insightPrompts.length === 4) return [...insightPrompts];
    return [insightPrompt || DEFAULT_INSIGHT_PROMPT, '', '', ''];
  });
  const [localInsightIndex, setLocalInsightIndex] = useState<number>(insightPromptIndex ?? 0);

  const [localSummaryPrompt, setLocalSummaryPrompt] = useState(summaryPrompt || DEFAULT_SUMMARY_PROMPT);

  const convertBlobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handleExport = async () => {
    try {
      const data: any = {};
      const startMs = exportDateRange === 'custom' && exportStartDate ? new Date(exportStartDate).getTime() : 0;
      const endMs = exportDateRange === 'custom' && exportEndDate ? new Date(exportEndDate).getTime() + 86400000 - 1 : Infinity;
      
      const startStr = exportDateRange === 'custom' ? exportStartDate || '0000-00-00' : '0000-00-00';
      const endStr = exportDateRange === 'custom' && exportEndDate ? exportEndDate : '9999-99-99';

      if (exportOptions.logs) {
         let logs = await db.raw_logs.toArray();
         if (exportDateRange === 'custom') {
           logs = logs.filter(l => l.created_at >= startMs && l.created_at <= endMs);
         }
         data.logs = await Promise.all(logs.map(async l => {
            if (l.audioBlob) {
              const base64 = await convertBlobToBase64(l.audioBlob);
              return { ...l, audioBlob: undefined, audioBase64: base64 };
            }
            return l;
         }));
      }
      if (exportOptions.diaries) {
         let diaries = await db.daily_diaries.toArray();
         if (exportDateRange === 'custom') {
           diaries = diaries.filter(d => d.diary_date >= startStr && d.diary_date <= endStr);
         }
         data.diaries = diaries;
      }
      if (exportOptions.insights) {
         let insights = await db.insights.toArray();
         if (exportDateRange === 'custom') {
           insights = insights.filter(i => i.created_at >= startMs && i.created_at <= endMs);
         }
         data.insights = insights;
      }
      
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `baimiao_data_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("导出失败");
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const text = ev.target?.result as string;
        const data = JSON.parse(text);
        
        let importedCount = 0;

        if (data.logs && Array.isArray(data.logs)) {
          const logsToPut = await Promise.all(data.logs.map(async (l: any) => {
            if (l.audioBase64) {
              const res = await fetch(l.audioBase64);
              const blob = await res.blob();
              l.audioBlob = blob;
              delete l.audioBase64;
            }
            return l;
          }));
          await db.raw_logs.bulkPut(logsToPut);
          importedCount += logsToPut.length;
        }

        if (data.diaries && Array.isArray(data.diaries)) {
          await db.daily_diaries.bulkPut(data.diaries);
          importedCount += data.diaries.length;
        }

        if (data.insights && Array.isArray(data.insights)) {
          await db.insights.bulkPut(data.insights);
          importedCount += data.insights.length;
        }

        alert(`成功导入了 ${importedCount} 条历史数据片段！`);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } catch (err) {
        console.error(err);
        alert('导入失败，请检查文件格式。');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col h-full bg-stone-100 font-sans text-stone-900 overflow-hidden items-center justify-center">
      <div className="flex flex-col h-full overflow-hidden bg-[#f4f4f0] relative z-50 mx-auto max-w-md w-full shadow-sm ring-1 ring-black/5">
        <div className="flex h-14 items-center px-4 bg-[#f4f4f0] border-b border-stone-200/50 shrink-0">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-stone-500 hover:text-black">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-[15px] font-medium ml-2 text-stone-900">系统设置</h2>
        </div>

        <div className="flex-1 overflow-y-auto thin-scrollbar w-full p-3 space-y-4 pb-16">
        
        {/* Navigation Tabs */}
        <div className="flex bg-black/5 p-1 rounded-xl shadow-inner border border-black/5">
          <button
            onClick={() => setActiveTab('model')}
            className={`flex-1 flex justify-center py-2 text-[13px] font-medium rounded-lg transition-colors ${
              activeTab === 'model' ? 'bg-white shadow-sm ring-1 ring-black/5 text-black' : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            系统设置
          </button>
          <button
            onClick={() => setActiveTab('data')}
            className={`flex-1 flex justify-center py-2 text-[13px] font-medium rounded-lg transition-colors ${
              activeTab === 'data' ? 'bg-white shadow-sm ring-1 ring-black/5 text-black' : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            数据管理
          </button>
          <button
            onClick={() => setActiveTab('prompt')}
            className={`flex-1 flex justify-center py-2 text-[13px] font-medium rounded-lg transition-colors ${
              activeTab === 'prompt' ? 'bg-white shadow-sm ring-1 ring-black/5 text-black' : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            提示词 (Prompt)
          </button>
        </div>

        <div className="space-y-3">
          {activeTab === 'model' && (
            <>
              {/* Provider Selection */}
              <section className="bg-white rounded-2xl border border-stone-100 p-1 shadow-sm">
                 <div className="grid grid-cols-4 gap-1 p-1">
                    {[
                      { id: 'gemini', label: 'Gemini', defaultBase: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-3.1-flash-lite', link: 'https://aistudio.google.com/app/apikey' },
                      { id: 'openai', label: 'OpenAI', defaultBase: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', link: 'https://platform.openai.com/api-keys' },
                      { id: 'volcengine', label: '火山引擎', defaultBase: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'ep-xxx', link: 'https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint' },
                      { id: 'kimi', label: 'Kimi', defaultBase: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k', link: 'https://platform.moonshot.cn/console/api-keys' },
                      { id: 'zhipu', label: '智谱', defaultBase: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash', link: 'https://bigmodel.cn/usercenter/apikeys' },
                      { id: 'minimax', label: 'MiniMax', defaultBase: 'https://api.minimax.chat/v1', defaultModel: 'abab6.5s-chat', link: 'https://platform.minimaxi.com/user-center/basic-information' },
                      { id: 'mimo', label: 'MIMO', defaultBase: 'https://ai.xiaomi.com/v1', defaultModel: 'mimo-chat', link: 'https://open.xiaomi.com/' },
                      { id: 'custom', label: '自定义', defaultBase: 'http://127.0.0.1:11434/v1', defaultModel: 'llama3', link: '' }
                    ].map(p => (
                       <button
                         key={p.id}
                         onClick={() => {
                           setSettings({ provider: p.id as any });
                         }}
                         className={`flex items-center justify-center py-1.5 px-1 rounded-lg text-[12px] font-medium transition-all ${
                           provider === p.id 
                             ? 'bg-black text-white shadow-md' 
                             : 'text-stone-500 hover:bg-stone-50'
                         }`}
                       >
                         {p.label}
                       </button>
                    ))}
                 </div>
              </section>

              {/* Dynamic Fields */}
              <section className="space-y-3">
                <div className="bg-white rounded-xl border border-stone-100 p-3 shadow-sm space-y-2">
                  <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase mb-1">配置详情</h3>
                  
                  {/* API Key */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-[13px] font-medium text-stone-700">
                        <KeyRound className="w-4 h-4 text-stone-400" />
                        API Key
                      </label>
                      {(() => {
                        const linkInfo = [
                          { id: 'gemini', link: 'https://aistudio.google.com/app/apikey' },
                          { id: 'openai', link: 'https://platform.openai.com/api-keys' },
                          { id: 'volcengine', link: 'https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint' },
                          { id: 'kimi', link: 'https://platform.moonshot.cn/console/api-keys' },
                          { id: 'zhipu', link: 'https://bigmodel.cn/usercenter/apikeys' },
                          { id: 'minimax', link: 'https://platform.minimaxi.com/user-center/basic-information' },
                          { id: 'mimo', link: 'https://open.xiaomi.com/' },
                        ].find(x => x.id === provider)?.link;
                        
                        return linkInfo ? (
                          <a href={linkInfo} target="_blank" rel="noreferrer" className="text-[11px] text-blue-500 hover:underline">申请密钥</a>
                        ) : null;
                      })()}
                    </div>
                    <div className="relative">
                      <input
                        type={showApiKey ? "text" : "password"}
                        placeholder={'输入你的 API 凭证'}
                        value={apiKey}
                        onChange={e => setSettings({ apiKey: e.target.value })}
                        className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 pr-10 rounded-lg text-[14px] text-stone-900 placeholder:text-stone-400 transition-all font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-stone-400 hover:text-stone-600 focus:outline-none"
                      >
                        {showApiKey ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    <p className="text-[11px] text-stone-400 leading-tight">安全说明：密钥直接存储于浏览器本地，不会上传至任何中转服务器。</p>
                  </div>

                  {/* Base URL */}
                  <div className="space-y-1.5 pt-2 border-t border-stone-100">
                    <label className="flex items-center gap-2 text-[13px] font-medium text-stone-700">
                      <Server className="w-4 h-4 text-stone-400" />
                      自定义代理地址 (Base URL)
                    </label>
                    <input
                      type="text"
                      placeholder={[
                        { id: 'gemini', defaultBase: 'https://generativelanguage.googleapis.com' },
                        { id: 'openai', defaultBase: 'https://api.openai.com/v1' },
                        { id: 'volcengine', defaultBase: 'https://ark.cn-beijing.volces.com/api/v3' },
                        { id: 'kimi', defaultBase: 'https://api.moonshot.cn/v1' },
                        { id: 'zhipu', defaultBase: 'https://open.bigmodel.cn/api/paas/v4' },
                        { id: 'minimax', defaultBase: 'https://api.minimax.chat/v1' },
                        { id: 'mimo', defaultBase: 'https://ai.xiaomi.com/v1' },
                        { id: 'custom', defaultBase: 'http://127.0.0.1:11434/v1' }
                      ].find(x => x.id === provider)?.defaultBase || ''}
                      value={baseUrl}
                      onChange={e => setSettings({ baseUrl: e.target.value })}
                      className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-lg text-[14px] text-stone-900 transition-all font-mono placeholder:text-stone-300"
                    />
                  </div>

                  {/* Model Name */}
                  <div className="space-y-1.5 pt-2 border-t border-stone-100">
                    <label className="flex items-center gap-2 text-[13px] font-medium text-stone-700">
                      <Cpu className="w-4 h-4 text-stone-400" />
                      模型名称 (Model)
                    </label>
                    <input
                      type="text"
                      placeholder={[
                        { id: 'gemini', defaultModel: 'gemini-3.1-flash-lite' },
                        { id: 'openai', defaultModel: 'gpt-4o-mini' },
                        { id: 'volcengine', defaultModel: 'doubao-seed-2-0-lite-260428' },
                        { id: 'kimi', defaultModel: 'moonshot-v1-8k' },
                        { id: 'zhipu', defaultModel: 'glm-4-flash' },
                        { id: 'minimax', defaultModel: 'abab6.5s-chat' },
                        { id: 'mimo', defaultModel: 'mimo-chat' },
                        { id: 'custom', defaultModel: 'llama3' }
                      ].find(x => x.id === provider)?.defaultModel || ''}
                      value={model}
                      onChange={e => setSettings({ model: e.target.value })}
                      className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-lg text-[14px] text-stone-900 transition-all font-mono placeholder:text-stone-300"
                    />
                  </div>
                </div>
              </section>
            </>
          )}

          {activeTab === 'prompt' && (
            <section className="bg-white rounded-xl border border-stone-100 p-3 shadow-sm space-y-3">
               <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase mb-2">后台提示词配置 (Prompt)</h3>
               <div className="space-y-3">
                  <div className="space-y-1.5">
                     <div className="flex flex-wrap items-center justify-between gap-y-2 gap-x-1">
                       <div className="flex items-center gap-1.5 min-w-0">
                         <label className="flex items-center gap-1.5 text-[13px] font-medium text-stone-700 shrink-0">
                            <Settings2 className="w-4 h-4 text-stone-400" />
                            日记生成 Prompt
                         </label>
                         <div className="flex gap-0.5 items-center bg-black/5 p-0.5 rounded-lg border border-black/5 shrink-0">
                           {['默认', '自定义 1', '自定义 2', '自定义 3'].map((label, idx) => (
                             <button
                               key={idx}
                               onClick={() => setLocalDiaryIndex(idx)}
                               className={`px-2 py-1 text-[11px] font-medium rounded transition-all active:scale-[0.93] shrink-0 ${
                                 localDiaryIndex === idx
                                   ? 'bg-white text-stone-900 shadow-sm ring-1 ring-black/5'
                                   : 'text-stone-400 hover:text-stone-600'
                               }`}
                             >
                               {label}
                             </button>
                           ))}
                         </div>
                       </div>
                       {localDiaryIndex !== 0 && (
                         <button 
                           onClick={() => {
                             const next = [...localDiaryPrompts];
                             next[localDiaryIndex] = '';
                             setLocalDiaryPrompts(next);
                           }}
                           className="text-[11px] text-stone-400 hover:text-black flex items-center gap-1 transition-colors"
                         >
                           <RotateCcw className="w-3 h-3" />
                           清空当前
                         </button>
                       )}
                     </div>
                     <textarea
                        placeholder={localDiaryIndex === 0 ? '' : '请输入日记生成提示词...'}
                        value={localDiaryPrompts[localDiaryIndex]}
                        readOnly={localDiaryIndex === 0}
                        onChange={e => {
                          if (localDiaryIndex === 0) return;
                          const next = [...localDiaryPrompts];
                          next[localDiaryIndex] = e.target.value;
                          setLocalDiaryPrompts(next);
                        }}
                        className={`w-full h-32 resize-none border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-xl text-[13px] transition-all font-mono leading-relaxed ${
                          localDiaryIndex === 0
                            ? 'bg-stone-100/70 text-stone-500 cursor-not-allowed'
                            : 'bg-white text-stone-900 focus:bg-white'
                        }`}
                     />
                  </div>
                  
                  <div className="space-y-1.5 pt-4 border-t border-stone-100">
                     <div className="flex flex-wrap items-center justify-between gap-y-2 gap-x-1">
                       <div className="flex items-center gap-1.5 min-w-0">
                         <label className="flex items-center gap-1.5 text-[13px] font-medium text-stone-700 shrink-0">
                            <Settings2 className="w-4 h-4 text-stone-400" />
                            回顾生成 Prompt
                         </label>
                         <div className="flex gap-0.5 items-center bg-black/5 p-0.5 rounded-lg border border-black/5 shrink-0">
                           {['默认', '自定义 1', '自定义 2', '自定义 3'].map((label, idx) => (
                             <button
                               key={idx}
                               onClick={() => setLocalReviewIndex(idx)}
                               className={`px-2 py-1 text-[11px] font-medium rounded transition-all active:scale-[0.93] shrink-0 ${
                                 localReviewIndex === idx
                                   ? 'bg-white text-stone-900 shadow-sm ring-1 ring-black/5'
                                   : 'text-stone-400 hover:text-stone-600'
                               }`}
                             >
                               {label}
                             </button>
                           ))}
                         </div>
                       </div>
                       {localReviewIndex !== 0 && (
                         <button 
                           onClick={() => {
                             const next = [...localReviewPrompts];
                             next[localReviewIndex] = '';
                             setLocalReviewPrompts(next);
                           }}
                           className="text-[11px] text-stone-400 hover:text-black flex items-center gap-1 transition-colors"
                         >
                           <RotateCcw className="w-3 h-3" />
                           清空当前
                         </button>
                       )}
                     </div>
                     <textarea
                        placeholder={localReviewIndex === 0 ? '' : '请输入回顾生成提示词...'}
                        value={localReviewPrompts[localReviewIndex]}
                        readOnly={localReviewIndex === 0}
                        onChange={e => {
                          if (localReviewIndex === 0) return;
                          const next = [...localReviewPrompts];
                          next[localReviewIndex] = e.target.value;
                          setLocalReviewPrompts(next);
                        }}
                        className={`w-full h-24 resize-none border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-xl text-[13px] transition-all font-mono leading-relaxed ${
                          localReviewIndex === 0
                            ? 'bg-stone-100/70 text-stone-500 cursor-not-allowed'
                            : 'bg-white text-stone-900 focus:bg-white'
                        }`}
                     />
                  </div>

                  <div className="space-y-1.5 pt-4 border-t border-stone-100">
                     <div className="flex flex-wrap items-center justify-between gap-y-2 gap-x-1">
                       <div className="flex items-center gap-1.5 min-w-0">
                         <label className="flex items-center gap-1.5 text-[13px] font-medium text-stone-700 shrink-0">
                            <Settings2 className="w-4 h-4 text-stone-400" />
                            洞察生成 Prompt
                         </label>
                         <div className="flex gap-0.5 items-center bg-black/5 p-0.5 rounded-lg border border-black/5 shrink-0">
                           {['默认', '自定义 1', '自定义 2', '自定义 3'].map((label, idx) => (
                             <button
                               key={idx}
                               onClick={() => setLocalInsightIndex(idx)}
                               className={`px-2 py-1 text-[11px] font-medium rounded transition-all active:scale-[0.93] shrink-0 ${
                                 localInsightIndex === idx
                                   ? 'bg-white text-stone-900 shadow-sm ring-1 ring-black/5'
                                   : 'text-stone-400 hover:text-stone-600'
                               }`}
                             >
                               {label}
                             </button>
                           ))}
                         </div>
                       </div>
                       {localInsightIndex !== 0 && (
                         <button 
                           onClick={() => {
                             const next = [...localInsightPrompts];
                             next[localInsightIndex] = '';
                             setLocalInsightPrompts(next);
                           }}
                           className="text-[11px] text-stone-400 hover:text-black flex items-center gap-1 transition-colors"
                         >
                           <RotateCcw className="w-3 h-3" />
                           清空当前
                         </button>
                       )}
                     </div>
                     <textarea
                        placeholder={localInsightIndex === 0 ? '' : '请输入洞察生成提示词...'}
                        value={localInsightPrompts[localInsightIndex]}
                        readOnly={localInsightIndex === 0}
                        onChange={e => {
                          if (localInsightIndex === 0) return;
                          const next = [...localInsightPrompts];
                          next[localInsightIndex] = e.target.value;
                          setLocalInsightPrompts(next);
                        }}
                        className={`w-full h-24 resize-none border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-xl text-[13px] transition-all font-mono leading-relaxed ${
                          localInsightIndex === 0
                            ? 'bg-stone-100/70 text-stone-500 cursor-not-allowed'
                            : 'bg-white text-stone-900 focus:bg-white'
                        }`}
                     />
                  </div>

                  <div className="space-y-1.5 pt-4 border-t border-stone-100">
                     <div className="flex items-center justify-between">
                       <label className="flex items-center gap-2 text-[13px] font-medium text-stone-700">
                          <Settings2 className="w-4 h-4 text-stone-400" />
                          日记摘要生成 Prompt
                       </label>
                       <button 
                         onClick={() => setLocalSummaryPrompt(DEFAULT_SUMMARY_PROMPT)}
                         className="text-[11px] text-stone-400 hover:text-black flex items-center gap-1 transition-colors"
                       >
                         <RotateCcw className="w-3 h-3" />
                         恢复默认
                       </button>
                     </div>
                     <textarea
                        placeholder="请输入摘要生成提示词..."
                        value={localSummaryPrompt}
                        onChange={e => setLocalSummaryPrompt(e.target.value)}
                        className="w-full h-24 resize-none bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-xl text-[13px] text-stone-900 placeholder:text-stone-400 transition-all font-mono leading-relaxed"
                     />
                  </div>
               </div>
            </section>
          )}

          {activeTab === 'data' && (
            <div className="space-y-4">
              {/* Storage Protection card */}
              <section className="bg-white rounded-xl border border-stone-100 p-3 shadow-sm space-y-2">
                <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase flex items-center gap-1.5 mb-2">
                  <Shield className="w-4 h-4 text-stone-400" />
                  本地存储保护
                </h3>
                {storageInfo ? (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2.5">
                      {storageInfo.persisted ? (
                        <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                      ) : (
                        <Shield className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                      )}
                      <div className="flex flex-col">
                        <span className="text-[13.5px] font-semibold text-stone-850">
                          状态：{storageInfo.persisted ? (
                            <span className="text-emerald-600">🟢 永久存储保护中</span>
                          ) : (
                            <span className="text-amber-600">🟡 临时存储 (系统在空间不足时可能会自动清理数据)</span>
                          )}
                        </span>
                        <span className="text-[12px] text-stone-450 mt-1">
                          当前应用已占用：{formatBytes(storageInfo.usedBytes)} / 可用估算：{formatBytes(storageInfo.quotaBytes)}
                        </span>
                      </div>
                    </div>
                    {!storageInfo.persisted && (
                      <button
                        onClick={handlePersist}
                        disabled={isPersisting}
                        className="w-full py-2 bg-black hover:bg-stone-900 text-white transition-colors rounded-xl text-[12.5px] font-medium active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {isPersisting ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            正在激活存储保护...
                          </>
                        ) : (
                          '🔒 激活永久存储保护 (防自动清理)'
                        )}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="text-[12px] text-stone-450 py-2">获取存储状态中...</div>
                )}
              </section>

              {/* Encrypted Cloud Sync card */}
              <section className="bg-white rounded-xl border border-stone-100 p-3 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase flex items-center gap-1.5">
                    <Cloud className="w-4 h-4 text-stone-400" />
                    加密云同步与多端备份
                  </h3>
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={localSyncEnabled}
                      onChange={(e) => setLocalSyncEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-stone-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-black"></div>
                  </label>
                </div>

                {localSyncEnabled && (
                  <div className="space-y-3 pt-2 border-t border-stone-100 animate-in fade-in duration-200">
                    <div className="space-y-1">
                      <label className="text-[12px] font-medium text-stone-500">云存储服务商</label>
                      <select 
                        value="webdav" 
                        disabled 
                        className="w-full bg-stone-100 border border-black/5 outline-none px-3 py-1.5 rounded-lg text-[13px] text-stone-600 cursor-not-allowed font-mono"
                      >
                        <option value="webdav">WebDAV (兼容坚果云、自建 NAS、Nextcloud)</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[12px] font-medium text-stone-500">服务器连接地址 (Endpoint URL)</label>
                      <input
                        type="text"
                        placeholder="https://dav.jianguoyun.com/dav/"
                        value={localSyncEndpoint}
                        onChange={(e) => setLocalSyncEndpoint(e.target.value)}
                        className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 rounded-lg text-[13px] text-stone-850 transition-all font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[12px] font-medium text-stone-500">云盘账号</label>
                        <input
                          type="text"
                          placeholder="Your account"
                          value={localSyncUsername}
                          onChange={(e) => setLocalSyncUsername(e.target.value)}
                          className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 rounded-lg text-[13px] text-stone-850 transition-all font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[12px] font-medium text-stone-500">应用密码/密钥</label>
                        <div className="relative">
                          <input
                            type={showSyncPass ? "text" : "password"}
                            placeholder="App Password"
                            value={localSyncPassword}
                            onChange={(e) => setLocalSyncPassword(e.target.value)}
                            className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 pr-8 rounded-lg text-[13px] text-stone-850 transition-all font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => setShowSyncPass(!showSyncPass)}
                            className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-stone-400 hover:text-stone-600 focus:outline-none"
                          >
                            {showSyncPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[12px] font-medium text-stone-500">云端同步文件夹目录</label>
                      <input
                        type="text"
                        placeholder="/baimiaobiji/"
                        value={localSyncDirectory}
                        onChange={(e) => setLocalSyncDirectory(e.target.value)}
                        className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 rounded-lg text-[13px] text-stone-800 transition-all font-mono"
                      />
                    </div>

                    <div className="space-y-1 pt-2 border-t border-stone-100">
                      <label className="text-[12px] font-medium text-stone-500 flex items-center gap-1">
                        🔒 端到端同步密码 (Sync Password)
                      </label>
                      <div className="relative">
                        <input
                          type={showE2eePass ? "text" : "password"}
                          placeholder="多设备间解密数据使用，防窥探"
                          value={localSyncPasswordE2EE}
                          onChange={(e) => setLocalSyncPasswordE2EE(e.target.value)}
                          className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 pr-8 rounded-lg text-[13px] text-stone-850 transition-all font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowE2eePass(!showE2eePass)}
                          className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-stone-400 hover:text-stone-600 focus:outline-none"
                        >
                          {showE2eePass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      <p className="text-[10px] text-stone-400 leading-normal mt-0.5">本地使用此密码以 AES-GCM-256 加密所有文本与音频，密码丢失将无法解密。</p>
                    </div>

                    <div className="pt-2 border-t border-stone-100 flex flex-col gap-2">
                      <div className="flex items-center justify-between text-[11px] text-stone-450 font-medium">
                        <span>同步状态：
                          {syncStatus === 'syncing' && <span className="text-blue-500 font-semibold animate-pulse">🔄 正在对齐...</span>}
                          {syncStatus === 'idle' && <span className="text-emerald-500 font-semibold">🟢 已对齐</span>}
                          {syncStatus === 'error' && <span className="text-red-500 font-semibold flex items-center gap-0.5"><CloudLightning className="w-3.5 h-3.5" />同步出错</span>}
                          {syncStatus === 'disabled' && <span className="text-stone-400">⚪ 未启用</span>}
                        </span>
                        {settingsStore.syncLastTime && (
                          <span className="font-mono">上次同步：{new Date(settingsStore.syncLastTime).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                        )}
                      </div>
                      {syncStatus === 'error' && syncErrorMessage && (
                        <p className="text-[10px] text-red-500 font-medium leading-tight bg-red-50 p-2 rounded-lg border border-red-100">{syncErrorMessage}</p>
                      )}
                      
                      <button
                        onClick={async () => {
                          settingsStore.setSettings({
                            syncEnabled: localSyncEnabled,
                            syncEndpoint: localSyncEndpoint,
                            syncUsername: localSyncUsername,
                            syncPassword: localSyncPassword,
                            syncDirectory: localSyncDirectory,
                            syncPasswordE2EE: localSyncPasswordE2EE
                          });
                          await new Promise(r => setTimeout(r, 50)); 
                          await syncNow();
                        }}
                        disabled={syncStatus === 'syncing'}
                        className="w-full mt-1 bg-stone-900 text-white hover:bg-black transition-colors rounded-xl text-[12.5px] font-medium active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-1.5 py-2.5"
                      >
                        {syncStatus === 'syncing' ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            同步进行中...
                          </>
                        ) : (
                          '🔄 立即执行手动同步 (Sync Now)'
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* Data Export / Import section */}
              <section className="bg-white rounded-xl border border-stone-100 p-3 shadow-sm space-y-4">
                 <div>
                   <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase mb-3">数据导出</h3>
                 
                 <div className="space-y-4">
                    {/* Data type selection */}
                    <div className="space-y-2.5">
                      <label className="flex items-start gap-3">
                         <input 
                           type="checkbox" 
                           checked={exportOptions.logs}
                           onChange={e => setExportOptions(prev => ({ ...prev, logs: e.target.checked }))}
                           className="w-4 h-4 mt-0.5 rounded border-stone-300 text-stone-900 focus:ring-black accent-black cursor-pointer" 
                         />
                         <div className="flex flex-col cursor-pointer select-none">
                            <span className="text-[14px] text-stone-800 font-medium leading-none">原始碎屑记录</span>
                            <span className="text-[12px] text-stone-400 mt-1">导出所有时间线上的打点记录，包含语音数据。</span>
                         </div>
                      </label>
                      <label className="flex items-start gap-3 pt-2.5 border-t border-stone-50">
                         <input 
                           type="checkbox" 
                           checked={exportOptions.diaries}
                           onChange={e => setExportOptions(prev => ({ ...prev, diaries: e.target.checked }))}
                           className="w-4 h-4 mt-0.5 rounded border-stone-300 text-stone-900 focus:ring-black accent-black cursor-pointer" 
                         />
                         <div className="flex flex-col cursor-pointer select-none">
                            <span className="text-[14px] text-stone-800 font-medium leading-none">生成的日记与回顾</span>
                            <span className="text-[12px] text-stone-400 mt-1">导出由 AI 汇总的日记文本及对应的日期戳。</span>
                         </div>
                      </label>
                      <label className="flex items-start gap-3 pt-2.5 border-t border-stone-50">
                         <input 
                           type="checkbox" 
                           checked={exportOptions.insights}
                           onChange={e => setExportOptions(prev => ({ ...prev, insights: e.target.checked }))}
                           className="w-4 h-4 mt-0.5 rounded border-stone-300 text-stone-900 focus:ring-black accent-black cursor-pointer" 
                         />
                         <div className="flex flex-col cursor-pointer select-none">
                            <span className="text-[14px] text-stone-800 font-medium leading-none">深度洞察</span>
                            <span className="text-[12px] text-stone-400 mt-1">导出生成的近期时间分布汇总及建议。</span>
                         </div>
                      </label>
                    </div>

                    {/* Date range selection */}
                    <div className="pt-3 border-t border-stone-100">
                      <h4 className="text-[12px] font-medium text-stone-500 mb-2">选择时间范围</h4>
                      <div className="flex gap-2">
                        <button 
                           onClick={() => setExportDateRange('all')}
                           className={`flex-1 py-1.5 text-[13px] rounded-lg border transition-all ${exportDateRange === 'all' ? 'bg-stone-100 border-stone-200 text-black font-medium shadow-[inset_0_1px_3px_rgb(0_0_0_/_0.02)]' : 'bg-white border-stone-100/50 text-stone-500 hover:bg-stone-50'}`}
                        >
                          全量导出
                        </button>
                        <button 
                           onClick={() => setExportDateRange('custom')}
                           className={`flex-1 py-1.5 text-[13px] rounded-lg border transition-all ${exportDateRange === 'custom' ? 'bg-stone-100 border-stone-200 text-black font-medium shadow-[inset_0_1px_3px_rgb(0_0_0_/_0.02)]' : 'bg-white border-stone-100/50 text-stone-500 hover:bg-stone-50'}`}
                        >
                          指定日期范围
                        </button>
                      </div>
                      
                      {exportDateRange === 'custom' && (
                        <div className="flex items-center justify-between gap-3 mt-3 p-3 bg-stone-50/80 rounded-lg border border-stone-100/60 shadow-[inset_0_1px_2px_rgb(0_0_0_/_0.01)]">
                          <input 
                            type="date" 
                            className="w-full bg-transparent border-b border-stone-200 pb-1 text-[13px] text-stone-700 outline-none focus:border-stone-400 transition-colors"
                            value={exportStartDate}
                            onChange={(e) => setExportStartDate(e.target.value)}
                          />
                          <span className="text-stone-400 text-[12px] font-mono shrink-0">to</span>
                          <input 
                            type="date" 
                            className="w-full bg-transparent border-b border-stone-200 pb-1 text-[13px] text-stone-700 outline-none focus:border-stone-400 transition-colors"
                            value={exportEndDate}
                            onChange={(e) => setExportEndDate(e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                 </div>
                 
                 <button 
                   onClick={handleExport}
                   disabled={!exportOptions.logs && !exportOptions.diaries && !exportOptions.insights}
                   className="w-full mt-4 flex items-center justify-center gap-2 bg-stone-100 text-stone-800 py-3 rounded-xl text-[13px] font-medium hover:bg-stone-200 transition-colors disabled:opacity-30 disabled:hover:bg-stone-100 active:scale-[0.98]"
                 >
                   <FileDown className="w-4 h-4" />
                   导出数据 (JSON)
                 </button>
               </div>

               <div className="pt-4 border-t border-stone-100">
                 <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase">数据导入</h3>
                 </div>
                 <p className="text-[12px] text-stone-500 mb-4 leading-relaxed">
                   迁移设备时，导入旧设备生成的 JSON 备份文件。
                 </p>
                 <input 
                   type="file" 
                   accept=".json"
                   ref={fileInputRef}
                   onChange={handleImport}
                   className="hidden"
                   id="import-file"
                 />
                 <label 
                   htmlFor="import-file"
                   className="w-full flex items-center justify-center gap-2 bg-white border border-stone-200 text-stone-700 py-3 rounded-xl text-[13px] font-medium hover:bg-stone-50 hover:border-stone-300 cursor-pointer transition-all shadow-[0_1px_2px_rgb(0_0_0_/_0.02)] active:scale-[0.98]"
                 >
                   <Upload className="w-4 h-4" />
                   选择文件并合并导入
                 </label>
               </div>
            </section>
          )}
        </div>

        <div className="pt-8 pb-4 mt-auto">
          <button
            onClick={() => {
              setSettings({
                diaryPrompts: localDiaryPrompts,
                diaryPromptIndex: localDiaryIndex,
                diaryPrompt: localDiaryPrompts[localDiaryIndex],
                reviewPrompts: localReviewPrompts,
                reviewPromptIndex: localReviewIndex,
                reviewPrompt: localReviewPrompts[localReviewIndex],
                insightPrompts: localInsightPrompts,
                insightPromptIndex: localInsightIndex,
                insightPrompt: localInsightPrompts[localInsightIndex],
                summaryPrompt: localSummaryPrompt,
                syncEnabled: localSyncEnabled,
                syncEndpoint: localSyncEndpoint,
                syncUsername: localSyncUsername,
                syncPassword: localSyncPassword,
                syncDirectory: localSyncDirectory,
                syncPasswordE2EE: localSyncPasswordE2EE
              });
              navigate(-1);
            }}
            className="w-full bg-[#2a2a2a] text-white py-3.5 rounded-xl text-[14px] font-medium tracking-wide hover:bg-[#222222] transition-all active:scale-[0.98] shadow-sm"
          >
             保存并返回
          </button>
        </div>

      </div>
    </div>
    </div>
  );
}

