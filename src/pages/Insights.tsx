import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2, Sparkles, Calendar, AlertCircle, ChevronDown, ChevronUp, Trash2, Copy, Check, RefreshCw, MessageCircle, Save, Edit2 } from 'lucide-react';
import { HeadCircuit } from '@phosphor-icons/react';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import ReactMarkdown from 'react-markdown';
import ContextChat from '../components/ContextChat';
import { db, Mingwu } from '../db/db';
import { useAppStore } from '../store/app.store';
import { useMingwuStore } from '../store/mingwu.store';
import { format, subDays } from 'date-fns';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatDiaryMarkdown } from '../lib/utils';
import { washCitations } from '../lib/citationWash';
import DatePickerPopover from '../components/DatePickerPopover';

const MENU_HALF_WIDTH = 140;
const MENU_SAFE_MARGIN = 296;


interface MingwuCardProps {
  mingwu: Mingwu;
  isEditing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onDelete: (id: string) => void;
  onRegenerate: (mingwu: Mingwu) => void;
}

const MingwuCard = ({ mingwu, isEditing, onStartEdit, onEndEdit, onDelete, onRegenerate }: MingwuCardProps) => {
  const [expanded, setExpanded] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [contextMenuState, setContextMenuState] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
  }>({
    isOpen: false,
    x: 0,
    y: 0,
  });
  const holdTimeoutRef = useRef<any>(null);
  const { copied, copy } = useCopyToClipboard();

  const [editText, setEditText] = useState(mingwu.content || '');
  const [isSaving, setIsSaving] = useState(false);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const isMingwuType = mingwu.mingwu_type === 'mingwu';
  const typeLabel = isMingwuType ? '明悟' : '洞察';

  useEffect(() => {
     setEditText(mingwu.content || '');
  }, [mingwu.content]);

  useEffect(() => {
     if (isEditing && editTextareaRef.current) {
        editTextareaRef.current.style.height = 'auto';
        editTextareaRef.current.style.height = editTextareaRef.current.scrollHeight + 'px';
     }
  }, [editText, isEditing]);

  const handleSaveEdit = async () => {
    if (!mingwu.id) return;
    setIsSaving(true);
    try {
      await db.mingwu.update(mingwu.id, { content: editText });
      onEndEdit();
    } catch (err: any) {
      alert('保存失败：' + (err?.message || '请重试'));
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!expanded) {
       setShowChat(false);
    }
  }, [expanded]);

  const summary = mingwu.ai_summary || '暂无内容概要';
  const title = mingwu.range_label;
  const headerDate = format(new Date(mingwu.created_at), 'MM-dd HH:mm');

  return (
    <>
    <div
      data-testid="mingwu-card"
      data-mingwu-type={mingwu.mingwu_type}
      className="w-full overflow-hidden baimiao-card-diary mb-4 relative"
      onTouchStart={(e) => {
         if (isEditing) return;
         const touch = e.touches[0];
         const x = touch.clientX;
         const y = touch.clientY;
         holdTimeoutRef.current = setTimeout(() => {
           if (window.navigator?.vibrate) window.navigator.vibrate(50);
           setContextMenuState({ isOpen: true, x, y });
         }, 500);
      }}
      onTouchEnd={() => clearTimeout(holdTimeoutRef.current)}
      onTouchMove={() => clearTimeout(holdTimeoutRef.current)}
      onContextMenu={(e) => {
         if (isEditing) return;
         e.preventDefault();
         if (window.navigator?.vibrate) window.navigator.vibrate(50);
         setContextMenuState({ isOpen: true, x: e.clientX, y: e.clientY });
      }}
    >
      {/* Card Header button - matches Diary/Review layout exactly */}
      <button
        type="button"
        onClick={() => { if (isEditing) return; setExpanded(!expanded); }}
        className="p-4 text-left hover:bg-stone-50 active:bg-stone-100 transition-colors flex flex-col gap-1.5 w-full relative select-none animate-in fade-in duration-200"
      >
        <div className="flex justify-between items-center w-full">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className={`w-4 h-4 shrink-0 ${isMingwuType ? 'text-baimiao-mysteria' : 'text-stone-400'}`} />
            <span className="text-[15px] font-semibold text-stone-800 truncate">{title}</span>
            <span
              data-testid={`mingwu-type-badge-${mingwu.mingwu_type}`}
              className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                isMingwuType
                  ? 'bg-baimiao-mysteria/10 text-baimiao-mysteria'
                  : 'bg-stone-100 text-stone-500'
              }`}
            >
              {typeLabel}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[12px] text-stone-400 font-mono">{headerDate}</span>
            {expanded ? <ChevronUp className="w-4 h-4 text-stone-300" /> : <ChevronDown className="w-4 h-4 text-stone-300" />}
          </div>
        </div>
        <span className="text-[13px] text-stone-500 line-clamp-2 leading-relaxed pr-6 select-none">
          {summary}
        </span>
      </button>

      {isEditing ? (
        <div className="flex flex-col gap-3 relative z-10 w-full animate-in fade-in zoom-in-95 duration-200 p-4 border-t border-black/[0.03]">
          <textarea
            ref={editTextareaRef}
            value={editText}
            onChange={e => setEditText(e.target.value)}
            className="w-full bg-white p-4 rounded-xl border border-stone-200 shadow-sm focus:outline-none focus:border-stone-300 focus:ring-2 focus:ring-stone-100 resize-none font-sans text-[15px] leading-relaxed text-stone-900 overflow-hidden min-h-[200px]"
            placeholder={`开始编辑${typeLabel}...`}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
          <div className="flex justify-end gap-2 pr-1">
            <button
              onClick={(e) => { e.stopPropagation(); onEndEdit(); }}
              className="px-4 py-2 rounded-full text-[13px] font-medium text-stone-600 bg-white border border-stone-200 hover:bg-stone-50 transition-colors shadow-sm select-none"
            >
              取消
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleSaveEdit(); }}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium text-white bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] border border-white/10 hover:brightness-110 transition-all shadow-sm select-none disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {isSaving ? '保存中' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        <>
        {/* Prompt/range meta sub-header - mirrors Diary/Review's sub-header. */}
        <div className="px-4 py-1.5 border-t border-black/[0.03] bg-stone-50/60 text-[11px] text-stone-400 font-mono flex items-center justify-between select-none">
          <span>{typeLabel} · {headerDate}</span>
          <span>{mingwu.range_type === 'custom' ? '自定义' : mingwu.range_type}</span>
        </div>
        {expanded && (
          <div
            data-testid="mingwu-card-content"
            className="px-4 pb-4 pt-3 border-t border-black/[0.03] markdown-body prose prose-stone baimiao-editorial-body prose-h1:text-[19px] prose-h2:text-[17px] prose-h3:text-[16px] prose-headings:font-medium prose-headings:font-serif baimiao-editorial-title prose-p:text-baimiao-ink prose-li:text-baimiao-ink text-[15.5px] leading-relaxed relative z-10 selection:bg-stone-200 cursor-pointer"
            onClick={(e) => {
              if (isEditing) return;
              if ((e.target as HTMLElement).tagName.toLowerCase() === 'a') return;
              setExpanded(!expanded);
            }}
          >
             <ReactMarkdown>{washCitations(formatDiaryMarkdown(mingwu.content))}</ReactMarkdown>
          </div>
        )}
        </>
      )}

      {expanded && !isEditing && (
        <div className="flex flex-col gap-3 border-t border-black/[0.03] pt-3 pb-4 px-4 select-none">
          <div className="flex justify-between w-full">
            <button
               onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`确认删除这篇${typeLabel}吗？`) && mingwu.id) {
                     onDelete(mingwu.id);
                  }
               }}
               className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-rose-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
            >
               <Trash2 className="w-4 h-4" />
               删除
            </button>
            <button
               onClick={(e) => {
                  e.stopPropagation();
                  if (mingwu.content) {
                     copy(mingwu.content);
                  }
               }}
               className={`flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                  copied
                    ? 'text-emerald-600 bg-emerald-50'
                    : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100'
               }`}
            >
               {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
               {copied ? '已复制' : '复制'}
            </button>
            <button
               onClick={(e) => {
                  e.stopPropagation();
                  setEditText(mingwu.content || '');
                  onStartEdit();
               }}
               className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
            >
               <Edit2 className="w-4 h-4" />
               编辑
            </button>
            <button
               onClick={(e) => { e.stopPropagation(); onRegenerate(mingwu); }}
               className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
            >
               <RefreshCw className="w-4 h-4" />
               重新生成
            </button>
            <button
               onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
               className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
            >
               <ChevronUp className="w-4 h-4" />
               收起
            </button>
          </div>

          <button
             onClick={(e) => { e.stopPropagation(); setShowChat(!showChat); }}
             className={`flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl text-[13px] font-medium transition-colors ${showChat ? 'bg-stone-800 text-white' : 'bg-stone-100 hover:bg-stone-200 text-stone-700'}`}
          >
             <MessageCircle className="w-4 h-4" />
             AI 追问
          </button>
        </div>
      )}

      {expanded && showChat && !isEditing && (
        <div className="border-t border-black/[0.03] p-4">
          <ContextChat
            chatHistory={mingwu.chat_history || []}
            contextContent={mingwu.content}
            apiEndpoint="/api/insight-chat"
            onUpdateHistory={async (newHistory) => {
              if (mingwu.id) {
                await db.mingwu.update(mingwu.id, { chat_history: newHistory });
              }
            }}
          />
        </div>
      )}


    </div>

    {contextMenuState.isOpen && (
        <div
          className="fixed inset-0 z-[100]"
          onClick={() => setContextMenuState({ ...contextMenuState, isOpen: false })}
          onTouchMove={(e) => { setContextMenuState({ ...contextMenuState, isOpen: false }) }}
          onWheel={(e) => { setContextMenuState({ ...contextMenuState, isOpen: false }) }}
        >
          <div
            className="absolute bg-gradient-to-r from-baimiao-mysteria/95 to-[#2c2957]/95 backdrop-blur-xl rounded-xl shadow-2xl flex items-center p-1 animate-in zoom-in-95 duration-100 divide-x divide-white/10"
            style={{
              top: contextMenuState.y > 100 ? contextMenuState.y - 75 : contextMenuState.y + 20,
              left: Math.max(16, Math.min(contextMenuState.x - MENU_HALF_WIDTH, window.innerWidth - MENU_SAFE_MARGIN)),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                 if (mingwu.content) {
                    copy(mingwu.content);
                 }
                 setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className={`flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 transition-colors rounded-l-lg disabled:opacity-50 ${
                copied
                  ? 'text-emerald-300 bg-white/10'
                  : 'text-white/90 hover:text-white hover:bg-white/10'
              }`}
            >
              {copied ? <Check className="w-3.5 h-3.5 mb-1.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5 mb-1.5 text-white/80" />}
              <span className="text-[10px] font-medium tracking-wide">{copied ? '已复制' : '复制内容'}</span>
            </button>
            <button
              onClick={() => {
                setEditText(mingwu.content || '');
                onStartEdit();
                setExpanded(true);
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-white/90 hover:text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <Edit2 className="w-3.5 h-3.5 mb-1.5 text-white/80" />
              <span className="text-[10px] font-medium tracking-wide">编辑内容</span>
            </button>
            <button
              onClick={() => {
                onRegenerate(mingwu);
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-white/90 hover:text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5 mb-1.5 text-white/80" />
              <span className="text-[10px] font-medium tracking-wide">重新生成</span>
            </button>
            <button
              onClick={() => {
                 if (mingwu.id) onDelete(mingwu.id);
                 setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-rose-400 hover:text-rose-300 transition-colors hover:bg-white/10 rounded-r-lg disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5 mb-1.5" />
              <span className="text-[10px] font-medium tracking-wide">删除{typeLabel}</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default function Insights() {
  const [timeRange, setTimeRange] = useState('week');
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const rangeOptions = [
    { value: 'day', label: '今日' },
    { value: 'week', label: '本周' },
    { value: 'month', label: '本月' },
    { value: 'quarter', label: '季度' },
    { value: 'half-year', label: '半年' },
    { value: 'year', label: '一年' },
    { value: 'custom', label: '自选范围' },
  ];

  const { isGeneratingMingwu, mingwuError } = useAppStore();
  const { generateMingwu, regenerateMingwu } = useMingwuStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [showFloatBtn, setShowFloatBtn] = useState(false);
  const floatBtnTimeoutRef = useRef<any>(null);

  // Edit state lifted to the page so the floating "生成明悟" button can
  // hide whenever any card is being edited/saved - otherwise its
  // pointer-events-auto overlay can intercept clicks on the Save/Cancel
  // buttons, making the save button look unresponsive.
  const [editingMingwuId, setEditingMingwuId] = useState<string | null>(null);

  const handleInteraction = useCallback(() => {
    setShowFloatBtn(true);
    if (floatBtnTimeoutRef.current) {
      clearTimeout(floatBtnTimeoutRef.current);
    }
    floatBtnTimeoutRef.current = setTimeout(() => {
      setShowFloatBtn(false);
    }, 5000);
  }, []);

  useEffect(() => {
    handleInteraction();
    return () => {
      if (floatBtnTimeoutRef.current) clearTimeout(floatBtnTimeoutRef.current);
    };
  }, [handleInteraction]);

  const mingwuList = useLiveQuery(() => db.mingwu.orderBy('created_at').reverse().toArray());

  const computeRange = () => {
    const today = new Date();
    let startTime = today.getTime();
    let endTime = today.getTime();
    let rangeLabel = "最近一周";

    switch (timeRange) {
      case 'day':
        startTime = subDays(today, 1).getTime();
        rangeLabel = "今天";
        break;
      case 'week':
        startTime = subDays(today, 7).getTime();
        rangeLabel = "最近一周";
        break;
      case 'month':
        startTime = subDays(today, 30).getTime();
        rangeLabel = "最近一月";
        break;
      case 'quarter':
        startTime = subDays(today, 90).getTime();
        rangeLabel = "最近一季度";
        break;
      case 'half-year':
        startTime = subDays(today, 180).getTime();
        rangeLabel = "最近半年";
        break;
      case 'year':
        startTime = subDays(today, 365).getTime();
        rangeLabel = "最近一年";
        break;
      case 'custom':
        if (!customStart || !customEnd) {
           throw new Error("请选择完整的起止时间");
        }
        startTime = new Date(customStart).getTime();
        endTime = new Date(customEnd).getTime() + 86400000;
        rangeLabel = `${customStart} 至 ${customEnd}`;
        break;
    }
    return { startTime, endTime, rangeLabel };
  };

  const handleGenerate = async () => {
    try {
      const { startTime, endTime, rangeLabel } = computeRange();
      await generateMingwu({
        rangeType: timeRange,
        startTime,
        endTime,
        rangeLabel,
      });
      setTimeout(() => {
        scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      }, 100);
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleRegenerate = async (oldMingwu: Mingwu) => {
    await regenerateMingwu(oldMingwu);
    setTimeout(() => {
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 100);
  };

  const handleDelete = async (id: string) => {
    await db.mingwu.delete(id);
  };

  return (
    <div className="flex flex-col h-full bg-transparent relative overflow-hidden">
      <div className="flex h-[52px] items-center px-4 bg-[#faf9fc]/85 backdrop-blur border-b border-baimiao-border/40 z-20 shrink-0 w-full justify-between">
         <h2 className="text-[13.5px] font-bold tracking-wide text-baimiao-mysteria flex items-center gap-1.5 font-serif baimiao-editorial-title">
           <HeadCircuit weight="regular" className="w-4 h-4 text-baimiao-mysteria/70 translate-y-[-0.8px] shrink-0" />
           明悟
         </h2>
         <div className="relative" ref={dropdownRef}>
           <button
             data-testid="mingwu-range-dropdown"
             onClick={() => setShowDropdown(!showDropdown)}
             className="flex items-center gap-1.5 bg-transparent text-[13px] font-medium text-stone-600 outline-none cursor-pointer hover:bg-stone-100 px-2 py-1 rounded transition-colors"
           >
             {rangeOptions.find(o => o.value === timeRange)?.label}
             <ChevronDown className="w-3.5 h-3.5" />
           </button>
           {showDropdown && (
             <div className="absolute right-0 top-full mt-1 w-28 bg-gradient-to-r from-baimiao-mysteria/95 to-[#2c2957]/95 backdrop-blur-xl rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.15)] flex flex-col p-1.5 animate-in fade-in zoom-in-95 duration-100 z-50">
               {rangeOptions.map((opt) => (
                 <button
                   key={opt.value}
                   data-testid={`mingwu-range-option-${opt.value}`}
                   onClick={() => {
                     setTimeRange(opt.value);
                     setShowDropdown(false);
                   }}
                   className={`px-3 py-2 text-[13px] font-medium rounded-lg text-left transition-colors ${
                     timeRange === opt.value
                       ? 'bg-white/10 text-white'
                       : 'text-white/70 hover:text-white hover:bg-white/5'
                   }`}
                 >
                   {opt.label}
                 </button>
               ))}
             </div>
           )}
         </div>
      </div>

      {timeRange === 'custom' && (
        <div className="flex bg-white border-b border-stone-100 px-3 py-2.5 justify-center gap-2 items-center z-10 relative shadow-sm overflow-visible">
          <DatePickerPopover
            value={customStart}
            onChange={setCustomStart}
            placeholder="开始日期"
            align="left"
          />
          <span className="text-stone-400 text-[12px] font-medium shrink-0">至</span>
          <DatePickerPopover
            value={customEnd}
            onChange={setCustomEnd}
            placeholder="结束日期"
            align="right"
          />
        </div>
      )}

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto thin-scrollbar px-4 py-6 pb-32 max-w-2xl mx-auto w-full flex flex-col"
        onClick={handleInteraction}
        onTouchStart={handleInteraction}
        onScroll={handleInteraction}
      >
        {mingwuError && (
          <div data-testid="mingwu-error" className="mb-6 px-4 py-3 bg-red-50 text-red-600 text-[13px] rounded-xl border border-red-100 flex items-center gap-2 animate-in fade-in shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {mingwuError}
          </div>
        )}

        {isGeneratingMingwu && (
          <div data-testid="mingwu-generating" className="flex flex-col items-center justify-center py-10 animate-in fade-in zoom-in duration-300 shrink-0">
            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-stone-100 flex items-center justify-center mb-4 relative">
               <div className="absolute inset-0 bg-stone-100/50 animate-pulse rounded-2xl"></div>
               <Loader2 className="w-8 h-8 text-stone-900 animate-spin relative z-10" />
            </div>
            <h3 className="text-[15px] text-stone-900 font-medium tracking-tight mb-1">正在明悟中...</h3>
            <p className="text-[13px] text-stone-500 font-mono">观照碎屑与沉思，浮现生命脉络</p>
          </div>
        )}

        {mingwuList && mingwuList.length > 0 ? (
          <div data-testid="mingwu-card-list" className="flex flex-col w-full animate-in slide-in-from-bottom-4 fade-in duration-700">
            {mingwuList.map(mw => (
              <MingwuCard
                key={mw.id}
                mingwu={mw}
                isEditing={editingMingwuId === mw.id}
                onStartEdit={() => setEditingMingwuId(mw.id || null)}
                onEndEdit={() => setEditingMingwuId(null)}
                onDelete={handleDelete}
                onRegenerate={handleRegenerate}
              />
            ))}
          </div>
        ) : (
          !isGeneratingMingwu && (
            <div data-testid="mingwu-empty" className="flex flex-col items-center justify-center text-center mt-10 flex-1">
              <div className="w-20 h-20 bg-stone-100 rounded-full flex items-center justify-center mb-6">
                <Calendar className="w-8 h-8 text-stone-400 stroke-[1.5px]" />
              </div>
              <h3 className="text-[17px] text-stone-900 font-semibold tracking-tight mb-3">开启明悟之旅</h3>
              <p className="text-[14px] text-stone-500 mb-8 leading-relaxed max-w-[260px]">
                 点击下方按钮，由 AI 观照你在这段时间内的碎屑与沉思，浮现明悟与洞察。
              </p>
            </div>
          )
        )}
      </div>

      {/* Floating generate button - hidden while a card is being edited
          so it can't intercept the Save/Cancel clicks below it. */}
      {!editingMingwuId && (
      <div
        className={`fixed bottom-24 left-0 w-full flex justify-center pointer-events-none z-20 transition-opacity duration-500 max-w-md mx-auto right-0 ${(showFloatBtn || isGeneratingMingwu || (!mingwuList || mingwuList.length === 0)) ? 'opacity-100' : 'opacity-0'}`}
      >
        <button
          data-testid="mingwu-generate-btn"
          onClick={handleGenerate}
          disabled={isGeneratingMingwu}
          className={`bg-gradient-to-r from-baimiao-mysteria/95 to-[#2c2957]/95 backdrop-blur-md border border-white/10 text-white px-6 py-2.5 rounded-full text-[13px] font-medium tracking-wide transition-all shadow-lg hover:shadow-xl active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:active:scale-100 min-w-[160px] ${(showFloatBtn || isGeneratingMingwu || (!mingwuList || mingwuList.length === 0)) ? 'pointer-events-auto' : 'pointer-events-none'}`}
        >
          {isGeneratingMingwu ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {isGeneratingMingwu ? '明悟中...' : '生成明悟'}
        </button>
      </div>
      )}
    </div>
  );
}
