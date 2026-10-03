export type OAuthProvider = 'onedrive' | 'gdrive' | 'dropbox';
const KEY = 'baimiao_pending_oauth';
const MAX_AGE_MS = 10 * 60 * 1000;
export function beginOAuth(provider: OAuthProvider, redirectUri: string, storage: Storage = sessionStorage, now = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const state = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  storage.setItem(KEY, JSON.stringify({ state, provider, redirectUri, createdAt: now }));
  return state;
}
/** Consume once before credentials or preferences are installed. */
export function consumeOAuthFragment(fragment: string, redirectUri: string, storage: Storage = sessionStorage, now = Date.now()): { provider: OAuthProvider; token: string } | null {
  const raw = storage.getItem(KEY);
  storage.removeItem(KEY);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw);
    const params = new URLSearchParams(fragment.replace(/^#/, ''));
    if (params.getAll('state').length !== 1 || params.getAll('access_token').length !== 1) return null;
    const token = params.get('access_token');
    if (!token || params.get('state') !== pending.state || !/^[a-f0-9]{64}$/.test(pending.state) || pending.redirectUri !== redirectUri || !Number.isFinite(pending.createdAt) || now < pending.createdAt || now - pending.createdAt > MAX_AGE_MS || !['onedrive', 'gdrive', 'dropbox'].includes(pending.provider)) return null;
    return { provider: pending.provider, token };
  } catch { return null; }
}
