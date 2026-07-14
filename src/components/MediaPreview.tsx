/**
 * 需求 7：图片/视频全屏预览组件。
 *
 * 行为：
 * - 应用容器内（max-w-md）全屏，覆盖顶部标题栏和底部 TabBar。
 * - 图片：pinch 缩放 / 双击放大缩小 / 拖拽平移 / 左右滑动切换。
 * - 视频：自动播放、不静音、循环；左右滑动切换。
 * - 关闭：点遮罩 / 右上角 × / 电脑端 ESC。
 *
 * ref 兼容两种格式：data URL / http 外链（直接渲染）与 IndexedDB attachments store id（异步加载 Blob）。
 */
import { useState, useEffect, useRef } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { db, type AttachmentMeta } from '../db/db';
import { useTranslation } from '../lib/i18n';

/** 判断附件 ref 是否可直接作为 URL 渲染（data URL 或 http(s) 链接）。 */
function isDirectUrl(ref?: string): boolean {
  return !!ref && (ref.startsWith('data:') || ref.startsWith('http'));
}

/**
 * 加载附件 Blob 并返回 object URL。
 * data URL / http 链接直接返回；IndexedDB store id 异步加载 Blob 转 object URL。
 * 组件卸载或 ref 变化时自动 revoke 上一个 URL。
 */
function useResolvedUrl(ref?: string): string | undefined {
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

interface MediaPreviewProps {
  items: AttachmentMeta[];
  initialIndex: number;
  onClose: () => void;
}

const SWIPE_THRESHOLD = 50;
const DOUBLE_TAP_MS = 300;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

export default function MediaPreview({ items, initialIndex, onClose }: MediaPreviewProps) {
  const { t } = useTranslation();
  const [currentIndex, setCurrentIndex] = useState(
    Math.max(0, Math.min(initialIndex, items.length - 1))
  );
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  // 触摸交互中禁用 transition（拖拽/缩放跟手），松手后恢复（回弹/定位平滑）
  const [interacting, setInteracting] = useState(false);

  const currentItem = items[currentIndex];
  const url = useResolvedUrl(currentItem?.ref);
  const isImage = currentItem?.kind === 'image';

  // 触摸状态（用 ref 避免闭包陈旧）
  const touchRef = useRef({
    startX: 0,
    startY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
    startScale: 1,
    pinchStartDist: 0,
    lastTapTime: 0,
    moved: false,
  });

  // 当前值的 ref（供触摸回调读取最新值，避免闭包陈旧）
  const stateRef = useRef({ scale, offset, currentIndex, itemsLen: items.length });
  useEffect(() => {
    stateRef.current = { scale, offset, currentIndex, itemsLen: items.length };
  }, [scale, offset, currentIndex, items.length]);

  // ESC 关闭
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // 切换 item 时重置缩放
  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [currentIndex]);

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < items.length - 1;

  /** 限制平移范围，避免图片被拖出可视区域。 */
  const clampOffset = (x: number, y: number, s: number) => {
    const rangeX = (s - 1) * 150;
    const rangeY = (s - 1) * 200;
    return {
      x: Math.max(-rangeX, Math.min(rangeX, x)),
      y: Math.max(-rangeY, Math.min(rangeY, y)),
    };
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const ts = touchRef.current;
    ts.moved = false;
    setInteracting(true);
    if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      ts.pinchStartDist = Math.hypot(dx, dy);
      ts.startScale = stateRef.current.scale;
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      ts.startX = touch.clientX;
      ts.startY = touch.clientY;
      ts.startOffsetX = stateRef.current.offset.x;
      ts.startOffsetY = stateRef.current.offset.y;
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const ts = touchRef.current;
    ts.moved = true;
    if (e.touches.length === 2 && isImage) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.hypot(dx, dy);
      const newScale = Math.max(
        1,
        Math.min(MAX_SCALE, (dist / (ts.pinchStartDist || 1)) * ts.startScale)
      );
      setScale(newScale);
      if (newScale === 1) setOffset({ x: 0, y: 0 });
    } else if (e.touches.length === 1 && stateRef.current.scale > 1 && isImage) {
      const touch = e.touches[0];
      const dx = touch.clientX - ts.startX;
      const dy = touch.clientY - ts.startY;
      const clamped = clampOffset(
        ts.startOffsetX + dx,
        ts.startOffsetY + dy,
        stateRef.current.scale
      );
      setOffset(clamped);
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    setInteracting(false);
    const ts = touchRef.current;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - ts.startX;
    const dy = touch.clientY - ts.startY;
    const isTap = !ts.moved || (Math.abs(dx) < 10 && Math.abs(dy) < 10);

    // 双击放大/缩小（仅图片）
    if (isImage && isTap) {
      const now = Date.now();
      if (now - ts.lastTapTime < DOUBLE_TAP_MS) {
        if (stateRef.current.scale > 1) {
          setScale(1);
          setOffset({ x: 0, y: 0 });
        } else {
          setScale(DOUBLE_TAP_SCALE);
        }
        ts.lastTapTime = 0;
        return;
      }
      ts.lastTapTime = now;
    }

    // 左右滑动切换（未缩放时）
    if (stateRef.current.scale === 1 && Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dy) < 100) {
      if (dx > 0 && stateRef.current.currentIndex > 0) {
        setCurrentIndex((i) => i - 1);
      } else if (dx < 0 && stateRef.current.currentIndex < stateRef.current.itemsLen - 1) {
        setCurrentIndex((i) => i + 1);
      }
    }
  };

  return (
    <div
      data-testid="media-preview"
      className="fixed inset-0 z-[200] w-full max-w-md mx-auto left-0 right-0 bg-black flex flex-col animate-in fade-in duration-200"
    >
      {/* 顶栏：位置指示 + 关闭按钮 */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 z-10">
        <span className="text-white/70 text-[13px] font-mono select-none">
          {currentIndex + 1} / {items.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('about.close')}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors active:scale-95"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* 媒体区：点击背景关闭，触摸处理滑动/缩放 */}
      <div
        className="flex-1 relative flex items-center justify-center overflow-hidden"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ touchAction: isImage ? 'none' : 'auto' }}
      >
        {!url ? (
          <div className="w-10 h-10 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
        ) : isImage ? (
          <img
            src={url}
            alt={currentItem?.name || t('record.image')}
            className="max-w-full max-h-full object-contain select-none"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              transition: interacting ? 'none' : 'transform 0.15s ease-out',
            }}
            draggable={false}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <video
            key={currentIndex}
            src={url}
            autoPlay
            loop
            playsInline
            controls
            className="max-w-full max-h-full object-contain"
            aria-label={currentItem?.name || t('record.video')}
            onClick={(e) => e.stopPropagation()}
          />
        )}

        {/* 桌面端左右导航箭头 */}
        {canGoPrev && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setCurrentIndex((i) => i - 1); }}
            aria-label={t('mediaPreview.prev')}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-10"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        {canGoNext && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setCurrentIndex((i) => i + 1); }}
            aria-label={t('mediaPreview.next')}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-10"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}
