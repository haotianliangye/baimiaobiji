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
  ai_review?: string;
  updated_at: number;
  prompt_index?: number;
  prompt_name?: string;
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
  }
}

export const db = new WhitewashDiaryDB();
