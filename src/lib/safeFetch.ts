import { upstreamSignal } from './upstreamLifecycle';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import { resolveSafeDestination } from './safeBaseUrl';

export interface SafeFetchPolicy {
  webdavLocal?: boolean;
  maxResponseBytes?: number;
}
type Resolver = typeof resolveSafeDestination;

/** Resolve once, validate every answer and connect only to that approved answer.
 * TLS and Host continue to use the original hostname. Redirects are never followed. */
export function createSafeFetch(resolve: Resolver = resolveSafeDestination) {
  return async function safeFetch(input: string | URL | Request, options: RequestInit = {}, timeoutMs = 30_000, policy: SafeFetchPolicy = {}): Promise<Response> {
    const controller = new AbortController();
    const signals = [options.signal, upstreamSignal(), input instanceof Request ? input.signal : undefined].filter((signal): signal is AbortSignal => !!signal);
    const caller = signals.length ? AbortSignal.any(signals) : undefined;
    const abort = () => controller.abort(caller?.reason);
    if (caller?.aborted) abort();
    else caller?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('Upstream deadline exceeded', 'TimeoutError')), timeoutMs);
    timer.unref?.();
    const cleanup = () => { clearTimeout(timer); caller?.removeEventListener('abort', abort); };
    try {
      const request = new Request(input, { ...options, signal: controller.signal, redirect: 'error' });
      const destination = await Promise.race([
        resolve(request.url, policy),
        new Promise<never>((_, reject) => { if (controller.signal.aborted) reject(controller.signal.reason); else controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }); }),
      ]);
      controller.signal.throwIfAborted();
      const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
      controller.signal.throwIfAborted();
      const headers = Object.fromEntries(request.headers.entries());
      headers['accept-encoding'] = 'identity';
      // Caller headers cannot change the validated recipient or HTTP framing.
      delete headers.host; delete headers.connection; delete headers['transfer-encoding']; delete headers['content-length'];
      if (body) headers['content-length'] = String(body.length);
      const address = destination.addresses[0];
      if (!address || ![4, 6].includes(address.family)) throw new Error('No approved upstream address');
      return await new Promise<Response>((resolveResponse, reject) => {
        const transport = destination.url.protocol === 'https:' ? https : http;
        const outgoing = transport.request(destination.url, {
          method: request.method, headers, agent: false, signal: controller.signal,
          lookup: ((_hostname: string, lookupOptions: any, callback: any) => {
            if (lookupOptions?.all) callback(null, [address]);
            else callback(null, address.address, address.family);
          }) as any,
        }, incoming => {
          try {
          const status = incoming.statusCode || 502;
          if (status >= 300 && status < 400 && incoming.headers.location) {
            incoming.destroy(); cleanup(); reject(new Error('Upstream redirects are not allowed')); return;
          }
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(incoming.headers)) {
            if (Array.isArray(value)) value.forEach(v => responseHeaders.append(key, v));
            else if (value !== undefined) responseHeaders.set(key, value);
          }
          if (request.method === 'HEAD' || [204, 205, 304].includes(status)) {
            incoming.resume(); cleanup(); resolveResponse(new Response(null, { status, headers: responseHeaders })); return;
          }
          let source: Readable = incoming;
          const encoding = incoming.headers['content-encoding'];
          if (encoding && encoding !== 'identity') {
            const decompress = encoding === 'gzip' ? createGunzip() : encoding === 'deflate' ? createInflate() : encoding === 'br' ? createBrotliDecompress() : undefined;
            if (!decompress) { incoming.destroy(); cleanup(); reject(new Error('Unsupported upstream compression')); return; }
            incoming.on('error', err => decompress.destroy(err));
            source = incoming.pipe(decompress);
            responseHeaders.delete('content-encoding'); responseHeaders.delete('content-length');
          }
          const reader = (Readable.toWeb(source, { strategy: { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength } }) as ReadableStream<Uint8Array>).getReader();
          let bytes = 0;
          const maxBytes = policy.maxResponseBytes ?? 64 * 1024 * 1024;
          const stream = new ReadableStream<Uint8Array>({
            async pull(target) {
              try {
                const chunk = await reader.read();
                if (chunk.done) { cleanup(); target.close(); return; }
                bytes += chunk.value.byteLength;
                if (bytes > maxBytes) throw new Error('Upstream response exceeds byte limit');
                target.enqueue(chunk.value);
              } catch (err) {
                cleanup(); outgoing.destroy(); incoming.destroy(); source.destroy();
                await reader.cancel(err).catch(() => {}); target.error(err);
              }
            },
            async cancel(reason) { cleanup(); outgoing.destroy(); incoming.destroy(); source.destroy(); await reader.cancel(reason).catch(() => {}); },
          });
          const response = new Response(stream, { status, statusText: incoming.statusMessage, headers: responseHeaders });
          Object.defineProperty(response, 'url', { value: request.url });
          resolveResponse(response);
          } catch (err) { incoming.destroy(); cleanup(); reject(err); }
        });
        outgoing.on('error', err => { cleanup(); reject(err); });
        outgoing.end(body);
      });
    } catch (err) { cleanup(); throw err; }
  };
}
export const safeFetchWithTimeout = createSafeFetch();
