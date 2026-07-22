/**
 * #11 随机漫步（RandomWalk）-- 卡片堆叠滑动浏览历史记录。
 *
 * 渲染模式（需求 2）：主内容区模式（非 fixed 全屏覆盖），限制在应用容器
 * （max-w-md）内渲染，保留顶部 header 和底部 TabBar。顶部 header 标题、×
 * 关闭、灯泡 toggle 由 Layout 控制；本组件只负责卡片区 + 底部操作栏。
 *
 * 数据源：默认 thoughts + daily_reviews；可在面板内扩展为
 *   raw_logs + thoughts + daily_reviews + mingwu（存 localStorage，不进 settings.store）。
 *
 * 抽取规则：每次随机抽 3 条（跨所选数据源），过滤最近 N 天（默认 7，可配置）已展示过的记录；
 *   「已阅」按钮标记为永久不再出现。展示历史存 localStorage(random-walk-shown)。
 *
 * 形态：Swiper + EffectCards 扇形堆叠滑动，左右滑动切换。
 * 底部操作栏（单排）：已阅 / 标签 / 编辑 / 复制 / 删除 / 换一批。
 *   - 删除/编辑按记录类型调对应表（raw_logs/thoughts/daily_reviews/mingwu）。
 *   - 标签：raw_logs/daily_reviews 可增删（#4 标签系统）；thoughts 标签来自正文 #标签（只读）。
 *   - 复制：useCopyToClipboard。
 *   - 编辑：弹 RichEditor 编辑弹窗（不跳转页面），所有记录类型统一。
 *   - 「下一张」靠左右滑动实现，不单设按钮。
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import { Swiper, SwiperSlide } from 'swiper/react';
import { EffectCards } from 'swiper/modules';
import type { Swiper as SwiperClass } from 'swiper';
import 'swiper/css';
import 'swiper/css/effect-cards';
import {
  Lightbulb,
  Shuffle,
  Hash,
  Pencil,
  Copy,
  Check,
  Trash2,
  Settings2,
  Plus,
  RotateCcw,
  ChevronRight,
  X,
  Save,
  Play,
  Link as LinkIcon,
} from 'lucide-react';
import { db, type Thought, type RawLog, type DailyReview, type Insight, type AttachmentMeta } from '../db/db';
import { useTagsStore } from '../store/tags.store';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { normalizeTagPath } from '../lib/tags';
import { useTranslation } from '../lib/i18n';
import RichEditor from './RichEditor';
import MediaPreview from './MediaPreview';

type SourceType = 'raw_logs' | 'thoughts' | 'daily_reviews' | 'insights';

const ALL_SOURCES: SourceType[] = ['raw_logs', 'thoughts', 'daily_reviews', 'insights'];

/** 翻译函数类型（与 i18n.ts 的 t 签名一致） */
type TFunc = (key: string, params?: Record<string, string | number>) => string;

/** 数据源 -> TabBar 标签 key 映射 */
const SOURCE_LABEL_KEYS: Record<SourceType, string> = {
  raw_logs: 'tab.record',
  thoughts: 'tab.thoughts',
  daily_reviews: 'tab.review',
  insights: 'tab.insight',
};

const LS_SOURCES = 'random-walk-sources';
const LS_SHOWN = 'random-walk-shown';
const LS_COOLDOWN = 'random-walk-cooldown-days';

const DEFAULT_SOURCES: SourceType[] = ['thoughts', 'daily_reviews'];
const DEFAULT_COOLDOWN_DAYS = 7;
// #116 需求 1：单次抽取卡片数 3 → 7
const DRAW_COUNT = 7;

interface ShownRecord {
  shownAt: number;
  read: boolean;
}
type ShownMap = Record<string, ShownRecord>;

interface WalkItem {
  key: string; // `${type}:${id}`
  type: SourceType;
  id: string;
  content: string; // 展示正文（Markdown）
  title?: string; // 回顾/洞察的一句话摘要
  createdAt: number;
  tags: string[];
  reviewDate?: string; // daily_reviews 的 review_date
  rawText: string; // 复制用的纯文本
  typeLabel: string;
  attachments?: AttachmentMeta[]; // raw_logs/thoughts 的多媒体附件
  attachmentSummary?: string; // raw_logs 的多模态合并摘要
}

/** 判断附件 ref 是否可直接作为 URL 渲染（data URL 或 http(s) 链接）。 */
function isDirectUrl(ref?: string): boolean {
  return !!ref && (ref.startsWith('data:') || ref.startsWith('http'));
}

/**
 * 加载附件 Blob 并返回 object URL，用于卡片中渲染图片/视频/音频。
 * data URL / http 链接直接返回；IndexedDB store id 异步加载 Blob 转 object URL。
 */
