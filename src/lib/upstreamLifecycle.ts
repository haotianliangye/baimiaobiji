import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler, Response } from 'express';
const context = new AsyncLocalStorage<AbortSignal>();
export const upstreamSignal = () => context.getStore();
export const upstreamLifecycle: RequestHandler = (_req, res, next) => {
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  context.run(controller.signal, next);
};

export async function writeSseEvent(res: Response, event: unknown): Promise<void> {
  if (res.destroyed || res.writableEnded) throw new Error('Downstream connection closed');
  if (res.write(`data: ${JSON.stringify(event)}\n\n`)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { res.off('drain', drain); res.off('close', close); res.off('error', error); };
    const drain = () => { cleanup(); resolve(); };
    const close = () => { cleanup(); reject(new Error('Downstream connection closed')); };
    const error = (err: Error) => { cleanup(); reject(err); };
    res.once('drain', drain); res.once('close', close); res.once('error', error);
  });
}
