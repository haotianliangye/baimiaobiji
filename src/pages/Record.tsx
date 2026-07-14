import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  startOfDay,
  endOfDay,
  format,
  parse,
  isSameDay,
  addDays,
  subDays,
} from "date-fns";
import {
  Mic,
  ArrowRight,
  Loader2,
  Copy,

  Edit2,
  Trash2,
  RefreshCw,
  Check,
  ListChecks,
  Keyboard,
  X,
  Sparkles,
  Clock,
  ShieldAlert,
  Paperclip,
  Image as ImageIcon,
  Music,
  Play,
  Video,
  Link as LinkIcon,
  FileUp,
} from "lucide-react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { db } from "../db/db";
import { generateUUID } from "../lib/utils";
import { countChars } from "../lib/wordCount";
import { useSettingsStore } from "../store/settings.store";
import { useAppStore } from "../store/app.store";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { parseTagsFromText, resolveAlias } from "../lib/tags";
import { useTagsStore } from "../store/tags.store";
import TodayStats from "../components/TodayStats";
import RichEditor from "../components/RichEditor";
import MediaPreview from "../components/MediaPreview";
import { saveAttachmentBlob, blobToBase64, generateAttachmentSummary, requestMultimediaSummary } from "../lib/multimedia";
import type { AttachmentMeta } from "../db/db";
import { useTranslation } from "../lib/i18n";

/** 待提交的附件（含原始 File，提交时转为 AttachmentMeta + Blob 存 IDB）。 */
interface PendingAttachment {
  id: string;
  kind: 'image' | 'audio' | 'video' | 'link' | 'file';
  file?: File;
  url?: string;
  name?: string;
  previewUrl?: string;
}

const AudioPlayer = ({ blob }: { blob: Blob | any }) => {
  const [url, setUrl] = React.useState<string | undefined>(undefined);
  
  React.useEffect(() => {
    if (!blob) return;
    let objectUrl: string | undefined;
    try {
      let finalBlob = blob;
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      
      if (blob && blob.type === "audio/webm" && isIOS) {
         // Fix old records on iOS Safari that were mislabeled as webm
         finalBlob = new Blob([blob], { type: "audio/mp4" });
      } else if (!(blob instanceof Blob) && blob && blob.size) {
          // Try wrapping in a new Blob if IndexedDB mutilated it
          finalBlob = new Blob([blob], { type: blob.type || (isIOS ? "audio/mp4" : "") });
      }

      objectUrl = URL.createObjectURL(finalBlob);
      if (objectUrl) {
         setUrl(objectUrl);
      }
    } catch(e) {
      console.error("Failed to create blob URL:", e);
    }
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [blob]);

  if (!url) return null;

  return (
    <audio
      controls
      controlsList="nodownload noplaybackrate"
      src={url}
      className="h-8 w-full opacity-60 grayscale hover:opacity-100 transition-opacity"
    />
  );
};

async function fetchTranscriptionWithRetry(body: any, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        return await res.json();
      }

      const errorText = await res.text();
      let errorData: any = { error: errorText };
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {}

      const finalError = errorData.error || errorData.message || "Server Error";
      const isHtmlFail = typeof finalError === "string" && (
        finalError.includes("<!") ||
        finalError.includes("JSON.parse") ||
        finalError.includes("Unexpected token '<'") ||
        finalError.includes("SyntaxError")
      );

      // It might be a proxy timeout during cold start. Let's retry!
      if (isHtmlFail && i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      
      throw new Error(finalError);
    } catch (err: any) {
      const msg = String(err.message || "");
      const isHtmlFail = msg.includes("<!") || msg.includes("JSON.parse") || msg.includes("Unexpected token '<'");
      if (isHtmlFail && i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      throw err;
    }
  }
}

/** 将 data URL 转为 Blob，用于编辑弹窗中新附件（RichEditor 以 data URL 形式暂存）落库。 */
function dataUrlToBlob(dataUrl: string): Blob {
  const commaIdx = dataUrl.indexOf(',');
  const meta = commaIdx >= 0 ? dataUrl.slice(0, commaIdx) : '';
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const mimeMatch = meta.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const binary = atob(base64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/**
 * #005 加载附件 Blob 并返回 object URL，用于卡片中渲染图片/视频/音频。
 * 组件卸载或 ref 变化时自动 revoke 上一个 URL。
 */
function useAttachmentUrl(ref?: string): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!ref) {
      setUrl(undefined);
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
  }, [ref]);
  return url;
}

/**
 * #005 单个图片/视频缩略图。
 * - 图片：object-fit cover，点击打开灯箱。
 * - 视频：preload metadata 显示首帧，叠加播放图标，点击播放。
 * - 无 AI 摘要时右下角显示单附件重试按钮。
 */
function MediaThumb({
  att,
  originalIndex,
  logId,
  isRetrying,
  onRetry,
  onOpenPreview,
}: {
  att: AttachmentMeta;
  originalIndex: number;
  logId: string;
  isRetrying: boolean;
  onRetry: (logId: string, originalIndex: number) => void;
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
      {/* 单附件重试按钮：无 summary 时显示在右下角 */}
      {!att.summary && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRetry(logId, originalIndex);
          }}
          disabled={isRetrying}
          className="absolute bottom-1 right-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-black/55 text-white text-[9px] font-medium backdrop-blur-sm hover:bg-black/70 transition-colors disabled:opacity-50"
        >
          {isRetrying ? (
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
          ) : (
            <RefreshCw className="w-2.5 h-2.5" />
          )}
          {t('record.regenerateSummary')}
        </button>
      )}
    </div>
  );
}

/**
 * #005 单个音频附件播放器 + 重试按钮。
 * 转写失败时播放器右侧显示"重新转写"按钮。
 */
function AudioAttachmentItem({
  att,
  originalIndex,
  logId,
  isRetrying,
  failed,
  onRetry,
}: {
  att: AttachmentMeta;
  originalIndex: number;
  logId: string;
  isRetrying: boolean;
  failed: boolean;
  onRetry: (logId: string, originalIndex: number) => void;
}) {
  const { t } = useTranslation();
  const url = useAttachmentUrl(att.ref);

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        {url ? (
          <audio
            controls
            controlsList="nodownload noplaybackrate"
            src={url}
            className="h-8 w-full opacity-60 grayscale hover:opacity-100 transition-opacity"
          />
        ) : (
          <div className="h-8 w-full bg-stone-100 rounded animate-pulse" />
        )}
      </div>
      {failed && (
        <button
          type="button"
          onClick={() => onRetry(logId, originalIndex)}
          disabled={isRetrying}
          className="shrink-0 flex items-center gap-0.5 px-1.5 py-1 rounded-md text-stone-400 hover:text-indigo-500 hover:bg-stone-100 text-[10px] font-medium transition-colors disabled:opacity-50"
        >
          {isRetrying ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          {t('record.retranscribe')}
        </button>
      )}
    </div>
  );
}

/**
 * #005 碎屑卡片多媒体渲染区。
 * - 图片/视频：2×2 网格(16:9, cover, 最多4张, 超出 +N)，单张 16:9 撑满。
 * - 音频：纵向列表播放器控件。
 * - 摘要区：媒体下方，次要文本色，最多3行截断。
 *   生成中 "AI 摘要生成中…"，失败 "摘要生成失败·重新生成"。
 */
