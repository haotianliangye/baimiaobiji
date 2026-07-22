/**
 * #009-ext: 流式 TTS 播放器。
 *
 * 用 fetch + ReadableStream 接收后端 /api/tts/stream 的 SSE 响应；
 * 逐个事件解析：config 事件 → 初始化 AudioContext + AudioWorklet；
 * audio 事件 → base64 解码为 Int16Array，postMessage 给 worklet 播放；
 * end 事件 → 等 worklet 排空 buffer 后自然结束；
 * error 事件 → 抛错并清理。
 *
 * 暴露 stop() 立即终止（关 fetch + 关 AudioContext）。
 */

import { useSettingsStore } from '../store/settings.store';

export interface StreamPlayHandle {
  /** 立即停止并释放资源。幂等。 */
  stop: () => void;
  /** Promise：流式播放自然结束后 resolve，错误时 reject。 */
  done: Promise<void>;
}

interface SSEConfig {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

/**
 * 启动一次流式 TTS 播放。文本被 stripMarkdown 处理后再发给后端。
 * 仅在 Gemini Provider 下可用（其它 Provider 后端会回 400，自动降级由调用方处理）。
 */
export async function playTtsStream(text: string): Promise<StreamPlayHandle> {
  const settings = useSettingsStore.getState();
  const cleanText = stripMarkdownForStream(text);

  const controller = new AbortController();
  let audioCtx: AudioContext | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let finished = false;
  let stopped = false;
  let resolveDone!: () => void;
  let rejectDone!: (err: Error) => void;

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

  (async () => {
    const t0 = Date.now();
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
          },
        }),
        signal: controller.signal,
      });
      console.log('[ttsStream] response received in', Date.now() - t0, 'ms', 'status=', res.status, 'content-type=', res.headers.get('content-type'));

      if (!res.ok || !res.body) {
        // 退化降级：让调用方知道需要走非流式路径
        const errBody = await res.text().catch(() => '');
        throw new Error(`流式 TTS HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 200)}` : ''}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      const handleEvent = async (eventObj: any) => {
        if (eventObj.event === 'config') {
          const cfg = eventObj as SSEConfig;
          audioCtx = new AudioContext({ sampleRate: cfg.sampleRate });
          await audioCtx.audioWorklet.addModule('/audio-worklets/pcm-player.js');
          workletNode = new AudioWorkletNode(audioCtx, 'pcm-player', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [cfg.channels],
          });
          workletNode.port.onmessage = (e) => {
            if (e.data?.type === 'finished') {
              finished = true;
              if (audioCtx && audioCtx.state !== 'closed') audioCtx.close().catch(() => {});
              resolveDone();
            }
          };
          workletNode.connect(audioCtx.destination);
        } else if (eventObj.event === 'audio') {
          if (!workletNode) return;
          // base64 -> Int16Array
          const bin = atob(eventObj.data);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const i16 = new Int16Array(bytes.buffer);
          // 如果 audioCtx 被 autoplay policy 暂停了，在首个 chunk 到达时 resume
          if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {/* noop */});
          }
          // 把样本所有权转给 worklet（避免 copy）
          workletNode.port.postMessage({ type: 'samples', samples: i16 }, [i16.buffer]);
        } else if (eventObj.event === 'end') {
          if (workletNode) workletNode.port.postMessage({ type: 'end' });
          // 不在这里 resolve，等 worklet 自然 finished 再 resolve
        } else if (eventObj.event === 'error') {
          throw new Error(eventObj.message || 'TTS stream error');
        }
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
          // 提取 data: 行
          const lines = rawEvent.split('\n').filter((l) => l.startsWith('data:'));
          if (lines.length === 0) continue;
          const data = lines.map((l) => l.slice(5).trimStart()).join('\n');
          if (!data || data === '[DONE]') continue;
          try {
            const obj = JSON.parse(data);
            await handleEvent(obj);
          } catch (err: any) {
            console.error('[ttsStream] 解析 SSE 事件失败:', err, data);
          }
        }
      }

      // 流结束但若没收到 'end' 事件，兜底触发
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

  return { stop, done };
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