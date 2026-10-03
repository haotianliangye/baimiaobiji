const GOOGLE_ORIGIN = 'https://generativelanguage.googleapis.com';

export function geminiCredentials(apiKey: unknown, baseUrl: unknown, serverKey?: string): { apiKey: string; baseUrl?: string } {
  if (typeof apiKey === 'string' && apiKey.trim()) {
    return { apiKey, baseUrl: typeof baseUrl === 'string' ? baseUrl : undefined };
  }
  if (!serverKey) throw new Error('请在设置页面中配置你的 Gemini API Key');
  if (baseUrl !== undefined && baseUrl !== '') {
    const url = new URL(String(baseUrl));
    if (url.origin !== GOOGLE_ORIGIN || url.username || url.password || url.search || url.hash || !['/', '/v1beta', '/v1beta/'].includes(url.pathname)) {
      throw new Error('Custom Gemini endpoints require your own API key');
    }
  }
  return { apiKey: serverKey, baseUrl: GOOGLE_ORIGIN };
}
