import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PieChart, Loader2, Sparkles, ChevronLeft, Calendar, AlertCircle, ChevronDown, ChevronUp, Trash2, Copy, RefreshCw, MessageCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import ContextChat from '../components/ContextChat';
import { db, Insight } from '../db/db';
import { useSettingsStore } from '../store/settings.store';
import { format, subDays } from 'date-fns';
import { useLiveQuery } from 'dexie-react-hooks';
import { generateUUID, formatDiaryMarkdown } from '../lib/utils';
import ActionSheet from '../components/ActionSheet';

const MENU_HALF_WIDTH = 140;
const MENU_SAFE_MARGIN = 296;

const InsightCard = ({ insight, onDelete, onRegenerate }: { insight: Insight, onDelete: (id: string) => void, onRegenerate: (insight: Insight) => void }) => {
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

  useEffect(() => {
    if (!expanded) {
       setShowChat(false);
    }
  }, [expanded]);

  return (
    <>
    <div 
      className="p-5 mb-4 relative overflow-hidden baimiao-card-diary" 
    >
      <div 
        className="cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
        onTouchStart={(e) => {
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
           e.preventDefault();
           if (window.navigator?.vibrate) window.navigator.vibrate(50);
           setContextMenuState({ isOpen: true, x: e.clientX, y: e.clientY });
        }}
      >
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-stone-400" />
            <span className="text-[15px] font-semibold text-stone-800">{insight.range_label}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-stone-400 font-mono">{format(new Date(insight.created_at), 'MM-dd HH:mm')}</span>
          </div>
        </div>
        
        <div 
          className={`markdown-body prose prose-stone baimiao-editorial-body prose-h1:text-[19px] prose-h2:text-[17px] prose-h3:text-[16px] prose-headings:font-medium prose-headings:font-serif baimiao-editorial-title prose-p:text-baimiao-ink prose-li:text-baimiao-ink text-[15.5px] leading-relaxed relative z-10 selection:bg-stone-200 cursor-pointer ${expanded ? '' : 'line-clamp-4 before:absolute before:bottom-0 before:left-0 before:right-0 before:h-12 before:bg-gradient-to-t before:from-white before:to-transparent'}`}
          onClick={(e) => {
            // 避免点击内部链接时触发收起
            if ((e.target as HTMLElement).tagName.toLowerCase() === 'a') return;
            setExpanded(!expanded);
          }}
        >
           <ReactMarkdown>{formatDiaryMarkdown(insight.content)}</ReactMarkdown>
        </div>
      </div>

      {expanded && (
        <div className="flex flex-col gap-3 mt-5 pt-4 border-t border-stone-100 select-none">
          <div className="flex justify-between w-full">
            <button
               onClick={(e) => {
                  e.stopPropagation();
                  if (confirm('确认删除这篇洞察吗？') && insight.id) {
                     onDelete(insight.id);
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
                  if (insight.content) {
                     navigator.clipboard.writeText(insight.content);
                     alert('洞察已复制到剪贴板');
                  }
               }}
               className="flex flex-col items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
            >
               <Copy className="w-4 h-4" />
               复制
            </button>
            <button
               onClick={(e) => { e.stopPropagation(); onRegenerate(insight); }}
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

      {expanded && showChat && (
        <ContextChat 
          chatHistory={insight.chat_history || []}
          contextContent={insight.content}
          apiEndpoint="/api/insight-chat"
          onUpdateHistory={async (newHistory) => {
            if (insight.id) {
              await db.insights.update(insight.id, { chat_history: newHistory });
            }
          }}
        />
      )}

      {!expanded && (
        <div 
          className="flex justify-center mt-2 text-stone-300 cursor-pointer"
          onClick={() => setExpanded(true)}
        >
          <ChevronDown className="w-5 h-5" />
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
                 if (insight.content) {
                    navigator.clipboard.writeText(insight.content);
                 }
                 setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-white/90 hover:text-white transition-colors hover:bg-white/10 rounded-l-lg disabled:opacity-50"
            >
              <Copy className="w-3.5 h-3.5 mb-1.5 text-white/80" />
              <span className="text-[10px] font-medium tracking-wide">复制内容</span>
            </button>
            <button
              onClick={() => {
                onRegenerate(insight);
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-white/90 hover:text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5 mb-1.5 text-white/80" />
              <span className="text-[10px] font-medium tracking-wide">重新生成</span>
            </button>
            <button
              onClick={() => {
                 if (insight.id) onDelete(insight.id);
                 setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-rose-400 hover:text-rose-300 transition-colors hover:bg-white/10 rounded-r-lg disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5 mb-1.5" />
              <span className="text-[10px] font-medium tracking-wide">删除洞察</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default function Insights() {
  const navigate = useNavigate();
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
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  const [showFloatBtn, setShowFloatBtn] = useState(false);
  const floatBtnTimeoutRef = useRef<any>(null);

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

  const settings = useSettingsStore();

  const insights = useLiveQuery(() => db.insights.orderBy('created_at').reverse().toArray());

  const handleGenerate = async () => {
    setIsGenerating(true);
    setErrorMsg("");
    
    try {
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

      // Fetch all raw logs in this range
      const logs = await db.raw_logs
        .where('created_at')
        .between(startTime, endTime, true, true)
        .toArray();

      if (logs.length === 0) {
        throw new Error("这段时间内还没有任何记录。换个时间范围或者去记录点什么吧！");
      }

      const res = await fetch('/api/generate-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeRangeLabel: rangeLabel,
          logs: logs.map(l => ({
            id: l.id,
            date: format(new Date(l.created_at), 'yyyy-MM-dd HH:mm'),
            content: l.content
          })),
          settings
        })
      });

      if (!res.ok) {
        let errStr = await res.text();
        try { const d = JSON.parse(errStr); errStr = d.error || errStr; } catch(e){}
        throw new Error(errStr);
      }

      const data = await res.json();
      const content = data.report || "";
      
      if (content) {
        await db.insights.add({
          id: generateUUID(),
          range_type: timeRange,
          range_label: rangeLabel,
          start_date: new Date(startTime).toISOString(),
          end_date: new Date(endTime).toISOString(),
          content,
          created_at: Date.now()
        });
        setTimeout(() => {
          scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        }, 100);
      }
      
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "生成失败，请重试");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerate = async (oldInsight: Insight) => {
    setIsGenerating(true);
    setErrorMsg("");
    
    try {
      const startTime = new Date(oldInsight.start_date).getTime();
      const endTime = new Date(oldInsight.end_date).getTime();
      const rangeLabel = oldInsight.range_label;

      const logs = await db.raw_logs
        .where('created_at')
        .between(startTime, endTime, true, true)
        .toArray();

      if (logs.length === 0) {
        throw new Error("此时间段内容为空，无法重新生成。");
      }

      const res = await fetch('/api/generate-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeRangeLabel: rangeLabel,
          logs: logs.map(l => ({
            id: l.id,
            date: format(new Date(l.created_at), 'yyyy-MM-dd HH:mm'),
            content: l.content
          })),
          settings
        })
      });

      if (!res.ok) {
        let errStr = await res.text();
        try { const d = JSON.parse(errStr); errStr = d.error || errStr; } catch(e){}
        throw new Error(errStr);
      }

      const data = await res.json();
      const content = data.report || "";
      
      if (content) {
        if (oldInsight.id) {
           await db.insights.delete(oldInsight.id);
        }
        await db.insights.add({
          id: generateUUID(),
          range_type: oldInsight.range_type,
          range_label: rangeLabel,
          start_date: oldInsight.start_date,
          end_date: oldInsight.end_date,
          content,
          created_at: Date.now()
        });
        setTimeout(() => {
          scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        }, 100);
      }
      
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "重新生成失败，请重试");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDelete = async (id: string) => {
    await db.insights.delete(id);
  };

  return (
    <div className="flex flex-col h-full bg-transparent relative overflow-hidden">
      <div className="flex h-[52px] items-center px-4 bg-[#faf9fc]/85 backdrop-blur border-b border-baimiao-border/40 z-20 shrink-0 w-full justify-between">
         <h2 className="text-[13.5px] font-bold tracking-wide text-baimiao-mysteria flex items-center gap-1.5 font-serif baimiao-editorial-title">
           <Sparkles className="w-4 h-4 text-baimiao-mysteria/70 stroke-[2.2px] translate-y-[-0.8px] shrink-0" />
           时光洞察
         </h2>
         <div className="relative" ref={dropdownRef}>
           <button 
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
        <div className="flex bg-white border-b border-stone-100 p-3 justify-center gap-2 items-center z-10 relative shadow-sm">
           <input 
             type="date" 
             value={customStart}
             onChange={e => setCustomStart(e.target.value)}
             className="text-[12px] p-2 rounded-lg border border-stone-200 bg-stone-50 focus:border-stone-400 focus:outline-none transition-colors" 
           />
           <span className="text-stone-400 text-[12px] font-medium">至</span>
           <input 
             type="date" 
             value={customEnd}
             onChange={e => setCustomEnd(e.target.value)}
             className="text-[12px] p-2 rounded-lg border border-stone-200 bg-stone-50 focus:border-stone-400 focus:outline-none transition-colors" 
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
        {errorMsg && (
           <div className="mb-6 px-4 py-3 bg-red-50 text-red-600 text-[13px] rounded-xl border border-red-100 flex items-center gap-2 animate-in fade-in shrink-0">
             <AlertCircle className="w-4 h-4 shrink-0" />
             {errorMsg}
           </div>
        )}

        {isGenerating && (
          <div className="flex flex-col items-center justify-center py-10 animate-in fade-in zoom-in duration-300 shrink-0">
            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-stone-100 flex items-center justify-center mb-4 relative">
               <div className="absolute inset-0 bg-stone-100/50 animate-pulse rounded-2xl"></div>
               <Loader2 className="w-8 h-8 text-stone-900 animate-spin relative z-10" />
            </div>
            <h3 className="text-[15px] text-stone-900 font-medium tracking-tight mb-1">正在深度整理...</h3>
            <p className="text-[13px] text-stone-500 font-mono">挖掘行为轨迹与生活灵感</p>
          </div>
        )}

        {insights && insights.length > 0 ? (
          <div className="flex flex-col w-full animate-in slide-in-from-bottom-4 fade-in duration-700">
            {insights.map(insight => (
              <InsightCard key={insight.id} insight={insight} onDelete={handleDelete} onRegenerate={handleRegenerate} />
            ))}
          </div>
        ) : (
          !isGenerating && (
            <div className="flex flex-col items-center justify-center text-center mt-10 flex-1">
              <div className="w-20 h-20 bg-stone-100 rounded-full flex items-center justify-center mb-6">
                <Calendar className="w-8 h-8 text-stone-400 stroke-[1.5px]" />
              </div>
              <h3 className="text-[17px] text-stone-900 font-semibold tracking-tight mb-3">开启过去的回音</h3>
              <p className="text-[14px] text-stone-500 mb-8 leading-relaxed max-w-[260px]">
                 点击下方按钮，由 AI 根据你在这个时间段内的记录，提炼出深度的行动洞察与建议。
              </p>
            </div>
          )
        )}
      </div>

      <div 
        className={`fixed bottom-24 left-0 w-full flex justify-center pointer-events-none z-20 transition-opacity duration-500 max-w-md mx-auto right-0 ${(showFloatBtn || isGenerating || (!insights || insights.length === 0)) ? 'opacity-100' : 'opacity-0'}`}
      >
        <button 
          onClick={handleGenerate}
          disabled={isGenerating}
          className={`bg-gradient-to-r from-baimiao-mysteria/95 to-[#2c2957]/95 backdrop-blur-md border border-white/10 text-white px-6 py-2.5 rounded-full text-[13px] font-medium tracking-wide transition-all shadow-lg hover:shadow-xl active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:active:scale-100 min-w-[160px] ${(showFloatBtn || isGenerating || (!insights || insights.length === 0)) ? 'pointer-events-auto' : 'pointer-events-none'}`}
        >
          {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {isGenerating ? '深度整理中...' : '生成当前洞察'}
        </button>
      </div>
    </div>
  );
}

