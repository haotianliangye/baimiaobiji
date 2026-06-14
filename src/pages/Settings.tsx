import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound, Server, Cpu, FileDown, Settings2, RotateCcw, Eye, EyeOff } from 'lucide-react';
import { useSettingsStore, DEFAULT_DIARY_PROMPT, DEFAULT_REVIEW_PROMPT, DEFAULT_INSIGHT_PROMPT, DEFAULT_SUMMARY_PROMPT } from '../store/settings.store';
import { db } from '../db/db';

export default function Settings() {
  const navigate = useNavigate();
  const { provider, apiKey, baseUrl, model, diaryPrompt, reviewPrompt, insightPrompt, summaryPrompt, setSettings } = useSettingsStore();

  const [activeTab, setActiveTab] = useState<'model' | 'export' | 'prompt'>('model');
  const [showApiKey, setShowApiKey] = useState(false);

  const [exportOptions, setExportOptions] = useState({
    logs: true,
    diaries: true,
    insights: true,
  });

  const [localPrompts, setLocalPrompts] = useState({
    diaryPrompt: diaryPrompt || DEFAULT_DIARY_PROMPT,
    reviewPrompt: reviewPrompt || DEFAULT_REVIEW_PROMPT,
    insightPrompt: insightPrompt || DEFAULT_INSIGHT_PROMPT,
    summaryPrompt: summaryPrompt || DEFAULT_SUMMARY_PROMPT,
  });

  const handleExport = async () => {
    try {
      const data: any = {};
      if (exportOptions.logs) {
         data.logs = await db.raw_logs.toArray();
      }
      if (exportOptions.diaries) {
         data.diaries = await db.daily_diaries.toArray();
      }
      if (exportOptions.insights) {
         data.insights = await db.insights.toArray();
      }
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `baimiao_export_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("导出失败");
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-stone-50 relative z-50 mx-auto max-w-md w-full shadow-sm ring-1 ring-black/5">
      <div className="flex h-14 items-center px-4 bg-white border-b border-stone-100 shrink-0">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-stone-500 hover:text-black">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-[15px] font-medium ml-2 text-stone-900">系统设置</h2>
      </div>

      <div className="flex-1 overflow-y-auto w-full p-3 space-y-4 pb-16">
        
        {/* Navigation Tabs */}
        <div className="flex bg-stone-100/80 p-1 rounded-xl shadow-inner border border-stone-200/50">
          <button
            onClick={() => setActiveTab('model')}
            className={`flex-1 flex justify-center py-2 text-[13px] font-medium rounded-lg transition-colors ${
              activeTab === 'model' ? 'bg-white shadow-sm ring-1 ring-black/5 text-black' : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            系统设置
          </button>
          <button
            onClick={() => setActiveTab('export')}
            className={`flex-1 flex justify-center py-2 text-[13px] font-medium rounded-lg transition-colors ${
              activeTab === 'export' ? 'bg-white shadow-sm ring-1 ring-black/5 text-black' : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            数据导出
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
                      { id: 'deepseek', label: 'DeepSeek', defaultBase: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', link: 'https://platform.deepseek.com/api_keys' },
                      { id: 'kimi', label: 'Kimi', defaultBase: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k', link: 'https://platform.moonshot.cn/console/api-keys' },
                      { id: 'zhipu', label: '智谱', defaultBase: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash', link: 'https://bigmodel.cn/usercenter/apikeys' },
                      { id: 'minimax', label: 'MiniMax', defaultBase: 'https://api.minimax.chat/v1', defaultModel: 'abab6.5s-chat', link: 'https://platform.minimaxi.com/user-center/basic-information' },
                      { id: 'mimo', label: 'MIMO', defaultBase: 'https://ai.xiaomi.com/v1', defaultModel: 'mimo-chat', link: 'https://open.xiaomi.com/' },
                      { id: 'custom', label: '自定义', defaultBase: 'http://127.0.0.1:11434/v1', defaultModel: 'llama3', link: '' }
                    ].map(p => (
                       <button
                         key={p.id}
                         onClick={() => {
                           const currProvDef = [
                             { id: 'gemini', defaultBase: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-3.1-flash-lite' },
                             { id: 'openai', defaultBase: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
                             { id: 'deepseek', defaultBase: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
                             { id: 'kimi', defaultBase: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k' },
                             { id: 'zhipu', defaultBase: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash' },
                             { id: 'minimax', defaultBase: 'https://api.minimax.chat/v1', defaultModel: 'abab6.5s-chat' },
                             { id: 'mimo', defaultBase: 'https://ai.xiaomi.com/v1', defaultModel: 'mimo-chat' },
                             { id: 'custom', defaultBase: 'http://127.0.0.1:11434/v1', defaultModel: 'llama3' }
                           ].find(x => x.id === provider);

                           const newBase = (!baseUrl || (currProvDef && baseUrl === currProvDef.defaultBase)) ? p.defaultBase : baseUrl;
                           const newModel = (!model || (currProvDef && model === currProvDef.defaultModel)) ? p.defaultModel : model;

                           setSettings({ provider: p.id as any, baseUrl: newBase, model: newModel });
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
                          { id: 'deepseek', link: 'https://platform.deepseek.com/api_keys' },
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
                        className="w-full bg-stone-50 border border-stone-200 outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 pr-10 rounded-lg text-[14px] text-stone-900 placeholder:text-stone-400 transition-all font-mono"
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
                      value={baseUrl || [
                        { id: 'gemini', defaultBase: 'https://generativelanguage.googleapis.com/v1beta' },
                        { id: 'openai', defaultBase: 'https://api.openai.com/v1' },
                        { id: 'deepseek', defaultBase: 'https://api.deepseek.com/v1' },
                        { id: 'kimi', defaultBase: 'https://api.moonshot.cn/v1' },
                        { id: 'zhipu', defaultBase: 'https://open.bigmodel.cn/api/paas/v4' },
                        { id: 'minimax', defaultBase: 'https://api.minimax.chat/v1' },
                        { id: 'mimo', defaultBase: 'https://ai.xiaomi.com/v1' },
                        { id: 'custom', defaultBase: 'http://127.0.0.1:11434/v1' }
                      ].find(x => x.id === provider)?.defaultBase || ''}
                      onChange={e => setSettings({ baseUrl: e.target.value })}
                      className="w-full bg-stone-50 border border-stone-200 outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-lg text-[14px] text-stone-900 transition-all font-mono"
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
                      value={model || [
                        { id: 'gemini', defaultModel: 'gemini-3.1-flash-lite' },
                        { id: 'openai', defaultModel: 'gpt-4o-mini' },
                        { id: 'deepseek', defaultModel: 'deepseek-chat' },
                        { id: 'kimi', defaultModel: 'moonshot-v1-8k' },
                        { id: 'zhipu', defaultModel: 'glm-4-flash' },
                        { id: 'minimax', defaultModel: 'abab6.5s-chat' },
                        { id: 'mimo', defaultModel: 'mimo-chat' },
                        { id: 'custom', defaultModel: 'llama3' }
                      ].find(x => x.id === provider)?.defaultModel || ''}
                      onChange={e => setSettings({ model: e.target.value })}
                      className="w-full bg-stone-50 border border-stone-200 outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-lg text-[14px] text-stone-900 transition-all font-mono"
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
                     <div className="flex items-center justify-between">
                       <label className="flex items-center gap-2 text-[13px] font-medium text-stone-700">
                          <Settings2 className="w-4 h-4 text-stone-400" />
                          日记生成 Prompt
                       </label>
                       <button 
                         onClick={() => setLocalPrompts(prev => ({...prev, diaryPrompt: DEFAULT_DIARY_PROMPT}))}
                         className="text-[11px] text-stone-400 hover:text-black flex items-center gap-1 transition-colors"
                       >
                         <RotateCcw className="w-3 h-3" />
                         恢复默认
                       </button>
                     </div>
                     <textarea
                        placeholder="请输入日记生成提示词..."
                        value={localPrompts.diaryPrompt}
                        onChange={e => setLocalPrompts(prev => ({...prev, diaryPrompt: e.target.value}))}
                        className="w-full h-32 resize-none bg-stone-50 border border-stone-200 outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-xl text-[13px] text-stone-900 placeholder:text-stone-400 transition-all font-mono leading-relaxed"
                     />
                  </div>
                  
                  <div className="space-y-1.5 pt-4 border-t border-stone-100">
                     <div className="flex items-center justify-between">
                       <label className="flex items-center gap-2 text-[13px] font-medium text-stone-700">
                          <Settings2 className="w-4 h-4 text-stone-400" />
                          回顾生成 Prompt
                       </label>
                       <button 
                         onClick={() => setLocalPrompts(prev => ({...prev, reviewPrompt: DEFAULT_REVIEW_PROMPT}))}
                         className="text-[11px] text-stone-400 hover:text-black flex items-center gap-1 transition-colors"
                       >
                         <RotateCcw className="w-3 h-3" />
                         恢复默认
                       </button>
                     </div>
                     <textarea
                        placeholder="请输入回顾生成提示词..."
                        value={localPrompts.reviewPrompt}
                        onChange={e => setLocalPrompts(prev => ({...prev, reviewPrompt: e.target.value}))}
                        className="w-full h-24 resize-none bg-stone-50 border border-stone-200 outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-xl text-[13px] text-stone-900 placeholder:text-stone-400 transition-all font-mono leading-relaxed"
                     />
                  </div>

                  <div className="space-y-1.5 pt-4 border-t border-stone-100">
                     <div className="flex items-center justify-between">
                       <label className="flex items-center gap-2 text-[13px] font-medium text-stone-700">
                          <Settings2 className="w-4 h-4 text-stone-400" />
                          洞察生成 Prompt
                       </label>
                       <button 
                         onClick={() => setLocalPrompts(prev => ({...prev, insightPrompt: DEFAULT_INSIGHT_PROMPT}))}
                         className="text-[11px] text-stone-400 hover:text-black flex items-center gap-1 transition-colors"
                       >
                         <RotateCcw className="w-3 h-3" />
                         恢复默认
                       </button>
                     </div>
                     <textarea
                        placeholder="请输入洞察生成提示词..."
                        value={localPrompts.insightPrompt}
                        onChange={e => setLocalPrompts(prev => ({...prev, insightPrompt: e.target.value}))}
                        className="w-full h-24 resize-none bg-stone-50 border border-stone-200 outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-xl text-[13px] text-stone-900 placeholder:text-stone-400 transition-all font-mono leading-relaxed"
                     />
                  </div>

                  <div className="space-y-1.5 pt-4 border-t border-stone-100">
                     <div className="flex items-center justify-between">
                       <label className="flex items-center gap-2 text-[13px] font-medium text-stone-700">
                          <Settings2 className="w-4 h-4 text-stone-400" />
                          日记摘要生成 Prompt
                       </label>
                       <button 
                         onClick={() => setLocalPrompts(prev => ({...prev, summaryPrompt: DEFAULT_SUMMARY_PROMPT}))}
                         className="text-[11px] text-stone-400 hover:text-black flex items-center gap-1 transition-colors"
                       >
                         <RotateCcw className="w-3 h-3" />
                         恢复默认
                       </button>
                     </div>
                     <textarea
                        placeholder="请输入摘要生成提示词..."
                        value={localPrompts.summaryPrompt}
                        onChange={e => setLocalPrompts(prev => ({...prev, summaryPrompt: e.target.value}))}
                        className="w-full h-24 resize-none bg-stone-50 border border-stone-200 outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-xl text-[13px] text-stone-900 placeholder:text-stone-400 transition-all font-mono leading-relaxed"
                     />
                  </div>
               </div>
            </section>
          )}

          {activeTab === 'export' && (
            <section className="bg-white rounded-xl border border-stone-100 p-3 shadow-sm space-y-3">
               <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase mb-2">数据导出</h3>
               <div className="space-y-2">
                  <label className="flex items-center gap-3">
                     <input 
                       type="checkbox" 
                       checked={exportOptions.logs}
                       onChange={e => setExportOptions(prev => ({ ...prev, logs: e.target.checked }))}
                       className="w-4 h-4 rounded border-stone-300 text-stone-900 focus:ring-black accent-black" 
                     />
                     <div className="flex flex-col">
                        <span className="text-[14px] text-stone-800 font-medium">原始碎屑记录</span>
                        <span className="text-[12px] text-stone-400">导出所有时间线上的打点记录。</span>
                     </div>
                  </label>
                  <label className="flex items-center gap-3 pt-2 border-t border-stone-50">
                     <input 
                       type="checkbox" 
                       checked={exportOptions.diaries}
                       onChange={e => setExportOptions(prev => ({ ...prev, diaries: e.target.checked }))}
                       className="w-4 h-4 rounded border-stone-300 text-stone-900 focus:ring-black accent-black" 
                     />
                     <div className="flex flex-col">
                        <span className="text-[14px] text-stone-800 font-medium">生成的日记与回顾</span>
                        <span className="text-[12px] text-stone-400">导出由 AI 汇总的所有日记文本及对应的日期戳。</span>
                     </div>
                  </label>
                  <label className="flex items-center gap-3 pt-2 border-t border-stone-50">
                     <input 
                       type="checkbox" 
                       checked={exportOptions.insights}
                       onChange={e => setExportOptions(prev => ({ ...prev, insights: e.target.checked }))}
                       className="w-4 h-4 rounded border-stone-300 text-stone-900 focus:ring-black accent-black" 
                     />
                     <div className="flex flex-col">
                        <span className="text-[14px] text-stone-800 font-medium">深度洞察</span>
                        <span className="text-[12px] text-stone-400">导出生成的近期时间分布汇总及建议。</span>
                     </div>
                  </label>
               </div>
               
               <button 
                 onClick={handleExport}
                 disabled={!exportOptions.logs && !exportOptions.diaries && !exportOptions.insights}
                 className="w-full mt-4 flex items-center justify-center gap-2 bg-stone-100 text-stone-900 py-3 rounded-xl text-[13px] font-medium hover:bg-stone-200 transition-colors disabled:opacity-50 disabled:hover:bg-stone-100"
               >
                 <FileDown className="w-4 h-4" />
                 导出选中数据 (JSON)
               </button>
            </section>
          )}
        </div>

        <div className="pt-8 pb-4 mt-auto">
          <button
            onClick={() => {
              setSettings({
                diaryPrompt: localPrompts.diaryPrompt,
                reviewPrompt: localPrompts.reviewPrompt,
                insightPrompt: localPrompts.insightPrompt,
                summaryPrompt: localPrompts.summaryPrompt
              });
              navigate(-1);
            }}
            className="w-full bg-black text-white py-3.5 rounded-xl text-[14px] font-medium tracking-wide hover:bg-stone-800 transition-all active:scale-[0.98] shadow-sm"
          >
            保存并返回
          </button>
        </div>

      </div>
    </div>
  );
}

