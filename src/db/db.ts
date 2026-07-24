import dexie, { type Table } from 'dexie';
import {
  plainTextToDocument,
  extractAttachmentIds,
  type RichDocument,
} from '../lib/documentModel';
import { buildEditorSchema, EMPTY_RICH_DOCUMENT } from '../lib/editorSchema';

/**
 * 持久化用的文档 JSON：在 db.ts 里抽象为「任意合法 RichDocument」，
 * 不在表层展开结构（避免 Dexie update 推断触发循环映射类型）。
 * 读出时通过 `resolveDocumentContent` 转回强类型 `RichDocument`。
 */
export type RichDocumentJson = unknown;

export interface RawLog {
  id: string; // uuid
  content?: string;
  content_doc?: RichDocumentJson;
  created_at: number; // ms timestamp
  timezone: string;
  audioBlob?: Blob;
  audioDuration?: number; // seconds
  embedding?: number[];       // vector float array for semantic search
  embedding_version?: string; // "provider:model" e.g. "gemini:gemini-embedding-2"
  tags?: string[];            // #4 全局标签路径数组（如 ['工作/项目A']）
  // #6 多媒体附件
  attachments?: AttachmentMeta[];        // 附件元数据引用（原始 Blob 存 attachments store）
  attachment_summary?: string;           // 多模态模型生成的文本摘要（用于 embedding）
  attachment_embedding?: number[];       // 附件摘要向量（独立于 content 的 embedding）
  attachment_embedding_version?: string; // 附件摘要向量版本标记
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
  tags?: string[];            // #4 全局标签路径数组
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

// V2「洞察」表：存储「明悟」与「洞察」两类 AI 产出。
// `insight_type` 区分「明悟」（mingwu）与「洞察」（insight）两类卡片。
export interface Insight {
  id?: string;
  range_type: string;
  range_label: string;
  start_date: string;
  end_date: string;
  content: string;
  ai_summary?: string;        // one-line poetic summary (mirrors DailyReview)
  created_at: number;
  insight_type: 'mingwu' | 'insight'; // 明悟 / 洞察 判别
  prompt_index?: number;
  prompt_name?: string;
  chat_history?: InsightMessage[];
  embedding?: number[];       // vector float array for semantic search
  embedding_version?: string; // "provider:model" e.g. "gemini:gemini-embedding-2"
  tags?: string[];            // #4 全局标签路径数组（AI 产出自动打标签，非索引）
}

// V2「沉淀」笔记（flomo 式慢思考）。#3 仅建表，UI/CRUD 留给 #7。
export interface Thought {
  id: string;
  content?: string;           // 旧版 Markdown 自由文本，保留作兼容迁移输入
  content_doc?: RichDocumentJson;
  tags: string[];             // 全局共享标签（#4），#3 暂留空
  attachments?: AttachmentMeta[]; // 图片/音频/视频/链接元数据，#7 细化
  created_at: number;         // 可被用户修改的展示时间
  original_created_at: number; // 创建时的初始时间，用于溯源
  embedding?: number[];
  embedding_version?: string;
}

// 多媒体附件元数据。image/audio/video/file 的 ref 指向 attachments store 的 id；
// link 的 ref 直接存外链 URL。原始 Blob 不压缩存 attachments store。
export interface AttachmentMeta {
  kind: 'image' | 'audio' | 'video' | 'link' | 'file';
  name?: string;
  ref?: string;               // IndexedDB attachments store id 或外链 URL
  summary?: string;           // AI 生成的文本摘要（用于 embedding）
}

// #6 多媒体附件原始文件存储。Blob 不压缩，以独立 store 存放，供未来多模态 embedding 复用。
export interface AttachmentBlob {
  id: string;                 // uuid，与 AttachmentMeta.ref 对应
  blob: Blob;                 // 原始文件
  type: 'image' | 'audio' | 'video' | 'file';
  created_at: number;
}

// #14 统一分块与向量化 pipeline 的分块存储。每条记录是某条源记录的一个文本分块及其向量。
// source_type + source_id + field 唯一定位一组分块，便于按源记录删除/重建。
// 既有 inline embedding 字段（raw_logs.embedding 等）继续保留并向后兼容，
// chunks 表是「全文按原文分块」的补充存储，供未来更精细的分块级语义检索。
export interface TextChunk {
  id: string;                 // `${source_type}:${source_id}:${field}:${chunk_index}`，确定性主键
  source_type: string;        // 源表名：'raw_logs' | 'daily_reviews' | 'thoughts' | 'insights'
  source_id: string;          // 源记录 id
  field: string;              // 被分块的文本字段：'content' | 'ai_review' | 'ai_editorial' | 'attachment_summary'
  chunk_index: number;        // 分块序号（0-based）
  text: string;               // 分块文本（已清洗）
  embedding: number[];        // 分块向量
  embedding_version: string;  // "provider:model"
  created_at: number;         // 取自源记录的时间戳
  tags: string[];             // 取自源记录的标签
}

// Issue P1-004 (ADR-0004): 长期记忆 facts 表。
// 关于"用户事实"的结构化记录：生日、偏好、习惯、背景事实。
// P0 阶段只 manual 录入；P2 候选：AI 自动抽取（基于 #005 引用回溯）。
// 注：category 是字面量联合（'user' | 'preference' | 'event' | 'context'），
//     与 src/lib/factsStore.ts 的 FactCategory 一致。
export interface Fact {
  id: string;                 // uuid，主键
  key: string;                // 业务唯一键，e.g. 'user.birthday', 'preference.theme'
  value: string;              // 事实值（自由文本，结构化由调用方决定）
  category: 'user' | 'preference' | 'event' | 'context';
  confidence: number;         // 0-1，P0 阶段 manual 录入都 1.0
  source: 'manual' | 'extracted';  // P0 阶段只 'manual'
  created_at: number;
  updated_at: number;
}

// V2 迁移备份：启动迁移前把旧表数据快照存此，供设置页下载。
export interface MigrationBackup {
  key: string;                // 如 'v8'
  payload: string;            // JSON 快照
  created_at: number;
}

/**
 * Issue #004: 通用 KV 表，存配置型数据（当前只用于转写幻觉 patterns，
 * 但保留一般化以支持未来 settings 迁出）。
 * value 字段是任意 JSON-serializable 对象。
 */
export interface SettingsKVRecord {
  key: string;                // 主键，如 'transcription.hallucinationPatterns'
  value: unknown;             // 任意可序列化对象
  updated_at: number;
}

// #4 全局标签定义。path 为完整路径（如 '工作/项目A'），name 为末级名。
export interface TagDef {
  path: string;               // 完整路径，主键
  name: string;               // 末级名（如 '项目A'）
  created_at: number;
  pinned?: boolean;           // 是否置顶
  sort_order?: number;        // 排序权重：置顶标签数值更小，排在同层级前面
  icon?: string;              // 标签图标（可选，如 emoji 或 lucide 图标名）
}

// #4 标签别名：被合并的旧路径 -> 合并目标路径。
export interface TagAlias {
  alias: string;              // 被合并的旧路径，主键
  target: string;             // 合并目标路径
}

// Issue #008: 本地自动备份记录
export interface BackupRecord {
  id: string;                 // uuid
  created_at: number;         // ms timestamp
  type: 'auto' | 'manual';
  payload: string;            // JSON 字符串（snapshot 序列化）
  size_bytes: number;
  source_version: string;     // package.json version
  db_version: number;         // db.verno
}

export class WhitewashDiaryDB extends dexie {
  raw_logs!: Table<RawLog>;
  daily_reviews!: Table<DailyReview>;
  insights!: Table<Insight>;
  thoughts!: Table<Thought>;
  copilot_conversations!: Table<CopilotConversation>;
  migration_backups!: Table<MigrationBackup>;
  tags!: Table<TagDef>;
  tag_aliases!: Table<TagAlias>;
  attachments!: Table<AttachmentBlob>;
  chunks!: Table<TextChunk>;
  settings_kv!: Table<SettingsKVRecord>;
  backups!: Table<BackupRecord>;
  facts!: Table<Fact>;

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
    // - 新增 thoughts（沉淀，#7 用）、migration_backups（迁移前快照）。
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
        } as any);
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
    // Version 10: #4 全局标签系统。
    // - 新增 tags 表（主键 path）、tag_aliases 表（主键 alias）。
    // - raw_logs / daily_reviews 加 *tags 多值索引（支持按标签搜索）。
    // - upgrade：遍历旧 raw_logs / daily_reviews 补 tags: []。
    this.version(10).stores({
      raw_logs: 'id, created_at, *tags',
      daily_reviews: 'id, review_date, entry_type, *tags',
      thoughts: 'id, created_at',
      mingwu: 'id, range_type, created_at',
      copilot_conversations: 'id, updated_at',
      migration_backups: 'key',
      tags: 'path, name, created_at',
      tag_aliases: 'alias, target',
    }).upgrade(async (tx) => {
      // 给旧 raw_logs 补 tags: []
      const rawLogs = await tx.table('raw_logs').toArray();
      for (const log of rawLogs) {
        if (!log.tags) {
          await tx.table('raw_logs').put({ ...log, tags: [] });
        }
      }
      // 给旧 daily_reviews 补 tags: []
      const reviews = await tx.table('daily_reviews').toArray();
      for (const review of reviews) {
        if (!review.tags) {
          await tx.table('daily_reviews').put({ ...review, tags: [] });
        }
      }
      // 给旧 mingwu 补 tags: []（v8 从 insights 迁移来的旧数据无 tags 字段；
      // 运行时读取已有 `|| []` 防御，此处补全保持数据一致）
      const mingwu = await tx.table('mingwu').toArray();
      for (const m of mingwu) {
        if (!m.tags) {
          await tx.table('mingwu').put({ ...m, tags: [] });
        }
      }
    });
    // Version 11: #6 多媒体附件。
    // - 新增 attachments store（id, blob, type, created_at），存放原始 Blob 不压缩。
    // - raw_logs 接口加 attachments / attachment_summary / attachment_embedding 字段
    //   （非索引，无需改 stores 声明，旧数据无此字段按 undefined 处理即可）。
    // - upgrade 无需迁旧数据（纯新表）。
    this.version(11).stores({
      raw_logs: 'id, created_at, *tags',
      daily_reviews: 'id, review_date, entry_type, *tags',
      thoughts: 'id, created_at',
      mingwu: 'id, range_type, created_at',
      copilot_conversations: 'id, updated_at',
      migration_backups: 'key',
      tags: 'path, name, created_at',
      tag_aliases: 'alias, target',
      attachments: 'id, type, created_at',
    });
    // Version 12: #14 统一分块与向量化 pipeline。
    // - 新增 chunks 表：存每条源记录的文本分块及其向量与元数据
    //   （source_type / source_id / field / tags / created_at）。
    // - [source_type+source_id+field] 复合索引用于按源记录 + 字段高效删除/重建分块；
    //   source_id 单列索引用于「取某记录全部分块」；*tags 多值索引支持未来按标签过滤。
    // - 纯新增表，不改动既有表结构；旧数据无 chunks 即按无分块处理，
    //   现有 inline embedding 字段继续保留，检索仍读 .embedding（向后兼容）。
    // - upgrade 无需迁旧数据（分块在 embedding pipeline 按需重建）。
    this.version(12).stores({
      raw_logs: 'id, created_at, *tags',
      daily_reviews: 'id, review_date, entry_type, *tags',
      thoughts: 'id, created_at',
      mingwu: 'id, range_type, created_at',
      copilot_conversations: 'id, updated_at',
      migration_backups: 'key',
      tags: 'path, name, created_at',
      tag_aliases: 'alias, target',
      attachments: 'id, type, created_at',
      chunks: 'id, source_id, [source_type+source_id+field], *tags',
    });
    // Version 13: task-112 标签快捷操作菜单。
    // - TagDef 新增 pinned / sort_order / icon 字段。
    // - tags 表加 sort_order 索引，用于置顶排序。
    // - upgrade：旧标签补 pinned=false、sort_order=created_at+BASE（置顶区间 0..1e9，未置顶 1e9+）。
    this.version(13).stores({
      raw_logs: 'id, created_at, *tags',
      daily_reviews: 'id, review_date, entry_type, *tags',
      thoughts: 'id, created_at',
      mingwu: 'id, range_type, created_at',
      copilot_conversations: 'id, updated_at',
      migration_backups: 'key',
      tags: 'path, name, created_at, sort_order',
      tag_aliases: 'alias, target',
      attachments: 'id, type, created_at',
      chunks: 'id, source_id, [source_type+source_id+field], *tags',
    }).upgrade(async (tx) => {
      const PINNED_ORDER_BASE = 1_000_000_000;
      const allTags = await tx.table('tags').toArray();
      for (const tag of allTags) {
        if (tag.pinned === undefined || tag.sort_order === undefined) {
          await tx.table('tags').put({
            ...tag,
            pinned: tag.pinned ?? false,
            sort_order: tag.sort_order ?? (tag.created_at + PINNED_ORDER_BASE),
            icon: tag.icon ?? '',
          });
        }
      }
    });

    // Version 14: 将内部表名由 mingwu 统一改为 insights。
    // - 新建 insights 表，字段 mingwu_type 改名为 insight_type。
    // - 迁移旧 mingwu 表数据；更新 chunks.source_type。
    // - 删除旧 mingwu 表（Dexie 中省略不会删除，必须显式设 null）。
    this.version(14).stores({
      raw_logs: 'id, created_at, *tags',
      daily_reviews: 'id, review_date, entry_type, *tags',
      thoughts: 'id, created_at',
      insights: 'id, range_type, created_at',
      copilot_conversations: 'id, updated_at',
      migration_backups: 'key',
      tags: 'path, name, created_at, sort_order',
      tag_aliases: 'alias, target',
      attachments: 'id, type, created_at',
      chunks: 'id, source_id, [source_type+source_id+field], *tags',
      mingwu: null,
    }).upgrade(async (tx) => {
      const safeToArray = async (name: string) => {
        try { return await tx.table(name).toArray(); } catch { return []; }
      };

      const oldRecords: any[] = await safeToArray('mingwu');
      for (const old of oldRecords) {
        // v14 干净重命名：剥离 mingwu_type 旧字段，不再作为运行时口径。
        delete old.mingwu_type;
        await tx.table('insights').put({
          ...old,
          insight_type: old.insight_type || 'insight',
        } as Insight);
      }

      const chunks = await tx.table('chunks').toArray();
      for (const c of chunks) {
        if (c.source_type === 'mingwu') {
          await tx.table('chunks').put({ ...c, source_type: 'insights' });
        }
      }
    });
    // Version 15: Issue #004 转写幻觉 patterns 外置到 IndexedDB。
    // - 新增 settings_kv 表（主键 key），通用 KV 存储。
    // - 首次启动时（首条写入），用 getDefaultPatterns 写入默认值。
    // - upgrade 无需迁旧数据：patterns 初始为空数组，等首次读时再懒写入默认。
    // - 旧用户在浏览器下次启动时，会自动通过 src/lib/hallucinationPatterns 的
    //   ensurePatterns() 写入默认值（首次访问触发）。
    // - 版本号取 v15 而非规格说的 v14（规格基于过时文件状态）。
    this.version(15).stores({
      raw_logs: 'id, created_at, *tags',
      daily_reviews: 'id, review_date, entry_type, *tags',
      thoughts: 'id, created_at',
      insights: 'id, range_type, created_at',
      copilot_conversations: 'id, updated_at',
      migration_backups: 'key',
      tags: 'path, name, created_at, sort_order',
      tag_aliases: 'alias, target',
      attachments: 'id, type, created_at',
      chunks: 'id, source_id, [source_type+source_id+field], *tags',
      settings_kv: 'key',
    });
    // Version 16: Issue #008 本地自动备份。
    // - 新增 backups 表（主键 id），按 created_at 索引，按 type 索引。
    // - 记录最近 4 周（28 天）的完整数据快照：raw_logs/daily_reviews/thoughts/insights/tags
    // - 不含 attachments（音频 Blob 太大）/ chunks（可重建）/ settings_kv（已在云）
    //   / copilot_conversations（经常变）
    // - 升级无需迁旧数据：新表，初始为空
    // - 用户开关 autoBackup.enabled 也存 settings_kv（保持 v15 引入的约定）
    this.version(16).stores({
      backups: 'id, created_at, type',
    });
    // Version 17: Issue P1-004 (ADR-0004) 长期记忆 facts 表。
    // - 新增 facts 表（主键 id），按 key/category/created_at 索引。
    // - 记录"用户事实"：生日、偏好、习惯、背景。
    // - 升级无需迁旧数据：纯新增表，初始为空。
    // - 与 P0 #004 settings_kv 不同：facts 是结构化记录（key-value + category + confidence + source），
    //   而 settings_kv 是无 schema KV 存储。
    // - 备份策略（P0 #008 autoBackup）：默认不备份 facts，详见 src/lib/autoBackup.ts。
    this.version(17).stores({
      facts: 'id, key, category, created_at',
    });
    // Version 18: Issue #15 raw_logs / thoughts 统一 RichDocument 存储基础。
    // - content_doc 为非索引 JSON 字段，保留旧 content 与附件字段供尚未接入的页面使用。
    // - 仅在 content_doc 缺失或非法时从旧 content 转换，重复执行不会覆盖已有合法文档。
    this.version(18).stores({}).upgrade(async (tx) => {
      for (const tableName of ['raw_logs', 'thoughts']) {
        const table = tx.table(tableName);
        const records = await table.toArray();
        for (const record of records) {
          const migrated = migrateDocumentContent(record);
          if (migrated !== record) {
            await table.put(migrated);
          }
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
export function normalizeLegacyInsight(i: any): Insight {
  // 干净重命名：从云备份/导入数据读取时剥离 mingwu_type 旧字段。
  delete i.mingwu_type;
  return { ...i, insight_type: i.insight_type || 'insight' } as Insight;
}

function isValidRichDocument(value: unknown): value is RichDocument {
  if (typeof value !== 'object' || value === null || (value as RichDocument).type !== 'doc') return false;
  try {
    buildEditorSchema().nodeFromJSON(value as any).check();
    return true;
  } catch {
    return false;
  }
}

/** 统一读取记录正文：合法 content_doc 优先，否则兼容旧 content 字符串。 */
export function resolveDocumentContent(raw: {
  content_doc?: unknown;
  content?: unknown;
  attachments?: AttachmentMeta[];
} | null | undefined): RichDocument {
  const hasValidDoc = isValidRichDocument(raw?.content_doc);
  let doc = hasValidDoc
    ? raw!.content_doc as RichDocument
    : typeof raw?.content === 'string' && raw.content !== ''
      ? plainTextToDocument(raw.content)
      : EMPTY_RICH_DOCUMENT;
  const existingIds = new Set(extractAttachmentIds(doc));
  const legacyAttachments = Array.isArray(raw?.attachments) ? raw.attachments : [];
  const legacyBlocks = legacyAttachments.flatMap((attachment) => {
    const ref = attachment?.ref;
    if (!ref || existingIds.has(ref) || ref.startsWith('data:') || ref.startsWith('http://') || ref.startsWith('https://')) return [];
    if (attachment.kind !== 'image' && attachment.kind !== 'audio' && attachment.kind !== 'video' && attachment.kind !== 'file') return [];
    existingIds.add(ref);
    return [{
      type: attachment.kind,
      attrs: {
        attachmentId: ref,
        alt: attachment.name || '',
        caption: attachment.summary || '',
        name: attachment.name || '',
        width: 100,
        align: 'center',
        mimeType: '',
        duration: 0,
      },
    } as RichDocument['content'][number]];
  });
  return legacyBlocks.length > 0
    ? { type: 'doc', content: [...(doc.content || []), ...legacyBlocks] }
    : doc;
}

/** v18 upgrade 共用的纯迁移步骤；已有合法文档时原样返回以保证幂等。 */
export function migrateDocumentContent<T extends { content_doc?: unknown; content?: unknown; attachments?: AttachmentMeta[] }>(raw: T): T & { content_doc: RichDocumentJson } {
  if (isValidRichDocument(raw.content_doc)) return raw as T & { content_doc: RichDocumentJson };
  return { ...raw, content_doc: resolveDocumentContent(raw) };
}

export const db = new WhitewashDiaryDB();
