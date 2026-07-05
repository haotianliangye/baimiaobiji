import React, { useState, useRef, useEffect, useCallback } from "react";
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
  ChevronLeft,
  ChevronRight,
  Square,
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
} from "lucide-react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { db } from "../db/db";
import { generateUUID } from "../lib/utils";
import { useSettingsStore } from "../store/settings.store";
import { useAppStore } from "../store/app.store";
import CalendarHeatmap from "../components/CalendarHeatmap";
import ActionSheet from "../components/ActionSheet";

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

export default function Record() {
  const [isPersisted, setIsPersisted] = useState<boolean | null>(null);
  const syncStatus = useAppStore(state => state.syncStatus);
  const syncErrorMessage = useAppStore(state => state.syncErrorMessage);
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
  const [showHeatmap, setShowHeatmap] = useState(false);

  // Action sheet & edit states
  const [activeLog, setActiveLog] = useState<any>(null);
  const [isActionSheetOpen, setIsActionSheetOpen] = useState(false);
  const [isEditingModalOpen, setIsEditingModalOpen] = useState(false);
  const [editContent, setEditContent] = useState("");
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

  const adjustTextareaHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, window.innerHeight * 0.5)}px`;
    }
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [inputText, adjustTextareaHeight]);

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

              let transcribedText = "[语音记录]";
              try {
                const data = await fetchTranscriptionWithRetry({
                  audio_base64: base64data,
                  mime_type: mimeType,
                  settings,
                });
                if (data && data.text) {
                  transcribedText = data.text;
                } else {
                  transcribedText = "[未识别到有效语音]";
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
                  transcribedText = `[语音解析失败: 远端接口无响应或返回了网页内容]`;
                } else {
                  transcribedText = `[语音解析失败: ${msg}]`;
                }
              }

              const finalDuration = Math.floor(((stopTime || Date.now()) - startTime) / 1000);
              
              let saveSuccess = false;
              try {
                await db.raw_logs.add({
                  id: generateUUID(),
                  content: transcribedText,
                  created_at: Date.now(),
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  audioBlob: audioBlob,
                  audioDuration: finalDuration > 0 ? finalDuration : undefined,
                });
                saveSuccess = true;
              } catch (dbErr: any) {
                console.error("Failed to add blob to IndexedDB:", dbErr);
                // Fallback: save without blob if blob cloning fails
                await db.raw_logs.add({
                  id: generateUUID(),
                  content: `${transcribedText} [音频文件保存失败: ${dbErr.message || "不支持此数据"}]`,
                  created_at: Date.now(),
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  audioDuration: finalDuration > 0 ? finalDuration : undefined,
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
      alert("无法访问麦克风，请检查权限设置。");
      isMicInitializingRef.current = false;
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim()) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
    }

    setIsSubmitting(true);
    try {
      await db.raw_logs.add({
        id: generateUUID(),
        content: inputText.trim(),
        created_at: Date.now(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setInputText("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto"; // Reset size
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
            transcribedText = data.text || "[未识别到有效语音]";
          } catch(e: any) {
            const msg = String(e.message || "");
            transcribedText = `[语音解析失败: ${msg.includes("JSON") ? "远端接口无响应或返回了网页内容" : msg}]`;
          }

          await db.raw_logs.update(log.id, { content: transcribedText });
        } catch (err: any) {
           const msg = String(err.message || "");
           await db.raw_logs.update(log.id, { content: `[语音解析失败: ${msg.includes("JSON") ? "远端接口无响应或返回了网页内容" : msg}]` });
        } finally {
          setRetryingLogId(null);
        }
      };
    } catch(e) {
      setRetryingLogId(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
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

  return (
    <div className="flex flex-col h-full bg-transparent relative">
      <div className="flex h-[52px] items-center px-4 bg-[#faf9fc]/85 backdrop-blur border-b border-baimiao-border/40 z-20 shrink-0 w-full justify-between">
        <h2 className="text-[13.5px] font-bold tracking-wide text-baimiao-mysteria flex items-center gap-1.5 font-serif baimiao-editorial-title">
          <Clock className="w-4 h-4 text-baimiao-mysteria/70 stroke-[2.2px] translate-y-[-0.8px] shrink-0" />
          时间碎屑
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigateToDate(-1)}
            className="p-1 hover:bg-stone-200/50 rounded-full transition-colors text-stone-400 hover:text-stone-700"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowHeatmap(true)}
            className="text-[13px] font-medium font-mono text-stone-700 w-[95px] text-center select-none hover:bg-stone-200/30 py-1 rounded-md transition-colors active:scale-95"
          >
            {dateStr}
          </button>
          <button
            onClick={() => navigateToDate(1)}
            disabled={isTodayDate}
            className="p-1 hover:bg-stone-200/50 rounded-full transition-colors text-stone-400 hover:text-stone-700 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isPersisted === false && !hideStorageWarning && (
        <div className="bg-[#fcf8fa]/95 backdrop-blur border-b border-rose-100/30 px-4 py-2 flex items-center justify-between text-[11px] text-rose-900 animate-in slide-in-from-top duration-200 z-10 relative">
          <span className="flex items-center gap-1.5 font-medium leading-none">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-500 stroke-[2.2px] shrink-0" />
            安全提示：未激活永久存储保护，数据可能被系统自动清理。
          </span>
          <div className="flex items-center gap-1.5 shrink-0 pl-2">
            <button
              onClick={() => navigate('/settings', { state: { tab: 'data' } })} 
              className="text-rose-950 font-bold hover:underline px-1 py-0.5"
            >
              设置
            </button>
            <button 
              onClick={() => {
                setHideStorageWarning(true);
              }}
              className="p-1 hover:bg-rose-100/50 rounded-md text-rose-700/60 hover:text-rose-900 transition-colors"
              title="不再提示"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {syncStatus === 'credentials_missing' && (
        <div className="bg-red-50 border-b border-red-100/60 px-4 py-2 flex items-center justify-between text-[11px] text-red-800 animate-in slide-in-from-top duration-200 shadow-sm relative z-10">
          <span className="flex items-center gap-1.5 font-medium line-clamp-1">
            🔒 {syncErrorMessage || '为保障安全，后台同步暂时挂起：请补充密码'}
          </span>
          <button
            onClick={() => navigate('/settings')} 
            className="text-red-950 font-bold hover:underline shrink-0 pl-3"
          >
            立即补充 →
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
            <p className="text-[14.5px] text-stone-700 font-medium mb-1.5 font-serif baimiao-editorial-title tracking-wide">
              碎屑终将汇成星河
            </p>
            <p className="text-[12px] text-stone-400 max-w-[200px] text-center leading-relaxed">
              写下此刻闪现的所思所感，哪怕只是片刻的情绪与言语。
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
                  className={`flex gap-3 group items-start px-2 py-1 rounded-lg transition-colors relative active:bg-stone-200/50 ${isMultiSelectMode ? "cursor-pointer" : ""}`}
                  onClick={() => {
                    if (isMultiSelectMode) {
                      const newSelected = new Set(selectedLogIds);
                      if (newSelected.has(log.id)) newSelected.delete(log.id);
                      else newSelected.add(log.id);
                      setSelectedLogIds(newSelected);
                    }
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
                <div className="flex-1 min-w-0">
                  <div className="inline-block bg-[#fdfdfc]/85 border border-stone-200/40 rounded-2xl px-4 py-3 pb-2 shadow-[0_2px_12px_rgba(27,25,56,0.012)] hover:border-stone-200/60 max-w-full text-left relative">
                    <p className="text-[15.5px] leading-relaxed text-baimiao-ink font-sans tracking-tight break-all pr-8">
                      {log.content}
                    </p>
                    {log.audioBlob && (
                      <div className="mt-2.5 w-full max-w-[220px] pb-1">
                        <AudioPlayer blob={log.audioBlob} />
                        {log.audioDuration !== undefined && (
                          <div className="text-[10px] font-mono text-stone-400 mt-1 pl-1">
                            时长: {formatRecordTime(log.audioDuration)}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="text-[9px] font-mono text-stone-400/60 text-right mt-1 select-none">
                      {format(new Date(log.created_at), "HH:mm")}
                    </div>
                  </div>
                  {typeof log.content === "string" && log.content.includes("解析失败") && log.audioBlob && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRetryTranscription(log);
                      }}
                      className="mt-2 text-[12px] text-indigo-500 hover:text-indigo-600 flex items-center gap-1.5 focus:outline-none transition-colors"
                      disabled={retryingLogId === log.id}
                    >
                      {retryingLogId === log.id ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <RefreshCw className="w-3.5 h-3.5"/>}
                      重新识别该录音
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
             <button onClick={() => { setIsMultiSelectMode(false); setSelectedLogIds(new Set()); }} className="px-5 py-2 text-stone-500 hover:text-stone-700 font-medium text-[14px] transition-colors">取消</button>
             <span className="text-[13px] font-medium text-stone-700 tracking-wide">已选 <span className="text-black font-semibold">{selectedLogIds.size}</span> 项</span>
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
                  <Trash2 className="w-4 h-4" /> 删除
                </div>
             </button>
          </div>
        ) : (
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
                className="w-full h-[36px] flex items-center justify-center gap-2 rounded-lg font-medium text-[14.5px] transition-all select-none bg-[#2a2a2a] text-white shadow-sm disabled:opacity-50 active:bg-[#1a1a1a]"
              >
                <div className="w-2 h-2 rounded-sm bg-red-500 animate-pulse" />
                <span className="font-mono">{formatRecordTime(recordingDuration)}</span>
                <span className="ml-[2px] opacity-90 font-normal">点击结束并发送</span>
              </button>
            ) : (
              <textarea
                ref={textareaRef}
                rows={1}
                className="w-full bg-transparent px-2 py-[7.5px] text-[15px] leading-[21px] outline-none placeholder:text-stone-400 min-w-0 resize-none overflow-y-auto no-scrollbar"
                placeholder={isSubmitting ? "正在解析..." : "输入你想记录的碎片..."}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isSubmitting}
                style={{ maxHeight: "50vh" }}
              />
            )}
          </div>

          {!isListening ? (
            inputText.trim() || isSubmitting ? (
              <button
                 type="submit"
                 disabled={!inputText.trim() || isSubmitting}
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
                 title="点击开始录音"
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
               title="取消录音"
            >
               <Keyboard className="w-[22px] h-[22px]" />
            </button>
          )}
        </form>
        )}
      </div>

      {showHeatmap && (
        <CalendarHeatmap
          currentDate={targetDate}
          onSelectDate={(date) => setSearchParams({ date })}
          onClose={() => setShowHeatmap(false)}
        />
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
                navigator.clipboard.writeText(contextMenuState.log.content);
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-white/90 hover:text-white transition-colors hover:bg-white/10 rounded-l-lg disabled:opacity-50"
            >
              <Copy className="w-3.5 h-3.5 mb-1.5 text-white/80" />
              <span className="text-[10px] font-medium tracking-wide">复制内容</span>
            </button>
            <button
              onClick={() => {
                setActiveLog(contextMenuState.log);
                setEditContent(contextMenuState.log.content);
                setIsEditingModalOpen(true);
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-white/90 hover:text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <Edit2 className="w-3.5 h-3.5 mb-1.5 text-white/80" />
              <span className="text-[10px] font-medium tracking-wide">编辑记录</span>
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
              <span className="text-[10px] font-medium tracking-wide">多选</span>
            </button>
            <button
              onClick={async () => {
                await db.raw_logs.delete(contextMenuState.log.id);
                setContextMenuState({ ...contextMenuState, isOpen: false });
              }}
              className="flex flex-col items-center justify-center w-[4.2rem] px-1 py-2 text-rose-400 hover:text-rose-300 transition-colors hover:bg-white/10 rounded-r-lg disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5 mb-1.5" />
              <span className="text-[10px] font-medium tracking-wide">删除记录</span>
            </button>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {isEditingModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-[110] flex items-center justify-center p-4 transition-opacity">
          <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-stone-100 flex justify-between items-center bg-stone-50/50">
              <h3 className="text-[15px] font-medium text-stone-800">
                编辑碎屑
              </h3>
              <button
                onClick={() => setIsEditingModalOpen(false)}
                className="text-stone-400 hover:text-stone-600 p-1"
              >
                <Square className="w-4 h-4 opacity-0" /> {/* Spacer */}
              </button>
            </div>
            <div className="p-4">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full bg-stone-50 rounded-xl p-3 text-[15px] outline-none border border-stone-200 focus:border-stone-400 min-h-[120px] resize-none"
                placeholder="内容..."
                autoFocus
              />
            </div>
            <div className="p-4 flex gap-3">
              <button
                onClick={() => setIsEditingModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl text-[14px] font-medium text-stone-600 bg-stone-100 hover:bg-stone-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  if (activeLog && editContent.trim()) {
                    await db.raw_logs.update(activeLog.id, {
                      content: editContent.trim(),
                    });
                    setIsEditingModalOpen(false);
                  }
                }}
                disabled={!editContent.trim()}
                className="flex-1 py-2.5 rounded-xl text-[14px] font-medium text-white bg-[#2a2a2a] hover:bg-[#222222] transition-colors disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
