/**
 * fetchWithTimeout — 带超时的 fetch 包装
 *
 * Issue #002 引入。原因：所有后端 /api/* 端点对外部 LLM / 网盘 / TTS 服务的 fetch 调用
 * 都没有超时。服务商挂掉时，整个 Express 进程会被挂死的请求拖住。
 *
 * 放在 src/lib/ 而非 server.ts 内部的考量：
 *   1. 可独立 import 进行单元测试（tests/fetch-timeout.test.ts）
 *   2. 后端和未来可能的 SSR 共享同一份实现
 *   3. 替换为全局 fetch 不会污染调用方代码
 *
 * 行为：
 *   - 默认 30s 超时
 *   - 超时触发 AbortController.abort()，fetch 抛 AbortError
 *   - deadline 保持到正文读完、取消或失败，并保留调用方取消信号。
 *   - 响应正文最多 64 MiB，拒绝重定向。
 *
 * @example
 *   const res = await fetchWithTimeout('https://api.example.com/v1/chat', {
 *     method: 'POST',
 *     headers: { Authorization: 'Bearer xxx' },
 *     body: JSON.stringify(payload),
 *   }, 15000);
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 30000
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Upstream deadline exceeded', 'AbortError')), timeoutMs);
  const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    controller.signal.throwIfAborted();
    const response = await fetch(url, { ...options, redirect: 'error', signal: controller.signal });
    if (!response.body) { cleanup(); return response; }
    reader = response.body.getReader();
    let bytes = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(target) {
        try {
          controller.signal.throwIfAborted();
          const chunk = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
            const onAbort = () => reject(controller.signal.reason);
            controller.signal.addEventListener('abort', onAbort, { once: true });
            reader!.read().then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', onAbort));
          });
          if (chunk.done) { cleanup(); target.close(); return; }
          bytes += chunk.value.byteLength;
          if (bytes > 64 * 1024 * 1024) throw new Error('Upstream response exceeds byte limit');
          target.enqueue(chunk.value);
        } catch (err) { cleanup(); controller.abort(err); await reader!.cancel(err).catch(() => {}); target.error(err); }
      },
      async cancel(reason) { cleanup(); controller.abort(reason); await reader!.cancel(reason).catch(() => {}); },
    });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (err) { cleanup(); throw err; }
}

/**
 * 超时常量。按任务类型分档，避免一刀切。
 * 来源：docs/issues/p0/002-server-timeout-and-degradation.md
 */
export const FETCH_TIMEOUTS = {
  /** 嵌入式向量生成（轻量 RPC） */
  embedding: 15_000,
  /** test-connection / 健康探测 */
  testConnection: 8_000,
  /** 语音转写（长任务，可能需大文件上传） */
  transcribe: 60_000,
  /** 语音合成（中等任务） */
  tts: 30_000,
  /** WebDAV 同步（中等等待） */
  webdav: 30_000,
  /** LLM 通用调用 */
  llm: 45_000,
} as const;