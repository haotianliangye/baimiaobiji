/**
 * #10 TTS 朗读模块
 *
 * 封装 Web Speech API（SpeechSynthesis）与可选的外部 TTS API，为回顾/明悟/洞察
 * 的 AI 产出与 LLM Chat 的 AI 回复提供统一的朗读接口。
 *
 * - speak(text) / stop() / isSpeaking 状态由 Zustand store 管理，跨组件共享。
 * - 同一时间只朗读一段文本；播放新文本时自动停止旧播放。
 * - 语言跟随内容语言检测（简单启发式：中文/英文判断）或用户指定默认朗读语言。
 * - 播放状态在按钮可见（播放中显示停止图标）。
 */
import { useCallback } from 'react';
import { create } from 'zustand';
import { useSettingsStore } from '../store/settings.store';

export type TTSService = 'webspeech' | 'external';
export type TTSLang = 'auto' | 'zh' | 'en';

export interface TTSSpeakOptions {
  service?: TTSService;
  lang?: TTSLang;
  rate?: number;
  voice?: string;
  // #009: 外部 TTS API 参数（service === 'external' 时随请求发送给后端 /api/tts）
  ttsProvider?: 'gemini' | 'volcengine';
  ttsApiKey?: string;
  ttsBaseUrl?: string;
  ttsModel?: string;
}

/**
 * 简单语言检测启发式：中文字符占比 >= 英文字母数判定为中文，否则英文。
 */
export function detectLang(text: string): 'zh' | 'en' {
  if (!text) return 'zh';
  const chineseChars = (text.match(/[一-鿿]/g) || []).length;
  const asciiLetters = (text.match(/[a-zA-Z]/g) || []).length;
  return chineseChars >= asciiLetters ? 'zh' : 'en';
}

/**
 * 将 BCP-47 语言标签映射到 SpeechSynthesisVoice 的语言前缀。
 */
function langToBcp47(lang: 'zh' | 'en'): string {
  return lang === 'zh' ? 'zh-CN' : 'en-US';
}

/**
 * 从 Markdown 文本中提取纯文本供朗读使用。
 * 去除代码块、链接 URL、图片、标题标记、列表标记、加粗/斜体等格式符号，
 * 保留可读文字内容。
 */
