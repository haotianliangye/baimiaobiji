import React, { useState, useRef } from 'react';
import { PieChart, Loader2, Sparkles, ChevronLeft, Calendar, AlertCircle, ChevronDown, ChevronUp, Trash2, Copy, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { db, Insight } from '../db/db';
import { useSettingsStore } from '../store/settings.store';
import { format, subDays } from 'date-fns';
import { useLiveQuery } from 'dexie-react-hooks';
import { generateUUID } from '../lib/utils';
import ActionSheet from '../components/ActionSheet';

const InsightCard = ({ insight, onDelete, onRegenerate }: { insight: Insight, onDelete: (id: string) => void, onRegenerate: (insight: Insight) => void }) => {
  const [expanded, setExpanded] = useState(false);
  const [isActionSheetOpen, setIsActionSheetOpen] = useState(false);
  const holdTimeoutRef = useRef<any>(null);

  return (
    <>
    <div 
      className="bg-white rounded-2xl p-5 shadow-sm border border-stone-200/60 mb-4 cursor-pointer transition-all hover:shadow-md relative overflow-hidden select-none" 
      onClick={() => setExpanded(!expanded)}
      onTouchStart={() => {
         holdTimeoutRef.current = setTimeout(() => {
           if (window.navigator?.vibrate) window.navigator.vibrate(50);
           setIsActionSheetOpen(true);
         }, 500);
      }}
      onTouchEnd={() => clearTimeout(holdTimeoutRef.current)}
      onTouchMove={() => clearTimeout(holdTimeoutRef.current)}
      onContextMenu={(e) => {
         e.preventDefault();
         if (window.navigator?.vibrate) window.navigator.vibrate(50);
         setIsActionSheetOpen(true);
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
      
      <div className={`markdown-body prose prose-stone prose-h1:text-[18px] prose-h2:text-[16px] prose-h3:text-[15px] prose-headings:font-bold prose-headings:text-stone-900 prose-p:text-stone-600 prose-li:text-stone-600 text-[14px] leading-relaxed relative z-10 selection:bg-stone-200 ${expanded ? '' : 'line-clamp-4 before:absolute before:bottom-0 before:left-0 before:right-0 before:h-12 before:bg-gradient-to-t before:from-white before:to-transparent'}`}>
         <ReactMarkdown>{insight.content}</ReactMarkdown>
      </div>
      <div className="flex justify-center mt-2 text-stone-300">
        {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
      </div>
    </div>
    
    <ActionSheet 
      isOpen={isActionSheetOpen}
      onClose={() => setIsActionSheetOpen(false)}
      actions={[
        {
          label: '复制内容',
          icon: <Copy className="w-4 h-4" />,
          onClick: () => {
             if (insight.content) {
                navigator.clipboard.writeText(insight.content);
             }
          }
        },
        {
          label: '重新生成',
          icon: <RefreshCw className="w-4 h-4" />,
          onClick: () => {
             onRegenerate(insight);
          }
        },
        {
          label: '删除洞察',
          icon: <Trash2 className="w-4 h-4" />,
          danger: true,
          onClick: () => {
             if (insight.id) onDelete(insight.id);
          }
        }
      ]}
    />
    </>
  );
};

export default function Insights() {
  const navigate = useNavigate();
  const [timeRange, setTimeRange] = useState('week');
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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
    <div className="flex flex-col h-full bg-stone-50/50 relative overflow-hidden">
      <div className="flex h-[52px] items-center px-4 bg-white/90 backdrop-blur border-b border-black/5 z-10 shrink-0 w-full justify-between shadow-sm shadow-black/[0.02]">
         <h2 className="text-[14px] font-semibold tracking-wide text-stone-800 flex items-center gap-2">
           <Sparkles className="w-4 h-4 text-stone-400" />
           时光洞察
         </h2>
         <select 
           value={timeRange}
           onChange={(e) => setTimeRange(e.target.value)}
           className="bg-transparent text-[13px] font-medium text-stone-600 outline-none cursor-pointer hover:bg-stone-100 px-2 py-1 rounded transition-colors"
         >
           <option value="day">今日</option>
           <option value="week">本周</option>
           <option value="month">本月</option>
           <option value="quarter">季度</option>
           <option value="half-year">半年</option>
           <option value="year">一年</option>
           <option value="custom">自选范围</option>
         </select>
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
      
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-6 pb-32 max-w-2xl mx-auto w-full flex flex-col">
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

      <div className="fixed bottom-20 left-0 p-4 bg-gradient-to-t from-stone-50 via-stone-50/90 to-transparent pointer-events-none shrink-0 z-20 flex justify-center w-full">
        <button 
          onClick={handleGenerate}
          disabled={isGenerating}
          className="bg-stone-900 hover:bg-black text-white px-8 py-3.5 rounded-full text-[14px] font-medium tracking-wide transition-all shadow-md hover:shadow-lg active:scale-95 flex items-center gap-2 pointer-events-auto disabled:opacity-50 disabled:active:scale-100"
        >
          {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {isGenerating ? '深度整理中...' : '生成当前洞察'}
        </button>
      </div>
    </div>
  );
}

