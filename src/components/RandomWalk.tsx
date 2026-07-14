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
  Eye,
  Hash,
  Pencil,
  Copy,
  Check,
  Trash2,
  Settings2,
  Plus,
  Clock,
  RotateCcw,
  ChevronRight,
  X,
  Save,
} from 'lucide-react';
import { db, type Thought, type RawLog, type DailyReview, type Mingwu, type AttachmentMeta } from '../db/db';
import { useTagsStore } from '../store/tags.store';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { normalizeTagPath } from '../lib/tags';
import { useTranslation } from '../lib/i18n';
import RichEditor from './RichEditor';

type SourceType = 'raw_logs' | 'thoughts' | 'daily_reviews' | 'mingwu';

const ALL_SOURCES: SourceType[] = ['raw_logs', 'thoughts', 'daily_reviews', 'mingwu'];

/** 翻译函数类型（与 i18n.ts 的 t 签名一致） */
type TFunc = (key: string, params?: Record<string, string | number>) => string;

/** 数据源 -> TabBar 标签 key 映射 */
const SOURCE_LABEL_KEYS: Record<SourceType, string> = {
  raw_logs: 'tab.record',
  thoughts: 'tab.thoughts',
  daily_reviews: 'tab.review',
  mingwu: 'tab.mingwu',
};

const LS_SOURCES = 'random-walk-sources';
const LS_SHOWN = 'random-walk-shown';
const LS_COOLDOWN = 'random-walk-cooldown-days';

