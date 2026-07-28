/**
 * #009-ext + #010: 通用流式 TTS 播放器（Gemini pcm / minimax mp3 / 火山引擎 mp3）。
 *
 * 用 fetch + ReadableStream 接收 /api/tts/stream 的 SSE 响应；逐个事件解析：
 *   - config 事件 → 创建 AudioContext + 加载对应 worklet 模块（pcm-player / mp3-scheduler）
 *   - audio 事件 →
 *       format='pcm': base64 → Int16Array → postMessage({type:'samples', samples:i16})
 *       format='mp3': hex → Uint8Array → audioCtx.decodeAudioData() → postMessage({type:'decode', buffer:audioBuf})
 *   - end 事件 → 通知 worklet 自然结束
 *   - error 事件 → 抛错并清理
 *
 * 暴露 stop() 立即终止（关 fetch + 关 AudioContext）。
 */

import { useSettingsStore } from '../store/settings.store';

export interface StreamPlayHandle {
  /** 立即停止并释放资源。幂等。 */
  stop: () => void;
  /** Promise：流式播放自然结束后 resolve，错误时 reject。 */
  done: Promise<void>;
  /**
   * 注册首个音频样本真正开始播放时的回调（用于上层 store 把 phase 从 'preparing'
   * 切到 'playing'，避免用 setTimeout 假装切到 playing）。
   */
  onFirstPlay: (cb: () => void) => void;
}

interface SSEConfigPcm {
  event: 'config';
  format: 'pcm' | undefined;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}
interface SSEConfigMp3 {
  event: 'config';
  format: 'mp3';
  sampleRate: number;
  channels: number;
}
type SSEConfig = SSEConfigPcm | SSEConfigMp3;

interface SSEAudioPcm {
  event: 'audio';
  format: 'pcm';
  data: string; // base64
}
interface SSEAudioMp3 {
  event: 'audio';
  format: 'mp3';
  data: string; // hex
  segmentIndex?: number;
  totalSegments?: number;
}
type SSEAudio = SSEAudioPcm | SSEAudioMp3;

/**
 * 启动一次流式 TTS 播放。文本被 stripMarkdown 处理后再发给后端。
 *
 * 适用于所有 Provider（Gemini / minimax / 火山引擎）；后端会按 settings.provider 路由。
 * 若后端流式失败，调用方应降级到 src/lib/tts.ts 的 speakExternalFallback（非流式）。
 */
