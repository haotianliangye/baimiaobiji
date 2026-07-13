import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, KeyRound, Server, Cpu, FileDown, Settings2, RotateCcw, Eye, EyeOff, Upload, Shield, Cloud, ShieldCheck, Loader2, CloudLightning, Download, FileJson, FileText, MessageSquare, Volume2 } from 'lucide-react';
import { useSettingsStore, DEFAULT_DIARY_PROMPT, DEFAULT_REVIEW_PROMPT, DEFAULT_INSIGHT_PROMPT, DEFAULT_MINGWU_PROMPT, DEFAULT_SUMMARY_PROMPT, DEFAULT_DIARY_SUMMARY_PROMPT, DEFAULT_INSIGHT_SUMMARY_PROMPT, DEFAULT_PROMPTS_BY_LANG, DEFAULT_REVIEW_PROMPT_NAMES_BY_LANG, type Language } from '../store/settings.store';
import { db, normalizeLegacyDiary, normalizeLegacyInsight } from '../db/db';
import { enqueueAllMissingEmbeddings } from '../lib/embedding';
import { checkStorageStatus, requestStoragePersistence, StorageEstimateInfo } from '../lib/storage';
import { useAppStore } from '../store/app.store';
import { SYNC_CONSTANTS } from '../config/constants';
import DatePickerPopover from '../components/DatePickerPopover';
import { exportData, exportConversations, downloadContent, getExportFilename } from '../lib/dataExport';
import type { DataType, ExportOptions } from '../lib/dataExport';
import { importData, importConversations } from '../lib/dataImport';
import type { ImportStrategy, ImportResult } from '../lib/dataImport';
import { cn } from '../lib/utils';
import { useTranslation } from '../lib/i18n';

const SYNC_START_DELAY_MS = 500;
const OAUTH_CHECK_INTERVAL_MS = 50;

// #13 统一数据管理 -- 可导出的数据类型选项（labelKey 用于 i18n）
const DATA_TYPE_OPTIONS: { id: DataType; labelKey: string }[] = [
  { id: 'raw_logs', labelKey: 'dataType.raw_logs' },
  { id: 'daily_reviews', labelKey: 'dataType.daily_reviews' },
  { id: 'thoughts', labelKey: 'dataType.thoughts' },
  { id: 'mingwu', labelKey: 'dataType.mingwu' },
  { id: 'copilot_conversations', labelKey: 'dataType.copilot_conversations' },
  { id: 'tags', labelKey: 'dataType.tags' },
  { id: 'tag_aliases', labelKey: 'dataType.tag_aliases' },
  { id: 'attachments', labelKey: 'dataType.attachments' },
];