function useAttachmentUrl(ref?: string): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  const direct = isDirectUrl(ref);
  useEffect(() => {
    if (!ref) {
      setUrl(undefined);
      return;
    }
    if (direct) {
      setUrl(ref);
      return;
    }
    let objectUrl: string | undefined;
    let cancelled = false;
    db.attachments.get(ref).then((record) => {
      if (cancelled || !record) return;
      objectUrl = URL.createObjectURL(record.blob);
      setUrl(objectUrl);
    }).catch(() => {
      // 附件 Blob 读取失败（可能已被清理），静默处理
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [ref, direct]);
  return url;
}

// ---------- localStorage 读写 ----------
function loadSources(): SourceType[] {
  try {
    const raw = localStorage.getItem(LS_SOURCES);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const valid = arr.filter((s): s is SourceType =>
          ALL_SOURCES.includes(s)
        );
        if (valid.length > 0) return valid;
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SOURCES;
}

function loadCooldownDays(): number {
  const raw = localStorage.getItem(LS_COOLDOWN);
  // localStorage.getItem 在 key 不存在时返回 null，而 Number(null)===0 会被误判为合法值，
  // 导致默认冷却期变成 0（已展示记录立刻可重抽）。key 缺失时必须回落到默认值。
  if (raw === null || raw === '') return DEFAULT_COOLDOWN_DAYS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_COOLDOWN_DAYS;
}

function loadShown(): ShownMap {
  try {
    const raw = localStorage.getItem(LS_SHOWN);
    if (raw) return JSON.parse(raw) as ShownMap;
  } catch {
    /* ignore */
  }
  return {};
}

function saveShown(map: ShownMap) {
  localStorage.setItem(LS_SHOWN, JSON.stringify(map));
}

// ---------- 数据源 -> WalkItem 归一化 ----------
function toWalkItems(
  thoughts: Thought[],
  rawLogs: RawLog[],
  reviews: DailyReview[],
  mingwu: Insight[],
  sources: SourceType[],
  tf: TFunc
): WalkItem[] {
  const items: WalkItem[] = [];
  if (sources.includes('thoughts')) {
    for (const th of thoughts) {
      items.push({
        key: `thoughts:${th.id}`,
        type: 'thoughts',
        id: th.id,
        content: th.content,
        createdAt: th.created_at,
        tags: th.tags || [],
        rawText: th.content,
        typeLabel: tf('tab.thoughts'),
        attachments: th.attachments,
      });
    }
  }
  if (sources.includes('raw_logs')) {
    for (const r of rawLogs) {
      items.push({
        key: `raw_logs:${r.id}`,
        type: 'raw_logs',
        id: r.id,
        content: r.content,
        createdAt: r.created_at,
        tags: r.tags || [],
        rawText: r.content,
        typeLabel: tf('tab.record'),
        attachments: r.attachments,
        attachmentSummary: r.attachment_summary,
      });
    }
  }
  if (sources.includes('daily_reviews')) {
    for (const r of reviews) {
      const isDiary = r.entry_type === 'diary';
      const body = isDiary
        ? r.ai_editorial || r.ai_summary || ''
        : r.ai_review || r.ai_summary || '';
      items.push({
        key: `daily_reviews:${r.id}`,
        type: 'daily_reviews',
        id: r.id,
        content: body,
        title: r.ai_summary,
        createdAt: r.updated_at,
        tags: r.tags || [],
        reviewDate: r.review_date,
        rawText: body,
        typeLabel: isDiary ? tf('review.diary') : tf('review.review'),
      });
    }
  }
  if (sources.includes('insights')) {
    for (const m of mingwu) {
      if (!m.id) continue;
      items.push({
        key: `insights:${m.id}`,
        type: 'insights',
        id: m.id,
        content: m.content,
        title: m.ai_summary,
        createdAt: m.created_at,
        tags: [],
        rawText: m.content,
        typeLabel: m.insight_type === 'insight' ? tf('insight.insight') : tf('insight.mingwu'),
      });
    }
  }
  // 过滤掉正文为空的记录
  return items.filter((it) => it.rawText.trim().length > 0);
}

/** Fisher-Yates 洗牌。 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 判断正文是否只是多媒体占位文本（附件为主、无有效文字时用占位入库）。 */
function isMultimediaPlaceholder(content: string): boolean {
  const c = content.trim();
  return c === '[多媒体记录]' || c === '[Multimedia record]';
}

/** 单个图片/视频缩略图：16:9 cover，图片点击预览，视频叠加播放按钮。 */
function WalkMediaThumb({
  att,
  onOpenPreview,
}: {
  att: AttachmentMeta;
  onOpenPreview: () => void;
}) {
  const { t } = useTranslation();
  const url = useAttachmentUrl(att.ref);

  if (!url) {
    return <div className="aspect-video w-full bg-stone-100 rounded-lg animate-pulse" />;
  }

  return (
    <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-stone-100">
      {att.kind === 'image' ? (
        <img
          src={url}
          alt={att.name || t('record.image')}
          onClick={onOpenPreview}
          className="w-full h-full object-cover cursor-pointer"
        />
      ) : (
        <>
          <video
            src={url}
            preload="metadata"
            className="w-full h-full object-cover pointer-events-none"
          />
          <button
            type="button"
            onClick={onOpenPreview}
            className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors"
            aria-label={t('record.video')}
          >
            <span className="w-7 h-7 rounded-full bg-white/90 flex items-center justify-center shadow-md">
              <Play className="w-3.5 h-3.5 text-stone-900 ml-0.5" fill="currentColor" />
            </span>
          </button>
        </>
      )}
    </div>
  );
}

/**
 * 随机漫步卡片多媒体附件区：
 * - 图片/视频：单张撑满 / 2×2 网格（最多 4 个）。
 * - 音频：纵向播放器列表。
 * - 链接：外链列表。
 * - 附件 AI 摘要：媒体下方次要文本，最多 3 行。
 */
function WalkAttachments({
  attachments,
  attachmentSummary,
  onOpenPreview,
}: {
  attachments: AttachmentMeta[];
  attachmentSummary?: string;
  onOpenPreview: (items: AttachmentMeta[], initialIndex: number) => void;
}) {
  const mediaItems = attachments
    .map((att, idx) => ({ att, originalIndex: idx }))
    .filter(({ att }) => att.kind === 'image' || att.kind === 'video');
  const audioItems = attachments.filter((a) => a.kind === 'audio');
  const linkItems = attachments.filter((a) => a.kind === 'link');

  const visibleMedia = mediaItems.slice(0, 4);
  const isSingle = visibleMedia.length === 1;
  const hasAudio = audioItems.length > 0;
  const hasLink = linkItems.length > 0;

  if (mediaItems.length === 0 && !hasAudio && !hasLink && !attachmentSummary) return null;

  return (
    <div className="mt-2 w-full shrink-0">
      {visibleMedia.length > 0 && (
        <div className={isSingle ? 'w-full' : 'grid grid-cols-2 gap-1'}>
          {visibleMedia.map(({ att, originalIndex }, i) => (
            <WalkMediaThumb
              key={originalIndex}
              att={att}
              onOpenPreview={() => onOpenPreview(mediaItems.map(({ att: a }) => a), i)}
            />
          ))}
        </div>
      )}

      {hasAudio && (
        <div className={`flex flex-col gap-2 ${visibleMedia.length > 0 ? 'mt-2' : ''}`}>
          {audioItems.map((att, i) => (
            <WalkAudioItem key={i} att={att} />
          ))}
        </div>
      )}

      {hasLink && (
        <div className={`flex flex-col gap-1 ${visibleMedia.length > 0 || hasAudio ? 'mt-2' : ''}`}>
          {linkItems.map((att, i) => (
            <a
              key={i}
              href={att.ref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-600 truncate"
            >
              <LinkIcon className="w-3 h-3 shrink-0" />
              <span className="truncate">{att.name || att.ref}</span>
            </a>
          ))}
        </div>
      )}

      {attachmentSummary && (
        <p className="mt-2 text-[12px] leading-relaxed text-stone-500 line-clamp-3 break-words">
          {attachmentSummary}
        </p>
      )}
    </div>
  );
}

/** 单个音频附件播放器。 */
function WalkAudioItem({ att }: { att: AttachmentMeta }) {
  const url = useAttachmentUrl(att.ref);
  if (!url) {
    return <div className="h-8 w-full bg-stone-100 rounded animate-pulse" />;
  }
  return (
    <audio
      controls
      controlsList="nodownload noplaybackrate"
      src={url}
      className="h-8 w-full opacity-60 grayscale hover:opacity-100 transition-opacity"
    />
  );
}

export default function RandomWalk() {
  const { copied, copy } = useCopyToClipboard();
  const createTag = useTagsStore((s) => s.createTag);
  const { t } = useTranslation();

  // --- 数据源（live query，始终保持最新，draw 时读取） ---
  const allThoughts = useLiveQuery(() => db.thoughts.toArray(), []);
  const allRawLogs = useLiveQuery(() => db.raw_logs.toArray(), []);
  const allReviews = useLiveQuery(() => db.daily_reviews.toArray(), []);
  const allMingwu = useLiveQuery(() => db.insights.toArray(), []);

  // 用 ref 持有最新数据，draw 闭包始终读到最新值
  const dataRef = useRef({ thoughts: [] as Thought[], rawLogs: [] as RawLog[], reviews: [] as DailyReview[], mingwu: [] as Insight[] });
  dataRef.current = {
    thoughts: allThoughts || [],
    rawLogs: allRawLogs || [],
    reviews: allReviews || [],
    mingwu: allMingwu || [],
  };

  // --- 配置 state（与 localStorage 同步） ---
  const [sources, setSources] = useState<SourceType[]>(loadSources);
  const [cooldownDays, setCooldownDays] = useState<number>(loadCooldownDays);

  // --- 卡片状态 ---
  const [items, setItems] = useState<WalkItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [ended, setEnded] = useState(false);
  const [loading, setLoading] = useState(true);

  // --- UI 状态 ---
  const [showSettings, setShowSettings] = useState(false);
  const [showTagSheet, setShowTagSheet] = useState(false);
  const [tagInput, setTagInput] = useState('');
  // 图片/视频全屏预览
  const [mediaPreview, setMediaPreview] = useState<{ items: AttachmentMeta[]; initialIndex: number } | null>(null);

  // --- Swiper 实例 ---
  const swiperRef = useRef<SwiperClass | null>(null);

  // Issue 002：当前卡片正文溢出检测（用于显示底部渐变遮罩）
  const contentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [contentOverflow, setContentOverflow] = useState(false);

  // --- 编辑弹窗状态 ---
  const [editingItem, setEditingItem] = useState<WalkItem | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editAttachments, setEditAttachments] = useState<AttachmentMeta[]>([]);
  const [editSaving, setEditSaving] = useState(false);

  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const cooldownRef = useRef(cooldownDays);
  cooldownRef.current = cooldownDays;

  /** 抽取一批（最多 DRAW_COUNT 条），写展示历史。 */
  const draw = useCallback(() => {
    const all = toWalkItems(
      dataRef.current.thoughts,
      dataRef.current.rawLogs,
      dataRef.current.reviews,
      dataRef.current.mingwu,
      sourcesRef.current,
      t
    );
    const shown = loadShown();
    const now = Date.now();
    const cooldownMs = cooldownRef.current * 86400000;
    const eligible = all.filter((item) => {
      const rec = shown[item.key];
      if (!rec) return true;
      if (rec.read) return false; // 已阅：永久不再出现
      if (now - rec.shownAt < cooldownMs) return false; // 冷却期内不重复
      return true;
    });
    const batch = shuffle(eligible).slice(0, DRAW_COUNT);
    // 标记为已展示（冷却期去重）
    const newShown = { ...shown };
    for (const item of batch) {
      newShown[item.key] = { shownAt: now, read: false };
    }
    saveShown(newShown);
    setItems(batch);
    setCurrentIndex(0);
    setEnded(batch.length === 0);
    setLoading(false);
    // 重置 swiper 到首张（若实例已存在）
    if (swiperRef.current) {
      swiperRef.current.slideTo(0, 0);
    }
  }, [t]);

  // 首次：等 live query 数据就绪后抽取
  const ready =
    allThoughts !== undefined &&
    allRawLogs !== undefined &&
    allReviews !== undefined &&
    allMingwu !== undefined;
  const didInitDraw = useRef(false);
  useEffect(() => {
    if (!ready || didInitDraw.current) return;
    didInitDraw.current = true;
    draw();
  }, [ready, draw]);

  const current = items[currentIndex];

  // Issue 002：检测当前卡片正文是否溢出，决定是否显示底部渐变遮罩
  useEffect(() => {
    const el = contentRefs.current[currentIndex];
    if (!el) {
      setContentOverflow(false);
      return;
    }
    const check = () => setContentOverflow(el.scrollHeight > el.clientHeight + 2);
    check();
    el.addEventListener('scroll', check);
    return () => el.removeEventListener('scroll', check);
  }, [currentIndex, items]);

  /** 前进到下一张；已到最后则进入结束态。 */
  const advance = useCallback(() => {
    const swiper = swiperRef.current;
    const idx = swiper ? swiper.activeIndex : currentIndex;
    if (idx < items.length - 1) {
      swiper ? swiper.slideNext() : setCurrentIndex(idx + 1);
    } else {
      setEnded(true);
    }
  }, [items.length, currentIndex]);

  // ---------- 操作 ----------
  const handleRead = () => {
    if (!current) return;
    const shown = loadShown();
    const prev = shown[current.key] || { shownAt: Date.now(), read: false };
    shown[current.key] = { ...prev, read: true };
    saveShown(shown);
    advance();
  };

  const handleDelete = async () => {
    if (!current) return;
    if (!confirm(t('randomWalk.confirmDelete'))) return;
    switch (current.type) {
      case 'thoughts':
        await db.thoughts.delete(current.id);
        break;
      case 'raw_logs':
        await db.raw_logs.delete(current.id);
        break;
      case 'daily_reviews':
        await db.daily_reviews.delete(current.id);
        break;
      case 'insights':
        await db.insights.delete(current.id);
        break;
    }
    advance();
  };

  // ---------- 编辑弹窗（RichEditor，不跳转页面） ----------
  const canEditAttachments = editingItem?.type === 'raw_logs' || editingItem?.type === 'thoughts';

  const openEdit = async (item: WalkItem) => {
    setEditingItem(item);
    setEditContent(item.content);
    setEditAttachments([]);
    // 从 DB 读取最新内容回显
    if (item.type === 'raw_logs') {
      const rec = await db.raw_logs.get(item.id);
      setEditContent(rec?.content ?? item.content);
      setEditAttachments(rec?.attachments ?? []);
    } else if (item.type === 'thoughts') {
      const rec = await db.thoughts.get(item.id);
      setEditContent(rec?.content ?? item.content);
      setEditAttachments(rec?.attachments ?? []);
    } else if (item.type === 'daily_reviews') {
      const rec = await db.daily_reviews.get(item.id);
      const isDiary = rec?.entry_type === 'diary';
      setEditContent(isDiary ? (rec?.ai_editorial ?? '') : (rec?.ai_review ?? ''));
    } else if (item.type === 'insights') {
      const rec = await db.insights.get(item.id);
      setEditContent(rec?.content ?? item.content);
    }
  };

  const closeEdit = () => {
    setEditingItem(null);
    setEditContent('');
    setEditAttachments([]);
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    const text = editContent.trim();
    // raw_logs/thoughts 允许仅附件无文本；daily_reviews/mingwu 需非空文本
    if (!text && !(canEditAttachments && editAttachments.length > 0)) return;
    setEditSaving(true);
    try {
      if (editingItem.type === 'raw_logs') {
        await db.raw_logs.update(editingItem.id, { content: editContent, attachments: editAttachments });
      } else if (editingItem.type === 'thoughts') {
        await db.thoughts.update(editingItem.id, { content: editContent, attachments: editAttachments });
      } else if (editingItem.type === 'daily_reviews') {
        const rec = await db.daily_reviews.get(editingItem.id);
        const isDiary = rec?.entry_type === 'diary';
        if (isDiary) {
          await db.daily_reviews.update(editingItem.id, { ai_editorial: editContent });
        } else {
          await db.daily_reviews.update(editingItem.id, { ai_review: editContent });
        }
      } else if (editingItem.type === 'insights') {
        await db.insights.update(editingItem.id, { content: editContent });
      }
      // 同步更新当前批次中的卡片内容
      setItems((prev) =>
        prev.map((it) =>
          it.key === editingItem.key ? { ...it, content: editContent, rawText: editContent } : it
        )
      );
      closeEdit();
    } finally {
      setEditSaving(false);
    }
  };

  const handleCopy = () => {
    if (current) copy(current.rawText);
  };

  // ---------- 标签增删（仅 raw_logs / daily_reviews） ----------
  const canEditTags = current?.type === 'raw_logs' || current?.type === 'daily_reviews';

  const refreshItemTags = (key: string, tags: string[]) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, tags } : it)));
  };

  const handleAddTag = async () => {
    if (!current || !canEditTags) return;
    const path = normalizeTagPath(tagInput);
    if (!path) return;
    await createTag(path);
    const table = current.type === 'raw_logs' ? db.raw_logs : db.daily_reviews;
    const rec = await table.get(current.id);
    const tags = rec?.tags || [];
    if (!tags.includes(path)) {
      const next = [...tags, path];
      await table.update(current.id, { tags: next });
      refreshItemTags(current.key, next);
    }
    setTagInput('');
  };

  const handleRemoveTag = async (tagPath: string) => {
    if (!current || !canEditTags) return;
    const table = current.type === 'raw_logs' ? db.raw_logs : db.daily_reviews;
    const rec = await table.get(current.id);
    const tags = (rec?.tags || []).filter((t) => t !== tagPath);
    await table.update(current.id, { tags });
    refreshItemTags(current.key, tags);
  };

  // ---------- 数据源 / 冷却期 配置 ----------
  const toggleSource = (src: SourceType) => {
    const next = sources.includes(src)
      ? sources.filter((s) => s !== src)
      : [...sources, src];
    if (next.length === 0) return; // 至少保留一个数据源
    setSources(next);
    sourcesRef.current = next; // 立即同步 ref，供紧随其后的 draw() 读取
    localStorage.setItem(LS_SOURCES, JSON.stringify(next));
    setShowSettings(false);
    draw();
  };

  const changeCooldown = (val: number) => {
    const n = Number.isFinite(val) && val >= 0 ? val : 0;
    setCooldownDays(n);
    cooldownRef.current = n; // 立即同步 ref
    localStorage.setItem(LS_COOLDOWN, String(n));
  };

  const handleResetHistory = () => {
    localStorage.removeItem(LS_SHOWN);
    draw();
  };

  return (
    <div
      data-testid="random-walk-overlay"
      className="flex flex-col h-full bg-[#faf9fc] animate-in fade-in duration-200 overflow-hidden"
    >
      {/* 设置面板（底部 sheet，设置入口在底部操作栏） */}
      {showSettings && (
        <div
          className="fixed inset-0 z-[135] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 animate-in fade-in duration-200"
          onClick={() => setShowSettings(false)}
        >
          <div
            data-testid="walk-settings-sheet"
            className="bg-white rounded-2xl w-full max-w-md max-h-[70vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 shrink-0">
              <span className="text-[13.5px] font-semibold text-baimiao-mysteria font-serif baimiao-editorial-title">
                {t('randomWalk.settingsTitle')}
              </span>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-full transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto thin-scrollbar p-4 flex flex-col gap-4">
              <div>
                <p className="text-[11.5px] font-semibold text-stone-500 mb-1.5">{t('randomWalk.dataSources')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_SOURCES.map((src) => {
                    const on = sources.includes(src);
                    return (
                      <button
                        key={src}
                        data-testid={`walk-source-${src}`}
                        onClick={() => toggleSource(src)}
                        className={`px-3 py-1 rounded-full text-[12px] font-medium transition-all ${
                          on
                            ? 'bg-baimiao-mysteria text-white'
                            : 'bg-stone-100 text-stone-500'
                        }`}
                      >
                        {t(SOURCE_LABEL_KEYS[src])}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-[11.5px] font-semibold text-stone-500 shrink-0">{t('randomWalk.cooldown')}</p>
                <input
                  data-testid="walk-cooldown-input"
                  type="number"
                  min={0}
                  value={cooldownDays}
                  onChange={(e) => changeCooldown(Number(e.target.value))}
                  className="w-16 bg-stone-50 border border-stone-200 rounded-lg px-2 py-1 text-[12px] text-stone-700 outline-none focus:border-baimiao-mysteria/40"
                />
                <span className="text-[11px] text-stone-400">{t('randomWalk.cooldownUnit')}</span>
              </div>
              {/* Issue 002：换一批按钮从底部栏移到设置面板底部 */}
              <button
                data-testid="walk-shuffle"
                onClick={() => { setShowSettings(false); draw(); }}
                className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl text-[12.5px] font-medium text-white bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] hover:brightness-110 transition-all active:scale-[0.98]"
              >
                <Shuffle className="w-3.5 h-3.5" />
                {t('randomWalk.shuffle')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 卡片堆叠区（Swiper + EffectCards 扇形堆叠）。
          顶部细栏已移除，卡片整体在剩余空间中居中（略上移）。 */}
      <div className="flex-1 overflow-hidden relative px-5 pt-1 pb-5 flex items-start justify-center min-h-0">
        {loading ? (
          <div className="text-[13px] text-stone-400">{t('randomWalk.loading')}</div>
        ) : ended ? (
          <div
            data-testid="walk-empty"
            className="flex flex-col items-center justify-center text-center select-none max-w-[280px]"
          >
            <div className="text-baimiao-mysteria/40 mb-4 bg-white p-3 rounded-xl shadow-[0_2px_10px_rgba(27,25,56,0.05)] border border-baimiao-mysteria/5">
              <Lightbulb className="w-6 h-6 stroke-[1.5px]" />
            </div>
            <p className="text-[14px] text-stone-700 font-medium mb-1 font-serif baimiao-editorial-title">
              {t('randomWalk.emptyTitle')}
            </p>
            <p className="text-[12px] text-stone-400 leading-relaxed mb-5">
              {t('randomWalk.emptyDesc')}
            </p>
            <div className="flex flex-col gap-2 w-full">
              <button
                data-testid="walk-shuffle"
                onClick={draw}
                className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full text-[13px] font-medium text-white bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] hover:brightness-110 transition-all"
              >
                <Shuffle className="w-4 h-4" />
                {t('randomWalk.shuffle')}
              </button>
              <button
                data-testid="walk-reset"
                onClick={handleResetHistory}
                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-[12.5px] font-medium text-stone-600 bg-white border border-stone-200 hover:bg-stone-50 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t('randomWalk.resetHistory')}
              </button>
            </div>
          </div>
        ) : (
          <Swiper
            effect="cards"
            modules={[EffectCards]}
            grabCursor
            className="walk-swiper w-full h-full max-w-[23rem]"
            onSwiper={(sw) => { swiperRef.current = sw; }}
            onSlideChange={(sw) => setCurrentIndex(sw.activeIndex)}
          >
            {items.map((item, index) => (
              <SwiperSlide key={item.key} className="overflow-hidden">
                <div
                  data-testid="walk-card"
                  data-active={index === currentIndex ? 'true' : 'false'}
                  data-walk-type={item.type}
                  data-walk-key={item.key}
                  data-walk-opacity={index === currentIndex ? '1' : '0.4'}
                  className={`w-full h-full baimiao-card-bubble p-5 flex flex-col transition-opacity duration-200 relative ${
                    index === currentIndex ? 'opacity-100' : 'opacity-40'
                  }`}
                >
                  {/* Issue 002：移除 chip 行（类型徽章 + 时间戳），减少视觉干扰。 */}

                  {/* 摘要标题（回顾/洞察） */}
                  {item.title && (
                    <p className="text-[12.5px] font-semibold text-baimiao-mysteria/80 mb-2 font-serif baimiao-editorial-title shrink-0">
                      {item.title}
                    </p>
                  )}

                  {/* 内容区（正文 + 多媒体附件共用一个局部滚动区，底部渐变遮罩）。
                      附件为主记录的正文是 [多媒体记录] 占位，过滤掉不渲染，只显示附件区。 */}
                  {(() => {
                    const hasBodyText = !!item.content.trim() && !isMultimediaPlaceholder(item.content);
                    const hasAttachments = !!item.attachments && item.attachments.length > 0;
                    return (
                      <div className="flex-1 relative min-h-0">
                        <div
                          ref={(el) => { contentRefs.current[index] = el; }}
                          data-testid="walk-card-content"
                          className="w-full h-full overflow-y-auto thin-scrollbar markdown-body prose prose-stone baimiao-editorial-body prose-headings:font-serif baimiao-editorial-title max-w-none text-[13.5px] leading-relaxed prose-h1:text-[16px] prose-h2:text-[15px] prose-h3:text-[14px]"
                        >
                          {hasBodyText && <ReactMarkdown>{item.content}</ReactMarkdown>}
                          {hasAttachments && (
                            <WalkAttachments
                              attachments={item.attachments!}
                              attachmentSummary={item.attachmentSummary}
                              onOpenPreview={(items, initialIndex) => setMediaPreview({ items, initialIndex })}
                            />
                          )}
                        </div>
                        {index === currentIndex && contentOverflow && (
                          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-white via-white/80 to-transparent rounded-b-lg" />
                        )}
                      </div>
                    );
                  })()}

                  {/* 标签 */}
                  {item.tags.length > 0 && (
                    <div
                      data-testid="walk-card-tags"
                      className="flex items-center gap-1 flex-wrap mt-3 pt-2 border-t border-black/[0.04] shrink-0"
                    >
                      {item.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-0.5 bg-baimiao-mysteria/8 text-baimiao-mysteria text-[10.5px] px-1.5 py-0.5 rounded-full"
                        >
                          <Hash className="w-2.5 h-2.5 opacity-60" />
                          {tag.split('/').pop()}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 滑动提示 */}
                  {index === currentIndex && (
                    <div className="flex items-center justify-center gap-1 mt-2 text-[10px] text-stone-300 shrink-0">
                      <ChevronRight className="w-3 h-3" />
                      {t('randomWalk.swipeHint')}
                    </div>
                  )}
                </div>
              </SwiperSlide>
            ))}
          </Swiper>
        )}
      </div>

      {/* 底部操作栏（方形圆角图标浮钮，排列在内容卡下方；删除用主配色强调） */}
      {!ended && current && !showTagSheet && (
        <div className="shrink-0 px-4 pb-3 pt-1">
          <div className="flex items-center justify-center gap-2.5 max-w-md mx-auto">
            {/* #116 需求 7：移除底部「已阅」按钮（handleRead 与 read 过滤逻辑保留供后续复用）。 */}
            <button
              data-testid="walk-tags"
              onClick={() => setShowTagSheet(true)}
              title={t('randomWalk.tags')}
              aria-label={t('randomWalk.tags')}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-stone-100 text-stone-500 hover:bg-baimiao-mysteria/10 hover:text-baimiao-mysteria transition-colors active:scale-95"
            >
              <Hash className="w-[18px] h-[18px]" />
            </button>
            <button
              data-testid="walk-edit"
              onClick={() => openEdit(current)}
              title={t('randomWalk.edit')}
              aria-label={t('randomWalk.edit')}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-stone-100 text-stone-500 hover:bg-baimiao-mysteria/10 hover:text-baimiao-mysteria transition-colors active:scale-95"
            >
              <Pencil className="w-[18px] h-[18px]" />
            </button>
            <button
              data-testid="walk-copy"
              onClick={handleCopy}
              title={copied ? t('record.copied') : t('record.copyContent')}
              aria-label={copied ? t('record.copied') : t('record.copyContent')}
              className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors active:scale-95 ${
                copied
                  ? 'bg-emerald-500 text-white'
                  : 'bg-stone-100 text-stone-500 hover:bg-baimiao-mysteria/10 hover:text-baimiao-mysteria'
              }`}
            >
              {copied ? <Check className="w-[18px] h-[18px]" /> : <Copy className="w-[18px] h-[18px]" />}
            </button>
            <button
              data-testid="walk-settings"
              onClick={() => setShowSettings((v) => !v)}
              title={t('randomWalk.settingsTitle')}
              aria-label={t('randomWalk.settingsTitle')}
              className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors active:scale-95 ${
                showSettings
                  ? 'bg-baimiao-mysteria/15 text-baimiao-mysteria'
                  : 'bg-stone-100 text-stone-500 hover:bg-baimiao-mysteria/10 hover:text-baimiao-mysteria'
              }`}
            >
              <Settings2 className="w-[18px] h-[18px]" />
            </button>
            <button
              data-testid="walk-delete"
              onClick={handleDelete}
              title={t('randomWalk.delete')}
              aria-label={t('randomWalk.delete')}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] text-white shadow-sm shadow-baimiao-mysteria/20 hover:brightness-110 transition-all active:scale-95"
            >
              <Trash2 className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>
      )}

      {/* 标签查看 / 编辑 sheet */}
      {showTagSheet && current && (
        <div
          className="fixed inset-0 z-[140] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 animate-in fade-in duration-200"
          onClick={() => {
            setShowTagSheet(false);
            setTagInput('');
          }}
        >
          <div
            data-testid="walk-tag-sheet"
            className="bg-white rounded-2xl w-full max-w-md max-h-[70vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 shrink-0">
              <span className="text-[13.5px] font-semibold text-baimiao-mysteria font-serif baimiao-editorial-title">
                {t('randomWalk.tagSheetTitle', { type: current.typeLabel })}
              </span>
              <button
                onClick={() => {
                  setShowTagSheet(false);
                  setTagInput('');
                }}
                className="p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-full transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto thin-scrollbar p-4 flex flex-col gap-3">
              {current.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {current.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 bg-baimiao-mysteria/8 text-baimiao-mysteria text-[12px] px-2.5 py-1 rounded-full"
                    >
                      <Hash className="w-3 h-3 opacity-60" />
                      {tag}
                      {canEditTags && (
                        <button
                          data-testid="walk-tag-remove"
                          onClick={() => handleRemoveTag(tag)}
                          className="ml-0.5 text-baimiao-mysteria/50 hover:text-rose-500 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[12.5px] text-stone-400">{t('randomWalk.noTags')}</p>
              )}

              {canEditTags ? (
                <div className="flex items-center gap-2">
                  <input
                    data-testid="walk-tag-add-input"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddTag();
                    }}
                    placeholder={t('randomWalk.tagPlaceholder')}
                    className="flex-1 bg-stone-50 border border-stone-200 rounded-lg px-3 py-1.5 text-[12.5px] text-stone-700 outline-none focus:border-baimiao-mysteria/40"
                  />
                  <button
                    data-testid="walk-tag-add"
                    onClick={handleAddTag}
                    disabled={!tagInput.trim()}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-white bg-baimiao-mysteria hover:brightness-110 transition-all disabled:opacity-40"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t('randomWalk.addTag')}
                  </button>
                </div>
              ) : current.type === 'thoughts' ? (
                <p className="text-[11px] text-stone-400 leading-relaxed">
                  {t('randomWalk.thoughtsTagHint')}
                </p>
              ) : (
                <p className="text-[11px] text-stone-400 leading-relaxed">
                  {t('randomWalk.unsupportedTags')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 图片/视频全屏预览 */}
      {mediaPreview && (
        <MediaPreview
          items={mediaPreview.items}
          initialIndex={mediaPreview.initialIndex}
          onClose={() => setMediaPreview(null)}
        />
      )}

      {/* 编辑弹窗（RichEditor，不跳转页面，不显示/不修改展示时间） */}
      {editingItem && (
        <div
          data-testid="walk-edit-modal"
          className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 animate-in fade-in duration-200"
          onClick={closeEdit}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-md max-h-[88vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹窗头 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 shrink-0">
              <span className="text-[13.5px] font-semibold text-baimiao-mysteria font-serif baimiao-editorial-title">
                {t('randomWalk.editTitle')}
              </span>
              <button
                onClick={closeEdit}
                className="p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-full transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 弹窗内容（可滚动） */}
            <div className="flex-1 overflow-y-auto thin-scrollbar p-3 flex flex-col gap-3 min-h-0">
              <RichEditor
                value={editContent}
                onChange={setEditContent}
                attachments={canEditAttachments ? editAttachments : []}
                onAttachmentsChange={canEditAttachments ? setEditAttachments : undefined}
                minHeightClass="min-h-[160px]"
                textareaTestId="walk-edit-textarea"
                onAttachmentPreview={(items, initialIndex) => setMediaPreview({ items, initialIndex })}
                attachmentSummary={editingItem.type === 'raw_logs' ? editingItem.attachmentSummary : undefined}
              />
            </div>

            {/* 弹窗操作栏 */}
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-stone-100 shrink-0">
              <button
                onClick={closeEdit}
                className="px-3.5 py-1.5 rounded-full text-[12.5px] font-medium text-stone-600 bg-white border border-stone-200 hover:bg-stone-50 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                data-testid="walk-edit-save"
                onClick={handleSaveEdit}
                disabled={editSaving || (!editContent.trim() && !(canEditAttachments && editAttachments.length > 0))}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12.5px] font-medium text-white bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Save className="w-3.5 h-3.5" />
                {t('record.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
