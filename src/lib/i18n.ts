/**
 * #12 轻量 i18n 框架 -- 不引入 i18next 等重型依赖。
 *
 * 设计：
 * - 语言存 settings.store(language: "zh" | "en")，切换后 UI 立即更新（Zustand 订阅）。
 * - t(key) 查字典，支持 {name} 插值。
 * - useTranslation() 是 React hook，订阅 language 变化后返回新的 t 函数。
 * - 非 React 上下文可用 translate(lang, key, params) 直接调用。
 */
import { useCallback } from 'react';
import { useSettingsStore } from '../store/settings.store';
import { zh } from '../i18n/zh';
import { en } from '../i18n/en';

export type Language = 'zh' | 'en';

export type TranslationDict = Record<string, string>;

const dictionaries: Record<Language, TranslationDict> = { zh, en };

/**
 * 非 React 上下文使用的纯函数翻译。按当前 settings.store 的 language 取值。
 */
export function translate(
  lang: Language,
  key: string,
  params?: Record<string, string | number>,
): string {
  const dict = dictionaries[lang] || dictionaries.zh;
  let text = dict[key];
  if (text === undefined) {
    // 回退到 zh，再回退到 key 本身
    text = dictionaries.zh[key] ?? key;
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}

/**
 * React hook：订阅 settings.store 的 language，返回 { t, language }。
 * language 变化时，所有使用 t() 的组件自动重新渲染。
 */
export function useTranslation() {
  const language = useSettingsStore((s) => s.language);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      translate(language, key, params),
    [language],
  );

  return { t, language };
}

/**
 * 获取当前语言（非 hook，直接读 store）。用于非 React 上下文。
 */
export function getCurrentLanguage(): Language {
  return useSettingsStore.getState().language || 'zh';
}

/**
 * 非 hook 版本的 t()，使用当前 store 中的 language。
 * 适用于事件处理回调、工具函数等非渲染上下文。
 */
export function t(key: string, params?: Record<string, string | number>): string {
  return translate(getCurrentLanguage(), key, params);
}
