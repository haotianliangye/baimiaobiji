import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, KeyRound, Server, Cpu, FileDown, Settings2, RotateCcw, Eye, EyeOff, Upload, Shield, Cloud, ShieldCheck, Loader2, CloudLightning } from 'lucide-react';
import { useSettingsStore, DEFAULT_DIARY_PROMPT, DEFAULT_WARM_DIARY_PROMPT, DEFAULT_REVIEW_PROMPT, DEFAULT_INSIGHT_PROMPT, DEFAULT_SUMMARY_PROMPT, DEFAULT_DIARY_SUMMARY_PROMPT, DEFAULT_INSIGHT_SUMMARY_PROMPT } from '../store/settings.store';
import { db } from '../db/db';
import { enqueueAllMissingEmbeddings } from '../lib/embedding';
import { checkStorageStatus, requestStoragePersistence, StorageEstimateInfo } from '../lib/storage';
import { useAppStore } from '../store/app.store';
import { SYNC_CONSTANTS } from '../config/constants';
import DatePickerPopover from '../components/DatePickerPopover';

const SYNC_START_DELAY_MS = 500;
const OAUTH_CHECK_INTERVAL_MS = 50;

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
    diarySummaryPrompt,
    insightSummaryPrompt,
    embedEnabled,
    embedProvider,
    embedApiKey,
    embedBaseUrl,
    embedModel,
    setSettings 
  } = settingsStore;

  const { 
    syncStatus, 
    syncErrorMessage, 
    syncNow, 
    checkAndGenerateHistoryTasks, 
    isProcessingQueue, 
    autoGenTasks, 
    isQueuePaused, 
    setQueuePaused, 
    clearQueue,
    totalVectorsCount,
    embeddingQueueSize,
    updateVectorsCount
  } = useAppStore();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<'model' | 'embedding' | 'data' | 'prompt'>(
    (location.state as any)?.tab || 'model'
  );
  const [showApiKey, setShowApiKey] = useState(false);
  const [showEmbedApiKey, setShowEmbedApiKey] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [storageInfo, setStorageInfo] = useState<StorageEstimateInfo | null>(null);
  const [isPersisting, setIsPersisting] = useState(false);
  const [showSyncPass, setShowSyncPass] = useState(false);
  const [showE2eePass, setShowE2eePass] = useState(false);

  // Cloud Sync Form States
  const [localSyncEnabled, setLocalSyncEnabled] = useState(settingsStore.syncEnabled);
  const [localSyncProvider, setLocalSyncProvider] = useState<'webdav' | 'onedrive' | 'gdrive' | 'dropbox'>(settingsStore.syncProvider || 'webdav');
  const [localSyncEndpoint, setLocalSyncEndpoint] = useState(settingsStore.syncEndpoint);
  const [localSyncUsername, setLocalSyncUsername] = useState(settingsStore.syncUsername);
  const [localSyncPassword, setLocalSyncPassword] = useState(settingsStore.syncPassword);
  const [localSyncDirectory, setLocalSyncDirectory] = useState(settingsStore.syncDirectory || '/baimiaobiji/');
  const [localSyncPasswordE2EE, setLocalSyncPasswordE2EE] = useState(settingsStore.syncPasswordE2EE);
  const [localSyncRememberCredentials, setLocalSyncRememberCredentials] = useState(settingsStore.syncRememberCredentials || false);

  // OAuth Client IDs local states
  const [localSyncOneDriveClientId, setLocalSyncOneDriveClientId] = useState(settingsStore.syncOneDriveClientId || '');
  const [localSyncGDriveClientId, setLocalSyncGDriveClientId] = useState(settingsStore.syncGDriveClientId || '');
  const [localSyncDropboxClientId, setLocalSyncDropboxClientId] = useState(settingsStore.syncDropboxClientId || '');

  useEffect(() => {
    async function loadStorageInfo() {
      const info = await checkStorageStatus();
      setStorageInfo(info);
    }
    loadStorageInfo();
  }, []);

  // OAuth Callback Hash Parser
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes('access_token=')) {
      const params = new URLSearchParams(hash.replace(/^#/, '?'));
      const token = params.get('access_token');
      const state = params.get('state');

      if (token && state) {
        // Restore pre-oauth backup
        try {
          const backupStr = localStorage.getItem('baimiao_oauth_backup');
          if (backupStr) {
            const backup = JSON.parse(backupStr);
            if (backup.syncEndpoint) setLocalSyncEndpoint(backup.syncEndpoint);
            if (backup.syncUsername) setLocalSyncUsername(backup.syncUsername);
            if (backup.syncDirectory) setLocalSyncDirectory(backup.syncDirectory);
            if (backup.syncRememberCredentials !== undefined) setLocalSyncRememberCredentials(backup.syncRememberCredentials);
            settingsStore.setSettings({
              syncEndpoint: backup.syncEndpoint,
              syncUsername: backup.syncUsername,
              syncDirectory: backup.syncDirectory,
              syncRememberCredentials: backup.syncRememberCredentials
            });
            localStorage.removeItem('baimiao_oauth_backup');
          }
        } catch (err) {}

        if (state === 'onedrive') {
          settingsStore.setSettings({
            syncOneDriveToken: token,
            syncProvider: 'onedrive',
            syncEnabled: true
          });
          setLocalSyncProvider('onedrive');
          setLocalSyncEnabled(true);
        } else if (state === 'gdrive') {
          settingsStore.setSettings({
            syncGDriveToken: token,
            syncProvider: 'gdrive',
            syncEnabled: true
          });
          setLocalSyncProvider('gdrive');
          setLocalSyncEnabled(true);
        } else if (state === 'dropbox') {
          settingsStore.setSettings({
            syncDropboxToken: token,
            syncProvider: 'dropbox',
            syncEnabled: true
          });
          setLocalSyncProvider('dropbox');
          setLocalSyncEnabled(true);
        }

        // Clean up hash from URL
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        alert(`已成功连接到 ${state === 'gdrive' ? 'Google Drive' : state === 'onedrive' ? 'OneDrive' : 'Dropbox'} 网盘！`);
        
        // Delay syncNow to give React state time to flush to Zustand
        setTimeout(() => {
          syncNow();
        }, SYNC_START_DELAY_MS);
      }
    }
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
      alert("永久存储申请被浏览器暂时拒绝。\n\n💡 提示：\n1. Chrome/Edge 等浏览器不会弹窗询问，而是根据您的「网站使用频率」自动静默批准。\n2. 最快的方法：点击浏览器地址栏右侧的「安装应用 / 安装为 PWA」图标，安装后浏览器会自动为您开放永久存储权限。\n3. 在此之前，只要您设备的 C盘/系统盘 空间充足，数据也不会被随意清理，请放心使用。");
    }
  };

  const handleOAuthAuthorize = (provider: 'onedrive' | 'gdrive' | 'dropbox') => {
    const redirectUri = window.location.origin + window.location.pathname;
    
    let authUrl = '';
    if (provider === 'onedrive') {
      const clientId = localSyncOneDriveClientId || SYNC_CONSTANTS.DEFAULT_ONEDRIVE_CLIENT_ID;
      authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('files.readwrite')}&state=onedrive`;
    } else if (provider === 'gdrive') {
      const clientId = localSyncGDriveClientId || SYNC_CONSTANTS.DEFAULT_GDRIVE_CLIENT_ID;
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive.file')}&state=gdrive`;
    } else if (provider === 'dropbox') {
      const clientId = localSyncDropboxClientId || SYNC_CONSTANTS.DEFAULT_DROPBOX_CLIENT_ID;
      authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&state=dropbox`;
    }
    
    if (authUrl) {
      settingsStore.setSettings({
        syncOneDriveClientId: localSyncOneDriveClientId,
        syncGDriveClientId: localSyncGDriveClientId,
        syncDropboxClientId: localSyncDropboxClientId,
        syncProvider: provider
      });
      // Backup state before redirect to survive cross-origin returns
      localStorage.setItem('baimiao_oauth_backup', JSON.stringify({
        syncProvider: provider,
        syncEndpoint: localSyncEndpoint,
        syncUsername: localSyncUsername,
        syncDirectory: localSyncDirectory,
        syncRememberCredentials: localSyncRememberCredentials
      }));
      window.location.href = authUrl;
    }
  };

  const handleOAuthDisconnect = (provider: 'onedrive' | 'gdrive' | 'dropbox') => {
    if (provider === 'onedrive') {
      settingsStore.setSettings({ syncOneDriveToken: '' });
    } else if (provider === 'gdrive') {
      settingsStore.setSettings({ syncGDriveToken: '' });
    } else if (provider === 'dropbox') {
      settingsStore.setSettings({ syncDropboxToken: '' });
    }
    alert(`已断开与 ${provider.toUpperCase()} 网盘的连接。`);
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
    embeddings: false,
  });

  const [localDiaryPrompts, setLocalDiaryPrompts] = useState<string[]>(() => {
    if (diaryPrompts && diaryPrompts.length === 4) return [...diaryPrompts];
    return [diaryPrompt || DEFAULT_DIARY_PROMPT, DEFAULT_WARM_DIARY_PROMPT, '', ''];
  });
  const [localDiaryIndex, setLocalDiaryIndex] = useState<number>(0);

  const [localReviewPrompts, setLocalReviewPrompts] = useState<string[]>(() => {
    if (reviewPrompts && reviewPrompts.length === 4) return [...reviewPrompts];
    return [reviewPrompt || DEFAULT_REVIEW_PROMPT, '', '', ''];
  });
  const [localReviewIndex, setLocalReviewIndex] = useState<number>(0);

  const [localInsightPrompts, setLocalInsightPrompts] = useState<string[]>(() => {
    if (insightPrompts && insightPrompts.length === 4) return [...insightPrompts];
    return [insightPrompt || DEFAULT_INSIGHT_PROMPT, '', '', ''];
  });
  const [localInsightIndex, setLocalInsightIndex] = useState<number>(0);

  const [localSummaryPrompt, setLocalSummaryPrompt] = useState(summaryPrompt || DEFAULT_SUMMARY_PROMPT);
  const [localDiarySummaryPrompt, setLocalDiarySummaryPrompt] = useState(diarySummaryPrompt || DEFAULT_DIARY_SUMMARY_PROMPT);
  const [localInsightSummaryPrompt, setLocalInsightSummaryPrompt] = useState(insightSummaryPrompt || DEFAULT_INSIGHT_SUMMARY_PROMPT);

  const [chatTestStatus, setChatTestStatus] = useState<'idle' | 'testing' | 'success' | 'fail'>('idle');
  const [chatTestError, setChatTestError] = useState('');
  const [embedTestStatus, setEmbedTestStatus] = useState<'idle' | 'testing' | 'success' | 'fail'>('idle');
  const [embedTestError, setEmbedTestError] = useState('');

  const handleTestChatConnection = async () => {
    if (!apiKey && provider !== 'custom') {
      setChatTestStatus('fail');
      setChatTestError('API Key 不能为空');
      setTimeout(() => setChatTestStatus('idle'), 3000);
      return;
    }
    setChatTestStatus('testing');
    setChatTestError('');
    try {
      const res = await fetch('/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'chat',
          settings: { provider, apiKey, baseUrl, model }
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      setChatTestStatus('success');
    } catch (err: any) {
      setChatTestStatus('fail');
      setChatTestError(err.message || '测试失败');
    } finally {
      setTimeout(() => setChatTestStatus('idle'), 4000);
    }
  };

  const handleTestEmbedConnection = async () => {
    const actualEmbedKey = embedApiKey || (embedProvider === 'gemini' ? apiKey : '');
    if (!actualEmbedKey && embedProvider !== 'custom') {
      setEmbedTestStatus('fail');
      setEmbedTestError('API Key 不能为空');
      setTimeout(() => setEmbedTestStatus('idle'), 3000);
      return;
    }
    setEmbedTestStatus('testing');
    setEmbedTestError('');
    try {
      const res = await fetch('/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'embed',
          settings: { provider: embedProvider, apiKey: actualEmbedKey, baseUrl: embedBaseUrl, model: embedModel }
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      setEmbedTestStatus('success');
    } catch (err: any) {
      setEmbedTestStatus('fail');
      setEmbedTestError(err.message || '测试失败');
    } finally {
      setTimeout(() => setEmbedTestStatus('idle'), 4000);
    }
  };

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
      if (exportOptions.embeddings) {
         // Export only id + embedding + embedding_version from all four tables
         // (full text content is covered by the other export options)
         const allLogs = await db.raw_logs.toArray();
         const filteredLogs = exportDateRange === 'custom'
           ? allLogs.filter(l => l.created_at >= startMs && l.created_at <= endMs)
           : allLogs;
         const allDiaries = await db.daily_diaries.toArray();
         const filteredDiaries = exportDateRange === 'custom'
           ? allDiaries.filter(d => d.diary_date >= startStr && d.diary_date <= endStr)
           : allDiaries;
         const allDailyReviews = await db.daily_reviews.toArray();
         const filteredReviews = exportDateRange === 'custom'
           ? allDailyReviews.filter(r => r.review_date >= startStr && r.review_date <= endStr)
           : allDailyReviews;
         const allInsights = await db.insights.toArray();
         const filteredInsights = exportDateRange === 'custom'
           ? allInsights.filter(i => i.created_at >= startMs && i.created_at <= endMs)
           : allInsights;
         data.embeddings = {
           logs: filteredLogs
             .filter(l => l.embedding && l.embedding.length > 0)
             .map(l => ({ id: l.id, embedding: l.embedding, embedding_version: l.embedding_version })),
           diaries: filteredDiaries
             .filter(d => d.embedding && d.embedding.length > 0)
             .map(d => ({ id: d.id, embedding: d.embedding, embedding_version: d.embedding_version })),
           daily_reviews: filteredReviews
             .filter(r => r.embedding && r.embedding.length > 0)
             .map(r => ({ id: r.id, embedding: r.embedding, embedding_version: r.embedding_version })),
           insights: filteredInsights
             .filter(i => i.embedding && i.embedding.length > 0)
             .map(i => ({ id: i.id, embedding: i.embedding, embedding_version: i.embedding_version })),
         };
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
      <div className="flex flex-col h-full overflow-hidden bg-white relative z-50 mx-auto max-w-md w-full shadow-sm ring-1 ring-black/5">
        <div className="flex h-14 items-center px-4 bg-[#faf9fc]/85 backdrop-blur border-b border-baimiao-border/40 shrink-0">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-baimiao-mysteria/70 hover:text-baimiao-mysteria hover:bg-baimiao-mysteria/5 transition-all rounded-full active:scale-90">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-[15.5px] font-bold ml-2 text-baimiao-mysteria font-serif baimiao-editorial-title">系统设置</h2>
        </div>

        <div className="flex-1 overflow-y-auto thin-scrollbar w-full p-3 space-y-4 pb-16">
        
        {/* Navigation Tabs */}
        <div className="flex bg-[#f0edf4]/60 p-1 rounded-xl border border-baimiao-border/20 gap-0.5">
          <button
            onClick={() => setActiveTab('model')}
            className={`flex-1 flex justify-center py-2 text-[12px] font-medium rounded-lg transition-colors ${
              activeTab === 'model' ? 'bg-white shadow-md shadow-baimiao-mysteria/5 text-baimiao-mysteria font-bold' : 'text-[#8a859e] hover:text-stone-700'
            }`}
          >
            对话模型
          </button>
          <button
            onClick={() => setActiveTab('embedding')}
            className={`flex-1 flex justify-center py-2 text-[12px] font-medium rounded-lg transition-colors ${
              activeTab === 'embedding' ? 'bg-white shadow-md shadow-baimiao-mysteria/5 text-baimiao-mysteria font-bold' : 'text-[#8a859e] hover:text-stone-700'
            }`}
          >
            向量与语义
          </button>
          <button
            onClick={() => setActiveTab('data')}
            className={`flex-1 flex justify-center py-2 text-[12px] font-medium rounded-lg transition-colors ${
              activeTab === 'data' ? 'bg-white shadow-md shadow-baimiao-mysteria/5 text-baimiao-mysteria font-bold' : 'text-[#8a859e] hover:text-stone-700'
            }`}
          >
            数据管理
          </button>
          <button
            onClick={() => setActiveTab('prompt')}
            className={`flex-1 flex justify-center py-2 text-[12px] font-medium rounded-lg transition-colors ${
              activeTab === 'prompt' ? 'bg-white shadow-md shadow-baimiao-mysteria/5 text-baimiao-mysteria font-bold' : 'text-[#8a859e] hover:text-stone-700'
            }`}
          >
            提示词配置
          </button>
        </div>

        <div className="space-y-3">
          {activeTab === 'model' && (
            <>
              {/* Provider Selection */}
              <section className="baimiao-card-diary p-1.5">
                 <div className="grid grid-cols-4 gap-1 p-1">
                    {[
                      { id: 'gemini', label: 'Gemini', defaultBase: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-3.1-flash-lite', link: 'https://aistudio.google.com/app/apikey' },
                      { id: 'openai', label: 'OpenAI', defaultBase: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', link: 'https://platform.openai.com/api-keys' },
                      { id: 'volcengine', label: '火山引擎', defaultBase: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'ep-xxx', link: 'https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint' },
                      { id: 'kimi', label: 'Kimi', defaultBase: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k', link: 'https://platform.moonshot.cn/console/api-keys' },
                      { id: 'zhipu', label: '智谱', defaultBase: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash', link: 'https://bigmodel.cn/usercenter/apikeys' },
                      { id: 'minimax', label: 'MiniMax', defaultBase: 'https://api.minimax.chat/v1', defaultModel: 'abab6.5s-chat', link: 'https://platform.minimaxi.com/user-center/basic-information' },
                      { id: 'mimo', label: 'MIMO', defaultBase: 'https://ai.xiaomi.com/v1', defaultModel: 'mimo-chat', link: 'https://open.xiaomi.com/' },
                      { id: 'anthropic', label: 'Anthropic', defaultBase: 'https://api.anthropic.com/v1', defaultModel: 'claude-3-5-sonnet-latest', link: 'https://console.anthropic.com/' },
                      { id: 'deepseek', label: 'DeepSeek', defaultBase: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', link: 'https://platform.deepseek.com/' },
                      { id: 'siliconflow', label: '硅基流动', defaultBase: 'https://api.siliconflow.cn/v1', defaultModel: 'Qwen/Qwen2.5-7B-Instruct', link: 'https://cloud.siliconflow.cn/account/ak' },
                      { id: 'custom', label: '自定义', defaultBase: 'http://127.0.0.1:11434/v1', defaultModel: 'llama3', link: '' }
                    ].map(p => (
                       <button
                         key={p.id}
                         onClick={() => {
                           setSettings({ provider: p.id as any });
                         }}
                         className={`flex items-center justify-center py-1.5 px-1 rounded-lg text-[12px] font-medium transition-all ${
                           provider === p.id 
                             ? 'bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white shadow-md' 
                             : 'text-stone-500 hover:bg-baimiao-mysteria/5 hover:text-baimiao-mysteria transition-all'
                         }`}
                       >
                         {p.label}
                       </button>
                    ))}
                 </div>
              </section>

              {/* Dynamic Fields */}
              <section className="space-y-3">
                <div className="baimiao-card-diary p-4 space-y-3">
                  <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase mb-1">配置详情</h3>
                  
                  {/* API Key */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-[13px] font-medium text-stone-700">
                        <KeyRound className="w-4 h-4 text-stone-400" />
                        API Key
                      </label>
                      <div className="flex items-center gap-6">
                        {(() => {
                          const linkInfo = [
                            { id: 'gemini', link: 'https://aistudio.google.com/app/apikey' },
                            { id: 'openai', link: 'https://platform.openai.com/api-keys' },
                            { id: 'volcengine', link: 'https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint' },
                            { id: 'kimi', link: 'https://platform.moonshot.cn/console/api-keys' },
                            { id: 'zhipu', link: 'https://bigmodel.cn/usercenter/apikeys' },
                            { id: 'minimax', link: 'https://platform.minimaxi.com/user-center/basic-information' },
                            { id: 'mimo', link: 'https://open.xiaomi.com/' },
                            { id: 'anthropic', link: 'https://console.anthropic.com/' },
                            { id: 'deepseek', link: 'https://platform.deepseek.com/' },
                            { id: 'siliconflow', link: 'https://cloud.siliconflow.cn/account/ak' },
                          ].find(x => x.id === provider)?.link;
                          
                          return linkInfo ? (
                            <a href={linkInfo} target="_blank" rel="noreferrer" className="text-[11.5px] text-[#8a859e] hover:text-baimiao-mysteria transition-colors hover:underline font-normal select-none leading-none">申请密钥</a>
                          ) : null;
                        })()}
                        {chatTestStatus === 'testing' ? (
                          <span className="text-[11.5px] text-stone-400 flex items-center gap-1 select-none font-medium leading-none">
                            <Loader2 className="w-3 h-3 animate-spin text-baimiao-mysteria" />
                            测试中...
                          </span>
                        ) : chatTestStatus === 'success' ? (
                          <span className="text-[11.5px] text-green-600 font-semibold flex items-center gap-0.5 animate-in fade-in select-none leading-none">
                            已连通 ✅
                          </span>
                        ) : chatTestStatus === 'fail' ? (
                          <span 
                            className="text-[11.5px] text-rose-500 font-semibold flex items-center gap-0.5 animate-in fade-in cursor-help select-none leading-none"
                            title={chatTestError}
                          >
                            连接失败 ❌
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={handleTestChatConnection}
                            className="text-[11.5px] text-[#8a859e] hover:text-baimiao-mysteria font-medium hover:underline select-none active:scale-95 transition-all leading-none"
                          >
                            测试连接
                          </button>
                        )}
                      </div>
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
                        { id: 'anthropic', defaultBase: 'https://api.anthropic.com/v1' },
                        { id: 'deepseek', defaultBase: 'https://api.deepseek.com/v1' },
                        { id: 'siliconflow', defaultBase: 'https://api.siliconflow.cn/v1' },
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
                        { id: 'anthropic', defaultModel: 'claude-3-5-sonnet-latest' },
                        { id: 'deepseek', defaultModel: 'deepseek-chat' },
                        { id: 'siliconflow', defaultModel: 'Qwen/Qwen2.5-7B-Instruct' },
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

          {activeTab === 'embedding' && (
            <>
              <section className="space-y-3">
                <div className="baimiao-card-diary p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-stone-100 pb-2 mb-1">
                    <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase">本地向量与语义搜索</h3>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={embedEnabled} 
                        onChange={e => setSettings({ embedEnabled: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-stone-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-baimiao-mysteria"></div>
                    </label>
                  </div>

                  {embedEnabled && (
                    <div className="space-y-3 pt-1">
                      {/* Provider Row */}
                      <div className="grid grid-cols-5 gap-1 p-1 bg-black/5 rounded-lg">
                        {[
                          { id: 'gemini', label: 'Gemini' },
                          { id: 'openai', label: 'OpenAI' },
                          { id: 'siliconflow', label: '硅基' },
                          { id: 'zhipu', label: '智谱' },
                          { id: 'custom', label: '自定义' }
                        ].map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setSettings({ embedProvider: p.id as any });
                            }}
                            className={`flex items-center justify-center py-1 px-0.5 rounded-md text-[11px] font-medium transition-all ${
                              embedProvider === p.id 
                                ? 'bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white shadow-sm' 
                                : 'text-stone-500 hover:bg-white/50 hover:text-baimiao-mysteria'
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>

                      {/* API Key */}
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between">
                          <label className="flex items-center gap-2 text-[12px] font-medium text-stone-700">
                            <KeyRound className="w-3.5 h-3.5 text-stone-400" />
                            向量接口 API Key
                          </label>
                          <div className="flex items-center gap-6">
                            {(() => {
                              const linkInfo = [
                                { id: 'gemini', link: 'https://aistudio.google.com/app/apikey' },
                                { id: 'openai', link: 'https://platform.openai.com/api-keys' },
                                { id: 'siliconflow', link: 'https://cloud.siliconflow.cn/account/ak' },
                                { id: 'zhipu', link: 'https://bigmodel.cn/usercenter/apikeys' }
                              ].find(x => x.id === embedProvider)?.link;
                              
                              return linkInfo ? (
                                <a href={linkInfo} target="_blank" rel="noreferrer" className="text-[11.5px] text-[#8a859e] hover:text-baimiao-mysteria transition-colors hover:underline font-normal select-none leading-none">申请密钥</a>
                              ) : null;
                            })()}
                            {embedTestStatus === 'testing' ? (
                              <span className="text-[11.5px] text-stone-400 flex items-center gap-1 select-none font-medium leading-none">
                                <Loader2 className="w-3 h-3 animate-spin text-baimiao-mysteria" />
                                测试中...
                              </span>
                            ) : embedTestStatus === 'success' ? (
                              <span className="text-[11.5px] text-green-600 font-semibold flex items-center gap-0.5 animate-in fade-in select-none leading-none">
                                已连通 ✅
                              </span>
                            ) : embedTestStatus === 'fail' ? (
                              <span 
                                className="text-[11.5px] text-rose-500 font-semibold flex items-center gap-0.5 animate-in fade-in cursor-help select-none leading-none"
                                title={embedTestError}
                              >
                                连接失败 ❌
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={handleTestEmbedConnection}
                                className="text-[11.5px] text-[#8a859e] hover:text-baimiao-mysteria font-medium hover:underline select-none active:scale-95 transition-all leading-none"
                              >
                                测试连接
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="relative">
                          <input
                            type={showEmbedApiKey ? "text" : "password"}
                            placeholder={embedProvider === 'gemini' && !embedApiKey && apiKey ? '自动复用上方 Gemini Key' : '输入你的 API 凭证'}
                            value={embedApiKey}
                            onChange={e => setSettings({ embedApiKey: e.target.value })}
                            className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 pr-10 rounded-lg text-[13px] text-stone-900 placeholder:text-stone-400 transition-all font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => setShowEmbedApiKey(!showEmbedApiKey)}
                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-stone-400 hover:text-stone-600 focus:outline-none"
                          >
                            {showEmbedApiKey ? (
                              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Base URL */}
                      <div className="space-y-1.5 pt-1.5 border-t border-stone-100">
                        <label className="flex items-center gap-2 text-[12px] font-medium text-stone-700">
                          <Server className="w-3.5 h-3.5 text-stone-400" />
                          向量代理地址 (Base URL)
                        </label>
                        <input
                          type="text"
                          placeholder={[
                            { id: 'gemini', defaultBase: 'https://generativelanguage.googleapis.com' },
                            { id: 'openai', defaultBase: 'https://api.openai.com/v1' },
                            { id: 'siliconflow', defaultBase: 'https://api.siliconflow.cn/v1' },
                            { id: 'zhipu', defaultBase: 'https://open.bigmodel.cn/api/paas/v4' },
                            { id: 'custom', defaultBase: 'http://127.0.0.1:11434/v1' }
                          ].find(x => x.id === embedProvider)?.defaultBase || ''}
                          value={embedBaseUrl}
                          onChange={e => setSettings({ embedBaseUrl: e.target.value })}
                          className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 rounded-lg text-[13px] text-stone-900 transition-all font-mono placeholder:text-stone-350"
                        />
                      </div>

                      {/* Model Name */}
                      <div className="space-y-1.5 pt-1.5 border-t border-stone-100">
                        <label className="flex items-center gap-2 text-[12px] font-medium text-stone-700">
                          <Cpu className="w-3.5 h-3.5 text-stone-400" />
                          向量模型名称 (Model)
                        </label>
                        <input
                          type="text"
                          placeholder={[
                            { id: 'gemini', defaultModel: 'gemini-embedding-2' },
                            { id: 'openai', defaultModel: 'text-embedding-3-small' },
                            { id: 'siliconflow', defaultModel: 'BAAI/bge-large-zh-v1.5' },
                            { id: 'zhipu', defaultModel: 'embedding-3' },
                            { id: 'custom', defaultModel: 'nomic-embed-text' }
                          ].find(x => x.id === embedProvider)?.defaultModel || ''}
                          value={embedModel}
                          onChange={e => setSettings({ embedModel: e.target.value })}
                          className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 rounded-lg text-[13px] text-stone-900 transition-all font-mono placeholder:text-stone-350"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {embedEnabled && (
                <section className="space-y-3 animate-in fade-in duration-250">
                  <div className="baimiao-card-diary p-4 space-y-3">
                    <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase flex items-center gap-1.5 border-b border-stone-100 pb-2 mb-1">
                      本地向量同步状态
                    </h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center text-[13px] text-stone-700">
                        <span>本地已就绪向量数：</span>
                        <span className="font-mono font-bold text-stone-900">{totalVectorsCount} 条</span>
                      </div>

                      <div className="flex justify-between items-center text-[13px] text-stone-700">
                        <span>后台待处理任务数：</span>
                        <span className="font-mono font-bold text-amber-600">
                          {embeddingQueueSize > 0 ? `${embeddingQueueSize} 条` : '0 (已全部就绪)'}
                        </span>
                      </div>

                      <div className="pt-2 border-t border-stone-100 flex justify-center">
                        <button
                          type="button"
                          onClick={async () => {
                            const count = await enqueueAllMissingEmbeddings();
                            updateVectorsCount();
                            alert(`扫描完毕！已将 ${count} 条缺少向量的记录推入生成队列。`);
                          }}
                          className="w-fit px-5 bg-white hover:bg-stone-50 active:scale-[0.97] text-stone-600 border border-stone-200/80 py-2 rounded-xl text-[12.5px] font-medium transition-all text-center shadow-sm"
                        >
                          扫描并补齐历史向量
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}

          {activeTab === 'prompt' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* Card 1: 日记生成 Prompt */}
              <section className="baimiao-card-diary p-4 space-y-3 overflow-hidden">
                <div className="bg-[#f8f6fa] border-b border-stone-100/80 px-4 py-2 flex flex-col gap-2 -mx-4 -mt-4">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-[13px] font-bold text-stone-700 border-l-2 border-baimiao-mysteria pl-2">
                      <Settings2 className="w-4 h-4 text-baimiao-mysteria" />
                      日记生成 Prompt
                    </label>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-0.5 items-center bg-[#f0edf4]/60 p-0.5 rounded-lg border border-stone-200/30">
                      {['默认', '自定义 1', '自定义 2', '自定义 3'].map((label, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setLocalDiaryIndex(idx)}
                          className={`px-2 py-0.5 text-[10.5px] font-medium rounded transition-all active:scale-[0.93] shrink-0 ${
                            localDiaryIndex === idx
                              ? 'bg-white text-baimiao-mysteria font-bold shadow-sm border border-stone-200/40'
                              : 'text-[#8a859e] hover:text-stone-600'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {localDiaryIndex !== 0 && (
                      <button 
                        type="button"
                        onClick={() => {
                          const next = [...localDiaryPrompts];
                          next[localDiaryIndex] = '';
                          setLocalDiaryPrompts(next);
                        }}
                        className="text-[11px] text-stone-400 hover:text-red-500 flex items-center gap-0.5 transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        清空当前
                      </button>
                    )}
                  </div>
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
                      ? 'bg-stone-50 text-stone-400 border-dashed border-stone-200 cursor-not-allowed'
                      : 'bg-white text-stone-900 focus:bg-white'
                  }`}
                />
              </section>

              {/* Card 2: 回顾生成 Prompt */}
              <section className="baimiao-card-diary p-4 space-y-3 overflow-hidden">
                <div className="bg-[#f8f6fa] border-b border-stone-100/80 px-4 py-2 flex flex-col gap-2 -mx-4 -mt-4">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-[13px] font-bold text-stone-700 border-l-2 border-baimiao-mysteria pl-2">
                      <Settings2 className="w-4 h-4 text-baimiao-mysteria" />
                      回顾生成 Prompt
                    </label>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-0.5 items-center bg-[#f0edf4]/60 p-0.5 rounded-lg border border-stone-200/30">
                      {['默认', '自定义 1', '自定义 2', '自定义 3'].map((label, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setLocalReviewIndex(idx)}
                          className={`px-2 py-0.5 text-[10.5px] font-medium rounded transition-all active:scale-[0.93] shrink-0 ${
                            localReviewIndex === idx
                              ? 'bg-white text-baimiao-mysteria font-bold shadow-sm border border-stone-200/40'
                              : 'text-[#8a859e] hover:text-stone-600'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {localReviewIndex !== 0 && (
                      <button 
                        type="button"
                        onClick={() => {
                          const next = [...localReviewPrompts];
                          next[localReviewIndex] = '';
                          setLocalReviewPrompts(next);
                        }}
                        className="text-[11px] text-stone-400 hover:text-red-500 flex items-center gap-0.5 transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        清空当前
                      </button>
                    )}
                  </div>
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
                      ? 'bg-stone-50 text-stone-400 border-dashed border-stone-200 cursor-not-allowed'
                      : 'bg-white text-stone-900 focus:bg-white'
                  }`}
                />
              </section>

              {/* Card 3: 洞察生成 Prompt */}
              <section className="baimiao-card-diary p-4 space-y-3 overflow-hidden">
                <div className="bg-[#f8f6fa] border-b border-stone-100/80 px-4 py-2 flex flex-col gap-2 -mx-4 -mt-4">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-[13px] font-bold text-stone-700 border-l-2 border-baimiao-mysteria pl-2">
                      <Settings2 className="w-4 h-4 text-baimiao-mysteria" />
                      洞察生成 Prompt
                    </label>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-0.5 items-center bg-[#f0edf4]/60 p-0.5 rounded-lg border border-stone-200/30">
                      {['默认', '自定义 1', '自定义 2', '自定义 3'].map((label, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setLocalInsightIndex(idx)}
                          className={`px-2 py-0.5 text-[10.5px] font-medium rounded transition-all active:scale-[0.93] shrink-0 ${
                            localInsightIndex === idx
                              ? 'bg-white text-baimiao-mysteria font-bold shadow-sm border border-stone-200/40'
                              : 'text-[#8a859e] hover:text-stone-600'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {localInsightIndex !== 0 && (
                      <button 
                        type="button"
                        onClick={() => {
                          const next = [...localInsightPrompts];
                          next[localInsightIndex] = '';
                          setLocalInsightPrompts(next);
                        }}
                        className="text-[11px] text-stone-400 hover:text-red-500 flex items-center gap-0.5 transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        清空当前
                      </button>
                    )}
                  </div>
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
                      ? 'bg-stone-50 text-stone-400 border-dashed border-stone-200 cursor-not-allowed'
                      : 'bg-white text-stone-900 focus:bg-white'
                  }`}
                />
              </section>

              {/* Card 4: 日记一句话摘要生成 Prompt */}
              <section className="baimiao-card-diary p-4 space-y-3 overflow-hidden">
                <div className="bg-[#f8f6fa] border-b border-stone-100/80 px-4 py-2.5 -mx-4 -mt-4 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 border-l-2 border-baimiao-mysteria pl-2">
                    <label className="flex items-center gap-1.5 text-[13px] font-bold text-stone-700">
                      <Settings2 className="w-4 h-4 text-baimiao-mysteria" />
                      日记一句话摘要生成 Prompt
                    </label>
                  </div>
                  <button 
                    type="button"
                    onClick={() => setLocalDiarySummaryPrompt(DEFAULT_DIARY_SUMMARY_PROMPT)}
                    className="text-[11px] text-stone-400 hover:text-red-500 flex items-center gap-1 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    恢复默认
                  </button>
                </div>
                <textarea
                  placeholder="请输入日记摘要生成提示词..."
                  value={localDiarySummaryPrompt}
                  onChange={e => setLocalDiarySummaryPrompt(e.target.value)}
                  className="w-full h-24 resize-none bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-xl text-[13px] text-stone-900 placeholder:text-stone-400 transition-all font-mono leading-relaxed focus:bg-white"
                />
              </section>

              {/* Card 5: 回顾一句话摘要生成 Prompt */}
              <section className="baimiao-card-diary p-4 space-y-3 overflow-hidden">
                <div className="bg-[#f8f6fa] border-b border-stone-100/80 px-4 py-2.5 -mx-4 -mt-4 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 border-l-2 border-baimiao-mysteria pl-2">
                    <label className="flex items-center gap-1.5 text-[13px] font-bold text-stone-700">
                      <Settings2 className="w-4 h-4 text-baimiao-mysteria" />
                      回顾一句话摘要生成 Prompt
                    </label>
                  </div>
                  <button 
                    type="button"
                    onClick={() => setLocalSummaryPrompt(DEFAULT_SUMMARY_PROMPT)}
                    className="text-[11px] text-stone-400 hover:text-red-500 flex items-center gap-1 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    恢复默认
                  </button>
                </div>
                <textarea
                  placeholder="请输入摘要生成提示词..."
                  value={localSummaryPrompt}
                  onChange={e => setLocalSummaryPrompt(e.target.value)}
                  className="w-full h-24 resize-none bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-xl text-[13px] text-stone-900 placeholder:text-stone-400 transition-all font-mono leading-relaxed focus:bg-white"
                />
              </section>

              {/* Card 6: 洞察一句话摘要生成 Prompt */}
              <section className="baimiao-card-diary p-4 space-y-3 overflow-hidden">
                <div className="bg-[#f8f6fa] border-b border-stone-100/80 px-4 py-2.5 -mx-4 -mt-4 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 border-l-2 border-baimiao-mysteria pl-2">
                    <label className="flex items-center gap-1.5 text-[13px] font-bold text-stone-700">
                      <Settings2 className="w-4 h-4 text-baimiao-mysteria" />
                      洞察一句话摘要生成 Prompt
                    </label>
                  </div>
                  <button 
                    type="button"
                    onClick={() => setLocalInsightSummaryPrompt(DEFAULT_INSIGHT_SUMMARY_PROMPT)}
                    className="text-[11px] text-stone-400 hover:text-red-500 flex items-center gap-1 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    恢复默认
                  </button>
                </div>
                <textarea
                  placeholder="请输入洞察摘要生成提示词..."
                  value={localInsightSummaryPrompt}
                  onChange={e => setLocalInsightSummaryPrompt(e.target.value)}
                  className="w-full h-24 resize-none bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-xl text-[13px] text-stone-900 placeholder:text-stone-400 transition-all font-mono leading-relaxed focus:bg-white"
                />
              </section>
            </div>
          )}

          {activeTab === 'data' && (
            <div className="space-y-4">
              {/* Storage Protection card */}
              <section className="baimiao-card-diary p-4 space-y-3">
                <h3 className="text-[12.5px] font-semibold text-stone-400 tracking-wider uppercase flex items-center gap-1.5 mb-1.5">
                  <Shield className="w-4 h-4 text-stone-400" />
                  本地存储保护
                </h3>
                {storageInfo ? (
                  <div className="space-y-3">
                    <div className={`p-3 rounded-xl border flex items-start gap-2.5 transition-all ${
                      storageInfo.persisted
                        ? "bg-emerald-50/30 border-emerald-100 text-emerald-800"
                        : "bg-amber-50/50 border-amber-100/70 text-amber-800"
                    }`}>
                      {storageInfo.persisted ? (
                        <ShieldCheck className="w-4.5 h-4.5 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <Shield className="w-4.5 h-4.5 text-amber-600 shrink-0 mt-0.5" />
                      )}
                      <div className="flex flex-col">
                        <span className="text-[13px] font-medium leading-normal">
                          状态：{storageInfo.persisted ? (
                            <span className="text-emerald-700 font-semibold">永久存储已启用</span>
                          ) : (
                            <span className="text-amber-700 font-semibold">临时存储已启用 (系统在空间极低时可能清理数据)</span>
                          )}
                        </span>
                        <span className="text-[11px] text-stone-500 mt-1">
                          已占用：{formatBytes(storageInfo.usedBytes)} / 可用空间约 {formatBytes(storageInfo.quotaBytes)}
                        </span>
                      </div>
                    </div>
                    {!storageInfo.persisted && (
                      <button
                        onClick={handlePersist}
                        disabled={isPersisting}
                        className="w-full py-2.5 bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] hover:brightness-110 text-white transition-all rounded-xl text-[13px] font-medium active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm"
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
              <section className="baimiao-card-diary p-4 space-y-3">
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
                        value={localSyncProvider} 
                        onChange={(e) => setLocalSyncProvider(e.target.value as any)}
                        className="w-full bg-white border border-black/5 outline-none px-3 py-1.5 rounded-lg text-[13px] text-stone-850 font-mono shadow-sm cursor-pointer focus:border-black focus:ring-1 focus:ring-black"
                      >
                        <option value="webdav">WebDAV (兼容坚果云、自建 NAS、Nextcloud)</option>
                        <option value="onedrive">OneDrive (微软云盘)</option>
                        <option value="gdrive">Google Drive (谷歌云盘)</option>
                        <option value="dropbox">Dropbox (多端同步)</option>
                      </select>
                    </div>

                    {localSyncProvider !== 'webdav' && (
                      <div className="space-y-3 pt-1 animate-in fade-in duration-200">
                        {/* OAuth Status Card */}
                        <div className="bg-stone-50 border border-stone-200/60 p-3 rounded-xl flex flex-col gap-2.5 shadow-inner">
                          <div className="flex items-center justify-between">
                            <span className="text-[12px] font-medium text-stone-500">网盘授权状态</span>
                            {((localSyncProvider === 'onedrive' && settingsStore.syncOneDriveToken) ||
                              (localSyncProvider === 'gdrive' && settingsStore.syncGDriveToken) ||
                              (localSyncProvider === 'dropbox' && settingsStore.syncDropboxToken)) ? (
                              <span className="text-[11.5px] font-semibold text-emerald-600 flex items-center gap-1">
                                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> 已连接
                              </span>
                            ) : (
                              <span className="text-[11.5px] font-medium text-stone-400">未授权</span>
                            )}
                          </div>

                          {((localSyncProvider === 'onedrive' && settingsStore.syncOneDriveToken) ||
                            (localSyncProvider === 'gdrive' && settingsStore.syncGDriveToken) ||
                            (localSyncProvider === 'dropbox' && settingsStore.syncDropboxToken)) ? (
                            <button
                              type="button"
                              onClick={() => handleOAuthDisconnect(localSyncProvider)}
                              className="w-full bg-stone-100 hover:bg-stone-200 text-stone-700 transition-colors py-2 rounded-lg text-[12px] font-medium active:scale-[0.99]"
                            >
                              断开网盘连接
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleOAuthAuthorize(localSyncProvider)}
                              className="w-full bg-stone-900 text-white hover:bg-black transition-colors py-2 rounded-lg text-[12px] font-medium active:scale-[0.99] flex items-center justify-center gap-1"
                            >
                              🔑 连接并授权网盘
                            </button>
                          )}
                        </div>

                        {/* Client ID Customization */}
                        <div className="space-y-1">
                          <label className="text-[12px] font-medium text-stone-500 flex items-center justify-between">
                            <span>OAuth 客户端 ID (Client ID)</span>
                            <span className="text-[10px] text-stone-400 font-normal">(可选/高级设置)</span>
                          </label>
                          {localSyncProvider === 'onedrive' && (
                            <input
                              type="text"
                              placeholder="e74f3468-f9b8-4903-b054-0dc55034c56e"
                              value={localSyncOneDriveClientId}
                              onChange={(e) => setLocalSyncOneDriveClientId(e.target.value)}
                              className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 rounded-lg text-[13px] text-stone-850 font-mono"
                            />
                          )}
                          {localSyncProvider === 'gdrive' && (
                            <input
                              type="text"
                              placeholder="937286392305-juh5263124874p82g4c4983057v4b518.apps.googleusercontent.com"
                              value={localSyncGDriveClientId}
                              onChange={(e) => setLocalSyncGDriveClientId(e.target.value)}
                              className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 rounded-lg text-[13px] text-stone-850 font-mono"
                            />
                          )}
                          {localSyncProvider === 'dropbox' && (
                            <input
                              type="text"
                              placeholder="3qy6q5w6sc1m22l"
                              value={localSyncDropboxClientId}
                              onChange={(e) => setLocalSyncDropboxClientId(e.target.value)}
                              className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-1.5 rounded-lg text-[13px] text-stone-850 font-mono"
                            />
                          )}
                          <p className="text-[10px] text-stone-400 leading-normal mt-0.5">
                            本地开发默认已内置 ID。如果您部署在自己的生产域名，请申请开发者 Client ID 填入。
                          </p>
                        </div>
                      </div>
                    )}

                    {localSyncProvider === 'webdav' && (
                      <div className="space-y-3 pt-1 animate-in fade-in duration-200">
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
                      </div>
                    )}

                    {localSyncProvider !== 'gdrive' && (
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
                    )}

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
                      
                      <label className="flex items-start gap-2 cursor-pointer mt-3 bg-stone-50 p-2.5 rounded-lg border border-stone-200/60 transition-colors hover:bg-stone-100/50">
                        <input
                          type="checkbox"
                          checked={localSyncRememberCredentials}
                          onChange={(e) => setLocalSyncRememberCredentials(e.target.checked)}
                          className="w-4 h-4 mt-0.5 rounded border-stone-300 text-stone-900 focus:ring-black accent-black cursor-pointer shrink-0"
                        />
                        <div className="flex flex-col select-none">
                          <span className="text-[12px] font-medium text-stone-800 leading-tight">在这台设备上记住密码以支持后台无感同步</span>
                          <span className="text-[10px] text-stone-500 mt-1 leading-tight tracking-wide">
                            <span className="text-amber-600 font-medium">警告：</span>
                            请确保持久化存储仅在您个人的受信任设备上开启，且设备设有屏幕锁。
                          </span>
                        </div>
                      </label>
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
                            syncProvider: localSyncProvider,
                            syncEndpoint: localSyncEndpoint,
                            syncUsername: localSyncUsername,
                            syncPassword: localSyncPassword,
                            syncDirectory: localSyncDirectory,
                            syncPasswordE2EE: localSyncPasswordE2EE,
                            syncOneDriveClientId: localSyncOneDriveClientId,
                            syncGDriveClientId: localSyncGDriveClientId,
                            syncDropboxClientId: localSyncDropboxClientId,
                          });
                          if (localSyncProvider === 'gdrive' && !localSyncGDriveClientId) {
                            setLocalSyncGDriveClientId(SYNC_CONSTANTS.DEFAULT_GDRIVE_CLIENT_ID);
                            await new Promise(r => setTimeout(r, OAUTH_CHECK_INTERVAL_MS)); 
                          }
                          if (localSyncProvider === 'onedrive' && !localSyncOneDriveClientId) {
                            setLocalSyncOneDriveClientId(SYNC_CONSTANTS.DEFAULT_ONEDRIVE_CLIENT_ID);
                            await new Promise(r => setTimeout(r, OAUTH_CHECK_INTERVAL_MS)); 
                          }
                          if (localSyncProvider === 'dropbox' && !localSyncDropboxClientId) {
                            setLocalSyncDropboxClientId(SYNC_CONSTANTS.DEFAULT_DROPBOX_CLIENT_ID);
                            await new Promise(r => setTimeout(r, OAUTH_CHECK_INTERVAL_MS)); 
                          }
                          await new Promise(r => setTimeout(r, OAUTH_CHECK_INTERVAL_MS)); 
                          await syncNow();
                        }}
                        disabled={
                          syncStatus === 'syncing' || 
                          !(
                            (localSyncProvider === 'webdav' && localSyncEndpoint && localSyncUsername && localSyncPassword && localSyncPasswordE2EE) ||
                            (localSyncProvider === 'onedrive' && settingsStore.syncOneDriveToken && localSyncPasswordE2EE) ||
                            (localSyncProvider === 'gdrive' && settingsStore.syncGDriveToken && localSyncPasswordE2EE) ||
                            (localSyncProvider === 'dropbox' && settingsStore.syncDropboxToken && localSyncPasswordE2EE)
                          )
                        }
                        className="w-full mt-1 bg-stone-900 text-white hover:bg-black transition-colors rounded-xl text-[12.5px] font-medium active:scale-[0.98] disabled:opacity-30 disabled:bg-stone-300 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 py-2.5"
                      >
                        {syncStatus === 'syncing' ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            同步进行中...
                          </>
                        ) : (
                          '🔄 立即执行手动同步'
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* AI Auto-Generation Maintenance section */}
              <section className="baimiao-card-diary p-4 space-y-3">
                <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase mb-1">AI 自动整理维护</h3>
                <p className="text-[12px] text-stone-500 leading-relaxed">
                  如果您多天未打开应用，或者中途生成中断导致日记或回顾不全，可以点击下方按钮扫描过去 30 天并自动补齐生成。
                </p>
                {autoGenTasks.length > 0 ? (
                  <div className="space-y-2 mt-2 bg-stone-50 rounded-xl p-3 border border-stone-100">
                    <div className="flex items-center justify-between text-[12px] font-medium text-stone-600">
                      <span className="flex items-center gap-1.5">
                        <Loader2 className={`w-3.5 h-3.5 ${isQueuePaused ? 'text-stone-400' : 'animate-spin text-stone-900'}`} />
                        {isQueuePaused ? '⏸️ 自动整理已暂停' : '🪄 正在后台自动整理中...'}
                      </span>
                      <span className="bg-stone-200/60 text-stone-700 px-2 py-0.5 rounded-full text-[11px] font-semibold">
                        剩余 {autoGenTasks.length} 项
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        onClick={() => setQueuePaused(!isQueuePaused)}
                        className="py-2 px-3 baimiao-btn-cream transition-colors rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1"
                      >
                        {isQueuePaused ? '▶️ 恢复整理' : '⏸️ 暂停整理'}
                      </button>
                      <button
                        onClick={() => clearQueue()}
                        className="py-2 px-3 bg-red-50 hover:bg-red-100 transition-colors rounded-lg text-[12px] font-semibold text-red-600 border border-red-100 flex items-center justify-center gap-1"
                      >
                        🛑 停止并清空
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={async () => {
                      await checkAndGenerateHistoryTasks(30);
                    }}
                    className="w-full mt-1 bg-baimiao-mysteria/[0.03] hover:bg-baimiao-mysteria/[0.06] border border-baimiao-mysteria/10 hover:border-baimiao-mysteria/20 text-baimiao-mysteria transition-colors rounded-xl text-[12.5px] font-medium active:scale-[0.98] flex items-center justify-center gap-1.5 py-2.5"
                  >
                    🪄 扫描并补全过去 30 天的日记与回顾
                  </button>
                )}
              </section>

              {/* Data Export / Import section */}
              <section className="baimiao-card-diary p-4 space-y-4">
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
                       <label className="flex items-start gap-3 pt-2.5 border-t border-stone-50">
                          <input 
                            type="checkbox" 
                            checked={exportOptions.embeddings}
                            onChange={e => setExportOptions(prev => ({ ...prev, embeddings: e.target.checked }))}
                            className="w-4 h-4 mt-0.5 rounded border-stone-300 text-stone-900 focus:ring-black accent-black cursor-pointer" 
                          />
                          <div className="flex flex-col cursor-pointer select-none">
                             <span className="text-[14px] text-stone-800 font-medium leading-none">向量索引数据</span>
                             <span className="text-[12px] text-stone-400 mt-1">导出本地语义搜索所用的向量数据，迁移设备时可免重建索引。默认不勾选（体积较大）。</span>
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
                        <div className="flex items-center justify-center gap-2 mt-3 py-2 overflow-visible">
                          <DatePickerPopover
                            value={exportStartDate}
                            onChange={setExportStartDate}
                            placeholder="开始日期"
                            align="left"
                          />
                          <span className="text-stone-400 text-[12px] font-mono shrink-0">-</span>
                          <DatePickerPopover
                            value={exportEndDate}
                            onChange={setExportEndDate}
                            placeholder="结束日期"
                            align="right"
                          />
                        </div>
                      )}
                    </div>
                 </div>
                 
                 <button 
                   onClick={handleExport}
                   disabled={!exportOptions.logs && !exportOptions.diaries && !exportOptions.insights && !exportOptions.embeddings}
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
            </div>
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
                diarySummaryPrompt: localDiarySummaryPrompt,
                insightSummaryPrompt: localInsightSummaryPrompt,
                syncEnabled: localSyncEnabled,
                syncProvider: localSyncProvider,
                syncEndpoint: localSyncEndpoint,
                syncUsername: localSyncUsername,
                syncPassword: localSyncPassword,
                syncDirectory: localSyncDirectory,
                syncPasswordE2EE: localSyncPasswordE2EE,
                syncRememberCredentials: localSyncRememberCredentials,
                syncOneDriveClientId: localSyncOneDriveClientId,
                syncGDriveClientId: localSyncGDriveClientId,
                syncDropboxClientId: localSyncDropboxClientId
              });
              navigate(-1);
            }}
            className="w-full py-3.5 rounded-xl text-[14px] font-medium tracking-wide text-white bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] hover:brightness-110 active:scale-[0.98] shadow-md shadow-baimiao-mysteria/10 transition-all"
          >
             保存并返回
          </button>
        </div>

      </div>
    </div>
    </div>
  );
}

