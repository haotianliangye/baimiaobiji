/**
 * #tag-aggregation 标签聚合页 v2。
 *
 * URL: /tag?path=<encoded tag path>&includeChildren=<0|1>
 *
 * 行为:
 * - 同时订阅四张表(raw_logs / daily_reviews / thoughts / insights)
 * - 用 normalizeTagPath + matchesByPrefix 过滤;includeChildren 默认开启
 * - 4 类内容混排成单一扁平时间线,按时间倒序,每条带板块图标
 * - 不再有分组/header/checkbox/返回按钮 — 全部操作(切换标签、包含子标签、管理、返回)
 *   移到 TopBar #标签胶囊下拉菜单(Layout.tsx)
 * - 右上角 🔍 复用 Layout 已有的全局搜索面板
 * - 点卡片空白 → 跳对应板块并带 entryId param(配合 review/insights/thoughts 高亮)
 * - 点 chip → 切换 path 跳转同聚合页
 */
import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { db, type RawLog, type DailyReview, type Thought, type Insight } from '../db/db';
import { normalizeTagPath, resolveAlias, matchesByPrefix } from '../lib/tags';
import { useTagsStore } from '../store/tags.store';
import { documentToText } from '../lib/documentModel';
import { TagChip } from '../components/TagChip';
import { useTranslation } from '../lib/i18n';

type Entry =
  | { kind: 'record'; created_at: number; data: RawLog }
  | { kind: 'review'; created_at: number; data: DailyReview }
  | { kind: 'thought'; created_at: number; data: Thought }
  | { kind: 'insight'; created_at: number; data: Insight };

const SECTION_KIND: Array<Entry['kind']> = ['record', 'review', 'thought', 'insight'];

/** 板块类型 -> (小图标 emoji + i18n key) */
const KIND_META: Record<Entry['kind'], { icon: string; labelKey: string }> = {
  record: { icon: '📝', labelKey: 'tags.sectionRecord' },
  review: { icon: '🪞', labelKey: 'tags.sectionReview' },
  thought: { icon: '💭', labelKey: 'tags.sectionThoughts' },
  insight: { icon: '💡', labelKey: 'tags.sectionInsights' },
};

