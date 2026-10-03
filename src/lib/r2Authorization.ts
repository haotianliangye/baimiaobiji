import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

/** Personal deployments have one owner; possession of the owner token grants
 * access only to the server-configured bucket and object namespace. */
export const requireR2Owner: RequestHandler = (req, res, next) => {
  const expected = process.env.R2_OWNER_TOKEN;
  if (!expected || expected.length < 32) {
    res.status(503).json({ error: 'R2_OWNER_TOKEN must be configured with at least 32 characters' });
    return;
  }
  const authorization = req.headers.authorization;
  const match = typeof authorization === 'string' && /^Bearer ([^\s]+)$/.exec(authorization);
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!match || !timingSafeEqual(digest(match[1]), digest(expected))) {
    res.status(401).json({ error: 'R2 owner authentication required' });
    return;
  }
  next();
};

export function r2Scope(bucket: unknown, key: unknown, listing = false): { bucket: string; key: string } {
  const allowedBucket = process.env.R2_BUCKET;
  if (!allowedBucket) throw new Error('R2_BUCKET is not configured');
  if (bucket !== undefined && bucket !== '' && bucket !== allowedBucket) throw new Error('R2 bucket is outside the owner scope');
  const root = (process.env.R2_KEY_PREFIX || 'baimiaobiji').replace(/\/+$/, '');
  const valid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1024 && /^[a-zA-Z0-9/_\-. ]+$/.test(value) && !value.startsWith('/') && !value.includes('..') && !value.includes('//');
  if (!valid(root)) throw new Error('Invalid server R2_KEY_PREFIX');
  const value = listing && (key === undefined || key === '') ? `${root}/` : key;
  if (!valid(value) || !value.startsWith(`${root}/`)) throw new Error('R2 key is outside the owner scope');
  return { bucket: allowedBucket, key: value };
}
