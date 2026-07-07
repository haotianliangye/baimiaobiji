// Owner-side wrapper around the cosine Web Worker. Provides a Promise-based
// `computeCosineBatch` that the semantic search path awaits, with per-requestId
// routing so overlapping searches (debounce + concurrent executeSearch calls)
// each resolve their own response and stale ones are dropped by the caller via
// the searchRequestId check.
//
// Resilience: if the worker cannot be constructed or throws at runtime,
// `computeCosineBatch` rejects with 'worker-unavailable' and callers fall back
// to the inline main-thread cosine loop, so semantic search keeps working on
// old WebViews that lack worker support.

import CosineWorker from './cosine.worker?worker';

export interface CosineCandidate {
  key: string; // `${type}:${id}`
  embedding: number[];
}

export interface CosineScore {
  key: string;
  sim: number;
}

interface PendingEntry {
  resolve: (result: { requestId: number; results: CosineScore[] }) => void;
  reject: (err: unknown) => void;
}

let worker: Worker | null = null;
let workerFailed = false;
let nextRequestId = 1;
const pending = new Map<number, PendingEntry>();

function getWorker(): Worker | null {
  if (workerFailed) return null;
  if (worker) return worker;
  try {
    worker = new CosineWorker();
    worker.onmessage = (e: MessageEvent) => {
      const { requestId, results } = e.data as { requestId: number; results: CosineScore[] };
      const entry = pending.get(requestId);
      if (entry) {
        pending.delete(requestId);
        entry.resolve({ requestId, results });
      }
    };
    worker.onerror = (err) => {
      console.error('[cosineWorker] worker error, will fall back to main thread:', err);
      workerFailed = true;
      // Reject every in-flight request so callers fall back to inline cosine.
      for (const [, entry] of pending) {
        entry.reject(new Error('worker-unavailable'));
      }
      pending.clear();
      worker = null;
    };
    return worker;
  } catch (err) {
    console.error('[cosineWorker] failed to construct worker:', err);
    workerFailed = true;
    return null;
  }
}

/**
 * Compute cosine similarity of `queryEmbedding` against every candidate in
 * `candidates`, returning those above `threshold` sorted by similarity desc
 * (capped at 100). Rejects with 'worker-unavailable' if the worker is not
 * available, so the caller can fall back to a main-thread loop.
 *
 * The correlation id is minted internally so callers don't have to manage one
 * (and can't collide across callers — e.g. search vs Copilot retrieval).
 * Callers that need staleness cancellation should capture their own sequence
 * id before the await and compare it after, independent of this call.
 */
export function computeCosineBatch(
  queryEmbedding: number[],
  candidates: CosineCandidate[],
  threshold: number
): Promise<{ results: CosineScore[] }> {
  const w = getWorker();
  if (!w) {
    return Promise.reject(new Error('worker-unavailable'));
  }
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending.set(requestId, {
      resolve: ({ results }) => resolve({ results }),
      reject,
    });
    w.postMessage({ requestId, queryEmbedding, candidates, threshold });
  });
}
