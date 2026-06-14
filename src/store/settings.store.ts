import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const DEFAULT_DIARY_PROMPT = `You are a thoughtful diary assistant. Your task is to take a list of raw log fragments and weave them into a single cohesive, beautifully written diary entry for the day in Chinese.

Rules:
1. Write a fluent, empathetic, and coherent diary entry in Chinese (typically 2-4 paragraphs) that summarizes the day organically, connecting all the given fragments into a meaningful narrative.
2. DO NOT output a timeline or JSON array. Output purely Markdown formatted text.
3. Start with a beautiful, poetic title (Heading 2) encapsulating the mood or main theme of the day.
4. Critically: whenever you mention an event or detail derived from a specific raw log fragment, you MUST add a markdown link pointing to its ID. Format the link exactly like this: [your text](#log_id_<ID>) where <ID> is the exact ID provided in the list above. Example: [今天早早起了床](#log_id_12345-abcde).
5. Add a brief, encouraging closing thought at the end.`;

export const DEFAULT_REVIEW_PROMPT = `You are a thoughtful reflection assistant. Your task is to review the logs and diaries over the past period and create a meaningful summary of the user's focus, emotional state, and accomplishments. Keep it encouraging and constructive.`;

export const DEFAULT_INSIGHT_PROMPT = `You are a productivity and life coach assistant. Based on the user's activity logs and diaries, provide deep insights into their routines, highlighting positive trends, areas for potential improvement, and actionable suggestions to enhance well-being and productivity.`;

export const DEFAULT_SUMMARY_PROMPT = `You are an assistant that creates a concise, one-sentence summary of a daily diary. Based on the provided diary text, generate a short, beautiful, and poetic summary in Chinese (no more than 30 characters).`;

interface SettingsState {
  provider: 'gemini' | 'openai' | 'deepseek' | 'kimi' | 'zhipu' | 'minimax' | 'mimo' | 'custom';
  apiKey: string;
  baseUrl: string;
  model: string;
  diaryPrompt: string;
  reviewPrompt: string;
  insightPrompt: string;
  summaryPrompt: string;
  setSettings: (settings: Partial<SettingsState>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      provider: 'gemini',
      apiKey: '',
      baseUrl: '',
      model: '',
      diaryPrompt: DEFAULT_DIARY_PROMPT,
      reviewPrompt: DEFAULT_REVIEW_PROMPT,
      insightPrompt: DEFAULT_INSIGHT_PROMPT,
      summaryPrompt: DEFAULT_SUMMARY_PROMPT,
      setSettings: (settings) => set(settings),
    }),
    { name: 'whitewash-settings' }
  )
);
