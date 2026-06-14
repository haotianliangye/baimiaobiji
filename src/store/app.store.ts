import { create } from 'zustand';
import { db } from '../db/db';
import { generateUUID } from '../lib/utils';
import { useSettingsStore } from './settings.store';

interface AppState {
  isProcessingDiary: boolean;
  isProcessingReviewMap: Record<string, boolean>;
  diaryErrorMap: Record<string, string>;
  generateDiaryTimeline: (dateStr: string, logs: any[]) => Promise<void>;
  generateReview: (dateStr: string, logs: any[], diaryContent: string) => Promise<void>;
  clearDiaryError: (dateStr: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  isProcessingDiary: false,
  isProcessingReviewMap: {},
  diaryErrorMap: {},

  clearDiaryError: (dateStr) => {
    set((state) => {
      const newMap = { ...state.diaryErrorMap };
      delete newMap[dateStr];
      return { diaryErrorMap: newMap };
    });
  },

  generateDiaryTimeline: async (dateStr, logs) => {
    if (!logs || logs.length === 0) return;
    
    set({ isProcessingDiary: true });
    get().clearDiaryError(dateStr);
    
    const settings = useSettingsStore.getState();
    
    try {
      const response = await fetch('/api/generate-timeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: dateStr,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          logs: logs.map(l => ({ id: l.id, content: l.content, created_at: l.created_at })),
          settings
        })
      });
      
      if (!response.ok) {
         const errText = await response.text();
         let errData = { error: errText };
         try { errData = JSON.parse(errText); } catch(e){}
         throw new Error(errData.error || 'AI 服务响应异常，请重试');
      }
      
      const data = await response.json();
      
      // Store the ai_summary inside the timeline_json array for the summary display
      const timelineContent = JSON.stringify([{ summary: data.ai_summary || "暂无内容概要" }]);

      const existing = await db.daily_diaries.where('diary_date').equals(dateStr).first();
      if (existing) {
        await db.daily_diaries.update(existing.id, {
           timeline_json: timelineContent,
           raw_log_ids: logs.map(l => l.id),
           ai_editorial: data.ai_editorial,
           ai_review: data.ai_review,
           updated_at: Date.now()
        });
      } else {
        await db.daily_diaries.add({
           id: generateUUID(),
           diary_date: dateStr,
           raw_log_ids: logs.map(l => l.id),
           timeline_json: timelineContent,
           ai_editorial: data.ai_editorial,
           ai_review: data.ai_review,
           updated_at: Date.now()
        });
      }
    } catch (err: any) {
      console.error("Timeline Generation Error:", err);
      set((state) => ({
        diaryErrorMap: {
          ...state.diaryErrorMap,
          [dateStr]: err.message || "生成时间轴失败，请检查网络连接"
        }
      }));
    } finally {
      set({ isProcessingDiary: false });
    }
  },

  generateReview: async (dateStr, logs, diaryContent) => {
    if (!logs || logs.length === 0) return;
    
    set((state) => ({
      isProcessingReviewMap: { ...state.isProcessingReviewMap, [dateStr]: true }
    }));
    get().clearDiaryError(dateStr);
    
    const settings = useSettingsStore.getState();
    
    try {
      const response = await fetch('/api/generate-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: dateStr,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          logs: logs.map(l => ({ id: l.id, content: l.content, created_at: l.created_at })),
          diaryContent,
          settings
        })
      });
      
      if (!response.ok) {
         const errText = await response.text();
         let errData = { error: errText };
         try { errData = JSON.parse(errText); } catch(e){}
         throw new Error(errData.error || 'AI 服务响应异常，请重试');
      }
      
      const data = await response.json();
      
      const existing = await db.daily_diaries.where('diary_date').equals(dateStr).first();
      if (existing) {
        await db.daily_diaries.update(existing.id, {
           ai_review: data.ai_review,
           updated_at: Date.now()
        });
      } else {
        await db.daily_diaries.add({
           id: generateUUID(),
           diary_date: dateStr,
           raw_log_ids: logs.map(l => l.id),
           timeline_json: JSON.stringify([{ summary: "暂无内容概要" }]),
           ai_editorial: "",
           ai_review: data.ai_review,
           updated_at: Date.now()
        });
      }
    } catch (err: any) {
      console.error("Review Generation Error:", err);
      set((state) => ({
        diaryErrorMap: {
          ...state.diaryErrorMap,
          [dateStr]: err.message || "生成回顾失败，请检查网络连接"
        }
      }));
    } finally {
      set((state) => ({
        isProcessingReviewMap: { ...state.isProcessingReviewMap, [dateStr]: false }
      }));
    }
  }
}));
