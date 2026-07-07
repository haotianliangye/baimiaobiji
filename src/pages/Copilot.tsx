import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Plus, ChevronDown, Sparkles, Trash2, Calendar as CalendarIcon } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';
import { db, type CopilotConversation, type InsightMessage } from '../db/db';
import { useAppStore } from '../store/app.store';
import { useSettingsStore } from '../store/settings.store';
import { generateUUID } from '../lib/utils';
import ContextChat from '../components/ContextChat';
import MiniCalendar from '../components/MiniCalendar';
import { retrieveCopilotContext, type CopilotRetrievalFilters, type CopilotCitation } from '../lib/copilotRetrieval';

const DATE_PRESETS = ['全部', '本周', '本月', '本季度'] as const;
const MODULE_LABELS: Record<'record' | 'diary' | 'review' | 'insight', string> = {
  record: '记录',
  diary: '日记',
  review: '回顾',
  insight: '洞察',
};
// Mirrors the diary generation menu so users can identify which prompt is
// selected without opening Settings. The index aligns with diaryPrompts[].
const DIARY_PROMPT_LABELS = ['默认', '自定义 1', '自定义 2', '自定义 3'];

export default function Copilot() {
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
  const [activeTab, setActiveTab] = useState<'chat' | 'history'>('chat');
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

  const currentConv = conversations?.find(c => c.id === currentId) || null;

  const embedReady = embedEnabled && (embedProvider === 'custom' || !!embedApiKey || !!apiKey);

  const closeDropdowns = () => {
    setShowDateDropdown(false);
    setShowPromptDropdown(false);
    setCalendarTarget('none');
  };

  const handleNewConversation = () => {
    setCurrentId(null);
    citationMapRef.current = new Map();
    setSessionKey(k => k + 1);
    setActiveTab('chat');
    closeDropdowns();
  };

  const handleSelectConversation = (id: string) => {
    setCurrentId(id);
    citationMapRef.current = new Map();
    setSessionKey(k => k + 1);
    setActiveTab('chat');
    closeDropdowns();
  };

  const handleDeleteConversation = async (id: string) => {
    await db.copilot_conversations.delete(id);
    if (currentId === id) {
      setCurrentId(null);
      citationMapRef.current = new Map();
    }
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
    if (currentId) {
      const existing = await db.copilot_conversations.get(currentId);
      const patch: Partial<CopilotConversation> = { messages: newHistory, updated_at: now };
      if (existing && (!existing.title || existing.title === '新对话')) {
        const firstUser = newHistory.find(m => m.role === 'user');
        if (firstUser) {
          patch.title = firstUser.content.slice(0, 20) + (firstUser.content.length > 20 ? '…' : '');
        }
      }
      await db.copilot_conversations.update(currentId, patch);
    } else {
      // Lazily create the conversation row on the first message.
      const newId = generateUUID();
      const firstUser = newHistory.find(m => m.role === 'user');
      const title = firstUser
        ? firstUser.content.slice(0, 20) + (firstUser.content.length > 20 ? '…' : '')
        : '新对话';
      await db.copilot_conversations.add({
        id: newId,
        title,
        messages: newHistory,
        created_at: now,
        updated_at: now,
      });
      setCurrentId(newId);
    }
  };

  // Stable label that distinguishes presets from the active custom range so the
  // filter button doesn't snap back to "全部日期" while a custom range is live.
  const dateLabel = useMemo(() => {
    if (dateRange === '自定义' && customStartDate && customEndDate) {
      return `${customStartDate.slice(5)} ~ ${customEndDate.slice(5)}`;
    }
    return dateRange === '全部' ? '全部日期' : dateRange;
  }, [dateRange, customStartDate, customEndDate]);

  const templateLabel = diaryPromptIndex === undefined
    ? '全部模板'
    : DIARY_PROMPT_LABELS[diaryPromptIndex] || `模板 ${diaryPromptIndex}`;

  return (
    <div className="absolute inset-0 bg-[#f0eef5] flex flex-col overflow-hidden animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex h-[54px] shrink-0 items-center px-4 bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white gap-2 select-none border-b border-white/5">
        <Sparkles className="w-4.5 h-4.5 text-white/90 shrink-0 translate-y-[2px]" />
        <span className="text-[14px] font-normal flex-1 font-serif baimiao-editorial-title translate-y-[2px] tracking-wide select-none">
          白描 Copilot
        </span>
        <button onClick={handleNewConversation} title="新对话" className="p-1.5 hover:opacity-70 transition-opacity active:scale-95 shrink-0">
          <Plus className="w-[18px] h-[18px]" />
        </button>
        <button onClick={() => setCopilotMode(false)} title="关闭" className="p-1.5 hover:opacity-70 transition-opacity active:scale-95 shrink-0">
          <X className="w-[18px] h-[18px]" />
        </button>
      </div>

      {/* Top Tab Toggle */}
      <div className="px-4 py-2 bg-white border-b border-stone-200/50 flex gap-2 shrink-0 select-none">
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex-1 text-center py-2 rounded-xl text-[12.5px] font-semibold tracking-wide transition-all active:scale-[0.98] ${
            activeTab === 'chat'
              ? 'bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white shadow-md shadow-baimiao-mysteria/10'
              : 'bg-stone-50 text-stone-600 hover:bg-stone-100 border border-stone-200/60'
          }`}
        >
          当前对话
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex-1 text-center py-2 rounded-xl text-[12.5px] font-semibold tracking-wide transition-all active:scale-[0.98] ${
            activeTab === 'history'
              ? 'bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white shadow-md shadow-baimiao-mysteria/10'
              : 'bg-stone-50 text-stone-600 hover:bg-stone-100 border border-stone-200/60'
          }`}
        >
          历史会话
        </button>
      </div>

      {activeTab === 'history' ? (
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
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="text-[13.5px] font-semibold text-stone-800 truncate mb-1">{c.title || '新对话'}</div>
                    <div className="text-[11px] text-stone-400 font-medium font-mono">{format(new Date(c.updated_at), 'yyyy-MM-dd HH:mm')}</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteConversation(c.id); }}
                    className="text-[#8a859e] hover:text-rose-500 p-2 transition-colors shrink-0 rounded-lg hover:bg-rose-50 active:scale-95"
                    title="删除会话"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center select-none">
                <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mb-4">
                  <Sparkles className="w-7 h-7 text-stone-300 stroke-[1.5px]" />
                </div>
                <h3 className="text-[14px] text-stone-800 font-semibold mb-1">暂无历史对话</h3>
                <p className="text-[12px] text-stone-500 mb-4 max-w-[200px]">开启一次新对话，Copilot 会根据您的提问自动生成会话记录。</p>
                <button
                  onClick={handleNewConversation}
                  className="bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white px-4 py-2 rounded-full text-[12.5px] font-medium shadow-sm hover:brightness-110 active:scale-95 transition-all"
                >
                  新建对话
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
          {embedReady && (
            <div className="flex flex-col bg-white border-b border-stone-200/50 px-4 py-2 gap-2 shrink-0 select-none">
              {/* Row 1: Module Chips */}
              <div className="flex items-center gap-2">
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
                      className={`px-3 py-1 rounded-xl text-[12px] font-medium border transition-all shrink-0 active:scale-95 ${
                        isSelected
                          ? 'bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white border-transparent shadow-sm'
                          : 'bg-[#f0edf4]/50 text-[#8a859e] border-stone-200/20 hover:bg-[#f0edf4]'
                      }`}
                    >
                      {MODULE_LABELS[mod]}
                    </button>
                  );
                })}
              </div>

              {/* Row 2: Dropdown filters */}
              <div className="flex items-center gap-2">
                {/* Date range button */}
                <div className="relative shrink-0">
                  <button
                    onClick={() => { setShowDateDropdown(!showDateDropdown); setShowPromptDropdown(false); setCalendarTarget('none'); }}
                    className="flex items-center gap-1.5 bg-stone-100 hover:bg-stone-200/80 text-stone-750 px-3 py-1 rounded-xl text-[12px] font-medium border border-stone-200/40 outline-none transition-colors cursor-pointer active:scale-95"
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
                      className="flex items-center gap-1.5 bg-stone-100 hover:bg-stone-200/80 text-stone-750 px-3 py-1 rounded-xl text-[12px] font-medium border border-stone-200/40 outline-none transition-colors cursor-pointer active:scale-95"
                    >
                      <span className="whitespace-nowrap">{templateLabel}</span>
                      <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Body */}
          <div className="flex-1 overflow-hidden flex flex-col bg-white">
            {!embedReady ? (
              <div className="flex flex-col items-center justify-center text-center mt-10 flex-1 px-6 select-none">
                <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mb-4">
                  <Sparkles className="w-7 h-7 text-stone-300 stroke-[1.5px]" />
                </div>
                <h3 className="text-[15px] text-stone-800 font-semibold mb-2">语义检索未开启</h3>
                <p className="text-[12.5px] text-stone-500 leading-relaxed mb-6 max-w-[260px]">
                  Copilot 依赖本地向量检索你的碎屑、日记与回顾。请先在设置中配置并开启向量模型。
                </p>
                <button
                  onClick={() => { setCopilotMode(false); navigate('/settings'); }}
                  className="bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white px-5 py-2 rounded-full text-[13px] font-medium shadow-sm hover:brightness-110 transition-all active:scale-95"
                >
                  前往设置
                </button>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto thin-scrollbar px-4 py-4 flex flex-col">
                <ContextChat
                  key={sessionKey}
                  chatHistory={currentConv?.messages || []}
                  apiEndpoint="/api/copilot-chat"
                  getDynamicContext={getDynamicContext}
                  onCitationClick={onCitationClick}
                  onUpdateHistory={onUpdateHistory}
                  inputPlaceholder="问 Copilot 任何关于你记录的问题…"
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
          <div className="absolute top-[192px] left-4 w-64 bg-gradient-to-r from-baimiao-mysteria/95 to-[#2c2957]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_10px_40px_rgba(27,25,56,0.15)] p-1.5 z-[90] animate-in fade-in zoom-in-95 duration-100 text-white">
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
                        ? 'bg-white/10 text-white'
                        : 'text-white/75 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {range === '全部' ? '全部日期' : range}
                  </button>
                ))}
                <div className="border-t border-white/10 my-1" />
                <div className="px-3 py-1.5 flex flex-col gap-2">
                  <span className="text-[10.5px] font-semibold text-white/40 uppercase tracking-wider">自定义时间</span>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11.5px] text-white/60 shrink-0">开始</span>
                      <button
                        onClick={() => setCalendarTarget('start')}
                        className="bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1 text-[11px] font-mono text-left w-32 outline-none hover:border-white/20 active:bg-white/10 transition-colors"
                      >
                        {customStartDate || '选择日期'}
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11.5px] text-white/60 shrink-0">结束</span>
                      <button
                        onClick={() => setCalendarTarget('end')}
                        className="bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1 text-[11px] font-mono text-left w-32 outline-none hover:border-white/20 active:bg-white/10 transition-colors"
                      >
                        {customEndDate || '选择日期'}
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (!customStartDate || !customEndDate) {
                        alert('请选择完整的开始和结束日期');
                        return;
                      }
                      if (customStartDate > customEndDate) {
                        alert('开始日期不能晚于结束日期');
                        return;
                      }
                      setDateRange('自定义');
                      setShowDateDropdown(false);
                      setCalendarTarget('none');
                    }}
                    disabled={!customStartDate || !customEndDate}
                    className="w-full mt-1.5 py-1.5 bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white border border-white/10 rounded-xl text-[11.5px] font-semibold flex items-center justify-center gap-1 active:scale-[0.98] disabled:opacity-40"
                  >
                    <CalendarIcon className="w-3 h-3" />
                    确定
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
                  title={calendarTarget === 'start' ? '选择开始日期' : '选择结束日期'}
                />
              </div>
            )}
          </div>
        </>
      )}

      {showPromptDropdown && (
        <>
          <div className="fixed inset-0 z-[85]" onClick={closeDropdowns} />
          <div className="absolute top-[192px] right-4 w-52 bg-gradient-to-r from-baimiao-mysteria/95 to-[#2c2957]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_10px_40px_rgba(27,25,56,0.15)] p-1.5 z-[90] animate-in fade-in zoom-in-95 duration-100 text-white">
            <button
              onClick={() => { setDiaryPromptIndex(undefined); setShowPromptDropdown(false); }}
              className={`w-full text-left px-3 py-1.5 text-[12px] font-medium rounded-xl transition-colors ${
                diaryPromptIndex === undefined
                  ? 'bg-white/10 text-white'
                  : 'text-white/75 hover:text-white hover:bg-white/5'
              }`}
            >
              全部模板
            </button>
            {diaryPrompts.map((p: string, i: number) => p.trim() && (
              <button
                key={i}
                onClick={() => { setDiaryPromptIndex(i); setShowPromptDropdown(false); }}
                className={`w-full text-left px-3 py-2 text-[12px] rounded-xl transition-colors ${
                  diaryPromptIndex === i
                    ? 'bg-white/10 text-white font-medium'
                    : 'text-white/75 hover:text-white hover:bg-white/5'
                }`}
              >
                <div className="font-semibold text-[12px]">{DIARY_PROMPT_LABELS[i] || `模板 ${i}`}</div>
                <div className="text-[10px] text-white/50 truncate mt-0.5">{p.trim().slice(0, 18)}…</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
