import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Plus, ChevronDown, Sparkles, Trash2, Calendar as CalendarIcon, MessageSquare, Download } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';
import { db, type CopilotConversation, type InsightMessage } from '../db/db';
import { useAppStore } from '../store/app.store';
import { useSettingsStore } from '../store/settings.store';
import { generateUUID } from '../lib/utils';
import ContextChat from '../components/ContextChat';
import MiniCalendar from '../components/MiniCalendar';
import { retrieveCopilotContext, type CopilotRetrievalFilters, type CopilotCitation } from '../lib/copilotRetrieval';
import { useTranslation } from '../lib/i18n';

const DATE_PRESETS = ['全部', '本周', '本月', '本季度'] as const;
// #12: dateRange 内部仍用中文串作标识符（过滤逻辑依赖），显示时映射到 i18n key
const DATE_PRESET_KEY: Record<string, string> = {
  '全部': 'search.allDates',
  '本周': 'search.thisWeek',
  '本月': 'search.thisMonth',
  '本季度': 'search.thisQuarter',
  '自定义': 'search.custom',
};
// #12: MODULE_LABELS 改为 key 映射，显示时用 t()
const MODULE_LABEL_KEY: Record<string, string> = {
  record: 'copilot.moduleRecord',
  diary: 'copilot.moduleDiary',
  review: 'copilot.moduleReview',
  insight: 'copilot.moduleInsight',
};
// Mirrors the diary generation menu so users can identify which prompt is
// selected without opening Settings. The index aligns with diaryPrompts[].
const DIARY_PROMPT_LABEL_KEYS = ['copilot.promptDefault', 'copilot.promptCustom1', 'copilot.promptCustom2', 'copilot.promptCustom3'];

