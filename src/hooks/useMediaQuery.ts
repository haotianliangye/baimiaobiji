import { useState, useEffect } from 'react';

/**
 * 响应式媒体查询 Hook：订阅 CSS 媒体查询，返回当前是否匹配。
 *
 * SSR 友好：服务端没有 window 时返回 false；客户端首屏也用 false（默认 desktop=false → 走移动端分支），
 * 后续 useEffect 启动监听后会自动同步到正确值。
 *
 * @param query 标准 CSS 媒体查询字符串，如 `'(min-width: 768px)'`
 * @returns boolean 当前是否匹配
 *
 * @example
 * const isDesktop = useMediaQuery('(min-width: 768px)');
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    // 同步一次（避免在初始 useState 之后 listener 还没注册期间变化）
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    // 现代浏览器：addEventListener；老 Safari：addListener
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    } else {
      mql.addListener(handler);
      return () => mql.removeListener(handler);
    }
  }, [query]);

  return matches;
}