function MultimediaAttachments({
  log,
  isGenerating,
  retryingIds,
  onRetryAttachment,
  onRetryAudio,
  onOpenPreview,
  onOpenDetail,
}: {
  log: any;
  isGenerating: boolean;
  retryingIds: Set<string>;
  onRetryAttachment: (logId: string, originalIndex: number) => void;
  onRetryAudio: (logId: string, originalIndex: number) => void;
  onOpenPreview: (items: AttachmentMeta[], initialIndex: number) => void;
  onOpenDetail: (log: any) => void;
}) {
  const { t } = useTranslation();
  const attachments: AttachmentMeta[] = log.attachments || [];

  // 按类型分组，保留原始索引
  const mediaItems = attachments
    .map((att, idx) => ({ att, originalIndex: idx }))
    .filter(({ att }) => att.kind === 'image' || att.kind === 'video');
  const audioItems = attachments
    .map((att, idx) => ({ att, originalIndex: idx }))
    .filter(({ att }) => att.kind === 'audio');
  const linkItems = attachments.filter((a) => a.kind === 'link');

  // 摘要状态：none(无媒体) / generating / failed / ready
  const hasMedia = mediaItems.length > 0;
  const summaryState: 'none' | 'generating' | 'failed' | 'ready' = !hasMedia
    ? 'none'
    : log.attachment_summary
      ? 'ready'
      : isGenerating
        ? 'generating'
        : 'failed';

  const handleRetryAll = () => {
    mediaItems.forEach(({ originalIndex }) => {
      if (!attachments[originalIndex].summary) {
        onRetryAttachment(log.id, originalIndex);
      }
    });
  };

  const visibleMedia = mediaItems.slice(0, 4);
  const overflowCount = mediaItems.length - 4;
  const isSingle = visibleMedia.length === 1;
  const hasAudio = audioItems.length > 0;
  const hasLink = linkItems.length > 0;
  const showSummary = summaryState !== 'none';
  // 音频转写失败标记：仅当 content 含失败标记时才显示"重新转写"按钮
  const audioTranscribeFailed = (log.content || '').includes(t('record.audioTranscribeFailed'));

  return (
    <div className="mt-2 w-full" data-attachment-region>
      {/* 图片/视频网格 */}
      {visibleMedia.length > 0 && (
        <div className={isSingle ? 'w-full' : 'grid grid-cols-2 gap-1'}>
          {visibleMedia.map(({ att, originalIndex }, i) => {
            const showOverflow = i === 3 && overflowCount > 0;
            return (
              <div key={originalIndex} className="relative">
                <MediaThumb
                  att={att}
                  originalIndex={originalIndex}
                  logId={log.id}
                  isRetrying={retryingIds.has(`${log.id}-${originalIndex}`)}
                  onRetry={onRetryAttachment}
                  onOpenPreview={() => onOpenPreview(mediaItems.map(({ att: a }) => a), i)}
                />
                {showOverflow && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onOpenDetail(log); }}
                    className="absolute inset-0 bg-black/50 flex items-center justify-center text-white font-semibold text-[15px] rounded-lg transition-colors hover:bg-black/60"
                  >
                    {t('record.moreCount', { count: overflowCount })}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 音频列表 */}
      {hasAudio && (
        <div className={`flex flex-col gap-2 ${visibleMedia.length > 0 ? 'mt-2' : ''}`}>
          {audioItems.map(({ att, originalIndex }) => (
            <AudioAttachmentItem
              key={originalIndex}
              att={att}
              originalIndex={originalIndex}
              logId={log.id}
              isRetrying={retryingIds.has(`${log.id}-${originalIndex}`)}
              failed={audioTranscribeFailed}
              onRetry={onRetryAudio}
            />
          ))}
        </div>
      )}

      {/* 链接附件 */}
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

      {/* AI 摘要区 */}
      {showSummary && summaryState === 'ready' && log.attachment_summary && (
        <p className="mt-2 text-[15.5px] leading-relaxed text-stone-500 line-clamp-3 break-words">
          {log.attachment_summary}
        </p>
      )}
      {showSummary && summaryState === 'generating' && (
        <div className="mt-2 flex items-center gap-1.5 text-[12px] text-stone-400">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>{t('record.aiSummaryGenerating')}</span>
        </div>
      )}
      {showSummary && summaryState === 'failed' && (
        <div className="mt-2 flex items-center gap-1.5 text-[12px]">
          <span className="text-stone-400">{t('record.summaryFailed')}</span>
          <span className="text-stone-300">·</span>
          <button
            type="button"
            onClick={handleRetryAll}
            className="text-indigo-500 hover:text-indigo-600 font-medium transition-colors"
          >
            {t('record.regenerateSummary')}
          </button>
        </div>
      )}
    </div>
  );
}

export default function Record() {
  const { t } = useTranslation();
  const [isPersisted, setIsPersisted] = useState<boolean | null>(null);
  const syncStatus = useAppStore(state => state.syncStatus);
  const syncErrorMessage = useAppStore(state => state.syncErrorMessage);
  const { copied, copy } = useCopyToClipboard();
  const navigate = useNavigate();
  const [inputText, setInputText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [hideStorageWarning, setHideStorageWarning] = useState(false);

  useEffect(() => {
    async function checkPersist() {
      try {
        const { checkStorageStatus } = await import("../lib/storage");
        const status = await checkStorageStatus();
        setIsPersisted(status.persisted);
      } catch (e) {
        console.error("Storage persist check failed", e);
      }
    }
    checkPersist();
  }, []);
  const [searchParams, setSearchParams] = useSearchParams();

  // Action sheet & edit states
  const [activeLog, setActiveLog] = useState<any>(null);
  const [isEditingModalOpen, setIsEditingModalOpen] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editAttachments, setEditAttachments] = useState<AttachmentMeta[]>([]);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);

  // New multi-select & context menu states
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedLogIds, setSelectedLogIds] = useState<Set<string>>(new Set());
  const [contextMenuState, setContextMenuState] = useState<{
    isOpen: boolean;
    log: any;
    x: number;
    y: number;
  }>({
    isOpen: false,
    log: null,
    x: 0,
    y: 0,
  });

  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const holdTimeoutRef = useRef<any>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMicInitializingRef = useRef(false);
  const isCancelledRef = useRef(false);

  // #6 多媒体附件状态
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [showAttachmentSheet, setShowAttachmentSheet] = useState(false);
  // 需求 8：面板上推主内容 + 下滑关闭
  const [sheetHeight, setSheetHeight] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetDragStartY = useRef<number | null>(null);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  // #005 多媒体卡片渲染状态
  const [generatingSummaryIds, setGeneratingSummaryIds] = useState<Set<string>>(new Set());
  const [retryingAttachmentIds, setRetryingAttachmentIds] = useState<Set<string>>(new Set());
  const [mediaPreview, setMediaPreview] = useState<{ items: AttachmentMeta[]; initialIndex: number } | null>(null);
  const [detailLog, setDetailLog] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileAccept, setFileAccept] = useState("");

  const today = new Date();
  const dateParam = searchParams.get("date");

  let targetDate = today;
  if (dateParam) {
    const parsed = parse(dateParam, "yyyy-MM-dd", new Date());
    if (!isNaN(parsed.getTime())) {
      targetDate = parsed;
    }
  }

  const start = startOfDay(targetDate).getTime();
  const end = endOfDay(targetDate).getTime();
  const dateStr = format(targetDate, "yyyy-MM-dd");
  const isTodayDate = isSameDay(targetDate, today);

  const navigateToDate = (offset: number) => {
    const newDate =
      offset > 0
        ? addDays(targetDate, offset)
        : subDays(targetDate, Math.abs(offset));
    setSearchParams({ date: format(newDate, "yyyy-MM-dd") });
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const diffX = e.changedTouches[0].clientX - touchStartX.current;
    const diffY = e.changedTouches[0].clientY - touchStartY.current;

    // Detect horizontal swipes
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 60) {
      if (diffX > 0) {
        // Swipe Right -> navigate to previous date
        navigateToDate(-1);
      } else {
        // Swipe Left -> navigate to next date (cannot exceed today)
        if (!isTodayDate) {
          navigateToDate(1);
        }
      }
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  const logs = useLiveQuery(
    () =>
      db.raw_logs.where("created_at").between(start, end).sortBy("created_at"),
    [start, end],
  );

  const dailyChars = useMemo(() => {
    return (logs || []).reduce((sum, log) => sum + countChars(log.content), 0);
  }, [logs]);

  const adjustTextareaHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, window.innerHeight * 0.5)}px`;
    }
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [inputText, adjustTextareaHeight]);

  // 需求 8：面板打开后测量高度，用于上推主内容
  useEffect(() => {
    if (showAttachmentSheet && sheetRef.current) {
      const measure = () => {
        if (sheetRef.current) {
          setSheetHeight(sheetRef.current.offsetHeight);
        }
      };
      requestAnimationFrame(measure);
    } else {
      setSheetHeight(0);
    }
  }, [showAttachmentSheet]);

  // #4 标签：确保别名缓存已加载（供保存时 resolveAlias 纠正被合并的标签）
  const refreshAliases = useTagsStore(state => state.refreshAliases);
  useEffect(() => { refreshAliases(); }, [refreshAliases]);

  /**
   * #4 从文本解析 #标签，经别名纠正后落库标签定义，返回最终标签路径数组。
   * 在文本提交、语音转写保存、编辑保存三处调用。
   */
  const processTags = async (text: string): Promise<string[]> => {
    const store = useTagsStore.getState();
    // 确保别名缓存是最新的（防止刚加载页面时别名尚未加载）
    await store.refreshAliases();
    const aliases = useTagsStore.getState().aliases;
    const rawTags = parseTagsFromText(text);
    if (rawTags.length === 0) return [];
    const resolved = rawTags.map(t => resolveAlias(t, aliases));
    for (const tag of resolved) {
      await store.createTag(tag);
    }
    return resolved;
  };

  const handleToggleListen = async () => {
    if (isMicInitializingRef.current) return;

    if (isListening && recognitionRef.current) {
      if (typeof recognitionRef.current.stop === "function") {
         try { recognitionRef.current.stop(); } catch(e) {}
      } else {
        const recorder = recognitionRef.current as MediaRecorder;
        if (recorder.state === "recording") {
          recorder.stop();
        }
      }
      setIsListening(false);
      return;
    }

    isMicInitializingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Double check if microphone track is actually enabled and active
      const audioTrack = stream.getAudioTracks()[0];
      if (
        !audioTrack ||
        audioTrack.readyState !== "live" ||
        !audioTrack.enabled
      ) {
        throw new Error("麦克风流未激活或被禁用");
      }

      let mediaRecorder: MediaRecorder;
      try {
         mediaRecorder = new MediaRecorder(stream);
      } catch (e) {
         console.error("Failed to initialize MediaRecorder:", e);
         throw e;
      }
      recognitionRef.current = mediaRecorder;
      const audioChunks: BlobPart[] = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      const startTime = Date.now();

      let stopTime: number | null = null;
      let hasPropagatedStop = false;
      
      const safelyStopRecorder = () => {
        if (!stopTime) stopTime = Date.now();
        if (!hasPropagatedStop) {
          hasPropagatedStop = true;
          try {
            if (mediaRecorder.state !== "inactive") {
               mediaRecorder.stop();
            }
          } catch(e) {}
        }
        setIsListening(false);
        if (recordingIntervalRef.current) {
          clearInterval(recordingIntervalRef.current);
          recordingIntervalRef.current = null;
        }
      };

      recognitionRef.current = {
         stop: safelyStopRecorder,
         get state() { return mediaRecorder.state; }
      };

      mediaRecorder.onstop = async () => {
        safelyStopRecorder(); // Ensure UI state is stopped

        let mimeType = mediaRecorder.mimeType;
        if (!mimeType) {
           const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
           mimeType = isIOS ? "audio/mp4" : "audio/webm";
        }
        const audioBlob = new Blob(audioChunks, { type: mimeType });
        stream.getTracks().forEach((track) => track.stop());

        if (isCancelledRef.current) {
          isCancelledRef.current = false;
          setIsSubmitting(false);
          return;
        }

        setIsSubmitting(true);
        try {
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            try {
              const base64data = (reader.result as string).split(",")[1];
              const settings = useSettingsStore.getState();

              let transcribedText = t('record.voiceRecord');
              try {
                const data = await fetchTranscriptionWithRetry({
                  audio_base64: base64data,
                  mime_type: mimeType,
                  settings,
                });
                if (data && data.text) {
                  transcribedText = data.text;
                } else {
                  transcribedText = t('record.voiceUnrecognized');
                }
              } catch (e: any) {
                console.error("Transcription API error:", e);
                const msg = String(e.message || "");
                if (
                  msg.includes("Unexpected token '<'") ||
                  msg.includes("is not valid JSON") ||
                  msg.includes("JSON.parse: unexpected character") ||
                  msg.includes("SyntaxError:")
                ) {
                  transcribedText = t('record.voiceParseFailedHtml');
                } else {
                  transcribedText = t('record.voiceParseFailed', { msg });
                }
              }

              const finalDuration = Math.floor(((stopTime || Date.now()) - startTime) / 1000);

              // #4 解析转写文本中的 #标签
              const transcribedTags = await processTags(transcribedText);

              let saveSuccess = false;
              try {
                await db.raw_logs.add({
                  id: generateUUID(),
                  content: transcribedText,
                  created_at: Date.now(),
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  audioBlob: audioBlob,
                  audioDuration: finalDuration > 0 ? finalDuration : undefined,
                  tags: transcribedTags,
                });
                saveSuccess = true;
              } catch (dbErr: any) {
                console.error("Failed to add blob to IndexedDB:", dbErr);
                // Fallback: save without blob if blob cloning fails
                await db.raw_logs.add({
                  id: generateUUID(),
                  content: `${transcribedText} ${t('record.audioSaveFailed', { msg: dbErr.message || '' })}`,
                  created_at: Date.now(),
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  audioDuration: finalDuration > 0 ? finalDuration : undefined,
                  tags: transcribedTags,
                });
                saveSuccess = true;
              }

              if (saveSuccess && endOfListRef.current) {
                endOfListRef.current.scrollIntoView({ behavior: "smooth" });
              }
            } catch (err) {
              console.error("Error inside onloadend:", err);
            } finally {
              setRecordingDuration(0);
              setIsSubmitting(false);
            }
          };
        } catch (err) {
          console.error(err);
          setRecordingDuration(0);
          setIsSubmitting(false);
        }
      };

      mediaRecorder.start();
      setRecordingDuration(0);
      recordingIntervalRef.current = setInterval(() => {
        const currentSeconds = Math.floor((Date.now() - startTime) / 1000);
        setRecordingDuration(currentSeconds);
        if (currentSeconds >= 60) {
          if (recognitionRef.current && recognitionRef.current.state === "recording") {
            recognitionRef.current.stop();
          }
          setIsListening(false);
          if (recordingIntervalRef.current) {
            clearInterval(recordingIntervalRef.current);
            recordingIntervalRef.current = null;
          }
        }
      }, 1000);
      setIsListening(true);
      isMicInitializingRef.current = false;
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert(t('record.micAccessError'));
      isMicInitializingRef.current = false;
    }
  };

  // #6 多媒体附件处理
  /** 根据文件 MIME 类型判断附件种类。 */
  const getFileKind = (file: File): 'image' | 'audio' | 'video' | 'file' => {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('audio/')) return 'audio';
    if (file.type.startsWith('video/')) return 'video';
    return 'file';
  };

  /** 选择附件类型后，打开文件选择器或链接输入。 */
  const handleSelectAttachmentKind = (kind: 'image' | 'audio' | 'video' | 'link' | 'file') => {
    if (kind === 'link') {
      setLinkInput('');
      setShowLinkInput(true);
      return;
    }
    const acceptMap: Record<string, string> = {
      image: 'image/*',
      audio: 'audio/*',
      video: 'video/*',
      file: '*/*',
    };
    setFileAccept(acceptMap[kind]);
    // 延迟点击，确保 accept 已更新
    setTimeout(() => fileInputRef.current?.click(), 0);
  };

  /** 需求 8：下滑手势关闭附件面板。 */
  const handleSheetTouchStart = (e: React.TouchEvent) => {
    sheetDragStartY.current = e.touches[0].clientY;
  };

  const handleSheetTouchEnd = (e: React.TouchEvent) => {
    if (sheetDragStartY.current === null) return;
    const deltaY = e.changedTouches[0].clientY - sheetDragStartY.current;
    if (deltaY > 50) {
      setShowAttachmentSheet(false);
    }
    sheetDragStartY.current = null;
  };

  /** 文件选择回调：将 File 转为 PendingAttachment。 */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const newAttachments: PendingAttachment[] = [];
    for (const file of Array.from(files)) {
      const kind = getFileKind(file);
      const previewUrl = kind === 'image' ? URL.createObjectURL(file) : undefined;
      newAttachments.push({
        id: generateUUID(),
        kind,
        file,
        name: file.name,
        previewUrl,
      });
    }
    setPendingAttachments((prev) => [...prev, ...newAttachments]);
    // 重置 input 以便重复选择同一文件
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /** 添加链接附件。 */
  const handleAddLink = () => {
    const url = linkInput.trim();
    if (!url) return;
    setPendingAttachments((prev) => [
      ...prev,
      { id: generateUUID(), kind: 'link', url, name: url },
    ]);
    setLinkInput('');
    setShowLinkInput(false);
  };

  /** 移除待提交附件。 */
  const handleRemoveAttachment = (id: string) => {
    setPendingAttachments((prev) => {
      const removed = prev.find((a) => a.id === id);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim() && pendingAttachments.length === 0) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
    }

    setIsSubmitting(true);
    try {
      const tags = await processTags(inputText);
      const logId = generateUUID();
      let content = inputText.trim();

      // #6 处理附件：保存 Blob 到 IDB，音频走 STT 转写，图片/视频标记待生成摘要
      const finalAttachments: AttachmentMeta[] = [];
      let hasMediaForSummary = false;

      for (const pending of pendingAttachments) {
        if (pending.kind === 'link') {
          finalAttachments.push({ kind: 'link', ref: pending.url, name: pending.name });
        } else if (pending.file) {
          const meta = await saveAttachmentBlob(pending.file, pending.kind);
          finalAttachments.push(meta);

          if (pending.kind === 'audio') {
            // 语音附件走现有 STT，转写文本拼入 content
            try {
              const base64 = await blobToBase64(pending.file);
              const settings = useSettingsStore.getState();
              const data = await fetchTranscriptionWithRetry({
                audio_base64: base64,
                mime_type: pending.file.type || 'audio/webm',
                settings,
              });
              if (data?.text) {
                content = content ? `${content}\n${data.text}` : data.text;
              }
            } catch (err) {
              console.error('[Multimedia] Audio transcription failed:', err);
              content = content ? `${content}\n${t('record.audioTranscribeFailed')}` : t('record.audioTranscribeFailed');
            }
          } else if (pending.kind === 'image' || pending.kind === 'video') {
            // image / video：标记需要生成多模态摘要
            hasMediaForSummary = true;
          }
          // 'file' kind：仅存储，不触发 STT 或摘要
        }
      }

      await db.raw_logs.add({
        id: logId,
        content: content || t('record.multimediaRecord'),
        created_at: Date.now(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        tags,
        attachments: finalAttachments.length > 0 ? finalAttachments : undefined,
      });

      // 清理预览 URL
      for (const att of pendingAttachments) {
        if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
      }
      setInputText("");
      setPendingAttachments([]);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto"; // Reset size
      }

      // 异步：对图片/视频附件生成多模态摘要，写入 attachment_summary
      if (hasMediaForSummary) {
        const genLogId = logId;
        setGeneratingSummaryIds((prev) => new Set(prev).add(genLogId));
        generateAttachmentSummary(finalAttachments)
          .then(async ({ attachments: updated, summary }) => {
            setGeneratingSummaryIds((prev) => {
              const n = new Set(prev);
              n.delete(genLogId);
              return n;
            });
            if (summary) {
              await db.raw_logs.update(genLogId, {
                attachments: updated,
                attachment_summary: summary,
              });
            }
          })
          .catch((err) => {
            setGeneratingSummaryIds((prev) => {
              const n = new Set(prev);
              n.delete(genLogId);
              return n;
            });
            console.error('[Multimedia] Summary generation failed:', err);
          });
      }

      if (endOfListRef.current) {
        endOfListRef.current.scrollIntoView({ behavior: "smooth" });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const [retryingLogId, setRetryingLogId] = useState<string | null>(null);

  const handleRetryTranscription = async (log: any) => {
    if (!log.audioBlob) return;
    setRetryingLogId(log.id);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(log.audioBlob);
      reader.onloadend = async () => {
        try {
          const base64data = (reader.result as string).split(",")[1];
          const settings = useSettingsStore.getState();
          const mimeType = log.audioBlob.type || "audio/webm";

          let transcribedText = "";
          try {
            const data = await fetchTranscriptionWithRetry({
              audio_base64: base64data,
              mime_type: mimeType,
              settings,
            });
            transcribedText = data.text || t('record.voiceUnrecognized');
          } catch(e: any) {
            const msg = String(e.message || "");
            transcribedText = msg.includes("JSON") ? t('record.voiceParseFailedHtml') : t('record.voiceParseFailed', { msg });
          }

          await db.raw_logs.update(log.id, { content: transcribedText });
        } catch (err: any) {
           const msg = String(err.message || "");
           await db.raw_logs.update(log.id, { content: msg.includes("JSON") ? t('record.voiceParseFailedHtml') : t('record.voiceParseFailed', { msg }) });
        } finally {
          setRetryingLogId(null);
        }
      };
    } catch(e) {
      setRetryingLogId(null);
    }
  };

  // #005 单附件重试：重新生成图片/视频的 AI 摘要
  const handleRetryAttachmentSummary = useCallback(async (logId: string, attachmentIndex: number) => {
    const log = await db.raw_logs.get(logId);
    if (!log?.attachments?.[attachmentIndex]) return;
    const attachment = log.attachments[attachmentIndex];
    if (!attachment.ref || (attachment.kind !== 'image' && attachment.kind !== 'video')) return;

    const retryKey = `${logId}-${attachmentIndex}`;
    setRetryingAttachmentIds((prev) => new Set(prev).add(retryKey));

    try {
      const blobRecord = await db.attachments.get(attachment.ref);
      if (!blobRecord) throw new Error('Attachment blob not found');
      const base64 = await blobToBase64(blobRecord.blob);
      const mimeType = blobRecord.blob.type || (attachment.kind === 'image' ? 'image/jpeg' : 'video/mp4');
      const summary = await requestMultimediaSummary(base64, mimeType, attachment.kind);

      // 更新单个附件的 summary，并重算合并摘要
      const latestLog = await db.raw_logs.get(logId);
      if (!latestLog?.attachments) return;
      const updatedAttachments = [...latestLog.attachments];
      updatedAttachments[attachmentIndex] = { ...attachment, summary: summary.trim() || undefined };
      const summaryParts = updatedAttachments
        .filter((a) => a.summary)
        .map((a) => a.summary as string);
      const combinedSummary = summaryParts.join('\n');
      await db.raw_logs.update(logId, {
        attachments: updatedAttachments,
        attachment_summary: combinedSummary || undefined,
      });
    } catch (err) {
      console.error('[Multimedia] Single attachment retry failed:', err);
    } finally {
      setRetryingAttachmentIds((prev) => {
        const n = new Set(prev);
        n.delete(retryKey);
        return n;
      });
    }
  }, []);

  // #005 单附件重试：重新转写音频附件的 STT
  const handleRetryAudioAttachment = useCallback(async (logId: string, attachmentIndex: number) => {
    const log = await db.raw_logs.get(logId);
    if (!log?.attachments?.[attachmentIndex]) return;
    const attachment = log.attachments[attachmentIndex];
    if (!attachment.ref || attachment.kind !== 'audio') return;

    const retryKey = `${logId}-${attachmentIndex}`;
    setRetryingAttachmentIds((prev) => new Set(prev).add(retryKey));

    try {
      const blobRecord = await db.attachments.get(attachment.ref);
      if (!blobRecord) throw new Error('Audio blob not found');
      const base64 = await blobToBase64(blobRecord.blob);
      const settings = useSettingsStore.getState();
      const mimeType = blobRecord.blob.type || 'audio/webm';

      let transcribedText = '';
      try {
        const data = await fetchTranscriptionWithRetry({
          audio_base64: base64,
          mime_type: mimeType,
          settings,
        });
        transcribedText = data?.text || t('record.voiceUnrecognized');
      } catch (e: any) {
        const msg = String(e.message || '');
        transcribedText = msg.includes('JSON')
          ? t('record.voiceParseFailedHtml')
          : t('record.voiceParseFailed', { msg });
      }

      // 更新 content：替换失败标记或追加新转写文本
      const currentContent = log.content || '';
      const failureMarker = t('record.audioTranscribeFailed');
      let newContent: string;
      if (currentContent.includes(failureMarker)) {
        newContent = currentContent.replace(failureMarker, transcribedText);
      } else {
        newContent = currentContent ? `${currentContent}\n${transcribedText}` : transcribedText;
      }
      await db.raw_logs.update(logId, { content: newContent });
    } catch (err) {
      console.error('[Multimedia] Audio re-transcribe failed:', err);
    } finally {
      setRetryingAttachmentIds((prev) => {
        const n = new Set(prev);
        n.delete(retryKey);
        return n;
      });
    }
  }, [t]);

  /**
   * #104 打开碎屑编辑弹窗（RichEditor）。
   * 供右键菜单"编辑记录"和双击卡片入口共用。
   */
  const handleOpenEditModal = useCallback((log: any) => {
    setActiveLog(log);
    setEditContent(log.content);
    setEditAttachments(log.attachments || []);
    setIsEditingModalOpen(true);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth < 768);
    
    if (e.key === "Enter" && !e.shiftKey && !isMobile) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const endOfListRef = useRef<HTMLDivElement>(null);

  const prevLogsLengthRef = useRef<number>(0);
  const isInitialLoadDone = useRef(false);

  const logIdParam = searchParams.get("logId");

  useEffect(() => {
    isInitialLoadDone.current = false;
    prevLogsLengthRef.current = 0;
  }, [dateStr]);

  useEffect(() => {
    if (!logs) return;

    if (logIdParam && logs.length > 0) {
      setTimeout(() => {
        const el = document.getElementById(`log-${logIdParam}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add(
            "bg-stone-200/60",
            "transition-colors",
            "duration-500",
          );
          setTimeout(() => {
            el.classList.remove("bg-stone-200/60");
          }, 2000);
        }
      }, 100);
    } else {
      if (!isInitialLoadDone.current && logs.length > 0) {
        requestAnimationFrame(() => {
          setTimeout(() => {
            endOfListRef.current?.scrollIntoView({ behavior: "auto" });
          }, 150);
        });
        isInitialLoadDone.current = true;
      } else if (isInitialLoadDone.current && logs.length > prevLogsLengthRef.current) {
        requestAnimationFrame(() => {
          setTimeout(() => {
            endOfListRef.current?.scrollIntoView({ behavior: "smooth" });
          }, 50);
        });
      }
    }
    prevLogsLengthRef.current = logs.length;
  }, [logs, logIdParam]);

  const formatRecordTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleSaveEdit = async () => {
    if (!activeLog || isSavingEdit) return;
    const text = editContent.trim();
    // 保存条件：content 非空 或 attachments 非空
    if (!text && editAttachments.length === 0) return;
    setIsSavingEdit(true);
    try {
      const tags = await processTags(editContent);
      const originalAttachments: AttachmentMeta[] = activeLog.attachments || [];
      // 旧附件 ref 集合（非 link），用于检测被删除的附件
      const remainingOldRefs = new Set(
        originalAttachments.filter((a) => a.ref && a.kind !== 'link').map((a) => a.ref!)
      );

      const finalAttachments: AttachmentMeta[] = [];
      const newMediaForSummary: AttachmentMeta[] = [];
      let content = editContent.trim();

      for (const att of editAttachments) {
        if (att.kind === 'link') {
          // 链接：仅元数据，直接保留
          finalAttachments.push(att);
          continue;
        }
        const isNew = !!att.ref && att.ref.startsWith('data:');
        if (isNew) {
          // 新附件：data URL -> Blob -> saveAttachmentBlob
          const blob = dataUrlToBlob(att.ref!);
          const meta = await saveAttachmentBlob(blob, att.kind);
          if (att.name) meta.name = att.name;

          if (att.kind === 'audio') {
            // 音频走 STT，转写文本拼入 content
            try {
              const base64 = att.ref!.split(',')[1];
              const settings = useSettingsStore.getState();
              const data = await fetchTranscriptionWithRetry({
                audio_base64: base64,
                mime_type: blob.type || 'audio/webm',
                settings,
              });
              if (data?.text) {
                content = content ? `${content}\n${data.text}` : data.text;
              }
            } catch (err) {
              console.error('[Edit] Audio transcription failed:', err);
              content = content
                ? `${content}\n${t('record.audioTranscribeFailed')}`
                : t('record.audioTranscribeFailed');
            }
          } else if (att.kind === 'image' || att.kind === 'video') {
            // 图片/视频：标记需要生成多模态摘要
            newMediaForSummary.push(meta);
          }
          // file kind：仅存储，不触发 STT 或摘要
          finalAttachments.push(meta);
        } else {
          // 旧附件（store id）：保留，从删除集合移除
          if (att.ref) remainingOldRefs.delete(att.ref);
          finalAttachments.push(att);
        }
      }

      // 删除被移除的旧附件 Blob
      for (const ref of remainingOldRefs) {
        try { await db.attachments.delete(ref); } catch (e) { /* ignore */ }
      }

      // 清空所有图片/视频附件时 attachment_summary 一并清空
      const hasMediaAfter = finalAttachments.some((a) => a.kind === 'image' || a.kind === 'video');
      const summaryUpdate: { attachment_summary?: undefined } = !hasMediaAfter
        ? { attachment_summary: undefined }
        : {};

      await db.raw_logs.update(activeLog.id, {
        content,
        tags,
        attachments: finalAttachments.length > 0 ? finalAttachments : undefined,
        ...summaryUpdate,
      });

      // 异步：对新图片/视频附件生成多模态摘要，写入 attachment_summary
      if (newMediaForSummary.length > 0) {
        const genLogId = activeLog.id;
        setGeneratingSummaryIds((prev) => new Set(prev).add(genLogId));
        const allMediaForSummary = finalAttachments.filter(
          (a) => a.kind === 'image' || a.kind === 'video'
        );
        generateAttachmentSummary(allMediaForSummary)
          .then(async ({ attachments: updated, summary }) => {
            setGeneratingSummaryIds((prev) => {
              const n = new Set(prev);
              n.delete(genLogId);
              return n;
            });
            if (summary) {
              await db.raw_logs.update(genLogId, {
                attachments: updated,
                attachment_summary: summary,
              });
            }
          })
          .catch((err) => {
            setGeneratingSummaryIds((prev) => {
              const n = new Set(prev);
              n.delete(genLogId);
              return n;
            });
            console.error('[Edit] Summary generation failed:', err);
          });
      }

      setIsEditingModalOpen(false);
    } catch (err: any) {
      alert(t('record.saveFailed', { msg: err?.message || '' }));
    } finally {
      setIsSavingEdit(false);
    }
  };

  /** 删除整条碎屑记录（含 audioBlob 与附件 Blob），确认后执行并关闭弹窗。 */
  const handleDeleteRecord = async () => {
    if (!activeLog) return;
    if (!window.confirm(t('record.confirmDelete'))) return;
    const attachments: AttachmentMeta[] = activeLog.attachments || [];
    for (const att of attachments) {
      if (att.ref && att.kind !== 'link') {
        try { await db.attachments.delete(att.ref); } catch (e) { /* ignore */ }
      }
    }
    await db.raw_logs.delete(activeLog.id);
    setIsEditingModalOpen(false);
    setActiveLog(null);
  };

  return (
    <div className="flex flex-col h-full bg-transparent relative overflow-hidden">
      {/* 需求 8：面板打开时上推主内容（输入栏 + 主内容区） */}
      <div
        className="flex-1 flex flex-col min-h-0 transition-transform duration-300 ease-out"
        style={{ transform: showAttachmentSheet && sheetHeight > 0 ? `translateY(-${sheetHeight}px)` : 'translateY(0)' }}
      >

      {isPersisted === false && !hideStorageWarning && (
        <div className="bg-[#fcf8fa]/95 backdrop-blur border-b border-rose-100/30 px-4 py-2 flex items-center justify-between text-[11px] text-rose-900 animate-in slide-in-from-top duration-200 z-10 relative">
          <span className="flex items-center gap-1.5 font-medium leading-none">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-500 stroke-[2.2px] shrink-0" />
            {t('record.storageWarning')}
          </span>
          <div className="flex items-center gap-1.5 shrink-0 pl-2">
            <button
              onClick={() => navigate('/settings', { state: { tab: 'data' } })}
              className="text-rose-950 font-bold hover:underline px-1 py-0.5"
            >
              {t('record.settings')}
            </button>
            <button
              onClick={() => {
                setHideStorageWarning(true);
              }}
              className="p-1 hover:bg-rose-100/50 rounded-md text-rose-700/60 hover:text-rose-900 transition-colors"
              title={t('record.dontRemind')}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {syncStatus === 'credentials_missing' && (
        <div className="bg-red-50 border-b border-red-100/60 px-4 py-2 flex items-center justify-between text-[11px] text-red-800 animate-in slide-in-from-top duration-200 shadow-sm relative z-10">
          <span className="flex items-center gap-1.5 font-medium line-clamp-1">
            🔒 {syncErrorMessage || t('record.credentialsMissing')}
          </span>
          <button
            onClick={() => navigate('/settings')} 
            className="text-red-950 font-bold hover:underline shrink-0 pl-3"
          >
            {t('record.supplementNow')}
          </button>
        </div>
      )}

      <div 
        className="flex-1 overflow-y-auto thin-scrollbar px-5 py-5 pb-6 w-full relative z-0 flex flex-col"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {!logs || logs.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-stone-400 p-8 select-none animate-in fade-in duration-300">
            <div className="w-10 h-10 bg-gradient-to-br from-baimiao-mysteria/[0.06] to-[#2c2957]/[0.02] rounded-full flex items-center justify-center mb-3.5 border border-baimiao-mysteria/5 shadow-sm">
              <Sparkles className="w-4 h-4 text-baimiao-mysteria/50 stroke-[1.8px]" />
            </div>
            <p className="text-[14.5px] text-stone-700 font-medium mb-1.5 tracking-wide">
              {t('record.emptyTitle')}
            </p>
            <p className="text-[12px] text-stone-400 max-w-[220px] text-center leading-relaxed">
              {t('record.emptyDesc')}
            </p>
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-[0px]" />
            <div className="flex-none flex flex-col space-y-6">
              {logs.map((log) => (
                <div
                  key={log.id}
                  id={`log-${log.id}`}
                  data-testid="log-card"
                  className={`flex gap-3 group items-start px-2 py-1 rounded-lg relative ${isMultiSelectMode ? "cursor-pointer" : ""} animate-in fade-in slide-in-from-bottom-2 duration-300`}
                  onClick={() => {
                    if (isMultiSelectMode) {
                      const newSelected = new Set(selectedLogIds);
                      if (newSelected.has(log.id)) newSelected.delete(log.id);
                      else newSelected.add(log.id);
                      setSelectedLogIds(newSelected);
                    }
                  }}
                  onDoubleClick={(e) => {
                    // #104 多选模式下双击不触发编辑
                    if (isMultiSelectMode) return;
                    const target = e.target as HTMLElement;
                    // 附件区单击保留打开灯箱/详情，双击只在非附件区触发编辑
                    if (target.closest('[data-attachment-region]') || target.closest('button, audio, video, img, a')) {
                      return;
                    }
                    handleOpenEditModal(log);
                  }}
                onTouchStart={(e) => {
                  if (isMultiSelectMode) return;
                  const touch = e.touches[0];
                  const x = touch.clientX;
                  const y = touch.clientY;
                  holdTimeoutRef.current = setTimeout(() => {
                    if (window.navigator?.vibrate) window.navigator.vibrate(50);
                    setContextMenuState({ isOpen: true, log, x, y });
                  }, 500);
                }}
                onTouchEnd={() => clearTimeout(holdTimeoutRef.current)}
                onTouchMove={() => clearTimeout(holdTimeoutRef.current)}
                onContextMenu={(e) => {
                  if (isMultiSelectMode) {
                    e.preventDefault();
                    return;
                  }
                  e.preventDefault();
                  if (window.navigator?.vibrate) window.navigator.vibrate(50);
                  setContextMenuState({ isOpen: true, log, x: e.clientX, y: e.clientY });
                }}
              >
                {isMultiSelectMode && (
                   <div className="shrink-0 pt-[6px]">
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                        selectedLogIds.has(log.id) ? 'bg-baimiao-mysteria border-baimiao-mysteria' : 'border-stone-300'
                      }`}>
                         {selectedLogIds.has(log.id) && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                   </div>
                )}
                <span className="text-[11.5px] font-mono text-stone-450 shrink-0 mt-[11px] w-10 text-right select-none opacity-80">
                  {format(new Date(log.created_at), "HH:mm")}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="inline-block baimiao-card-bubble px-4 py-3 pb-2 max-w-full text-left relative">
                    <p className="text-[15.5px] leading-relaxed text-baimiao-ink font-sans tracking-tight break-all">
                      {log.content}
                    </p>
                    {log.audioBlob && (
                      <div className="mt-2.5 w-full max-w-[220px] pb-1">
                        <AudioPlayer blob={log.audioBlob} />
                        {log.audioDuration !== undefined && (
                          <div className="text-[10px] font-mono text-stone-400 mt-1 pl-1">
                            {t('record.duration', { duration: formatRecordTime(log.audioDuration) })}
                          </div>
                        )}
                      </div>
                    )}
                    {log.attachments && log.attachments.length > 0 && (
                      <MultimediaAttachments
                        log={log}
                        isGenerating={generatingSummaryIds.has(log.id)}
                        retryingIds={retryingAttachmentIds}
                        onRetryAttachment={handleRetryAttachmentSummary}
                        onRetryAudio={handleRetryAudioAttachment}
                        onOpenPreview={(items: AttachmentMeta[], initialIndex: number) => setMediaPreview({ items, initialIndex })}
                        onOpenDetail={(l: any) => setDetailLog(l)}
                      />
                    )}
                  </div>
                  {typeof log.content === "string" && (log.content.includes("解析失败") || log.content.includes("parsing failed")) && log.audioBlob && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRetryTranscription(log);
                      }}
                      className="mt-2 text-[12px] text-indigo-500 hover:text-indigo-600 flex items-center gap-1.5 focus:outline-none transition-colors"
                      disabled={retryingLogId === log.id}
                    >
                      {retryingLogId === log.id ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <RefreshCw className="w-3.5 h-3.5"/>}
                      {t('record.retryTranscription')}
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div ref={endOfListRef} />
          </div>
          </>
        )}
      </div>

      <div className="p-4 bg-white/95 backdrop-blur-lg border-t border-baimiao-border/30 shrink-0 z-20 relative">
        {isMultiSelectMode ? (
          <div className="flex items-center justify-between -mx-2 h-[56px] animate-in slide-in-from-bottom-2 duration-200">
             <button onClick={() => { setIsMultiSelectMode(false); setSelectedLogIds(new Set()); }} className="px-5 py-2 text-stone-500 hover:text-stone-700 font-medium text-[14px] transition-colors">{t('record.cancel')}</button>
             <span className="text-[13px] font-medium text-stone-700 tracking-wide">{t('record.selectedCount', { count: selectedLogIds.size })}</span>
             <button 
                disabled={selectedLogIds.size === 0}
                onClick={async () => {
                   for (const id of Array.from(selectedLogIds)) {
                      await db.raw_logs.delete(id);
                   }
                   setSelectedLogIds(new Set());
                   setIsMultiSelectMode(false);
                }}
                className="px-5 py-2 text-red-500 hover:text-red-600 font-medium text-[14px] disabled:opacity-30 disabled:hover:text-red-500 transition-colors"
             >
                <div className="flex items-center gap-1">
                  <Trash2 className="w-4 h-4" /> {t('record.delete')}
                </div>
             </button>
          </div>
        ) : (
        <>
        {/* 需求 1：底部输入框左上方今日统计（当前查看日期 raw_logs） */}
        <TodayStats count={(logs || []).length} chars={dailyChars} />
        {/* #6 待提交附件预览 */}
        {pendingAttachments.length > 0 && (
          <div data-testid="attachment-preview" className="flex flex-wrap gap-2 mb-2 px-1">
            {pendingAttachments.map((att) => (
              <div
                key={att.id}
                className="relative group bg-stone-100 rounded-lg overflow-hidden shrink-0"
              >
                {att.kind === 'image' && att.previewUrl ? (
                  <img
                    src={att.previewUrl}
                    alt={att.name || t('record.addAttachment')}
                    data-testid={`attachment-thumb-${att.id}`}
                    className="w-14 h-14 object-cover"
                  />
                ) : (
                  <div className="w-14 h-14 flex flex-col items-center justify-center gap-0.5 px-1">
                    {att.kind === 'audio' && <Music className="w-4 h-4 text-stone-500" />}
                    {att.kind === 'video' && <Video className="w-4 h-4 text-stone-500" />}
                    {att.kind === 'link' && <LinkIcon className="w-4 h-4 text-stone-500" />}
                    {att.kind === 'file' && <FileUp className="w-4 h-4 text-stone-500" />}
                    <span className="text-[8px] text-stone-500 leading-tight line-clamp-2 text-center break-all">
                      {att.kind === 'link' ? t('record.link') : att.name || att.kind}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => handleRemoveAttachment(att.id)}
                  className="absolute top-0 right-0 w-4 h-4 flex items-center justify-center bg-black/50 text-white rounded-bl-lg opacity-80 hover:opacity-100"
                  data-testid={`attachment-remove-${att.id}`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <form
          onSubmit={handleSubmit}
          className={`flex items-end bg-white rounded-2xl p-1.5 border transition-all shadow-[0_2px_10px_rgb(0_0_0_/_0.03)] ${
            !isTodayDate
              ? "opacity-50 pointer-events-none border-transparent"
              : "border-black/5 focus-within:border-black/15 focus-within:shadow-[0_4px_16px_rgb(0_0_0_/_0.06)]"
          }`}
        >
          <div className="relative flex-1 mr-1.5 flex flex-col justify-center min-h-[36px]">
            {isListening ? (
              <button
                type="button"
                onClick={handleToggleListen}
                disabled={isSubmitting}
                className="w-full h-[36px] flex items-center justify-center gap-2 rounded-xl font-medium text-[14.5px] transition-all select-none bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] hover:brightness-110 active:scale-[0.99] text-white shadow-md shadow-baimiao-mysteria/10 disabled:opacity-50"
              >
                <div className="w-2 h-2 rounded-sm bg-red-500 animate-pulse" />
                <span className="font-mono">{formatRecordTime(recordingDuration)}</span>
                <span className="ml-[2px] opacity-90 font-normal">{t('record.clickToEnd')}</span>
              </button>
            ) : (
              <textarea
                ref={textareaRef}
                rows={1}
                data-testid="tag-input"
                className="w-full bg-transparent px-2 py-[7.5px] text-[15px] leading-[21px] outline-none placeholder:text-stone-400 min-w-0 resize-none overflow-y-auto no-scrollbar"
                placeholder={isSubmitting ? t('record.parsing') : t('record.inputPlaceholder')}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isSubmitting}
                style={{ maxHeight: "50vh" }}
              />
            )}
          </div>

          {/* #6 附件按钮 */}
          {!isListening && (
            <button
              type="button"
              onClick={() => setShowAttachmentSheet(true)}
              disabled={isSubmitting}
              data-testid="attachment-button"
              className="w-[36px] h-[36px] flex items-center justify-center rounded-xl text-stone-400 hover:text-stone-900 hover:bg-stone-100/50 disabled:opacity-30 transition-colors shrink-0"
              title={t('record.addAttachment')}
            >
              <Paperclip className="w-[19px] h-[19px]" />
            </button>
          )}

          {!isListening ? (
            inputText.trim() || isSubmitting || pendingAttachments.length > 0 ? (
              <button
                 type="submit"
                 disabled={(!inputText.trim() && pendingAttachments.length === 0) || isSubmitting}
                 data-testid="submit-button"
                 className="w-[36px] h-[36px] flex items-center justify-center rounded-xl text-stone-400 hover:text-stone-900 hover:bg-stone-100/50 disabled:opacity-30 disabled:bg-transparent transition-colors shrink-0"
              >
                 {isSubmitting ? (
                   <Loader2 className="w-[20px] h-[20px] animate-spin" />
                 ) : (
                   <ArrowRight className="w-[20px] h-[20px]" />
                 )}
              </button>
            ) : (
              <button
                 type="button"
                 onClick={handleToggleListen}
                 className="w-[36px] h-[36px] flex items-center justify-center rounded-xl text-stone-400 hover:text-stone-900 hover:bg-stone-100/50 transition-colors shrink-0"
                 title={t('record.voiceRecord')}
              >
                 <Mic className="w-[22px] h-[22px]" />
              </button>
            )
          ) : (
            <button
               type="button"
               disabled={isSubmitting}
               onClick={() => {
                 isCancelledRef.current = true;
                 handleToggleListen();
               }}
               className="w-[36px] h-[36px] flex items-center justify-center rounded-xl text-stone-400 hover:text-stone-900 hover:bg-stone-100/50 disabled:opacity-30 transition-colors shrink-0"
               title={t('record.cancel')}
            >
               <Keyboard className="w-[22px] h-[22px]" />
            </button>
          )}
        </form>
        {/* 隐藏文件选择器 */}
        <input
          ref={fileInputRef}
          type="file"
          data-testid="attachment-file-input"
          accept={fileAccept}
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
        </>
        )}
      </div>
      </div>

      {/* 需求 8：附件类型选择面板（底部上滑网格，上推主内容，下滑关闭） */}
      {showAttachmentSheet && (
        <>
          <div
            data-testid="attachment-sheet-mask"
            className="fixed inset-0 bg-black/40 z-[100] transition-opacity"
            onClick={() => setShowAttachmentSheet(false)}
          />
          <div
            ref={sheetRef}
            data-testid="attachment-sheet"
            onTouchStart={handleSheetTouchStart}
            onTouchEnd={handleSheetTouchEnd}
            className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl z-[101] max-w-md mx-auto transform transition-transform animate-in slide-in-from-bottom-full duration-300 pb-safe max-h-[50vh] flex flex-col"
          >
            <div className="p-4 overflow-y-auto">
              <div data-testid="attachment-sheet-handle" className="w-10 h-1.5 bg-stone-200 rounded-full mx-auto mb-5" />
              <div className="grid grid-cols-3 gap-3">
                {/* 第一行：相册 / 音频 / 视频 */}
                <button
                  type="button"
                  data-testid="attachment-option-image"
                  onClick={() => { handleSelectAttachmentKind('image'); setShowAttachmentSheet(false); }}
                  className="flex flex-col items-center gap-1.5 py-3 rounded-2xl hover:bg-stone-100 active:bg-stone-200 focus-visible:bg-stone-100 focus-visible:ring-2 focus-visible:ring-stone-300 transition-colors"
                >
                  <span className="w-11 h-11 flex items-center justify-center rounded-full bg-stone-100 text-stone-600">
                    <ImageIcon className="w-5 h-5" />
                  </span>
                  <span className="text-[12px] font-medium text-stone-600">{t('record.album')}</span>
                </button>
                <button
                  type="button"
                  data-testid="attachment-option-audio"
                  onClick={() => { handleSelectAttachmentKind('audio'); setShowAttachmentSheet(false); }}
                  className="flex flex-col items-center gap-1.5 py-3 rounded-2xl hover:bg-stone-100 active:bg-stone-200 focus-visible:bg-stone-100 focus-visible:ring-2 focus-visible:ring-stone-300 transition-colors"
                >
                  <span className="w-11 h-11 flex items-center justify-center rounded-full bg-stone-100 text-stone-600">
                    <Music className="w-5 h-5" />
                  </span>
                  <span className="text-[12px] font-medium text-stone-600">{t('record.audio')}</span>
                </button>
                <button
                  type="button"
                  data-testid="attachment-option-video"
                  onClick={() => { handleSelectAttachmentKind('video'); setShowAttachmentSheet(false); }}
                  className="flex flex-col items-center gap-1.5 py-3 rounded-2xl hover:bg-stone-100 active:bg-stone-200 focus-visible:bg-stone-100 focus-visible:ring-2 focus-visible:ring-stone-300 transition-colors"
                >
                  <span className="w-11 h-11 flex items-center justify-center rounded-full bg-stone-100 text-stone-600">
                    <Video className="w-5 h-5" />
                  </span>
                  <span className="text-[12px] font-medium text-stone-600">{t('record.video')}</span>
                </button>
                {/* 第二行：链接 / 文件 / 取消 */}
                <button
                  type="button"
                  data-testid="attachment-option-link"
                  onClick={() => { handleSelectAttachmentKind('link'); setShowAttachmentSheet(false); }}
                  className="flex flex-col items-center gap-1.5 py-3 rounded-2xl hover:bg-stone-100 active:bg-stone-200 focus-visible:bg-stone-100 focus-visible:ring-2 focus-visible:ring-stone-300 transition-colors"
                >
                  <span className="w-11 h-11 flex items-center justify-center rounded-full bg-stone-100 text-stone-600">
                    <LinkIcon className="w-5 h-5" />
                  </span>
                  <span className="text-[12px] font-medium text-stone-600">{t('record.link')}</span>
                </button>
                <button
                  type="button"
                  data-testid="attachment-option-file"
                  onClick={() => { handleSelectAttachmentKind('file'); setShowAttachmentSheet(false); }}
                  className="flex flex-col items-center gap-1.5 py-3 rounded-2xl hover:bg-stone-100 active:bg-stone-200 focus-visible:bg-stone-100 focus-visible:ring-2 focus-visible:ring-stone-300 transition-colors"
                >
                  <span className="w-11 h-11 flex items-center justify-center rounded-full bg-stone-100 text-stone-600">
                    <FileUp className="w-5 h-5" />
                  </span>
                  <span className="text-[12px] font-medium text-stone-600">{t('record.file')}</span>
                </button>
                <button
                  type="button"
                  data-testid="attachment-option-cancel"
                  onClick={() => setShowAttachmentSheet(false)}
                  className="flex flex-col items-center gap-1.5 py-3 rounded-2xl hover:bg-stone-100 active:bg-stone-200 focus-visible:bg-stone-100 focus-visible:ring-2 focus-visible:ring-stone-300 transition-colors"
                >
                  <span className="w-11 h-11 flex items-center justify-center rounded-full bg-stone-100 text-stone-400">
                    <X className="w-5 h-5" />
                  </span>
                  <span className="text-[12px] font-medium text-stone-400">{t('record.cancel')}</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* #6 链接输入弹窗 */}
      {showLinkInput && (
        <div
          className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-6"
          onClick={() => setShowLinkInput(false)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-sm p-4 space-y-3 shadow-2xl animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[14px] font-semibold text-stone-700">{t('record.addLink')}</h3>
            <input
              type="url"
              data-testid="link-input"
              autoFocus
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddLink(); } }}
              placeholder="https://..."
              className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-[14px] outline-none focus:border-baimiao-mysteria/40"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowLinkInput(false)}
                className="px-3.5 py-1.5 rounded-full text-[13px] font-medium text-stone-600 bg-white border border-stone-200 hover:bg-stone-50 transition-colors"
              >
                {t('record.cancel')}
              </button>
              <button
                data-testid="link-add-confirm"
                onClick={handleAddLink}
                disabled={!linkInput.trim()}
                className="px-4 py-1.5 rounded-full text-[13px] font-medium text-white bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] hover:brightness-110 transition-all disabled:opacity-40"
              >
                {t('record.add')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Context Menu */}
      {contextMenuState.isOpen && contextMenuState.log && (
        <div
          className="fixed inset-0 z-[100]"
          onClick={() => setContextMenuState({ ...contextMenuState, isOpen: false })}
          onTouchMove={(e) => { setContextMenuState({ ...contextMenuState, isOpen: false }) }}
          onWheel={(e) => { setContextMenuState({ ...contextMenuState, isOpen: false }) }}
        >
          <div
            className="absolute bg-gradient-to-r from-baimiao-mysteria/95 to-[#2c2957]/95 backdrop-blur-xl rounded-xl shadow-2xl flex items-center p-1 animate-in zoom-in-95 duration-100 divide-x divide-white/10"
            style={{
              top: contextMenuState.y > 100 ? contextMenuState.y - 75 : contextMenuState.y + 20,
              left: Math.max(16, Math.min(contextMenuState.x - 140, window.innerWidth - 296)),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                copy(contextMenuState.log.content);
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className={`flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 transition-colors rounded-l-lg disabled:opacity-50 ${
                copied
                  ? 'text-emerald-300 bg-white/10'
                  : 'text-white/90 hover:text-white hover:bg-white/10'
              }`}
            >
              {copied ? <Check className="w-3.5 h-3.5 mb-1.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5 mb-1.5 text-white/80" />}
              <span className="text-[10px] font-medium tracking-wide">{copied ? t('record.copied') : t('record.copyContent')}</span>
            </button>
            <button
              onClick={() => {
                handleOpenEditModal(contextMenuState.log);
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-white/90 hover:text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <Edit2 className="w-3.5 h-3.5 mb-1.5 text-white/80" />
              <span className="text-[10px] font-medium tracking-wide">{t('record.editRecord')}</span>
            </button>
            <button
              onClick={() => {
                setSelectedLogIds(new Set([contextMenuState.log.id]));
                setIsMultiSelectMode(true);
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-white/90 hover:text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <ListChecks className="w-3.5 h-3.5 mb-1.5 text-white/80" />
              <span className="text-[10px] font-medium tracking-wide">{t('record.multiSelect')}</span>
            </button>
            <button
              onClick={async () => {
                await db.raw_logs.delete(contextMenuState.log.id);
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-rose-400 hover:text-rose-300 transition-colors hover:bg-white/10 rounded-r-lg disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5 mb-1.5" />
              <span className="text-[10px] font-medium tracking-wide">{t('record.deleteRecord')}</span>
            </button>
          </div>
        </div>
      )}

      {/* 编辑弹窗（居中弹窗 + RichEditor，需求 3 多媒体化） */}
      {isEditingModalOpen && (
        <div
          data-testid="record-edit-modal"
          className="fixed inset-0 z-[110] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 animate-in fade-in duration-200"
          onClick={() => setIsEditingModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-md max-h-[88vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹窗头 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 shrink-0">
              <span className="text-[13.5px] font-semibold text-baimiao-mysteria font-serif baimiao-editorial-title">
                {t('record.editTitle')}
              </span>
              <button
                onClick={() => setIsEditingModalOpen(false)}
                className="p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-full transition-colors"
                aria-label={t('about.close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 内容区（可滚动，局部 overflow-y-auto 不依赖 body 滚动） */}
            <div className="flex-1 overflow-y-auto thin-scrollbar p-3 min-h-0">
              <RichEditor
                value={editContent}
                onChange={setEditContent}
                attachments={editAttachments}
                onAttachmentsChange={setEditAttachments}
                minHeightClass="min-h-[160px]"
                textareaTestId="record-edit-textarea"
                placeholder={t('record.contentPlaceholder')}
              />
            </div>

            {/* 底部操作栏：左 字数+删除 / 右 取消+保存 */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100 shrink-0 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[12px] text-stone-500 shrink-0">
                  {t('record.totalChars', { count: countChars(editContent) })}
                </span>
                <button
                  data-testid="record-edit-delete"
                  onClick={handleDeleteRecord}
                  disabled={isSavingEdit}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[12px] font-medium text-rose-500 hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t('record.delete')}
                </button>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setIsEditingModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-full text-[12.5px] font-medium text-stone-600 bg-white border border-stone-200 hover:bg-stone-50 transition-colors"
                >
                  {t('record.cancel')}
                </button>
                <button
                  data-testid="record-edit-save"
                  onClick={handleSaveEdit}
                  disabled={(!editContent.trim() && editAttachments.length === 0) || isSavingEdit}
                  className="px-4 py-1.5 rounded-full text-[12.5px] font-medium text-white bg-gradient-to-r from-baimiao-mysteria to-[#2c2957] hover:brightness-110 active:scale-[0.98] shadow-md shadow-baimiao-mysteria/10 transition-all disabled:opacity-30 disabled:scale-100 disabled:shadow-none"
                >
                  {isSavingEdit ? t('record.saving') : t('record.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 需求 7：图片/视频全屏预览 */}
      {mediaPreview && (
        <MediaPreview
          items={mediaPreview.items}
          initialIndex={mediaPreview.initialIndex}
          onClose={() => setMediaPreview(null)}
        />
      )}

      {/* #005 附件详情面板：+N 点击后展示全部附件 + 完整摘要 */}
      {detailLog && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-[110] transition-opacity"
            onClick={() => setDetailLog(null)}
          />
          <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl z-[111] max-w-md mx-auto transform transition-transform animate-in slide-in-from-bottom-full duration-300 pb-safe max-h-[70vh] flex flex-col">
            <div className="shrink-0 px-4 pt-4 pb-2 flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-stone-700">{t('record.detailTitle')}</h3>
              <button
                type="button"
                onClick={() => setDetailLog(null)}
                className="w-7 h-7 flex items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 transition-colors"
                aria-label={t('about.close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto px-4 pb-4 flex-1">
              {(detailLog.attachments || []).some((a: AttachmentMeta) => a.kind === 'image' || a.kind === 'video') && (
                <div className="grid grid-cols-2 gap-1 mb-2">
                  {(() => {
                    const detailMedia = (detailLog.attachments || [])
                      .map((att: AttachmentMeta, idx: number) => ({ att, originalIndex: idx }))
                      .filter(({ att }) => att.kind === 'image' || att.kind === 'video');
                    return detailMedia.map(({ att, originalIndex }, i) => (
                      <MediaThumb
                        key={originalIndex}
                        att={att}
                        originalIndex={originalIndex}
                        logId={detailLog.id}
                        isRetrying={retryingAttachmentIds.has(`${detailLog.id}-${originalIndex}`)}
                        onRetry={handleRetryAttachmentSummary}
                        onOpenPreview={() => setMediaPreview({ items: detailMedia.map(({ att: a }) => a), initialIndex: i })}
                      />
                    ));
                  })()}
                </div>
              )}
              {detailLog.attachment_summary && (
                <div className="mt-2">
                  <p className="text-[12px] font-medium text-stone-400 mb-1">{t('record.fullSummary')}</p>
                  <p className="text-[15.5px] leading-relaxed text-stone-600 break-words">{detailLog.attachment_summary}</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
