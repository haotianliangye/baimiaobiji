// Web Worker that computes cosine similarity for semantic search off the main
// thread (PRD §2 / §4.3.4). Kept dependency-free: it does NOT import db or
// settings.store — those don't work inside a worker. The main thread performs
// IndexedDB date/prompt pre-filtering and candidate collection, then posts the
// query embedding plus the surviving candidate embeddings here. We return the
// similarity scores keyed by `${type}:${id}` so the main thread can map them
// back to record/diary/review metadata.
//
// Transfer strategy (v1): structured clone of number[][]. Candidate counts are
// bounded by MAX_SEMANTIC_CANDIDATES (1000) and usually far smaller after
// date/prompt pre-filtering, so the clone cost is acceptable. Packing into a
// single transferable Float32Array is a future optimization, not needed now.
//
// Typing note: this project's tsconfig has no `WebWorker` lib (only DOM), so
// DedicatedWorkerGlobalScope is unavailable. We cast `self` to the DOM `Worker`
// type, which exposes compatible `postMessage(message, options?)`, `onmessage`
// and `addEventListener` signatures — sufficient for tsc. At runtime `self` is
// the DedicatedWorkerGlobalScope and these calls behave correctly.

const ctx = self as unknown as Worker;

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

interface CosineBatchRequest {
  requestId: number;
  queryEmbedding: number[];
  candidates: Array<{ key: string; embedding: number[] }>;
  threshold: number;
}

ctx.onmessage = (e: MessageEvent) => {
  const { requestId, queryEmbedding, candidates, threshold } = e.data as CosineBatchRequest;

  if (!queryEmbedding || queryEmbedding.length === 0 || !candidates) {
    ctx.postMessage({ requestId, results: [] });
    return;
  }

  const results: Array<{ key: string; sim: number }> = [];
  for (const c of candidates) {
    if (!c.embedding || c.embedding.length === 0) continue;
    const sim = cosineSimilarity(queryEmbedding, c.embedding);
    if (sim > threshold) {
      results.push({ key: c.key, sim });
    }
  }

  results.sort((a, b) => b.sim - a.sim);
  // Cap well above the main thread's top-20 RRF need; more would only waste the
  // structured-clone transfer on the way back.
  const capped = results.slice(0, 100);

  ctx.postMessage({ requestId, results: capped });
};
