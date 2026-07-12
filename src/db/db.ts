import dexie, { type Table } from 'dexie';

export interface RawLog {
  id: string; // uuid
  content: string;
  created_at: number; // ms timestamp
  timezone: string;
  audioBlob?: Blob;
  audioDuration?: number; // seconds
  embedding?: number[];       // vector float array for semantic search
  embedding_version?: string; // "provider:model" e.g. "gemini:gemini-embedding-2"
}

export interface TimelineBlock {
  start: string;
  end: string;
  duration_mins: number;
  category: string;
  summary: string;
}

// Legacy shape of the pre-V2 `daily_diaries` rows. Kept only to type the V3
// upgrade function that migrates very old databases; the table itself was
// removed in V8 (its data merged into `daily_reviews` with entry_type='diary').
export interface DailyDiary {
  id: string;
  diary_date: string; // YYYY-MM-DD
  raw_log_ids: string[];
  timeline_json: string; // serialized JSON array of TimelineBlock
  ai_editorial: string;
  ai_summary?: string;
  ai_review?: string;
  updated_at: number;
  prompt_index?: number;
  prompt_name?: string;
  review_prompt_index?: number;
  review_prompt_name?: string;
  chat_history?: InsightMessage[];
  embedding?: number[];
  embedding_version?: string;
}

// V2 合并后的回顾表：原 `daily_diaries`（日记）与 `daily_reviews`（回顾）统一到此。
// `entry_type` 是可靠判别器（不依赖 prompt_name，因为旧数据 prompt_name 会与 #5 的
// 5 槽命名冲突）；日记走 `ai_editorial` + `timeline_json`，回顾走 `ai_review`。
export interface DailyReview {
  id: string;
  review_date: string;        // YYYY-MM-DD - 该回顾所属日期
  raw_log_ids: string[];
  entry_type: 'diary' | 'review'; // 日记 / 回顾 判别
  ai_review: string;          // 回顾正文（entry_type='review'）
  ai_editorial?: string;      // 日记正文（entry_type='diary'）
  ai_summary: string;         // 卡片头一句话摘要
  timeline_json?: string;     // 日记时间线（entry_type='diary'）
  prompt_index?: number;      // 统一的 Prompt 槽位（原 review_prompt_index / diary prompt_index）
  prompt_name?: string;       // 统一的 Prompt 名称
  updated_at: number;
  chat_history?: InsightMessage[];
  embedding?: number[];       // vector float array for semantic search
  embedding_version?: string; // "provider:model" e.g. "gemini:gemini-embedding-2"
}

export interface InsightMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface CopilotConversation {
  id: string;
  title: string;        // auto-derived from the first user message
  messages: InsightMessage[];
  mode: 'rag' | 'chat'; // RAG 问答 vs 通用 Chat（#9）
  created_at: number;
  updated_at: number;
}

// V2「明悟」表：由原 `insights` 改名而来。`mingwu_type` 区分「明悟」与「洞察」两类
// AI 产出（双产出 UI 留给 #8，#3 仅做表重命名 + 导航重命名，保持原洞察功能可用）。
export interface Mingwu {
  id?: string;
  range_type: string;
  range_label: string;
  start_date: string;
  end_date: string;
  content: string;
  ai_summary?: string;        // one-line poetic summary (mirrors DailyReview)
  created_at: number;
  mingwu_type: 'mingwu' | 'insight'; // 明悟 / 洞察 判别
  prompt_index?: number;
  prompt_name?: string;
  chat_history?: InsightMessage[];
  embedding?: number[];       // vector float array for semantic search
  embedding_version?: string; // "provider:model" e.g. "gemini:gemini-embedding-2"
}

// V2「沉思」笔记（flomo 式慢思考）。#3 仅建表，UI/CRUD 留给 #7。
export interface Thought {
  id: string;
  content: string;            // Markdown 自由文本
  tags: string[];             // 全局共享标签（#4），#3 暂留空
  attachments?: AttachmentMeta[]; // 图片/音频/视频/链接元数据，#7 细化
  created_at: number;         // 可被用户修改的展示时间
  original_created_at: number; // 创建时的初始时间，用于溯源
  embedding?: number[];
  embedding_version?: string;
}

// 多媒体附件元数据占位（#7 会扩展为 Blob 存储 + 类型字段）。
export interface AttachmentMeta {
  kind: 'image' | 'audio' | 'video' | 'link';
  name?: string;
  ref?: string;               // IndexedDB Blob 引用或外链 URL
  summary?: string;           // AI 生成的文本摘要（用于 embedding）
}

// V2 迁移备份：启动迁移前把旧表数据快照存此，供设置页下载。
export interface MigrationBackup {
  key: string;                // 如 'v8'
  payload: string;            // JSON 快照
  created_at: number;
}

