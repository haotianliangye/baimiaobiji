import dexie, { type Table } from 'dexie';

export interface RawLog {
  id: string; // uuid
  content: string;
  created_at: number; // ms timestamp
  timezone: string;
  audioBlob?: Blob;
  audioDuration?: number; // seconds
}

export interface TimelineBlock {
  start: string;
  end: string;
  duration_mins: number;
  category: string;
  summary: string;
}

export interface DailyDiary {
  id: string;
  diary_date: string; // YYYY-MM-DD
  raw_log_ids: string[];
  timeline_json: string; // serialized JSON array of TimelineBlock
  ai_editorial: string;
  ai_review?: string; // kept for legacy migration only, not written to anymore
  updated_at: number;
  prompt_index?: number;
  prompt_name?: string;
  review_prompt_index?: number;
  review_prompt_name?: string;
}

export interface DailyReview {
  id: string;
  review_date: string;    // YYYY-MM-DD — the date this review belongs to
  raw_log_ids: string[];  // the raw log IDs used to generate this review
  ai_review: string;      // the review markdown content
  ai_summary: string;     // one-sentence poetic summary for card header display
  review_prompt_index?: number;
  review_prompt_name?: string;
  updated_at: number;
}

export interface Insight {
  id?: string;
  range_type: string;
  range_label: string;
  start_date: string;
  end_date: string;
  content: string;
  created_at: number;
}

export class WhitewashDiaryDB extends dexie {
  raw_logs!: Table<RawLog>;
  daily_diaries!: Table<DailyDiary>;
  daily_reviews!: Table<DailyReview>;
  insights!: Table<Insight>;

  constructor() {
    super('whitewash_diary');
    this.version(1).stores({
      raw_logs: 'id, created_at',
      daily_diaries: 'id, diary_date',
      insights: 'id, range_type'
    });
    this.version(2).stores({
      insights: 'id, range_type, created_at'
    });
    this.version(3).stores({
      daily_reviews: 'id, review_date'
    }).upgrade(async (tx) => {
      // Migrate existing ai_review data from daily_diaries into the new daily_reviews table
      const diariesWithReview = await tx.table('daily_diaries')
        .filter((d: DailyDiary) => !!(d.ai_review && d.ai_review.trim()))
        .toArray();

      for (const diary of diariesWithReview) {
        // Derive a one-sentence summary from timeline_json if available
        let ai_summary = '暂无内容概要';
        try {
          const blocks = JSON.parse(diary.timeline_json);
          if (blocks[0]?.summary) ai_summary = blocks[0].summary;
        } catch {
          // ignore parse errors
        }

        await tx.table('daily_reviews').add({
          id: diary.id + '_migrated',
          review_date: diary.diary_date,
          raw_log_ids: diary.raw_log_ids || [],
          ai_review: diary.ai_review!,
          ai_summary,
          review_prompt_index: diary.review_prompt_index,
          review_prompt_name: diary.review_prompt_name,
          updated_at: diary.updated_at,
        } as DailyReview);
      }
    });
  }
}

export const db = new WhitewashDiaryDB();