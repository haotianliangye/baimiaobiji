import { AsyncLocalStorage } from 'node:async_hooks';
import { GoogleGenAI } from '@google/genai';
import { assertSafeBaseUrl } from './safeBaseUrl';
import { safeFetchWithTimeout } from './safeFetch';
import { FETCH_TIMEOUTS } from './fetchWithTimeout';

// The installed models SDK uses global fetch and has no public transport hook.
// Install once; async context confines the guarded transport to our models calls.
// Other concurrent fetch users retain their original transport.
const context = new AsyncLocalStorage<boolean>();
let installed = false;
function installTransport() {
  if (installed) return;
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, options?: RequestInit) =>
    context.getStore() ? safeFetchWithTimeout(input, options, FETCH_TIMEOUTS.transcribe) : original(input, options)) as typeof fetch;
  installed = true;
}

export async function buildGeminiClient(apiKey: string, baseUrl?: string) {
  installTransport();
  const normalized = baseUrl === 'https://generativelanguage.googleapis.com/v1beta' ? 'https://generativelanguage.googleapis.com' : baseUrl;
  const safeUrl = await assertSafeBaseUrl(normalized || 'https://generativelanguage.googleapis.com');
  const ai = new GoogleGenAI({ apiKey, httpOptions: { baseUrl: safeUrl } });
  return { models: {
    generateContent: (params: Parameters<typeof ai.models.generateContent>[0]) => context.run(true, () => ai.models.generateContent(params)),
    embedContent: (params: Parameters<typeof ai.models.embedContent>[0]) => context.run(true, () => ai.models.embedContent(params)),
  } };
}