export default function Copilot() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setCopilotMode = useAppStore(s => s.setCopilotMode);
  const { embedEnabled, embedProvider, embedApiKey, apiKey, diaryPrompts } = useSettingsStore();

  const conversations = useLiveQuery(
    () => db.copilot_conversations.orderBy('updated_at').reverse().toArray(),
    [],
    [] as CopilotConversation[]
  );

  const [currentId, setCurrentId] = useState<string | null>(null);
  // sessionKey forces ContextChat to remount on explicit user actions
  // (switching to a history entry or starting a new conversation), so the
  // chat area is cleared. Deliberately NOT incremented when the first
  // message of a new conversation creates the Dexie row mid-send, which
  // would unmount the component and drop the in-flight fetch.
  const [sessionKey, setSessionKey] = useState(0);
  // Seam 3: flattened navigation - RAG / CHAT / 历史 in a single row.
  // Replaces the old "对话/历史会话" two-level tab + RAG/Chat mode switcher.
  const [navView, setNavView] = useState<'rag' | 'chat' | 'history'>('rag');
  // #9 LLM Chat: 'rag' = RAG 问答（检索本地数据），'chat' = 通用 Chat（纯 LLM 对话）
  const [chatMode, setChatMode] = useState<'rag' | 'chat'>('rag');
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [showPromptDropdown, setShowPromptDropdown] = useState(false);

  // Local filter state — independent of the search panel's global searchFilters.
  const [modules, setModules] = useState<Array<'record' | 'diary' | 'review' | 'insight'>>(['record', 'diary', 'review', 'insight']);
  const [dateRange, setDateRange] = useState<string>('全部');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [calendarTarget, setCalendarTarget] = useState<'none' | 'start' | 'end'>('none');
  const [diaryPromptIndex, setDiaryPromptIndex] = useState<number | undefined>(undefined);

  // Citations accumulate across questions in the current session so older
  // citation links in the scroll history stay clickable. Reset on conversation switch.
  const citationMapRef = useRef<Map<string, CopilotCitation>>(new Map());

  // Mirror currentId into a ref so the `onUpdateHistory` callback always reads
  // the freshest id, even when invoked from a stale closure. Without this, the
  // second `updateAndSave` call inside ContextChat.handleSend (after the AI
  // response returns) still sees `currentId === null` from the first render
  // and would create a *second* conversation row instead of updating the one
  // that was just lazily created.
  const currentIdRef = useRef<string | null>(null);

  // Mirror chatMode into a ref so onUpdateHistory (which may run from a stale
  // closure inside ContextChat.handleSend) always reads the freshest mode.
  const chatModeRef = useRef<'rag' | 'chat'>('rag');
  useEffect(() => { chatModeRef.current = chatMode; }, [chatMode]);

  const currentConv = conversations?.find(c => c.id === currentId) || null;

  const embedReady = embedEnabled && (embedProvider === 'custom' || !!embedApiKey || !!apiKey);

  const closeDropdowns = () => {
    setShowDateDropdown(false);
    setShowPromptDropdown(false);
    setCalendarTarget('none');
  };

  const handleNewConversation = () => {
    currentIdRef.current = null;
    setCurrentId(null);
    citationMapRef.current = new Map();
    setSessionKey(k => k + 1);
    setNavView(chatMode);
    closeDropdowns();
  };

  // #9: Switching mode starts a fresh conversation (mode is per-conversation).
  const handleSwitchMode = (mode: 'rag' | 'chat') => {
    if (mode === chatMode && navView === mode) return;
    chatModeRef.current = mode;
    setChatMode(mode);
    setNavView(mode);
    currentIdRef.current = null;
    setCurrentId(null);
    citationMapRef.current = new Map();
    setSessionKey(k => k + 1);
    closeDropdowns();
  };

  // Seam 3: Switch to the history list view without altering the current mode.
  const handleSwitchToHistory = () => {
    setNavView('history');
    closeDropdowns();
  };

  const handleSelectConversation = (id: string) => {
    const conv = conversations?.find(c => c.id === id);
    const mode = conv?.mode || 'rag'; // defensive fallback for pre-v9 rows
    chatModeRef.current = mode;
    setChatMode(mode);
    currentIdRef.current = id;
    setCurrentId(id);
    citationMapRef.current = new Map();
    setSessionKey(k => k + 1);
    setNavView(mode);
    closeDropdowns();
  };

  const handleDeleteConversation = async (id: string) => {
    await db.copilot_conversations.delete(id);
    if (currentIdRef.current === id) {
      currentIdRef.current = null;
      setCurrentId(null);
      citationMapRef.current = new Map();
    }
  };

  // #9: 导出单条会话为 Markdown 文件。
  const handleExportConversation = (conv: CopilotConversation) => {
    const lines: string[] = [`# ${conv.title || t('copilot.conversationRecord')}`, ''];
    for (const msg of conv.messages) {
      const roleLabel = msg.role === 'user' ? t('copilot.userRole') : 'AI';
      const time = format(new Date(msg.timestamp), 'yyyy-MM-dd HH:mm');
      lines.push(`## ${roleLabel}（${time}）`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');
    }
    const markdown = lines.join('\n');
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (conv.title || t('copilot.conversationRecord')).replace(/[\\/:*?"<>|]/g, '_');
    a.download = `${safeName}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filters: CopilotRetrievalFilters = {
    modules,
    dateRange,
    customStartDate,
    customEndDate,
    diaryPromptIndex,
  };

  const getDynamicContext = async (userMessage: string): Promise<string> => {
    const { contextContent, citationMap } = await retrieveCopilotContext(userMessage, filters);
    citationMap.forEach((v, k) => citationMapRef.current.set(k, v));
    return contextContent;
  };

  const onCitationClick = (logId: string) => {
    const cite = citationMapRef.current.get(logId);
    setCopilotMode(false);
    if (!cite) return;
    if (cite.type === 'record') {
      navigate(`/?date=${cite.date}&logId=${logId}`);
    } else if (cite.type === 'diary') {
      navigate(`/diary?date=${cite.date}`);
    } else if (cite.type === 'review') {
      navigate(`/review?date=${cite.date}`);
    } else {
      // 洞察不需要日期维度，直接定位到大板块
      navigate('/insights');
    }
  };

  const onUpdateHistory = async (newHistory: InsightMessage[]) => {
    const now = Date.now();
    // Read from the ref (not the closure-captured state) so the second
    // updateAndSave call inside a single handleSend — which still uses the
    // first render's closure — targets the conversation row we just created
    // rather than spawning a duplicate.
    const id = currentIdRef.current;
    if (id) {
      const existing = await db.copilot_conversations.get(id);
      if (!existing) {
        // The referenced conversation was deleted elsewhere; clear the stale
        // id so the next message re-creates a new conversation cleanly.
        currentIdRef.current = null;
        setCurrentId(null);
      } else {
        const patch: Partial<CopilotConversation> = { messages: newHistory, updated_at: now };
        if (!existing.title || existing.title === '新对话' || existing.title === 'New chat') {
          const firstUser = newHistory.find(m => m.role === 'user');
          if (firstUser) {
            patch.title = firstUser.content.slice(0, 20) + (firstUser.content.length > 20 ? '…' : '');
          }
        }
        await db.copilot_conversations.update(id, patch);
        return;
      }
    }

    // Lazily create the conversation row on the first message.
    const newId = generateUUID();
    const firstUser = newHistory.find(m => m.role === 'user');
    const title = firstUser
      ? firstUser.content.slice(0, 20) + (firstUser.content.length > 20 ? '…' : '')
      : t('copilot.newConversation');
    await db.copilot_conversations.add({
      id: newId,
      title,
      messages: newHistory,
      mode: chatModeRef.current,
      created_at: now,
      updated_at: now,
    });
    // Set the ref synchronously so a second onUpdateHistory call awaiting
    // behind the same handleSend picks up the new id, even if React hasn't
    // flushed the setCurrentId re-render yet.
    currentIdRef.current = newId;
    setCurrentId(newId);
  };

  // Stable label that distinguishes presets from the active custom range so the
  // filter button doesn't snap back to "全部日期" while a custom range is live.
  const dateLabel = useMemo(() => {
    if (dateRange === '自定义' && customStartDate && customEndDate) {
      const formatShort = (s: string) => {
        const [_, m, d] = s.split('-');
        return `${parseInt(m, 10)}.${parseInt(d, 10)}`;
      };
      return `${formatShort(customStartDate)}~${formatShort(customEndDate)}`;
    }
    return t(DATE_PRESET_KEY[dateRange] || 'search.allDates');
  }, [dateRange, customStartDate, customEndDate, t]);

  const templateLabel = diaryPromptIndex === undefined
    ? t('copilot.allTemplates')
    : t(DIARY_PROMPT_LABEL_KEYS[diaryPromptIndex]) || t('copilot.templateN', { n: diaryPromptIndex });

  return (
    <div className="absolute inset-0 bg-[#f0eef5] flex flex-col overflow-hidden animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex h-[54px] shrink-0 items-center px-4 bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white gap-2 select-none border-b border-white/5">
        <MessageSquare className="w-4.5 h-4.5 text-white/90 shrink-0 translate-y-[2px]" />
        <span className="text-[14px] font-normal flex-1 font-serif baimiao-editorial-title translate-y-[2px] tracking-wide select-none">
          {t('copilot.title')}
        </span>
        <button onClick={handleNewConversation} title={t('copilot.newChat')} className="p-1.5 hover:opacity-70 transition-opacity active:scale-95 shrink-0">
          <Plus className="w-[18px] h-[18px]" />
        </button>
        <button onClick={() => setCopilotMode(false)} title={t('about.close')} className="p-1.5 hover:opacity-70 transition-opacity active:scale-95 shrink-0">
          <X className="w-[18px] h-[18px]" />
        </button>
      </div>

      {/* Top Nav: Seam 3 flattened RAG -> CHAT -> 历史 horizontal navigation */}
      <div className="px-4 py-2 bg-white border-b border-stone-200/50 flex gap-2 shrink-0 select-none">
        <button
          onClick={() => handleSwitchMode('rag')}
          className={`flex-1 text-center py-2 rounded-xl text-[12.5px] font-semibold tracking-wide transition-all active:scale-[0.98] ${
            navView === 'rag'
              ? 'bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white shadow-md shadow-baimiao-mysteria/10'
              : 'bg-stone-50 text-stone-600 hover:bg-stone-100 border border-stone-200/60'
          }`}
        >
          {t('copilot.navRag')}
        </button>
        <button
          onClick={() => handleSwitchMode('chat')}
          className={`flex-1 text-center py-2 rounded-xl text-[12.5px] font-semibold tracking-wide transition-all active:scale-[0.98] ${
            navView === 'chat'
              ? 'bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white shadow-md shadow-baimiao-mysteria/10'
              : 'bg-stone-50 text-stone-600 hover:bg-stone-100 border border-stone-200/60'
          }`}
        >
          {t('copilot.navChat')}
        </button>
        <button
          onClick={handleSwitchToHistory}
          className={`flex-1 text-center py-2 rounded-xl text-[12.5px] font-semibold tracking-wide transition-all active:scale-[0.98] ${
            navView === 'history'
              ? 'bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white shadow-md shadow-baimiao-mysteria/10'
              : 'bg-stone-50 text-stone-600 hover:bg-stone-100 border border-stone-200/60'
          }`}
        >
          {t('copilot.navHistory')}
        </button>
      </div>

      {navView === 'history' ? (
        <div className="flex-1 overflow-hidden flex flex-col bg-white">
          <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 thin-scrollbar">
            {conversations && conversations.length > 0 ? (
              conversations.map(c => (
                <div
                  key={c.id}
                  onClick={() => handleSelectConversation(c.id)}
                  className={`flex items-center justify-between p-4 cursor-pointer rounded-2xl border transition-all ${
                    c.id === currentId
                      ? 'bg-gradient-to-r from-baimiao-mysteria/10 to-[#2c2957]/10 border-baimiao-mysteria/40 shadow-sm'
                      : 'bg-white hover:bg-stone-50 border-stone-200/60 shadow-sm'
                  }`}
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="text-[13.5px] font-semibold text-stone-800 truncate">{c.title || t('copilot.newConversation')}</div>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded-md text-[9.5px] font-semibold tracking-wide ${
                        (c.mode || 'rag') === 'chat'
                          ? 'bg-emerald-50 text-emerald-600 border border-emerald-200/50'
                          : 'bg-violet-50 text-violet-600 border border-violet-200/50'
                      }`}>
                        {(c.mode || 'rag') === 'chat' ? t('copilot.chatMode') : t('copilot.ragMode')}
                      </span>
                    </div>
                    <div className="text-[11px] text-stone-400 font-medium font-mono">{format(new Date(c.updated_at), 'yyyy-MM-dd HH:mm')}</div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleExportConversation(c); }}
                      className="text-[#8a859e] hover:text-stone-700 p-2 transition-colors shrink-0 rounded-lg hover:bg-stone-100 active:scale-95"
                      title={t('copilot.exportMd')}
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteConversation(c.id); }}
                      className="text-[#8a859e] hover:text-rose-500 p-2 transition-colors shrink-0 rounded-lg hover:bg-rose-50 active:scale-95"
                      title={t('copilot.deleteSession')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center select-none">
                <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mb-4">
                  <Sparkles className="w-7 h-7 text-stone-300 stroke-[1.5px]" />
                </div>
                <h3 className="text-[14px] text-stone-800 font-semibold mb-1">{t('copilot.noHistoryTitle')}</h3>
                <p className="text-[12px] text-stone-500 mb-4 max-w-[200px]">{t('copilot.noHistoryDesc')}</p>
                <button
                  onClick={handleNewConversation}
                  className="bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white px-4 py-2 rounded-full text-[12.5px] font-medium shadow-sm hover:brightness-110 active:scale-95 transition-all"
                >
                  {t('copilot.newChat')}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Filter row — single horizontal line, scrolls instead of wrapping.
              Keeping all controls on one row prevents layout jumping when the
              diary-template chip conditionally appears. */}
          {navView === 'rag' && embedReady && (
            <div className="flex items-center px-4 py-2 bg-white border-b border-stone-200/50 shrink-0 relative justify-between select-none">
              {/* Module chips */}
              {(['record', 'diary', 'review', 'insight'] as const).map(mod => {
                const isSelected = modules.includes(mod);
                return (
                  <button
                    key={mod}
                    onClick={() => {
                      let nm = [...modules];
                      if (isSelected) {
                        if (nm.length > 1) nm = nm.filter(m => m !== mod);
                      } else {
                        nm.push(mod);
                      }
                      setModules(nm);
                    }}
                    className={`px-2.5 py-1 rounded-xl text-[12px] font-medium border transition-all shrink-0 active:scale-95 ${
                      isSelected
                        ? 'bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white border-transparent shadow-sm'
                        : 'bg-[#f0edf4]/50 text-[#8a859e] border-stone-200/20 hover:bg-[#f0edf4]'
                    }`}
                  >
                    {t(MODULE_LABEL_KEY[mod])}
                  </button>
                );
              })}

              {/* Date range button */}
              <div className="relative shrink-0">
                <button
                  onClick={() => { setShowDateDropdown(!showDateDropdown); setShowPromptDropdown(false); setCalendarTarget('none'); }}
                  className="flex items-center gap-1 bg-stone-100 hover:bg-stone-200/80 text-stone-750 px-2.5 py-1 rounded-xl text-[12px] font-medium border border-stone-200/40 outline-none transition-colors cursor-pointer active:scale-95"
                >
                  <span className="whitespace-nowrap">{dateLabel}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
                </button>
              </div>

              {/* Diary template filter button (PRD §4.3.2) */}
              {modules.includes('diary') && (
                <div className="relative shrink-0">
                  <button
                    onClick={() => { setShowPromptDropdown(!showPromptDropdown); setShowDateDropdown(false); }}
                    className="flex items-center gap-1 bg-stone-100 hover:bg-stone-200/80 text-stone-750 px-2.5 py-1 rounded-xl text-[12px] font-medium border border-stone-200/40 outline-none transition-colors cursor-pointer active:scale-95"
                  >
                    <span className="whitespace-nowrap">{templateLabel}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Body */}
          <div className="flex-1 overflow-hidden flex flex-col bg-white">
            {navView === 'rag' && !embedReady ? (
              <div className="flex flex-col items-center justify-center text-center mt-10 flex-1 px-6 select-none">
                <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mb-4">
                  <Sparkles className="w-7 h-7 text-stone-300 stroke-[1.5px]" />
                </div>
                <h3 className="text-[15px] text-stone-800 font-semibold mb-2">{t('copilot.semanticOff')}</h3>
                <p className="text-[12.5px] text-stone-500 leading-relaxed mb-6 max-w-[260px]">
                  {t('copilot.semanticOffDesc')}
                </p>
                <button
                  onClick={() => { setCopilotMode(false); navigate('/settings'); }}
                  className="bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white px-5 py-2 rounded-full text-[13px] font-medium shadow-sm hover:brightness-110 transition-all active:scale-95"
                >
                  {t('copilot.goSettings')}
                </button>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto thin-scrollbar px-4 py-4 flex flex-col">
                <ContextChat
                  key={sessionKey}
                  chatHistory={currentConv?.messages || []}
                  apiEndpoint={chatMode === 'rag' ? '/api/copilot-chat' : '/api/chat'}
                  getDynamicContext={chatMode === 'rag' ? getDynamicContext : undefined}
                  onCitationClick={chatMode === 'rag' ? onCitationClick : undefined}
                  onUpdateHistory={onUpdateHistory}
                  inputPlaceholder={chatMode === 'rag' ? t('copilot.ragPlaceholder') : t('copilot.chatPlaceholder')}
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* Dropdowns rendered outside the overflow-x-auto container, using absolute positioning relative to root container */}
      {showDateDropdown && (
        <>
          <div className="fixed inset-0 z-[85]" onClick={closeDropdowns} />
          <div className="absolute top-[142px] right-4 w-52 bg-white border border-stone-200 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] p-1.5 z-[90] animate-in fade-in zoom-in-95 duration-100 text-stone-800">
            {calendarTarget === 'none' ? (
              <>
                {DATE_PRESETS.map(range => (
                  <button
                    key={range}
                    onClick={() => {
                      setDateRange(range);
                      setCustomStartDate('');
                      setCustomEndDate('');
                      setShowDateDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-[12px] font-medium rounded-xl transition-colors ${
                      dateRange === range
                        ? 'bg-baimiao-mysteria/10 text-baimiao-mysteria'
                        : 'text-stone-600 hover:text-stone-800 hover:bg-stone-100'
                    }`}
                  >
                    {t(DATE_PRESET_KEY[range] || 'search.allDates')}
                  </button>
                ))}
                <div className="border-t border-stone-100 my-1" />
                <div className="px-3 py-1.5 flex flex-col gap-2">
                  <span className="text-[10.5px] font-semibold text-stone-400 uppercase tracking-wider">{t('search.customTime')}</span>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11.5px] text-stone-500 shrink-0">{t('search.startDate')}</span>
                      <button
                        onClick={() => setCalendarTarget('start')}
                        className="bg-stone-50 border border-stone-200 text-stone-700 rounded-lg px-2 py-1 text-[11px] font-mono text-left w-32 outline-none hover:border-baimiao-mysteria/40 active:bg-stone-100 transition-colors"
                      >
                        {customStartDate || t('copilot.selectDate')}
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11.5px] text-stone-500 shrink-0">{t('search.endDate')}</span>
                      <button
                        onClick={() => setCalendarTarget('end')}
                        className="bg-stone-50 border border-stone-200 text-stone-700 rounded-lg px-2 py-1 text-[11px] font-mono text-left w-32 outline-none hover:border-baimiao-mysteria/40 active:bg-stone-100 transition-colors"
                      >
                        {customEndDate || t('copilot.selectDate')}
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (!customStartDate || !customEndDate) {
                        alert(t('search.alertSelectDates'));
                        return;
                      }
                      if (customStartDate > customEndDate) {
                        alert(t('search.alertStartAfterEnd'));
                        return;
                      }
                      setDateRange('自定义');
                      setShowDateDropdown(false);
                      setCalendarTarget('none');
                    }}
                    disabled={!customStartDate || !customEndDate}
                    className="w-full mt-1.5 py-1.5 bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white rounded-xl text-[11.5px] font-semibold flex items-center justify-center gap-1 active:scale-[0.98] disabled:opacity-40"
                  >
                    <CalendarIcon className="w-3 h-3" />
                    {t('search.confirm')}
                  </button>
                </div>
              </>
            ) : (
              <div className="p-1">
                <MiniCalendar
                  value={calendarTarget === 'start' ? customStartDate : customEndDate}
                  onChange={(val) => {
                    if (calendarTarget === 'start') setCustomStartDate(val);
                    else setCustomEndDate(val);
                    setCalendarTarget('none');
                  }}
                  onBack={() => setCalendarTarget('none')}
                  title={calendarTarget === 'start' ? t('search.selectStart') : t('search.selectEnd')}
                />
              </div>
            )}
          </div>
        </>
      )}

      {showPromptDropdown && (
        <>
          <div className="fixed inset-0 z-[85]" onClick={closeDropdowns} />
          <div className="absolute top-[142px] right-4 w-52 bg-white border border-stone-200 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] p-1.5 z-[90] animate-in fade-in zoom-in-95 duration-100 text-stone-800">
            <button
              onClick={() => { setDiaryPromptIndex(undefined); setShowPromptDropdown(false); }}
              className={`w-full text-left px-3 py-1.5 text-[12px] font-medium rounded-xl transition-colors ${
                diaryPromptIndex === undefined
                  ? 'bg-baimiao-mysteria/10 text-baimiao-mysteria'
                  : 'text-stone-600 hover:text-stone-800 hover:bg-stone-100'
              }`}
            >
              {t('copilot.allTemplates')}
            </button>
            {diaryPrompts.map((p: string, i: number) => p.trim() && (
              <button
                key={i}
                onClick={() => { setDiaryPromptIndex(i); setShowPromptDropdown(false); }}
                className={`w-full text-left px-3 py-2 text-[12px] rounded-xl transition-colors ${
                  diaryPromptIndex === i
                    ? 'bg-baimiao-mysteria/10 text-baimiao-mysteria font-medium'
                    : 'text-stone-600 hover:text-stone-800 hover:bg-stone-100'
                }`}
              >
                <div className="font-semibold text-[12px]">{t(DIARY_PROMPT_LABEL_KEYS[i]) || t('copilot.templateN', { n: i })}</div>
                <div className="text-[10px] text-stone-400 truncate mt-0.5">{p.trim().slice(0, 18)}…</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