export async function playTtsStream(text: string): Promise<StreamPlayHandle> {
  const settings = useSettingsStore.getState();
  const cleanText = stripMarkdownForStream(text);

  const controller = new AbortController();
  let audioCtx: AudioContext | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let format: 'pcm' | 'mp3' | null = null;
  let finished = false;
  let stopped = false;
  let firstPlayCallback: (() => void) | null = null;
  let firstPlayFired = false;
  let resolveDone!: () => void;
  let rejectDone!: (err: Error) => void;
  const tStart = Date.now();

  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    if (workletNode) {
      try {
        workletNode.port.postMessage({ type: 'stop' });
      } catch {/* noop */}
    }
    if (audioCtx && audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {/* noop */});
    }
    if (!finished) {
      finished = true;
      resolveDone();
    }
  };

  const fireFirstPlay = () => {
    if (firstPlayFired) return;
    firstPlayFired = true;
    firstPlayCallback?.();
  };

  (async () => {
    try {
      console.log('[ttsStream] POST /api/tts/stream', { textLen: cleanText.length, provider: settings.ttsProvider, voice: settings.ttsVoice });
      const res = await fetch('/api/tts/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cleanText,
          settings: {
            provider: settings.ttsProvider,
            apiKey: settings.ttsApiKey,
            baseUrl: settings.ttsBaseUrl,
            model: settings.ttsModel,
            voice: settings.ttsVoice,
            rate: settings.ttsRate,
          },
        }),
        signal: controller.signal,
      });
      console.log('[ttsStream] response received in', Date.now() - tStart, 'ms', 'status=', res.status, 'content-type=', res.headers.get('content-type'));

      if (!res.ok || !res.body) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`流式 TTS HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 200)}` : ''}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      const hexToArrayBuffer = (hex: string): ArrayBuffer => {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
          bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        }
        // 解码时 decodeAudioData 会 detach 这片 buffer；为安全起见 slice 一份。
        return bytes.buffer.slice(0);
      };

      const setupAudio = async (cfg: SSEConfig) => {
        if (audioCtx) return;
        format = cfg.format || 'pcm';
        audioCtx = new AudioContext({ sampleRate: cfg.sampleRate });
        const moduleUrl = format === 'mp3' ? '/audio-worklets/mp3-scheduler.js' : '/audio-worklets/pcm-player.js';
        const procName = format === 'mp3' ? 'mp3-scheduler' : 'pcm-player';
        await audioCtx.audioWorklet.addModule(moduleUrl);
        workletNode = new AudioWorkletNode(audioCtx, procName, {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [cfg.channels],
        });
        workletNode.port.onmessage = (e) => {
          const t = e.data?.type;
          if (t === 'finished') {
            finished = true;
            if (audioCtx && audioCtx.state !== 'closed') audioCtx.close().catch(() => {});
            const tEnd = Date.now();
            console.log(`[ttsStream] worklet finished in ${tEnd - tStart}ms (provider=${settings.ttsProvider} format=${format})`);
            resolveDone();
          } else if (t === 'ready' || t === 'resumed') {
            fireFirstPlay();
          }
        };
        workletNode.connect(audioCtx.destination);
      };

      while (true) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE 事件以 "\n\n" 分隔
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const lines = rawEvent.split('\n').filter((l) => l.startsWith('data:'));
          if (lines.length === 0) continue;
          const data = lines.map((l) => l.slice(5).trimStart()).join('\n');
          if (!data || data === '[DONE]') continue;
          try {
            const obj: any = JSON.parse(data);
            if (obj.event === 'config') {
              await setupAudio(obj as SSEConfig);
            } else if (obj.event === 'audio') {
              if (!workletNode || !audioCtx) {
                // config 还没到，先丢弃（理论上 SSE 顺序保证先 config 再 audio）
                continue;
              }
              if (audioCtx.state === 'suspended') {
                audioCtx.resume().catch(() => {/* noop */});
              }
              if ((obj as SSEAudioMp3).format === 'mp3' || format === 'mp3') {
                const ab = hexToArrayBuffer(obj.data as string);
                try {
                  const audioBuf = await audioCtx.decodeAudioData(ab);
                  workletNode.port.postMessage({ type: 'decode', buffer: audioBuf });
                } catch (e) {
                  console.error('[ttsStream] mp3 decode failed (segment dropped)', e);
                }
              } else {
                // PCM 路径：base64 → Int16Array → 转移所有权
                const bin = atob(obj.data);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                const i16 = new Int16Array(bytes.buffer);
                workletNode.port.postMessage({ type: 'samples', samples: i16 }, [i16.buffer]);
              }
            } else if (obj.event === 'end') {
              if (workletNode) workletNode.port.postMessage({ type: 'end' });
              // 不在这里 resolve；等 worklet 自然 finished 后再 resolve
              if (obj.stats) {
                console.log('[ttsStream] end stats:', obj.stats);
              }
            } else if (obj.event === 'error') {
              throw new Error(obj.message || 'TTS stream error');
            }
          } catch (err: any) {
            // 已经 throw 给上层 catch；不重复报错
            if (err?.name === 'AbortError') throw err;
          }
        }
      }

      // 流自然 EOF 但若没收到 'end' 事件，兜底给 worklet 发 end
      if (workletNode && !finished) workletNode.port.postMessage({ type: 'end' });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // stop() 主动取消
        if (!finished) {
          finished = true;
          resolveDone();
        }
        return;
      }
      console.error('[ttsStream] 错误:', err);
      if (!finished) {
        finished = true;
        rejectDone(err instanceof Error ? err : new Error(String(err)));
      }
      // 清理
      if (workletNode) {
        try { workletNode.port.postMessage({ type: 'stop' }); } catch {/* noop */}
      }
      if (audioCtx && audioCtx.state !== 'closed') {
        audioCtx.close().catch(() => {/* noop */});
      }
    }
  })();

  return {
    stop,
    done,
    onFirstPlay: (cb) => { firstPlayCallback = cb; },
  };
}

/** 与 src/lib/tts.ts 中的 stripMarkdown 等价；这里复制一份避免循环依赖。 */
function stripMarkdownForStream(text: string): string {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(^|\s)#([^\s#]+)/g, '$1$2')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/^>\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