export class WhitewashDiaryDB extends dexie {
  raw_logs!: Table<RawLog>;
  daily_reviews!: Table<DailyReview>;
  mingwu!: Table<Mingwu>;
  thoughts!: Table<Thought>;
  copilot_conversations!: Table<CopilotConversation>;
  migration_backups!: Table<MigrationBackup>;

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
          entry_type: 'review',
          raw_log_ids: diary.raw_log_ids || [],
          ai_review: diary.ai_review!,
          ai_summary,
          prompt_index: diary.review_prompt_index,
          prompt_name: diary.review_prompt_name,
          updated_at: diary.updated_at,
        } as DailyReview);
      }
    });
    // Version 4: embedding fields added to interfaces (no new indexes needed)
    this.version(4).stores({});
    // Version 5: Copilot RAG conversation history (multi-conversation).
    this.version(5).stores({
      copilot_conversations: 'id, updated_at'
    });
    // Version 6: insight embedding fields (no new indexes needed).
    this.version(6).stores({});
    // Version 7: insight ai_summary field for the Diary/Review-style card.
    this.version(7).stores({});
    // Version 8: V2 信息架构重构。
    // - daily_diaries 合并进 daily_reviews（entry_type='diary'），旧表删除。
    // - insights 改名为 mingwu（加 mingwu_type），旧表删除。
    // - 新增 thoughts（沉思，#7 用）、migration_backups（迁移前快照）。
    // - daily_reviews 统一 prompt_index/prompt_name（原 review_prompt_*）+ entry_type 索引。
    this.version(8).stores({
      raw_logs: 'id, created_at',
      daily_reviews: 'id, review_date, entry_type',
      thoughts: 'id, created_at',
      mingwu: 'id, range_type, created_at',
      copilot_conversations: 'id, updated_at',
      migration_backups: 'key',
      // 显式删除旧表（Dexie 中省略不会删除，必须设 null）
      daily_diaries: null,
      insights: null
    }).upgrade(async (tx) => {
      // 防御性读取：全新安装时旧表不存在，toArray 会抛错，吞掉即可。
      const safeToArray = async (name: string) => {
        try { return await tx.table(name).toArray(); } catch { return []; }
      };

      const oldDiaries: DailyDiary[] = await safeToArray('daily_diaries');
      const oldReviews: any[] = await safeToArray('daily_reviews');
      const oldInsights: any[] = await safeToArray('insights');

      // 1. 迁移前快照备份（旧表完整数据）
      await tx.table('migration_backups').put({
        key: 'v8',
        payload: JSON.stringify({
          daily_diaries: oldDiaries,
          daily_reviews: oldReviews,
          insights: oldInsights
        }),
        created_at: Date.now()
      } as MigrationBackup);

      // 2. daily_diaries -> daily_reviews（entry_type='diary'）
      for (const d of oldDiaries) {
        const targetId = (await tx.table('daily_reviews').get(d.id)) ? `${d.id}_diary` : d.id;
        await tx.table('daily_reviews').put({
          id: targetId,
          review_date: d.diary_date,
          raw_log_ids: d.raw_log_ids || [],
          entry_type: 'diary',
          ai_review: d.ai_review || '',
          ai_editorial: d.ai_editorial,
          ai_summary: d.ai_summary || '暂无内容概要',
          timeline_json: d.timeline_json,
          prompt_index: d.prompt_index,
          prompt_name: d.prompt_name || '日记',
          updated_at: d.updated_at,
          chat_history: d.chat_history,
          embedding: d.embedding,
          embedding_version: d.embedding_version
        } as DailyReview);
      }

      // 3. 升级已存在的 daily_reviews 行：补 entry_type='review' + 统一 prompt 字段
      for (const r of oldReviews) {
        await tx.table('daily_reviews').put({
          ...r,
          entry_type: r.entry_type || 'review',
          prompt_index: r.prompt_index !== undefined ? r.prompt_index : r.review_prompt_index,
          prompt_name: r.prompt_name || r.review_prompt_name || '回顾'
        } as DailyReview);
      }

      // 4. insights -> mingwu（mingwu_type='insight'）
      for (const ins of oldInsights) {
        await tx.table('mingwu').put({
          ...ins,
          mingwu_type: ins.mingwu_type || 'insight'
        } as Mingwu);
      }
      // daily_diaries 与 insights 在 v8 stores 中显式声明为 null，Dexie 据此删除旧表
      // （注意：Dexie 中省略一个 store 不会删除它，必须显式设 null）。
    });
    // Version 9: #9 LLM Chat — copilot_conversations 加 mode 字段。
    // 旧会话（v5-v8 创建）没有 mode，统一补 'rag'；新会话由前端写入正确的 mode。
    this.version(9).stores({}).upgrade(async (tx) => {
      const convs = await tx.table('copilot_conversations').toArray();
      for (const c of convs) {
        if (!c.mode) {
          await tx.table('copilot_conversations').put({ ...c, mode: 'rag' });
        }
      }
    });
  }
}

// V2 迁移归一化：把旧版 daily_diaries / 旧 daily_reviews / 旧 insights 行映射到新 schema。
// 供 Settings 导入、云同步合并等兼容路径共用，避免迁移规则散落（一处改多处跟）。
// db v8 升级因需精心构造字段而保留显式实现，作为单一事实源。
export function normalizeLegacyDiary(d: any): DailyReview {
  const { diary_date, ...rest } = d;
  return {
    ...rest,
    review_date: rest.review_date || diary_date,
    entry_type: rest.entry_type || 'diary',
    prompt_name: rest.prompt_name || '日记',
  } as DailyReview;
}
export function normalizeLegacyReview(r: any): DailyReview {
  const { review_prompt_index, review_prompt_name, ...rest } = r;
  return {
    ...rest,
    entry_type: rest.entry_type || 'review',
    prompt_index: rest.prompt_index !== undefined ? rest.prompt_index : review_prompt_index,
    prompt_name: rest.prompt_name || review_prompt_name || '回顾',
  } as DailyReview;
}
export function normalizeLegacyInsight(i: any): Mingwu {
  return { ...i, mingwu_type: i.mingwu_type || 'insight' } as Mingwu;
}

export const db = new WhitewashDiaryDB();
