// RAG context assembly for the 白描 Copilot panel (PRD §2 + user stories 3/4/7).
//
// Given the user's question, runs a pure-semantic retrieval (no keyword/RRF
// merge — that's for the search panel) over local record/diary/review
// embeddings, takes the top-K fragments, and packs them into a context string
// whose entries each carry a `#log_id_<UUID>` so the LLM can cite them. The
// matching id→{date,type} map is returned alongside so the panel can turn
// citation clicks into in-app navigation.
//
// Reuses the same primitives as executeSearch: requestEmbedding for the query,
// IndexedDB date/prompt pre-filtering (getFilterRange/isDateInFilter), the
// cosine Web Worker (computeCosineBatch) with a main-thread fallback, and the
// shared SEMANTIC_THRESHOLD / MAX_SEMANTIC_CANDIDATES constants.

import { db } from '../db/db';
import { requestEmbedding, cosineSimilarity } from './embedding';
import { computeCosineBatch, type CosineCandidate, type CosineScore } from './cosineWorker';
import {
  SEMANTIC_THRESHOLD,
  MAX_SEMANTIC_CANDIDATES,
  getFilterRange,
  isDateInFilter,
} from '../store/app.store';
import { format, parseISO } from 'date-fns';

export interface CopilotRetrievalFilters {
  modules: Array<'record' | 'diary' | 'review'>;
  dateRange: string; // '全部' | '本周' | '本月' | '本季度' | '自定义'
  customStartDate?: string;
  customEndDate?: string;
  diaryPromptIndex?: number; // multi-template isolation (PRD §4.3.2)
}

export interface CopilotCitation {
  date: string; // yyyy-MM-dd — used for in-app navigation
  type: 'record' | 'diary' | 'review';
}

export interface CopilotRetrievalResult {
  contextContent: string;
  citationMap: Map<string, CopilotCitation>; // logId -> {date, type}
}

// How many fragments to inject as RAG context. Keeps the LLM prompt bounded.
const COPILOT_TOP_K = 10;
// Per-fragment char cap so a few long diaries/reviews don't blow the context.
const MAX_FRAGMENT_CHARS = 800;

interface CandidateMeta {
  type: 'record' | 'diary' | 'review';
  id: string;
  navDate: string; // yyyy-MM-dd
  displayDate: string;
  content: string;
  label: string;
}

export async function retrieveCopilotContext(
  question: string,
  filters: CopilotRetrievalFilters
): Promise<CopilotRetrievalResult> {
  const empty: CopilotRetrievalResult = { contextContent: '', citationMap: new Map() };
  if (!question.trim()) return empty;

  let queryEmbedding: number[];
  try {
    queryEmbedding = await requestEmbedding(question);
  } catch (err: any) {
    throw new Error(err.message || '生成检索向量失败');
  }
  if (!queryEmbedding || queryEmbedding.length === 0) return empty;

  const candidates: CosineCandidate[] = [];
  const meta = new Map<string, CandidateMeta>();
  const filterRange = getFilterRange(filters.dateRange, filters.customStartDate, filters.customEndDate);

  if (filters.modules.includes('record')) {
    // Pre-filter by the created_at index when bounded (PRD §4.3.4).
    const logs = filterRange
      ? await db.raw_logs.where('created_at').between(filterRange.start, filterRange.end).toArray()
      : await db.raw_logs.toArray();
    for (const log of logs.slice(0, MAX_SEMANTIC_CANDIDATES)) {
      if (!log.embedding || log.embedding.length === 0) continue;
      const key = `record:${log.id}`;
      meta.set(key, {
        type: 'record',
        id: log.id,
        navDate: format(new Date(log.created_at), 'yyyy-MM-dd'),
        displayDate: format(new Date(log.created_at), 'yyyy-MM-dd HH:mm'),
        content: log.content,
        label: '碎屑记录',
      });
      candidates.push({ key, embedding: log.embedding });
    }
  }

  if (filters.modules.includes('diary')) {
    const diaries = (await db.daily_diaries.toArray()).slice(0, MAX_SEMANTIC_CANDIDATES);
    for (const d of diaries) {
      if (!d.embedding || d.embedding.length === 0) continue;
      if (!isDateInFilter(parseISO(d.diary_date), filters.dateRange, filters.customStartDate, filters.customEndDate)) continue;
      // Multi-template isolation (PRD §4.3.2).
      if (filters.diaryPromptIndex !== undefined && d.prompt_index !== filters.diaryPromptIndex) continue;
      const key = `diary:${d.id}`;
      meta.set(key, {
        type: 'diary',
        id: d.id,
        navDate: d.diary_date,
        displayDate: d.diary_date,
        content: d.ai_editorial || '',
        label: '整合日记',
      });
      candidates.push({ key, embedding: d.embedding });
    }
  }

  if (filters.modules.includes('review')) {
    const reviews = (await db.daily_reviews.toArray()).slice(0, MAX_SEMANTIC_CANDIDATES);
    for (const r of reviews) {
      if (!r.embedding || r.embedding.length === 0) continue;
      if (!isDateInFilter(parseISO(r.review_date), filters.dateRange, filters.customStartDate, filters.customEndDate)) continue;
      const key = `review:${r.id}`;
      meta.set(key, {
        type: 'review',
        id: r.id,
        navDate: r.review_date,
        displayDate: r.review_date,
        content: r.ai_review || '',
        label: '反思回顾',
      });
      candidates.push({ key, embedding: r.embedding });
    }
  }

  if (candidates.length === 0) return empty;

  let scores: CosineScore[];
  try {
    const res = await computeCosineBatch(queryEmbedding, candidates, SEMANTIC_THRESHOLD);
    scores = res.results;
  } catch (err) {
    // Worker unavailable — fall back to inline cosine (mirrors executeSearch).
    console.warn('[Copilot Retrieval] worker unavailable, falling back to main thread:', err);
    scores = [];
    for (const c of candidates) {
      const sim = cosineSimilarity(queryEmbedding, c.embedding);
      if (sim > SEMANTIC_THRESHOLD) scores.push({ key: c.key, sim });
    }
    scores.sort((a, b) => b.sim - a.sim);
  }

  const top = scores.slice(0, COPILOT_TOP_K);
  if (top.length === 0) return empty;

  const citationMap = new Map<string, CopilotCitation>();
  const blocks: string[] = [];
  top.forEach((s, i) => {
    const m = meta.get(s.key);
    if (!m) return;
    citationMap.set(m.id, { date: m.navDate, type: m.type });
    const truncated =
      m.content.length > MAX_FRAGMENT_CHARS
        ? m.content.slice(0, MAX_FRAGMENT_CHARS) + '…'
        : m.content;
    blocks.push(`[${i + 1}] 日期: ${m.displayDate} | 类型: ${m.label} | ID: #log_id_${m.id}\n${truncated}`);
  });

  if (blocks.length === 0) return empty;

  const contextContent =
    `以下是与用户问题最相关的本地记录片段（按相关度排序），每条带有一个 ID，供你引用：\n\n` +
    blocks.join('\n\n');

  return { contextContent, citationMap };
}
