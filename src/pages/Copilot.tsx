import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Plus, ChevronDown, Sparkles, Trash2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';
import { db, type CopilotConversation, type InsightMessage } from '../db/db';
import { useAppStore } from '../store/app.store';
import { useSettingsStore } from '../store/settings.store';
import { generateUUID } from '../lib/utils';
import ContextChat from '../components/ContextChat';
import { retrieveCopilotContext, type CopilotRetrievalFilters, type CopilotCitation } from '../lib/copilotRetrieval';

const DATE_PRESETS = ['全部', '本周', '本月', '本季度'] as const;
const MODULE_LABELS: Record<'record' | 'diary' | 'review' | 'insight', string> = {
  record: '记录',
  diary: '日记',
  review: '回顾',
  insight: '洞察',
};

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
  const [showHistory, setShowHistory] = useState(false);
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [showPromptDropdown, setShowPromptDropdown] = useState(false);

  // Local filter state — independent of the search panel's global searchFilters.
  const [modules, setModules] = useState<Array<'record' | 'diary' | 'review' | 'insight'>>(['record', 'diary', 'review', 'insight']);
  const [dateRange, setDateRange] = useState<string>('全部');
  const [diaryPromptIndex, setDiaryPromptIndex] = useState<number | undefined>(undefined);

  // Citations accumulate across questions in the current session so older
  // citation links in the scroll history stay clickable. Reset on conversation switch.
  const citationMapRef = useRef<Map<string, CopilotCitation>>(new Map());

  const currentConv = conversations?.find(c => c.id === currentId) || null;

  const embedReady = embedEnabled && (embedProvider === 'custom' || !!embedApiKey || !!apiKey);

  const closeDropdowns = () => {
    setShowHistory(false);
    setShowDateDropdown(false);
    setShowPromptDropdown(false);
  };

  const handleNewConversation = () => {
    setCurrentId(null);
    citationMapRef.current = new Map();
    setSessionKey(k => k + 1);
    closeDropdowns();
  };

  const handleSelectConversation = (id: string) => {
    setCurrentId(id);
    citationMapRef.current = new Map();
    setSessionKey(k => k + 1);
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

  const dateLabel = dateRange === '全部' ? '全部日期' : dateRange;

  return (
    <div className="absolute inset-0 bg-[#f0eef5] flex flex-col overflow-hidden animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex h-[54px] shrink-0 items-center px-4 bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white gap-2 select-none border-b border-white/5">
        <Sparkles className="w-4 h-4 text-white/85 shrink-0" />
        <button
          onClick={() => { setShowHistory(!showHistory); setShowDateDropdown(false); setShowPromptDropdown(false); }}
          className="flex items-center gap-1 flex-1 min-w-0 hover:opacity-80 transition-opacity"
        >
          <span className="text-[14px] font-medium truncate">{currentConv?.title || '新对话'}</span>
          <ChevronDown className="w-3.5 h-3.5 text-white/70 shrink-0" />
        </button>
        <button onClick={handleNewConversation} title="新对话" className="p-1.5 hover:opacity-70 transition-opacity active:scale-95 shrink-0">
          <Plus className="w-[18px] h-[18px]" />
        </button>
        <button onClick={() => setCopilotMode(false)} title="关闭" className="p-1.5 hover:opacity-70 transition-opacity active:scale-95 shrink-0">
          <X className="w-[18px] h-[18px]" />
        </button>
      </div>

      {/* History dropdown */}
      {showHistory && (
        <>
          <div className="fixed inset-0 z-[85]" onClick={closeDropdowns} />
          <div className="absolute left-4 top-[60px] w-64 max-h-[50vh] overflow-y-auto thin-scrollbar bg-white rounded-2xl border border-stone-200/60 shadow-xl z-[90] py-1 animate-in fade-in zoom-in-95 duration-100">
            {conversations && conversations.length > 0 ? (
              conversations.map(c => (
                <div
                  key={c.id}
                  onClick={() => handleSelectConversation(c.id)}
                  className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-colors ${c.id === currentId ? 'bg-stone-100' : 'hover:bg-stone-50'}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-stone-800 truncate">{c.title || '新对话'}</div>
                    <div className="text-[10px] text-stone-400 font-mono">{format(new Date(c.updated_at), 'MM-dd HH:mm')}</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteConversation(c.id); }}
                    className="text-stone-300 hover:text-rose-500 p-1 transition-colors shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            ) : (
              <div className="px-3 py-6 text-[12px] text-stone-400 text-center select-none">暂无历史对话</div>
            )}
          </div>
        </>
      )}

      {/* Filter row */}
      {embedReady && (
        <div className="flex flex-wrap px-4 py-2 bg-white border-b border-stone-200/50 gap-2 shrink-0 relative">
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

          {/* Date range dropdown */}
          <div className="relative shrink-0">
            <button
              onClick={() => { setShowDateDropdown(!showDateDropdown); setShowPromptDropdown(false); }}
              className="flex items-center gap-1.5 bg-stone-100 hover:bg-stone-200/80 text-stone-750 px-3 py-1 rounded-xl text-[12px] font-medium border border-stone-200/40 outline-none transition-colors cursor-pointer active:scale-95"
            >
              <span>{dateLabel}</span>
              <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
            </button>
            {showDateDropdown && (
              <>
                <div className="fixed inset-0 z-[85]" onClick={closeDropdowns} />
                <div className="absolute top-full left-0 mt-1 bg-white rounded-2xl border border-stone-200/60 shadow-lg py-1 z-[90] min-w-[110px] animate-in fade-in zoom-in-95 duration-100">
                  {DATE_PRESETS.map(range => (
                    <button
                      key={range}
                      onClick={() => { setDateRange(range); setShowDateDropdown(false); }}
                      className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-stone-100 ${dateRange === range ? 'text-baimiao-mysteria font-medium' : 'text-stone-700'}`}
                    >
                      {range === '全部' ? '全部日期' : range}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Diary template filter (PRD §4.3.2) */}
          {modules.includes('diary') && (
            <div className="relative shrink-0">
              <button
                onClick={() => { setShowPromptDropdown(!showPromptDropdown); setShowDateDropdown(false); }}
                className="flex items-center gap-1.5 bg-stone-100 hover:bg-stone-200/80 text-stone-750 px-3 py-1 rounded-xl text-[12px] font-medium border border-stone-200/40 outline-none transition-colors cursor-pointer active:scale-95"
              >
                <span>{diaryPromptIndex === undefined ? '全部模板' : `模板 ${diaryPromptIndex === 0 ? '默认' : diaryPromptIndex}`}</span>
                <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
              </button>
              {showPromptDropdown && (
                <>
                  <div className="fixed inset-0 z-[85]" onClick={closeDropdowns} />
                  <div className="absolute top-full left-0 mt-1 bg-white rounded-2xl border border-stone-200/60 shadow-lg py-1 z-[90] min-w-[120px] animate-in fade-in zoom-in-95 duration-100">
                    <button
                      onClick={() => { setDiaryPromptIndex(undefined); setShowPromptDropdown(false); }}
                      className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-stone-100 ${diaryPromptIndex === undefined ? 'text-baimiao-mysteria font-medium' : 'text-stone-700'}`}
                    >
                      全部模板
                    </button>
                    {diaryPrompts.map((p: string, i: number) => p.trim() && (
                      <button
                        key={i}
                        onClick={() => { setDiaryPromptIndex(i); setShowPromptDropdown(false); }}
                        className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-stone-100 ${diaryPromptIndex === i ? 'text-baimiao-mysteria font-medium' : 'text-stone-700'}`}
                      >
                        模板 {i === 0 ? '默认' : i}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
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
    </div>
  );
}