function buildSummary(kind: Entry['kind'], data: any): string {
  if (kind === 'record') {
    const text = data.content_doc ? documentToText(data.content_doc) : (data.content || '');
    return text.replace(/\s+/g, ' ').trim().slice(0, 200);
  }
  if (kind === 'review') {
    return (data.ai_summary || '').replace(/\s+/g, ' ').trim().slice(0, 200) ||
      (data.ai_editorial || data.ai_review || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  }
  if (kind === 'thought') {
    const text = data.content_doc ? documentToText(data.content_doc) : (data.content || '');
    return text.replace(/\s+/g, ' ').trim().slice(0, 200);
  }
  // insight
  return (data.ai_summary || data.content || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function entryHref(entry: Entry): string {
  const id = (entry.data as any).id;
  if (entry.kind === 'record') return `/record?logId=${id}`;
  if (entry.kind === 'review') return `/review?reviewId=${id}`;
  if (entry.kind === 'thought') return `/thoughts?thoughtId=${id}`;
  return `/insight?insightId=${id}`;
}

function entryId(entry: Entry): string {
  return (entry.data as any).id as string;
}

function entryDate(entry: Entry): number {
  return entry.created_at || (entry.data as any).updated_at || 0;
}

export default function TagAggregation() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const aliases = useTagsStore((s) => s.aliases);

  const rawPath = searchParams.get('path') ?? '';
  const includeChildren = searchParams.get('includeChildren') !== '0';

  const path = useMemo(() => normalizeTagPath(rawPath), [rawPath]);
  const canonical = useMemo(() => resolveAlias(path, aliases), [path, aliases]);
  const queryPath = includeChildren ? canonical : canonical;

  const records = useLiveQuery(() => db.raw_logs.toArray(), []);
  const reviews = useLiveQuery(() => db.daily_reviews.toArray(), []);
  const thoughts = useLiveQuery(() => db.thoughts.toArray(), []);
  const insights = useLiveQuery(() => db.insights.toArray(), []);

  const flatEntries = useMemo(() => {
    const all: Entry[] = [];
    if (!queryPath) return all;
    const matches = (entryTags: string[] | undefined) =>
      !!entryTags && entryTags.some((p) => matchesByPrefix(p, queryPath));

    (records ?? []).forEach((r) => {
      if (matches(r.tags)) all.push({ kind: 'record', created_at: r.created_at, data: r });
    });
    (reviews ?? []).forEach((r) => {
      if (matches(r.tags)) all.push({ kind: 'review', created_at: r.updated_at || 0, data: r });
    });
    (thoughts ?? []).forEach((th) => {
      if (matches(th.tags)) all.push({ kind: 'thought', created_at: th.created_at, data: th });
    });
    (insights ?? []).forEach((i) => {
      if (matches(i.tags)) all.push({ kind: 'insight', created_at: i.created_at, data: i });
    });

    all.sort((a, b) => entryDate(b) - entryDate(a));
    return all;
  }, [records, reviews, thoughts, insights, queryPath]);

  const switchPath = (p: string) => {
    navigate(`/tag?path=${encodeURIComponent(p)}`);
  };

  return (
    <div className="px-4 pt-3 pb-20 mx-auto max-w-3xl" data-testid="tag-aggregation-page">
      {/* Empty path:未指定标签 */}
      {!path && (
        <div className="py-16 text-center text-stone-400 text-[13px]">
          {t('tags.aggregationEmpty', { path: '...' })}
        </div>
      )}

      {/* Empty state:有 path 但无内容 */}
      {path && flatEntries.length === 0 && (
        <div className="py-16 text-center text-stone-400 text-[13px]">
          {t('tags.aggregationEmpty', { path })}
        </div>
      )}

      {/* 单一扁平时间线 */}
      <div className="flex flex-col gap-3">
        {flatEntries.map((entry) => (
          <EntryRow
            key={`${entry.kind}-${entryId(entry)}`}
            entry={entry}
            onClickHref={entryHref(entry)}
            onSwitchPath={switchPath}
          />
        ))}
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  onClickHref,
  onSwitchPath,
}: {
  entry: Entry;
  onClickHref: string;
  onSwitchPath: (p: string) => void;
}) {
  const { t } = useTranslation();
  const meta = KIND_META[entry.kind];
  const summary = buildSummary(entry.kind, entry.data);
  const tags: string[] = (entry.data as any).tags || [];
  const dateStr = format(new Date(entryDate(entry) || Date.now()), 'yyyy-MM-dd HH:mm');

  return (
    <a
      href={onClickHref}
      data-testid={`tag-entry-${entry.kind}-${entryId(entry)}`}
      className="block px-4 py-3 rounded-xl bg-white/60 border border-stone-200/60 hover:border-baimiao-mysteria/40 hover:bg-white/90 transition-colors group"
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[12px] font-medium text-baimiao-mysteria/80 flex items-center gap-1">
          <span aria-hidden="true">{meta.icon}</span>
          <span>{t(meta.labelKey)}</span>
        </span>
        <span className="text-[10.5px] text-stone-400 font-mono shrink-0">{dateStr}</span>
      </div>
      {summary && (
        <div className="text-[14.5px] text-stone-700 leading-relaxed line-clamp-3 mb-2">
          {summary}
        </div>
      )}
      {tags.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {tags.map((tag) => (
            <TagChip
              key={tag}
              path={tag}
              testId={`tag-aggregation-chip-${entry.kind}-${entryId(entry)}-${tag}`}
              onNavigate={onSwitchPath}
            />
          ))}
        </div>
      )}
    </a>
  );
}