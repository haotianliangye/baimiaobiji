import { Worker } from 'node:worker_threads';
import { computeConfidence, shouldDropTranscript, type HallucinationPattern } from './hallucinationFilter';

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { text, patterns } = workerData;
let index = -1;
for (let i = 0; i < patterns.length; i++) {
  const p = patterns[i];
  let hit = false;
  if (p.type === 'exact') hit = text.includes(p.value);
  else { try { hit = new RegExp(p.value).test(text); } catch {} }
  if (hit) { index = i; break; }
}
parentPort.postMessage(index);
`;
let active = 0;

/** Arbitrary JS regex semantics are retained, outside the server event loop. */
export async function evaluateTranscriptSafely(text: string, patterns: HallucinationPattern[], budgetMs = 500) {
  if (typeof text !== 'string' || text.length > 100_000 || !Array.isArray(patterns) || patterns.length > 128 || patterns.some(p => !p || typeof p.key !== 'string' || p.key.length > 256 || !['exact', 'regex'].includes(p.type) || typeof p.value !== 'string' || p.value.length > 2048)) throw new Error('Transcription filter input exceeds limits');
  if (active >= 4) throw new Error('Transcription filter is busy');
  active++;
  let worker: Worker | undefined;
  try {
    const index = await new Promise<number>((resolve, reject) => {
      worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { text, patterns: patterns.map(({ key, type, value }) => ({ key, type, value })) }, resourceLimits: { maxOldGenerationSizeMb: 32 } });
      const timer = setTimeout(() => reject(new Error('Transcription filter deadline exceeded')), budgetMs);
      const finish = (fn: () => void) => { clearTimeout(timer); fn(); };
      worker.once('message', value => finish(() => resolve(value)));
      worker.once('error', error => finish(() => reject(error)));
      worker.once('exit', code => finish(() => { if (code !== 0) reject(new Error('Transcription filter worker failed')); }));
    });
    const matched = index < 0 ? null : patterns[index];
    const confidence = computeConfidence(text, matched, patterns);
    const decision = shouldDropTranscript(text, matched, confidence);
    return { dropped: decision.drop, finalText: decision.drop ? '' : text, reason: decision.reason, confidence };
  } finally {
    if (worker) await worker.terminate();
    active--;
  }
}