export default function Settings() {
  const navigate = useNavigate();
  const { t } = useTranslation();
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
    reviewPromptNames,
    reviewSelectedIndices,
    insightPrompt,
    insightPrompts,
    insightPromptIndex,
    mingwuPrompt,
    mingwuPrompts,
    mingwuPromptIndex,
    summaryPrompt,
    diarySummaryPrompt,
    insightSummaryPrompt,
    embedEnabled,
    embedProvider,
    embedApiKey,
    embedBaseUrl,
    embedModel,
    submitMultimedia,
    ttsService,
    ttsLang,
    ttsRate,
    ttsVoice,
    language,
    setLanguage,
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
        alert(t('settings.oauthConnectedAlert', { provider: state === 'gdrive' ? 'Google Drive' : state === 'onedrive' ? 'OneDrive' : 'Dropbox' }));
        
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
      alert(t('settings.storageActivatingSuccess'));
    } else {
      alert(t('settings.persistRejected'));
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
    alert(t('settings.oauthDisconnectedAlert', { provider: provider.toUpperCase() }));
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

  // #13 统一数据管理 -- 状态
  const [unifiedExportTypes, setUnifiedExportTypes] = useState<Set<DataType>>(
    new Set(['raw_logs', 'daily_reviews'])
  );
  const [unifiedExportFormat, setUnifiedExportFormat] = useState<'markdown' | 'json'>('json');
  const [unifiedExportStartDate, setUnifiedExportStartDate] = useState('');
  const [unifiedExportEndDate, setUnifiedExportEndDate] = useState('');
  const [isUnifiedExporting, setIsUnifiedExporting] = useState(false);

  const [unifiedImportStrategy, setUnifiedImportStrategy] = useState<ImportStrategy>('overwrite');
  const [unifiedImportResult, setUnifiedImportResult] = useState<ImportResult | null>(null);
  const [unifiedImportFile, setUnifiedImportFile] = useState<File | null>(null);
  const [isUnifiedImporting, setIsUnifiedImporting] = useState(false);
  const unifiedImportFileRef = useRef<HTMLInputElement>(null);

  const [convImportStrategy, setConvImportStrategy] = useState<ImportStrategy>('overwrite');
  const [convImportResult, setConvImportResult] = useState<ImportResult | null>(null);
  const [convImportFile, setConvImportFile] = useState<File | null>(null);
  const [isConvImporting, setIsConvImporting] = useState(false);
  const convImportFileRef = useRef<HTMLInputElement>(null);

  // #5: 统一 5 槽日记回顾 Prompt（合并旧 diaryPrompts + reviewPrompts）
  const [localReviewPrompts, setLocalReviewPrompts] = useState<string[]>(() => {
    if (reviewPrompts && reviewPrompts.length === 5) return [...reviewPrompts];
    // 兼容旧 4 槽 reviewPrompts（迁移前）
    if (reviewPrompts && reviewPrompts.length === 4) {
      return [reviewPrompts[0] || DEFAULT_DIARY_PROMPT, reviewPrompts[0] || DEFAULT_REVIEW_PROMPT, '', '', ''];
    }
    return [DEFAULT_DIARY_PROMPT, DEFAULT_REVIEW_PROMPT, '', '', ''];
  });
  const [localReviewPromptNames, setLocalReviewPromptNames] = useState<string[]>(() => {
    if (reviewPromptNames && reviewPromptNames.length === 5) return [...reviewPromptNames];
    return [...DEFAULT_REVIEW_PROMPT_NAMES_BY_LANG[language]];
  });
  const [localReviewSelectedIndices, setLocalReviewSelectedIndices] = useState<number[]>(() => {
    if (reviewSelectedIndices && reviewSelectedIndices.length > 0) return [...reviewSelectedIndices];
    return [0, 1];
  });
  const [localReviewIndex, setLocalReviewIndex] = useState<number>(0);

  const [localInsightPrompts, setLocalInsightPrompts] = useState<string[]>(() => {
    if (insightPrompts && insightPrompts.length === 4) return [...insightPrompts];
    return [insightPrompt || DEFAULT_INSIGHT_PROMPT, '', '', ''];
  });
  const [localInsightIndex, setLocalInsightIndex] = useState<number>(0);

  // #8 明悟生成 Prompt（4 槽：默认 + 自定义1/2/3）
  const [localMingwuPrompts, setLocalMingwuPrompts] = useState<string[]>(() => {
    if (mingwuPrompts && mingwuPrompts.length === 4) return [...mingwuPrompts];
    return [mingwuPrompt || DEFAULT_MINGWU_PROMPT, '', '', ''];
  });
  const [localMingwuIndex, setLocalMingwuIndex] = useState<number>(0);

  const [localSummaryPrompt, setLocalSummaryPrompt] = useState(summaryPrompt || DEFAULT_SUMMARY_PROMPT);
  const [localDiarySummaryPrompt, setLocalDiarySummaryPrompt] = useState(diarySummaryPrompt || DEFAULT_DIARY_SUMMARY_PROMPT);
  const [localInsightSummaryPrompt, setLocalInsightSummaryPrompt] = useState(insightSummaryPrompt || DEFAULT_INSIGHT_SUMMARY_PROMPT);

  // #12: 语言切换后，从 store 重新加载本地 Prompt 状态（store 的 setLanguage 已切换 active 字段）
  useEffect(() => {
    const s = useSettingsStore.getState();
    const d = DEFAULT_PROMPTS_BY_LANG[s.language];
    if (s.reviewPrompts && s.reviewPrompts.length === 5) setLocalReviewPrompts([...s.reviewPrompts]);
    if (s.reviewPromptNames && s.reviewPromptNames.length === 5) setLocalReviewPromptNames([...s.reviewPromptNames]);
    if (s.reviewSelectedIndices) setLocalReviewSelectedIndices([...s.reviewSelectedIndices]);
    if (s.insightPrompts && s.insightPrompts.length === 4) setLocalInsightPrompts([...s.insightPrompts]);
    if (s.mingwuPrompts && s.mingwuPrompts.length === 4) setLocalMingwuPrompts([...s.mingwuPrompts]);
    setLocalSummaryPrompt(s.summaryPrompt || d.summary);
    setLocalDiarySummaryPrompt(s.diarySummaryPrompt || d.diarySummary);
    setLocalInsightSummaryPrompt(s.insightSummaryPrompt || d.insightSummary);
  }, [language]);

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
      setChatTestError(err.message || t('settings.connectionFailed'));
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
      setEmbedTestError(err.message || t('settings.connectionFailed'));
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
         // V2: 日记已合并进 daily_reviews（entry_type='diary'）
         let diaries = await db.daily_reviews.filter(d => d.entry_type === 'diary').toArray();
         if (exportDateRange === 'custom') {
           diaries = diaries.filter(d => d.review_date >= startStr && d.review_date <= endStr);
         }
         data.diaries = diaries;
      }
      if (exportOptions.insights) {
         // V2: insights 改名为 mingwu
         let insights = await db.mingwu.toArray();
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
         const allDiaries = await db.daily_reviews.filter(d => d.entry_type === 'diary').toArray();
         const filteredDiaries = exportDateRange === 'custom'
           ? allDiaries.filter(d => d.review_date >= startStr && d.review_date <= endStr)
           : allDiaries;
         const allDailyReviews = await db.daily_reviews.filter(r => r.entry_type === 'review').toArray();
         const filteredReviews = exportDateRange === 'custom'
           ? allDailyReviews.filter(r => r.review_date >= startStr && r.review_date <= endStr)
           : allDailyReviews;
         const allInsights = await db.mingwu.toArray();
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
      alert(t('settings.exportFailed'));
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
          // V2: 兼容旧导出（diary_date/无 entry_type）与新格式，统一写入 daily_reviews
          const diariesToPut = data.diaries.map((d: any) => normalizeLegacyDiary(d));
          await db.daily_reviews.bulkPut(diariesToPut);
          importedCount += diariesToPut.length;
        }

        if (data.insights && Array.isArray(data.insights)) {
          // V2: insights -> mingwu
          const insightsToPut = data.insights.map((i: any) => normalizeLegacyInsight(i));
          await db.mingwu.bulkPut(insightsToPut);
          importedCount += insightsToPut.length;
        }

        alert(t('settings.importSuccess', { count: importedCount }));
        if (fileInputRef.current) fileInputRef.current.value = '';
      } catch (err) {
        console.error(err);
        alert(t('settings.importFailed'));
      }
    };
    reader.readAsText(file);
  };

  const handleDownloadMigrationBackup = async () => {
    try {
      const backup = await db.migration_backups.get('v8');
      if (!backup) {
        alert(t('settings.noBackup'));
        return;
      }
      const blob = new Blob([backup.payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `baimiao_migration_backup_v8_${new Date(backup.created_at).toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(t('settings.downloadBackupFailed'));
    }
  };

  // #13 统一数据管理 -- 导出
  const handleUnifiedExport = async () => {
    const types = Array.from(unifiedExportTypes);
    if (types.length === 0) return;
    setIsUnifiedExporting(true);
    try {
      const opts: ExportOptions = { types, format: unifiedExportFormat };
      if (unifiedExportStartDate) {
        opts.dateStart = new Date(unifiedExportStartDate).getTime();
      }
      if (unifiedExportEndDate) {
        opts.dateEnd = new Date(unifiedExportEndDate).getTime() + 86400000 - 1;
      }
      const content = await exportData(opts);
      // 测试钩子：导出内容存 window 供 E2E 读取
      (window as any).__testExportData = content;
      const filename = getExportFilename(unifiedExportFormat);
      const mimeType = unifiedExportFormat === 'json' ? 'application/json' : 'text/markdown';
      downloadContent(content, filename, mimeType);
    } catch (e) {
      alert(t('settings.exportFailed'));
    } finally {
      setIsUnifiedExporting(false);
    }
  };

  // #13 统一数据管理 -- 导入
  const handleUnifiedFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUnifiedImportFile(file);
      setUnifiedImportResult(null);
    }
  };

  const handleUnifiedImport = async () => {
    if (!unifiedImportFile) return;
    setIsUnifiedImporting(true);
    setUnifiedImportResult(null);
    try {
      const text = await unifiedImportFile.text();
      const result = await importData(text, unifiedImportStrategy);
      setUnifiedImportResult(result);
      (window as any).__testImportResult = result;
    } catch (e: any) {
      const errResult: ImportResult = { imported: 0, skipped: 0, errors: [e?.message || t('settings.importFailed')] };
      setUnifiedImportResult(errResult);
      (window as any).__testImportResult = errResult;
    } finally {
      setIsUnifiedImporting(false);
    }
  };

  // #13 聊天记录单独导出
  const handleConvExport = async (format: 'markdown' | 'json') => {
    try {
      const content = await exportConversations(format);
      (window as any).__testExportData = content;
      const filename = getExportFilename(format, 'baimiao-conversations');
      const mimeType = format === 'json' ? 'application/json' : 'text/markdown';
      downloadContent(content, filename, mimeType);
    } catch (e) {
      alert(t('settings.exportConvFailed'));
    }
  };

  // #13 聊天记录单独导入
  const handleConvFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setConvImportFile(file);
      setConvImportResult(null);
    }
  };

  const handleConvImport = async () => {
    if (!convImportFile) return;
    setIsConvImporting(true);
    setConvImportResult(null);
    try {
      const text = await convImportFile.text();
      const result = await importConversations(text, convImportStrategy);
      setConvImportResult(result);
      (window as any).__testImportResult = result;
    } catch (e: any) {
      const errResult: ImportResult = { imported: 0, skipped: 0, errors: [e?.message || t('settings.importFailed')] };
      setConvImportResult(errResult);
      (window as any).__testImportResult = errResult;
    } finally {
      setIsConvImporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-stone-100 font-sans text-stone-900 overflow-hidden items-center justify-center">
      <div className="flex flex-col h-full overflow-hidden bg-white relative z-50 mx-auto max-w-md w-full shadow-sm ring-1 ring-black/5">
        <div className="flex h-14 items-center px-4 bg-[#faf9fc]/85 backdrop-blur border-b border-baimiao-border/40 shrink-0">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-baimiao-mysteria/70 hover:text-baimiao-mysteria hover:bg-baimiao-mysteria/5 transition-all rounded-full active:scale-90">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-[15.5px] font-bold ml-2 text-baimiao-mysteria font-serif baimiao-editorial-title">{t('settings.title')}</h2>
        </div>

        <div className="flex-1 overflow-y-auto thin-scrollbar w-full p-3 space-y-4 pb-16">

        {/* #12 Language Switcher */}
        <section className="baimiao-card-diary p-3 flex items-center justify-between" data-testid="language-section">
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold text-stone-700">{t('settings.language')}</span>
            <span className="text-[11px] text-stone-400 mt-0.5">{t('settings.languageHint')}</span>
          </div>
          <div className="flex items-center bg-stone-100/80 rounded-full p-0.5" data-testid="language-switcher">
            <button
              data-testid="language-zh"
              onClick={() => setLanguage('zh')}
              className={`px-4 py-1.5 rounded-full text-[12.5px] font-medium transition-all ${
                language === 'zh'
                  ? 'bg-white text-baimiao-mysteria shadow-sm font-bold'
                  : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              {t('settings.languageZh')}
            </button>
            <button
              data-testid="language-en"
              onClick={() => setLanguage('en')}
              className={`px-4 py-1.5 rounded-full text-[12.5px] font-medium transition-all ${
                language === 'en'
                  ? 'bg-white text-baimiao-mysteria shadow-sm font-bold'
                  : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              {t('settings.languageEn')}
            </button>
          </div>
        </section>

        {/* Navigation Tabs */}
        <div className="flex bg-[#f0edf4]/60 p-1 rounded-xl border border-baimiao-border/20 gap-0.5">
          <button
            onClick={() => setActiveTab('model')}
            className={`flex-1 flex justify-center py-2 text-[12px] font-medium rounded-lg transition-colors ${
              activeTab === 'model' ? 'bg-white shadow-md shadow-baimiao-mysteria/5 text-baimiao-mysteria font-bold' : 'text-[#8a859e] hover:text-stone-700'
            }`}
          >
            {t('settings.tabModel')}
          </button>
          <button
            onClick={() => setActiveTab('embedding')}
            className={`flex-1 flex justify-center py-2 text-[12px] font-medium rounded-lg transition-colors ${
              activeTab === 'embedding' ? 'bg-white shadow-md shadow-baimiao-mysteria/5 text-baimiao-mysteria font-bold' : 'text-[#8a859e] hover:text-stone-700'
            }`}
          >
            {t('settings.tabEmbedding')}
          </button>
          <button
            onClick={() => setActiveTab('data')}
            className={`flex-1 flex justify-center py-2 text-[12px] font-medium rounded-lg transition-colors ${
              activeTab === 'data' ? 'bg-white shadow-md shadow-baimiao-mysteria/5 text-baimiao-mysteria font-bold' : 'text-[#8a859e] hover:text-stone-700'
            }`}
          >
            {t('settings.tabData')}
          </button>
          <button
            onClick={() => setActiveTab('prompt')}
            className={`flex-1 flex justify-center py-2 text-[12px] font-medium rounded-lg transition-colors ${
              activeTab === 'prompt' ? 'bg-white shadow-md shadow-baimiao-mysteria/5 text-baimiao-mysteria font-bold' : 'text-[#8a859e] hover:text-stone-700'
            }`}
          >
            {t('settings.tabPrompt')}
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
                      { id: 'volcengine', label: t('provider.volcengine'), defaultBase: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'ep-xxx', link: 'https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint' },
                      { id: 'kimi', label: 'Kimi', defaultBase: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k', link: 'https://platform.moonshot.cn/console/api-keys' },
                      { id: 'zhipu', label: t('provider.zhipu'), defaultBase: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash', link: 'https://bigmodel.cn/usercenter/apikeys' },
                      { id: 'minimax', label: 'MiniMax', defaultBase: 'https://api.minimax.chat/v1', defaultModel: 'abab6.5s-chat', link: 'https://platform.minimaxi.com/user-center/basic-information' },
                      { id: 'mimo', label: 'MIMO', defaultBase: 'https://ai.xiaomi.com/v1', defaultModel: 'mimo-chat', link: 'https://open.xiaomi.com/' },
                      { id: 'anthropic', label: 'Anthropic', defaultBase: 'https://api.anthropic.com/v1', defaultModel: 'claude-3-5-sonnet-latest', link: 'https://console.anthropic.com/' },
                      { id: 'deepseek', label: 'DeepSeek', defaultBase: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', link: 'https://platform.deepseek.com/' },
                      { id: 'siliconflow', label: t('provider.siliconflow'), defaultBase: 'https://api.siliconflow.cn/v1', defaultModel: 'Qwen/Qwen2.5-7B-Instruct', link: 'https://cloud.siliconflow.cn/account/ak' },
                      { id: 'custom', label: t('provider.custom'), defaultBase: 'http://127.0.0.1:11434/v1', defaultModel: 'llama3', link: '' }
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
                  <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase mb-1">{t('settings.configDetails')}</h3>
                  
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
                            <a href={linkInfo} target="_blank" rel="noreferrer" className="text-[11.5px] text-[#8a859e] hover:text-baimiao-mysteria transition-colors hover:underline font-normal select-none leading-none">{t('settings.applyKey')}</a>
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
                        placeholder={t('settings.apiKeyPlaceholder')}
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
                    <p className="text-[11px] text-stone-400 leading-tight">{t('settings.apiKeySafety')}</p>
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

              {/* #6 多媒体提交开关 */}
              <section className="baimiao-card-diary p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1 pr-3">
                    <h3 className="text-[13px] font-semibold text-stone-700 mb-1">{t('settings.multimediaSummary')}</h3>
                    <p className="text-[11.5px] text-stone-400 leading-relaxed">
                      生成回顾/明悟时，是否将图片/视频附件的 AI 摘要一并提交给模型。关闭后仅提交文本内容。
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={submitMultimedia}
                      onChange={e => setSettings({ submitMultimedia: e.target.checked })}
                      data-testid="submit-multimedia-toggle"
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-stone-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-baimiao-mysteria"></div>
                  </label>
                </div>
              </section>

              {/* #10 TTS 语音朗读配置 */}
              <section className="baimiao-card-diary p-4 space-y-3" data-testid="tts-config-section">
                <div className="flex items-center gap-2 border-b border-stone-100 pb-2 mb-1">
                  <Volume2 className="w-4 h-4 text-baimiao-mysteria" />
                  <h3 className="text-[13px] font-semibold text-stone-700">{t('settings.tts')}</h3>
                </div>
                <p className="text-[11.5px] text-stone-400 leading-relaxed">
                  为回顾、明悟、洞察的 AI 产出与 AI 对话回复提供朗读功能。碎屑与沉思不支持朗读。
                </p>

                {/* 朗读服务选择 */}
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-stone-500">{t('settings.ttsService')}</label>
                  <div className="flex gap-1 p-1 bg-black/5 rounded-lg">
                    <button
                      type="button"
                      data-testid="tts-service-webspeech"
                      onClick={() => setSettings({ ttsService: 'webspeech' })}
                      className={`flex-1 flex justify-center py-1.5 text-[11.5px] font-medium rounded-md transition-all ${
                        ttsService === 'webspeech'
                          ? 'bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white shadow-sm'
                          : 'text-stone-500 hover:bg-white/50 hover:text-baimiao-mysteria'
                      }`}
                    >
                      浏览器内置 (Web Speech)
                    </button>
                    <button
                      type="button"
                      data-testid="tts-service-external"
                      onClick={() => setSettings({ ttsService: 'external' })}
                      className={`flex-1 flex justify-center py-1.5 text-[11.5px] font-medium rounded-md transition-all ${
                        ttsService === 'external'
                          ? 'bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white shadow-sm'
                          : 'text-stone-500 hover:bg-white/50 hover:text-baimiao-mysteria'
                      }`}
                    >
                      外部 TTS API
                    </button>
                  </div>
                  {ttsService === 'external' && (
                    <p className="text-[10.5px] text-stone-400 leading-relaxed mt-1">
                      外部 TTS 需后端提供 /api/tts 端点，接收 {"{ text, lang }"} 并返回音频 blob。
                    </p>
                  )}
                </div>

                {/* 默认朗读语言 */}
                <div className="space-y-1.5 pt-1.5 border-t border-stone-100">
                  <label className="text-[12px] font-medium text-stone-500">{t('settings.ttsLang')}</label>
                  <select
                    value={ttsLang}
                    onChange={e => setSettings({ ttsLang: e.target.value as 'auto' | 'zh' | 'en' })}
                    data-testid="tts-lang-select"
                    className="w-full bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-lg text-[13px] text-stone-900 cursor-pointer font-mono"
                  >
                    <option value="auto">{t('settings.ttsLangAuto')}</option>
                    <option value="zh">{t('settings.ttsLangZh')}</option>
                    <option value="en">{t('settings.ttsLangEn')}</option>
                  </select>
                </div>

                {/* 语速 */}
                <div className="space-y-1.5 pt-1.5 border-t border-stone-100">
                  <label className="text-[12px] font-medium text-stone-500 flex items-center justify-between">
                    <span>{t('settings.ttsRate')}</span>
                    <span className="font-mono text-stone-400 text-[11px]">{ttsRate.toFixed(1)}x</span>
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={ttsRate}
                    onChange={e => setSettings({ ttsRate: parseFloat(e.target.value) })}
                    data-testid="tts-rate-slider"
                    className="w-full accent-baimiao-mysteria cursor-pointer"
                  />
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
                                <a href={linkInfo} target="_blank" rel="noreferrer" className="text-[11.5px] text-[#8a859e] hover:text-baimiao-mysteria transition-colors hover:underline font-normal select-none leading-none">{t('settings.applyKey')}</a>
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
              {/* #5: Card 1: 日记回顾生成 Prompt（合并旧日记+回顾，5 槽统一） */}
              <section className="baimiao-card-diary p-4 space-y-3 overflow-hidden">
                <div className="bg-[#f8f6fa] border-b border-stone-100/80 px-4 py-2 flex flex-col gap-2 -mx-4 -mt-4">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-[13px] font-bold text-stone-700 border-l-2 border-baimiao-mysteria pl-2">
                      <Settings2 className="w-4 h-4 text-baimiao-mysteria" />
                      {t('settings.reviewPromptTitle')}
                    </label>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-0.5 items-center bg-[#f0edf4]/60 p-0.5 rounded-lg border border-stone-200/30 flex-wrap">
                      {localReviewPromptNames.map((label, idx) => (
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
                    {localReviewIndex >= 2 && (
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

                {/* 自定义槽位（2/3/4）可改名 */}
                {localReviewIndex >= 2 && (
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-stone-500 font-medium shrink-0">槽位名称</label>
                    <input
                      type="text"
                      value={localReviewPromptNames[localReviewIndex]}
                      onChange={e => {
                        const next = [...localReviewPromptNames];
                        next[localReviewIndex] = e.target.value;
                        setLocalReviewPromptNames(next);
                      }}
                      placeholder="如：知识、决策、复盘"
                      className="flex-1 bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-2.5 py-1.5 rounded-lg text-[12.5px] text-stone-900 transition-all"
                    />
                  </div>
                )}

                <textarea
                  placeholder={localReviewIndex < 2 ? '' : '请输入生成提示词...'}
                  value={localReviewPrompts[localReviewIndex] || ''}
                  readOnly={localReviewIndex < 2}
                  onChange={e => {
                    if (localReviewIndex < 2) return;
                    const next = [...localReviewPrompts];
                    next[localReviewIndex] = e.target.value;
                    setLocalReviewPrompts(next);
                  }}
                  className={`w-full h-28 resize-none border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-xl text-[13px] transition-all font-mono leading-relaxed ${
                    localReviewIndex < 2
                      ? 'bg-stone-50 text-stone-400 border-dashed border-stone-200 cursor-not-allowed'
                      : 'bg-white text-stone-900 focus:bg-white'
                  }`}
                />

                {/* #5: 自动生成选中状态 - 每个槽位可勾选 */}
                <div className="pt-2 border-t border-stone-100">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-[11px] font-semibold text-stone-500">自动生成选中</span>
                    <span className="text-[10px] text-stone-400">（至少保留一项，默认选中日记+回顾）</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {localReviewPromptNames.map((name, idx) => {
                      const isSelected = localReviewSelectedIndices.includes(idx);
                      const canToggle = !isSelected || localReviewSelectedIndices.length > 1;
                      return (
                        <label
                          key={idx}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border cursor-pointer transition-all select-none ${
                            isSelected
                              ? 'bg-baimiao-mysteria/5 border-baimiao-mysteria/20 text-baimiao-mysteria'
                              : 'bg-stone-50 border-stone-200/60 text-stone-400'
                          } ${!canToggle ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={!canToggle}
                            onChange={() => {
                              if (isSelected) {
                                if (localReviewSelectedIndices.length <= 1) return;
                                setLocalReviewSelectedIndices(localReviewSelectedIndices.filter(i => i !== idx));
                              } else {
                                setLocalReviewSelectedIndices([...localReviewSelectedIndices, idx].sort((a, b) => a - b));
                              }
                            }}
                            className="w-3.5 h-3.5 rounded border-stone-300 text-baimiao-mysteria focus:ring-baimiao-mysteria/20 accent-baimiao-mysteria cursor-pointer"
                          />
                          <span className="text-[11.5px] font-medium">{name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* Card: 明悟生成 Prompt（#8） */}
              <section className="baimiao-card-diary p-4 space-y-3 overflow-hidden">
                <div className="bg-[#f8f6fa] border-b border-stone-100/80 px-4 py-2 flex flex-col gap-2 -mx-4 -mt-4">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-[13px] font-bold text-stone-700 border-l-2 border-baimiao-mysteria pl-2">
                      <Settings2 className="w-4 h-4 text-baimiao-mysteria" />
                      {t('settings.mingwuPromptTitle')}
                    </label>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-0.5 items-center bg-[#f0edf4]/60 p-0.5 rounded-lg border border-stone-200/30">
                      {[t('settings.promptDefault'), t('settings.promptCustom1'), t('settings.promptCustom2'), t('settings.promptCustom3')].map((label, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setLocalMingwuIndex(idx)}
                          className={`px-2 py-0.5 text-[10.5px] font-medium rounded transition-all active:scale-[0.93] shrink-0 ${
                            localMingwuIndex === idx
                              ? 'bg-white text-baimiao-mysteria font-bold shadow-sm border border-stone-200/40'
                              : 'text-[#8a859e] hover:text-stone-600'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {localMingwuIndex !== 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = [...localMingwuPrompts];
                          next[localMingwuIndex] = '';
                          setLocalMingwuPrompts(next);
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
                  placeholder={localMingwuIndex === 0 ? '' : '请输入明悟生成提示词...'}
                  value={localMingwuPrompts[localMingwuIndex]}
                  readOnly={localMingwuIndex === 0}
                  onChange={e => {
                    if (localMingwuIndex === 0) return;
                    const next = [...localMingwuPrompts];
                    next[localMingwuIndex] = e.target.value;
                    setLocalMingwuPrompts(next);
                  }}
                  className={`w-full h-24 resize-none border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-3 py-2 rounded-xl text-[13px] transition-all font-mono leading-relaxed ${
                    localMingwuIndex === 0
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
                      {t('settings.insightPromptTitle')}
                    </label>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-0.5 items-center bg-[#f0edf4]/60 p-0.5 rounded-lg border border-stone-200/30">
                      {[t('settings.promptDefault'), t('settings.promptCustom1'), t('settings.promptCustom2'), t('settings.promptCustom3')].map((label, idx) => (
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
                      {t('settings.diarySummaryPromptTitle')}
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
                      {t('settings.reviewSummaryPromptTitle')}
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
                      {t('settings.insightSummaryPromptTitle')}
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

               {/* V2 迁移备份下载 */}
               <div className="pt-4 border-t border-stone-100">
                 <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase">V2 迁移备份</h3>
                 </div>
                 <p className="text-[12px] text-stone-500 mb-4 leading-relaxed">
                   升级到 V2 信息架构时，应用会自动备份旧的日记与洞察数据。可在此下载该备份文件留存。
                 </p>
                 <button
                   onClick={handleDownloadMigrationBackup}
                   className="w-full flex items-center justify-center gap-2 bg-stone-100 text-stone-800 py-3 rounded-xl text-[13px] font-medium hover:bg-stone-200 transition-colors active:scale-[0.98]"
                 >
                   <FileDown className="w-4 h-4" />
                   下载 V2 迁移备份 (JSON)
                 </button>
               </div>
              </section>

              {/* 统一数据管理 (#13) */}
              <section className="baimiao-card-diary p-4 space-y-4">
                <h3 className="text-[13px] font-semibold text-stone-400 tracking-wider uppercase flex items-center gap-1.5">
                  <FileJson className="w-4 h-4 text-stone-400" />
                  统一数据管理
                </h3>

                {/* 导出面板 */}
                <div className="space-y-3">
                  <h4 className="text-[13px] font-medium text-stone-700">导出数据</h4>

                  {/* 时间范围 */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] text-stone-500">时间范围（可留空 = 全部）</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="date"
                        data-testid="export-start-date"
                        value={unifiedExportStartDate}
                        onChange={(e) => setUnifiedExportStartDate(e.target.value)}
                        className="flex-1 min-w-0 bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-2.5 py-1.5 rounded-lg text-[12px] text-stone-900 transition-all font-mono"
                      />
                      <span className="text-stone-400 text-[12px] font-mono shrink-0">-</span>
                      <input
                        type="date"
                        data-testid="export-end-date"
                        value={unifiedExportEndDate}
                        onChange={(e) => setUnifiedExportEndDate(e.target.value)}
                        className="flex-1 min-w-0 bg-white border border-black/5 shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black px-2.5 py-1.5 rounded-lg text-[12px] text-stone-900 transition-all font-mono"
                      />
                    </div>
                  </div>

                  {/* 数据类型多选 chip */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] text-stone-500">数据类型</label>
                    <div className="flex flex-wrap gap-2">
                      {DATA_TYPE_OPTIONS.map((opt) => {
                        const selected = unifiedExportTypes.has(opt.id);
                        return (
                          <button
                            key={opt.id}
                            data-testid={`export-type-chip-${opt.id}`}
                            onClick={() => {
                              setUnifiedExportTypes((prev) => {
                                const next = new Set(prev);
                                if (next.has(opt.id)) next.delete(opt.id);
                                else next.add(opt.id);
                                return next;
                              });
                            }}
                            className={cn(
                              'px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all active:scale-[0.97]',
                              selected
                                ? 'bg-baimiao-mysteria/5 border-baimiao-mysteria/20 text-baimiao-mysteria'
                                : 'bg-stone-50 border-stone-200/60 text-stone-400 hover:text-stone-600'
                            )}
                          >
                            {t(opt.labelKey)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 格式单选 */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] text-stone-500">导出格式</label>
                    <div className="flex gap-2">
                      <button
                        data-testid="export-format-json"
                        onClick={() => setUnifiedExportFormat('json')}
                        className={cn(
                          'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-medium border transition-all active:scale-[0.98]',
                          unifiedExportFormat === 'json'
                            ? 'bg-stone-100 border-stone-200 text-stone-900 shadow-sm'
                            : 'bg-white border-stone-100/50 text-stone-500 hover:bg-stone-50'
                        )}
                      >
                        <FileJson className="w-3.5 h-3.5" />
                        JSON
                      </button>
                      <button
                        data-testid="export-format-markdown"
                        onClick={() => setUnifiedExportFormat('markdown')}
                        className={cn(
                          'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-medium border transition-all active:scale-[0.98]',
                          unifiedExportFormat === 'markdown'
                            ? 'bg-stone-100 border-stone-200 text-stone-900 shadow-sm'
                            : 'bg-white border-stone-100/50 text-stone-500 hover:bg-stone-50'
                        )}
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Markdown
                      </button>
                    </div>
                  </div>

                  <button
                    data-testid="export-btn"
                    onClick={handleUnifiedExport}
                    disabled={unifiedExportTypes.size === 0 || isUnifiedExporting}
                    className="w-full flex items-center justify-center gap-2 bg-stone-100 text-stone-800 py-2.5 rounded-xl text-[13px] font-medium hover:bg-stone-200 transition-colors disabled:opacity-30 disabled:hover:bg-stone-100 active:scale-[0.98]"
                  >
                    {isUnifiedExporting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    导出数据 ({unifiedExportFormat === 'json' ? 'JSON' : 'Markdown'})
                  </button>
                </div>

                {/* 导入面板 */}
                <div className="space-y-3 pt-4 border-t border-stone-100">
                  <h4 className="text-[13px] font-medium text-stone-700">导入数据</h4>

                  {/* 文件选择 */}
                  <div className="space-y-1.5">
                    <input
                      type="file"
                      accept=".json"
                      data-testid="import-file-input"
                      ref={unifiedImportFileRef}
                      onChange={handleUnifiedFileSelect}
                      className="hidden"
                    />
                    <button
                      onClick={() => unifiedImportFileRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 bg-white border border-stone-200 text-stone-700 py-2.5 rounded-xl text-[13px] font-medium hover:bg-stone-50 hover:border-stone-300 cursor-pointer transition-all shadow-sm active:scale-[0.98]"
                    >
                      <Upload className="w-4 h-4" />
                      {unifiedImportFile ? unifiedImportFile.name : '选择 JSON 文件'}
                    </button>
                  </div>

                  {/* 冲突策略 */}
                  <div className="space-y-1.5">
                    <label className="text-[12px] text-stone-500">冲突处理策略</label>
                    <div className="flex gap-2">
                      <button
                        data-testid="import-strategy-overwrite"
                        onClick={() => setUnifiedImportStrategy('overwrite')}
                        className={cn(
                          'flex-1 py-2 rounded-lg text-[12px] font-medium border transition-all active:scale-[0.98]',
                          unifiedImportStrategy === 'overwrite'
                            ? 'bg-stone-100 border-stone-200 text-stone-900 shadow-sm'
                            : 'bg-white border-stone-100/50 text-stone-500 hover:bg-stone-50'
                        )}
                      >
                        以导入为准
                      </button>
                      <button
                        data-testid="import-strategy-skip"
                        onClick={() => setUnifiedImportStrategy('skip')}
                        className={cn(
                          'flex-1 py-2 rounded-lg text-[12px] font-medium border transition-all active:scale-[0.98]',
                          unifiedImportStrategy === 'skip'
                            ? 'bg-stone-100 border-stone-200 text-stone-900 shadow-sm'
                            : 'bg-white border-stone-100/50 text-stone-500 hover:bg-stone-50'
                        )}
                      >
                        跳过已存在
                      </button>
                    </div>
                  </div>

                  <button
                    data-testid="import-btn"
                    onClick={handleUnifiedImport}
                    disabled={!unifiedImportFile || isUnifiedImporting}
                    className="w-full flex items-center justify-center gap-2 bg-stone-900 text-white py-2.5 rounded-xl text-[13px] font-medium hover:bg-black transition-colors disabled:opacity-30 disabled:bg-stone-300 disabled:cursor-not-allowed active:scale-[0.98]"
                  >
                    {isUnifiedImporting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    导入数据
                  </button>

                  {unifiedImportResult && (
                    <div data-testid="import-result" className="space-y-1.5 p-3 rounded-xl bg-stone-50 border border-stone-100">
                      <div className="flex justify-between text-[12px]">
                        <span className="text-emerald-600 font-medium">导入 {unifiedImportResult.imported} 条</span>
                        <span className="text-stone-500">跳过 {unifiedImportResult.skipped} 条</span>
                      </div>
                      {unifiedImportResult.errors.length > 0 && (
                        <div className="text-[11px] text-rose-500 leading-relaxed">
                          {unifiedImportResult.errors.slice(0, 5).map((err, i) => (
                            <div key={i}>{err}</div>
                          ))}
                          {unifiedImportResult.errors.length > 5 && (
                            <div>...等 {unifiedImportResult.errors.length} 条错误</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 聊天记录单独导入/导出 */}
                <div className="space-y-3 pt-4 border-t border-stone-100">
                  <h4 className="text-[13px] font-medium text-stone-700 flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-stone-400" />
                    聊天记录
                  </h4>

                  <div className="flex gap-2">
                    <button
                      data-testid="conversation-export-json"
                      onClick={() => handleConvExport('json')}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-stone-100 text-stone-800 py-2 rounded-lg text-[12px] font-medium hover:bg-stone-200 transition-colors active:scale-[0.98]"
                    >
                      <FileJson className="w-3.5 h-3.5" />
                      导出 JSON
                    </button>
                    <button
                      data-testid="conversation-export-md"
                      onClick={() => handleConvExport('markdown')}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-stone-100 text-stone-800 py-2 rounded-lg text-[12px] font-medium hover:bg-stone-200 transition-colors active:scale-[0.98]"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      导出 Markdown
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <input
                      type="file"
                      accept=".json"
                      data-testid="conversation-import-file-input"
                      ref={convImportFileRef}
                      onChange={handleConvFileSelect}
                      className="hidden"
                    />
                    <button
                      onClick={() => convImportFileRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 bg-white border border-stone-200 text-stone-700 py-2 rounded-lg text-[12px] font-medium hover:bg-stone-50 hover:border-stone-300 cursor-pointer transition-all shadow-sm active:scale-[0.98]"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      {convImportFile ? convImportFile.name : '选择聊天记录 JSON 文件'}
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <button
                      data-testid="conversation-strategy-overwrite"
                      onClick={() => setConvImportStrategy('overwrite')}
                      className={cn(
                        'flex-1 py-1.5 rounded-lg text-[11px] font-medium border transition-all',
                        convImportStrategy === 'overwrite'
                          ? 'bg-stone-100 border-stone-200 text-stone-900'
                          : 'bg-white border-stone-100/50 text-stone-500'
                      )}
                    >
                      以导入为准
                    </button>
                    <button
                      data-testid="conversation-strategy-skip"
                      onClick={() => setConvImportStrategy('skip')}
                      className={cn(
                        'flex-1 py-1.5 rounded-lg text-[11px] font-medium border transition-all',
                        convImportStrategy === 'skip'
                          ? 'bg-stone-100 border-stone-200 text-stone-900'
                          : 'bg-white border-stone-100/50 text-stone-500'
                      )}
                    >
                      跳过已存在
                    </button>
                  </div>

                  <button
                    data-testid="conversation-import-btn"
                    onClick={handleConvImport}
                    disabled={!convImportFile || isConvImporting}
                    className="w-full flex items-center justify-center gap-2 bg-stone-900 text-white py-2 rounded-lg text-[12px] font-medium hover:bg-black transition-colors disabled:opacity-30 disabled:bg-stone-300 active:scale-[0.98]"
                  >
                    {isConvImporting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" />
                    )}
                    导入聊天记录
                  </button>

                  {convImportResult && (
                    <div data-testid="conversation-import-result" className="space-y-1 p-2.5 rounded-xl bg-stone-50 border border-stone-100">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-emerald-600 font-medium">导入 {convImportResult.imported} 条</span>
                        <span className="text-stone-500">跳过 {convImportResult.skipped} 条</span>
                      </div>
                      {convImportResult.errors.length > 0 && (
                        <div className="text-[10px] text-rose-500 leading-relaxed">
                          {convImportResult.errors.slice(0, 3).map((err, i) => (
                            <div key={i}>{err}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>

        <div className="pt-8 pb-4 mt-auto">
          <button
            onClick={() => {
              setSettings({
                // #5: 保留旧 diaryPrompts 供 Copilot 兼容（只含日记槽位内容）
                diaryPrompts: [localReviewPrompts[0], '', '', ''],
                diaryPromptIndex: 0,
                diaryPrompt: localReviewPrompts[0],
                // #5: 统一 5 槽 reviewPrompts + 名称 + 选中状态
                reviewPrompts: localReviewPrompts,
                reviewPromptNames: localReviewPromptNames,
                reviewSelectedIndices: localReviewSelectedIndices,
                reviewPromptIndex: localReviewIndex,
                reviewPrompt: localReviewPrompts[localReviewIndex],
                insightPrompts: localInsightPrompts,
                insightPromptIndex: localInsightIndex,
                insightPrompt: localInsightPrompts[localInsightIndex],
                // #8 明悟生成 Prompt
                mingwuPrompts: localMingwuPrompts,
                mingwuPromptIndex: localMingwuIndex,
                mingwuPrompt: localMingwuPrompts[localMingwuIndex],
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
             {t('settings.saveAndBack')}
          </button>
        </div>

      </div>
    </div>
    </div>
  );
}

