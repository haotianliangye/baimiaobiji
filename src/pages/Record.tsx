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
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { db } from "../db/db";
import { generateUUID } from "../lib/utils";
import { useSettingsStore } from "../store/settings.store";
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
  const [inputText, setInputText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [showHeatmap, setShowHeatmap] = useState(false);

  // Action sheet & edit states
  const [activeLog, setActiveLog] = useState<any>(null);
  const [isActionSheetOpen, setIsActionSheetOpen] = useState(false);
  const [isEditingModalOpen, setIsEditingModalOpen] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [recordingDuration, setRecordingDuration] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const holdTimeoutRef = useRef<any>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMicInitializingRef = useRef(false);

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
    <div className="flex flex-col h-full bg-white relative">
      <div className="flex h-[52px] items-center px-4 bg-stone-50/80 backdrop-blur border-b border-stone-100 z-10 shrink-0 w-full justify-between">
        <h2 className="text-[13px] font-medium tracking-wide text-stone-500 uppercase">
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

      <div className="flex-1 overflow-y-auto p-5 space-y-6 pb-6 w-full relative z-0">
        {!logs || logs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-stone-400 text-[15px] tracking-tight">
            记录下你此刻的时光碎屑
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              id={`log-${log.id}`}
              className="flex gap-4 group items-start px-2 py-1 rounded-lg transition-colors active:bg-stone-50"
              onTouchStart={() => {
                holdTimeoutRef.current = setTimeout(() => {
                  if (window.navigator?.vibrate) window.navigator.vibrate(50);
                  setActiveLog(log);
                  setIsActionSheetOpen(true);
                }, 500);
              }}
              onTouchEnd={() => clearTimeout(holdTimeoutRef.current)}
              onTouchMove={() => clearTimeout(holdTimeoutRef.current)}
              onContextMenu={(e) => {
                // Prevent default context menu, show our custom one
                e.preventDefault();
                if (window.navigator?.vibrate) window.navigator.vibrate(50);
                setActiveLog(log);
                setIsActionSheetOpen(true);
              }}
            >
              <span className="text-[11px] font-mono text-stone-400 shrink-0 mt-[4px] w-10 text-right opacity-80">
                {format(new Date(log.created_at), "HH:mm")}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] leading-relaxed text-stone-900 font-sans tracking-tight break-all">
                  {log.content}
                </p>
                {log.audioBlob && (
                  <div className="mt-2 w-full max-w-[220px]">
                    <AudioPlayer blob={log.audioBlob} />
                    {log.audioDuration !== undefined && (
                      <div className="text-[11px] font-mono text-stone-400 mt-1 pl-1">
                        时长: {formatRecordTime(log.audioDuration)}
                      </div>
                    )}
                  </div>
                )}
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
          ))
        )}
        <div ref={endOfListRef} />
      </div>

      <div className="p-4 bg-white/90 backdrop-blur-md border-t border-stone-50 shrink-0 z-20 relative">
        <form
          onSubmit={handleSubmit}
          className={`flex items-end bg-stone-100 rounded-2xl px-4 py-2 border transition-all shadow-[0_2px_8px_rgb(0_0_0_/_0.04)] ${
            !isTodayDate
              ? "opacity-50 pointer-events-none border-transparent"
              : "border-black/5 focus-within:border-black/20 focus-within:bg-white"
          }`}
        >
          <button
            type="button"
            onClick={handleToggleListen}
            className={`p-2 -ml-2 transition-colors shrink-0 ${isListening ? "text-red-500 animate-pulse" : "text-stone-400 hover:text-stone-900"}`}
            title="点击开始/停止录音"
          >
            {isListening ? (
              <Square className="w-5 h-5 fill-current" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </button>

          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              rows={1}
              className={`w-full bg-transparent px-3 py-2 text-[15px] outline-none placeholder:text-stone-400 min-w-0 resize-none overflow-y-auto no-scrollbar ${isListening ? "opacity-0" : ""}`}
              placeholder={isSubmitting ? "正在解析..." : "输入你想记录的碎片..."}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSubmitting || isListening}
              style={{ minHeight: "40px", maxHeight: "50vh" }}
            />
            {isListening && (
              <div className="absolute inset-0 flex items-center justify-between px-3 pointer-events-none">
                <span className="text-stone-500 font-medium animate-pulse">正在录音...</span>
                <span className="text-red-500 font-mono text-[14px]">{formatRecordTime(recordingDuration)}</span>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={!inputText.trim() || isSubmitting}
            className="p-2 -mr-2 text-stone-400 hover:text-stone-900 disabled:opacity-30 transition-colors shrink-0"
          >
            {isSubmitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <ArrowRight className="w-5 h-5" />
            )}
          </button>
        </form>
      </div>

      {showHeatmap && (
        <CalendarHeatmap
          currentDate={targetDate}
          onSelectDate={(date) => setSearchParams({ date })}
          onClose={() => setShowHeatmap(false)}
        />
      )}

      {/* Action Sheet */}
      <ActionSheet
        isOpen={isActionSheetOpen}
        onClose={() => setIsActionSheetOpen(false)}
        actions={[
          {
            label: "复制内容",
            icon: <Copy className="w-4 h-4" />,
            onClick: () => {
              if (activeLog) {
                navigator.clipboard.writeText(activeLog.content);
              }
            },
          },
          {
            label: "编辑记录",
            icon: <Edit2 className="w-4 h-4" />,
            onClick: () => {
              if (activeLog) {
                setEditContent(activeLog.content);
                setIsEditingModalOpen(true);
              }
            },
          },
          {
            label: "删除记录",
            icon: <Trash2 className="w-4 h-4" />,
            danger: true,
            onClick: async () => {
              if (activeLog) {
                await db.raw_logs.delete(activeLog.id);
              }
            },
          },
        ]}
      />

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
                className="flex-1 py-2.5 rounded-xl text-[14px] font-medium text-white bg-stone-900 hover:bg-stone-800 transition-colors disabled:opacity-50"
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
