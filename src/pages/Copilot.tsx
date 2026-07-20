import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Plus, Sparkles, Trash2, MessageSquare, Download } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';
import { db, type CopilotConversation, type InsightMessage } from '../db/db';
import { useAppStore } from '../store/app.store';
import { useSettingsStore } from '../store/settings.store';
import { generateUUID } from '../lib/utils';
import ContextChat from '../components/ContextChat';
import RagDatePopover from '../components/RagDatePopover';
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
// #115 需求 1：模块联合类型由 'record' | 'diary' | 'review' | 'insight'
// 调整为 'record' | 'review' | 'thoughts' | 'insight'，对应显示文案
// 「识微 / 回顾 / 沉淀 / 洞察」。diary 已合并到 review（内部按 entry_type 选正文）。
const MODULE_LABEL_KEY: Record<string, string> = {
  record: 'copilot.moduleRecord',
  review: 'copilot.moduleReview',
  thoughts: 'copilot.moduleThoughts',
  insight: 'copilot.moduleInsight',
};

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
  // Issue 001: 历史页日期预设 + 自定义区间；'全部' = 不过滤日期
  const [historyDatePreset, setHistoryDatePreset] = useState<'全部' | '本周' | '本月' | '本季度' | '自定义'>('全部');
  const [historyCustomStart, setHistoryCustomStart] = useState('');
  const [historyCustomEnd, setHistoryCustomEnd] = useState('');
  // Issue 001: 历史页 RAG/CHAT 来源筛选（多选，空集 = 全部）
  const [historySources, setHistorySources] = useState<Set<'rag' | 'chat'>>(new Set());

  // Local filter state — independent of the search panel's global searchFilters.
  // #115 需求 1：模块类型由 'diary' 改 'thoughts'，默认全选新四类。
  const [modules, setModules] = useState<Array<'record' | 'review' | 'thoughts' | 'insight'>>(['record', 'review', 'thoughts', 'insight']);
  const [dateRange, setDateRange] = useState<string>('全部');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');

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
    // Issue 001: 日期下拉 open 状态已下沉到 RagDatePopover 内部；本函数保留为空以兼容现有调用点
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
    } else if (cite.type === 'review') {
      // #115 需求 2：diary 已合并到 review，原 diary citation 也走 review 路由。
      navigate(`/review?date=${cite.date}`);
    } else if (cite.type === 'thoughts') {
      // #115 需求 3：新增沉淀模块，跳转 /thoughts 页。
      navigate(`/thoughts?date=${cite.date}`);
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

  // Issue 001: 历史页日期区间（由预设计算）
  const historyRange = useMemo(() => {
    if (historyDatePreset === '全部') return null;
    if (historyDatePreset === '自定义') {
      if (!historyCustomStart || !historyCustomEnd) return null;
      return { start: historyCustomStart, end: historyCustomEnd };
    }
    const now = new Date();
    const end = format(now, 'yyyy-MM-dd');
    let start = end;
    if (historyDatePreset === '本周') {
      const day = now.getDay() || 7; // 周日=7，周一=1
      const monday = new Date(now);
      monday.setDate(now.getDate() - day + 1);
      monday.setHours(0, 0, 0, 0);
      start = format(monday, 'yyyy-MM-dd');
    } else if (historyDatePreset === '本月') {
      start = format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd');
    } else if (historyDatePreset === '本季度') {
      const quarter = Math.floor(now.getMonth() / 3);
      start = format(new Date(now.getFullYear(), quarter * 3, 1), 'yyyy-MM-dd');
    }
    return { start, end };
  }, [historyDatePreset, historyCustomStart, historyCustomEnd]);

  // Issue 001: 历史页过滤 = 来源 (RAG/CHAT 多选) ∩ 日期区间；空 = 全部
  const filteredConversations = useMemo(() => {
    if (!conversations) return [];
    let result = conversations;
    // 来源筛选（多选，空集 = 全部）
    if (historySources.size > 0) {
      result = result.filter(c => historySources.has((c.mode || 'rag') as 'rag' | 'chat'));
    }
    // 日期区间筛选（null = 全部；区间闭合含 [start, end]）
    if (historyRange) {
      const { start, end } = historyRange;
      result = result.filter(c => {
        const d = format(new Date(c.updated_at), 'yyyy-MM-dd');
        return d >= start && d <= end;
      });
    }
    return result;
  }, [conversations, historySources, historyRange]);

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
          {/* Issue 001: 历史页顶部筛选区 = RAG / CHAT / 全部日期，与上方 RAG/CHAT/历史 tab 垂直对齐 */}
          {/* 用分段控制器（segmented control）样式，与上方主导航的独立胶囊做出层级区分 */}
          <div className="px-4 py-2 bg-white border-b border-stone-200/50 shrink-0 select-none">
            <div className="flex items-center gap-1 p-1 bg-stone-100 rounded-xl">
              <button
                data-testid="history-source-rag"
                onClick={() => {
                  const next = new Set(historySources);
                  if (next.has('rag')) next.delete('rag');
                  else next.add('rag');
                  setHistorySources(next);
                }}
                className={`flex-1 text-center py-1.5 rounded-lg text-[12px] font-medium transition-all active:scale-[0.98] ${
                  historySources.has('rag')
                    ? 'bg-white text-baimiao-mysteria shadow-sm'
                    : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                RAG
              </button>
              <button
                data-testid="history-source-chat"
                onClick={() => {
                  const next = new Set(historySources);
                  if (next.has('chat')) next.delete('chat');
                  else next.add('chat');
                  setHistorySources(next);
                }}
                className={`flex-1 text-center py-1.5 rounded-lg text-[12px] font-medium transition-all active:scale-[0.98] ${
                  historySources.has('chat')
                    ? 'bg-white text-baimiao-mysteria shadow-sm'
                    : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                CHAT
              </button>
              <div className="flex-1">
                <RagDatePopover
                  dateRange={historyDatePreset}
                  customStartDate={historyCustomStart}
                  customEndDate={historyCustomEnd}
                  onDateRangeChange={(range) => {
                    setHistoryDatePreset(range as typeof historyDatePreset);
                    if (range !== '自定义') {
                      setHistoryCustomStart('');
                      setHistoryCustomEnd('');
                    }
                  }}
                  onCustomStartDateChange={setHistoryCustomStart}
                  onCustomEndDateChange={setHistoryCustomEnd}
                  displayLabel={
                    historyDatePreset === '自定义' && historyCustomStart && historyCustomEnd
                      ? (() => {
                          const fmt = (s: string) => {
                            const [_, m, d] = s.split('-');
                            return `${parseInt(m, 10)}.${parseInt(d, 10)}`;
                          };
                          return `${fmt(historyCustomStart)}~${fmt(historyCustomEnd)}`;
                        })()
                      : t(DATE_PRESET_KEY[historyDatePreset] || 'search.allDates')
                  }
                  testId="history-date-picker"
                  className="w-full"
                  buttonClassName={`w-full justify-center py-1.5 rounded-lg text-[12px] font-medium transition-all active:scale-[0.98] ${
                    historyDatePreset !== '全部'
                      ? 'bg-white text-baimiao-mysteria shadow-sm'
                      : 'text-stone-500 hover:text-stone-700'
                  }`}
                />
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 thin-scrollbar">
            {filteredConversations.length > 0 ? (
              filteredConversations.map(c => (
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
              {(['record', 'review', 'thoughts', 'insight'] as const).map(mod => {
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

              {/* Date range button — Issue 001: 复用 RagDatePopover 组件（RAG 模块同款） */}
              <RagDatePopover
                dateRange={dateRange}
                customStartDate={customStartDate}
                customEndDate={customEndDate}
                onDateRangeChange={setDateRange}
                onCustomStartDateChange={setCustomStartDate}
                onCustomEndDateChange={setCustomEndDate}
                displayLabel={dateLabel}
                testId="rag-date-picker"
              />
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

      {/* Issue 001: 日期下拉已下沉到 RagDatePopover 组件内部，根容器不再需要内联弹窗 */}
    </div>
  );
}
