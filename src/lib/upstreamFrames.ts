/** Incremental framing with a per-frame cap; finally cancels on early return. */
export async function* readUpstreamFrames(body: ReadableStream<Uint8Array>, delimiter: string, maxFrameBytes = 8 * 1024 * 1024) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let index: number;
      while ((index = pending.indexOf(delimiter)) >= 0) {
        const frame = pending.slice(0, index);
        if (Buffer.byteLength(frame) > maxFrameBytes) throw new Error('Upstream frame exceeds byte limit');
        pending = pending.slice(index + delimiter.length);
        yield frame;
      }
      if (Buffer.byteLength(pending) > maxFrameBytes) throw new Error('Upstream frame exceeds byte limit');
      if (done) { if (pending) yield pending; break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