export function stripMarkdown(text: string): string {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, ' ')          // 代码块
    .replace(/`[^`]*`/g, ' ')                  // 行内代码
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')  // 图片 -> alt 文字
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // 链接 -> 链接文字
    .replace(/^#{1,6}\s+/gm, '')               // 标题标记
    .replace(/(^|\s)#([^\s#]+)/g, '$1$2')      // #标签 -> 标签名
    .replace(/^\s*[-*+]\s+/gm, '')             // 无序列表标记
    .replace(/^\s*\d+\.\s+/gm, '')             // 有序列表标记
    .replace(/[*_~]/g, '')                      // 加粗/斜体/删除线
    .replace(/^>\s+/gm, '')                    // 引用标记
    .replace(/\n{3,}/g, '\n\n')                // 折叠多余空行
    .trim();
}

// --- 模块级播放句柄 ---
let currentUtterance: SpeechSynthesisUtterance | null = null;
let currentAudio: HTMLAudioElement | null = null;

/**
 * 停止底层音频播放（不更新 store 状态），用于切换播放时先静默取消旧播放。
 */
function cancelPlayback() {
  if (currentUtterance) {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
    currentUtterance = null;
  }
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch {
      /* noop */
    }
    if (currentAudio.src) {
      URL.revokeObjectURL(currentAudio.src);
    }
    currentAudio = null;
  }
}

interface TTSStore {
  /** 当前正在朗读的原始文本（用于按钮判断是否高亮） */
  speakingText: string | null;
  /** 是否正在朗读 */
  isSpeaking: boolean;
  /** 朗读文本（toggle：若该文本正在播放则停止） */
  speak: (text: string, opts?: TTSSpeakOptions) => void;
  /** 停止所有朗读 */
  stop: () => void;
}

export const useTTSStore = create<TTSStore>((set, get) => ({
  speakingText: null,
  isSpeaking: false,

  speak: (text, opts = {}) => {
    const state = get();

    // Toggle：再次点击同一段正在播放的文本 -> 停止
    if (state.isSpeaking && state.speakingText === text) {
      get().stop();
      return;
    }

    // 停止当前播放（不触发状态闪烁）
    cancelPlayback();

    const service = opts.service || 'webspeech';
    const langPref = opts.lang || 'auto';
    const resolvedLang = langPref === 'auto' ? detectLang(text) : langPref;
    const rate = opts.rate ?? 1;
    const voiceName = opts.voice || '';

    const cleanText = stripMarkdown(text);
    if (!cleanText) return;

    // 标记为播放中
    set({ speakingText: text, isSpeaking: true });

    const onEnd = () => {
      currentUtterance = null;
      currentAudio = null;
      // 仅在确实还在播放这段文本时才清除（防止已被新播放覆盖）
      if (get().speakingText === text) {
        set({ speakingText: null, isSpeaking: false });
      }
    };

    if (service === 'webspeech') {
      speakWebSpeech(cleanText, resolvedLang, rate, voiceName, onEnd);
    } else {
      speakExternal(cleanText, resolvedLang, onEnd, {
        rate,
        voice: voiceName,
        ttsProvider: opts.ttsProvider,
        ttsApiKey: opts.ttsApiKey,
        ttsBaseUrl: opts.ttsBaseUrl,
        ttsModel: opts.ttsModel,
      });
    }
  },

  stop: () => {
    cancelPlayback();
    set({ speakingText: null, isSpeaking: false });
  },
}));

/**
 * 使用浏览器内置 Web Speech API 朗读。
 */
function speakWebSpeech(
  text: string,
  lang: 'zh' | 'en',
  rate: number,
  voiceName: string,
  onEnd: () => void
) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    console.warn('Web Speech API 不可用，无法朗读');
    onEnd();
    return;
  }

  try {
    window.speechSynthesis.cancel();
  } catch {
    /* noop */
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = langToBcp47(lang);
  utterance.rate = rate;

  // 尝试匹配语音
  const voices = window.speechSynthesis.getVoices();
  let voice: SpeechSynthesisVoice | undefined;
  if (voiceName) {
    voice = voices.find((v) => v.name === voiceName);
  }
  if (!voice) {
    const langPrefix = lang === 'zh' ? 'zh' : 'en';
    voice = voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix));
  }
  if (voice) {
    utterance.voice = voice;
  }

  utterance.onend = onEnd;
  utterance.onerror = onEnd;

  currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

/**
 * 调用外部 TTS API（/api/tts 端点）朗读。
 * 后端根据 settings.provider 调用 Gemini / 火山引擎，返回音频 blob，前端用 HTMLAudioElement 播放。
 */
async function speakExternal(
  text: string,
  lang: 'zh' | 'en',
  onEnd: () => void,
  opts: {
    rate?: number;
    voice?: string;
    ttsProvider?: 'gemini' | 'volcengine';
    ttsApiKey?: string;
    ttsBaseUrl?: string;
    ttsModel?: string;
  }
) {
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        lang,
        settings: {
          provider: opts.ttsProvider || 'gemini',
          apiKey: opts.ttsApiKey || '',
          baseUrl: opts.ttsBaseUrl || '',
          model: opts.ttsModel || '',
          voice: opts.voice || '',
          rate: opts.rate ?? 1,
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`TTS 请求失败: HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const audio = new Audio(URL.createObjectURL(blob));
    currentAudio = audio;

    audio.onended = () => {
      if (audio.src) URL.revokeObjectURL(audio.src);
      onEnd();
    };
    audio.onerror = () => {
      if (audio.src) URL.revokeObjectURL(audio.src);
      onEnd();
    };

    await audio.play();
  } catch (err) {
    console.error('外部 TTS 朗读失败:', err);
    onEnd();
  }
}

/**
 * React Hook：封装 TTS store 与 settings 配置，供组件直接使用。
 *
 * 用法：
 *   const { play, stop, isPlaying } = useTTS();
 *   <button onClick={() => play(content)}>
 *     {isPlaying(content) ? '停止' : '朗读'}
 *   </button>
 */
export function useTTS() {
  const isSpeaking = useTTSStore((s) => s.isSpeaking);
  const speakingText = useTTSStore((s) => s.speakingText);
  const speak = useTTSStore((s) => s.speak);
  const stop = useTTSStore((s) => s.stop);

  const ttsService = useSettingsStore((s) => s.ttsService);
  const ttsLang = useSettingsStore((s) => s.ttsLang);
  const ttsRate = useSettingsStore((s) => s.ttsRate);
  const ttsVoice = useSettingsStore((s) => s.ttsVoice);
  const ttsProvider = useSettingsStore((s) => s.ttsProvider);
  const ttsApiKey = useSettingsStore((s) => s.ttsApiKey);
  const ttsBaseUrl = useSettingsStore((s) => s.ttsBaseUrl);
  const ttsModel = useSettingsStore((s) => s.ttsModel);

  const play = useCallback(
    (text: string) => {
      speak(text, {
        service: ttsService,
        lang: ttsLang,
        rate: ttsRate,
        voice: ttsVoice,
        ttsProvider,
        ttsApiKey,
        ttsBaseUrl,
        ttsModel,
      });
    },
    [speak, ttsService, ttsLang, ttsRate, ttsVoice, ttsProvider, ttsApiKey, ttsBaseUrl, ttsModel]
  );

  const isPlaying = useCallback(
    (text: string) => {
      return isSpeaking && speakingText === text;
    },
    [isSpeaking, speakingText]
  );

  return { play, stop, isPlaying };
}