const DEFAULT_SOURCES: SourceType[] = ['thoughts', 'daily_reviews'];
const DEFAULT_COOLDOWN_DAYS = 7;
const DRAW_COUNT = 3;

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
  title?: string; // 回顾/明悟的一句话摘要
  createdAt: number;
  tags: string[];
  reviewDate?: string; // daily_reviews 的 review_date
  rawText: string; // 复制用的纯文本
  typeLabel: string;
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
  mingwu: Mingwu[],
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
  if (sources.includes('mingwu')) {
    for (const m of mingwu) {
      if (!m.id) continue;
      items.push({
        key: `mingwu:${m.id}`,
        type: 'mingwu',
        id: m.id,
        content: m.content,
        title: m.ai_summary,
        createdAt: m.created_at,
        tags: [],
        rawText: m.content,
        typeLabel: m.mingwu_type === 'insight' ? tf('mingwu.insight') : tf('mingwu.mingwu'),
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

export default function RandomWalk() {
  const { copied, copy } = useCopyToClipboard();
  const createTag = useTagsStore((s) => s.createTag);
  const { t } = useTranslation();

  // --- 数据源（live query，始终保持最新，draw 时读取） ---
  const allThoughts = useLiveQuery(() => db.thoughts.toArray(), []);
  const allRawLogs = useLiveQuery(() => db.raw_logs.toArray(), []);
  const allReviews = useLiveQuery(() => db.daily_reviews.toArray(), []);
  const allMingwu = useLiveQuery(() => db.mingwu.toArray(), []);

  // 用 ref 持有最新数据，draw 闭包始终读到最新值
  const dataRef = useRef({ thoughts: [] as Thought[], rawLogs: [] as RawLog[], reviews: [] as DailyReview[], mingwu: [] as Mingwu[] });
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

  // --- Swiper 实例 ---
  const swiperRef = useRef<SwiperClass | null>(null);

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
      case 'mingwu':
        await db.mingwu.delete(current.id);
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
    } else if (item.type === 'mingwu') {
      const rec = await db.mingwu.get(item.id);
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
      } else if (editingItem.type === 'mingwu') {
        await db.mingwu.update(editingItem.id, { content: editContent });
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
      {/* 顶部细栏：计数 + 数据源设置（标题与 × 关闭在全局 header） */}
      <div className="flex h-[40px] shrink-0 items-center px-4 bg-white/85 backdrop-blur border-b border-baimiao-border/40 z-20 justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <Lightbulb className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          {items.length > 0 && !ended ? (
            <span className="text-[11.5px] font-medium text-stone-500 font-mono">
              {currentIndex + 1}/{items.length}
            </span>
          ) : (
            <span className="text-[11.5px] font-medium text-stone-400">{t('randomWalk.title')}</span>
          )}
        </div>
        <button
          data-testid="walk-settings"
          onClick={() => setShowSettings((v) => !v)}
          className={`p-1.5 rounded-full transition-colors ${
            showSettings
              ? 'text-baimiao-mysteria bg-baimiao-mysteria/8'
              : 'text-stone-400 hover:text-stone-700 hover:bg-stone-100'
          }`}
          title={t('randomWalk.settingsTitle')}
          aria-label={t('randomWalk.settingsTitle')}
        >
          <Settings2 className="w-4 h-4" />
        </button>
      </div>

      {/* 设置面板 */}
      {showSettings && (
        <div className="shrink-0 bg-white/90 backdrop-blur border-b border-baimiao-border/40 px-4 py-3 flex flex-col gap-3 animate-in slide-in-from-top-2 duration-200">
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
        </div>
      )}

      {/* 卡片堆叠区（Swiper + EffectCards 扇形堆叠） */}
      <div className="flex-1 overflow-hidden relative px-5 py-4 flex items-center justify-center min-h-0">
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
            className="walk-swiper w-full h-full max-w-md"
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
                  className="w-full h-full baimiao-card-bubble p-5 flex flex-col"
                >
                  {/* 类型徽章 + 时间 */}
                  <div className="flex items-center justify-between shrink-0 mb-3">
                    <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-baimiao-mysteria bg-baimiao-mysteria/8 px-2 py-0.5 rounded-full">
                      <Hash className="w-2.5 h-2.5 opacity-60" />
                      {item.typeLabel}
                    </span>
                    <span className="text-[10.5px] text-stone-400 font-mono flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {item.reviewDate
                        ? item.reviewDate
                        : format(new Date(item.createdAt), 'MM-dd HH:mm')}
                    </span>
                  </div>

                  {/* 摘要标题（回顾/明悟） */}
                  {item.title && (
                    <p className="text-[12.5px] font-semibold text-baimiao-mysteria/80 mb-2 font-serif baimiao-editorial-title shrink-0">
                      {item.title}
                    </p>
                  )}

                  {/* 正文（局部滚动，移动端红线） */}
                  <div
                    data-testid="walk-card-content"
                    className="flex-1 overflow-y-auto thin-scrollbar markdown-body prose prose-stone baimiao-editorial-body prose-headings:font-serif baimiao-editorial-title max-w-none text-[13.5px] leading-relaxed prose-h1:text-[16px] prose-h2:text-[15px] prose-h3:text-[14px] min-h-0"
                  >
                    <ReactMarkdown>{item.content}</ReactMarkdown>
                  </div>

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

      {/* 底部操作栏（单排：已阅/标签/编辑/复制/删除/换一批） */}
      {!ended && current && !showTagSheet && (
        <div className="shrink-0 border-t border-baimiao-border/40 bg-white/90 backdrop-blur px-2 py-2">
          <div className="flex items-center justify-around max-w-md mx-auto">
            <button
              data-testid="walk-read"
              onClick={handleRead}
              className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl text-stone-500 hover:bg-stone-100 hover:text-baimiao-mysteria transition-colors"
            >
              <Eye className="w-5 h-5" />
              <span className="text-[10.5px] font-medium">{t('randomWalk.read')}</span>
            </button>
            <button
              data-testid="walk-tags"
              onClick={() => setShowTagSheet(true)}
              className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl text-stone-500 hover:bg-stone-100 hover:text-baimiao-mysteria transition-colors"
            >
              <Hash className="w-5 h-5" />
              <span className="text-[10.5px] font-medium">{t('randomWalk.tags')}</span>
            </button>
            <button
              data-testid="walk-edit"
              onClick={() => openEdit(current)}
              className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl text-stone-500 hover:bg-stone-100 hover:text-baimiao-mysteria transition-colors"
            >
              <Pencil className="w-5 h-5" />
              <span className="text-[10.5px] font-medium">{t('randomWalk.edit')}</span>
            </button>
            <button
              data-testid="walk-copy"
              onClick={handleCopy}
              className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-colors ${
                copied
                  ? 'text-emerald-600 bg-emerald-50'
                  : 'text-stone-500 hover:bg-stone-100 hover:text-baimiao-mysteria'
              }`}
            >
              {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
              <span className="text-[10.5px] font-medium">{copied ? t('record.copied') : t('record.copyContent')}</span>
            </button>
            <button
              data-testid="walk-delete"
              onClick={handleDelete}
              className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl text-stone-500 hover:bg-rose-50 hover:text-rose-500 transition-colors"
            >
              <Trash2 className="w-5 h-5" />
              <span className="text-[10.5px] font-medium">{t('randomWalk.delete')}</span>
            </button>
            <button
              data-testid="walk-shuffle"
              onClick={draw}
              className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl text-baimiao-mysteria hover:bg-baimiao-mysteria/8 transition-colors"
            >
              <Shuffle className="w-5 h-5" />
              <span className="text-[10.5px] font-medium">{t('randomWalk.shuffle')}</span>
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
