import { timingSafeEqual } from 'node:crypto';
import { sanitizeStableId } from './gifts.js';

const buckets = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const MIN_INTERVAL_MS = 250;

const extractToken = (headers = {}) => {
  const auth = String(headers.authorization || headers.Authorization || '');
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return String(headers['x-admin-token'] || headers['X-Admin-Token'] || '').trim();
};
const secureEqual = (a, b) => {
  const aa = Buffer.from(String(a || '')), bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && aa.length > 0 && timingSafeEqual(aa, bb);
};

export function authorizeAdminRequest({ headers = {}, ip = 'unknown', token = process.env.ADMIN_TOKEN || '', now = Date.now(), action = 'admin' } = {}) {
  if (!token) return { ok: false, status: 503, reason: 'admin-token-not-configured' };
  if (!secureEqual(extractToken(headers), token)) return { ok: false, status: 401, reason: 'unauthorized' };
  const key = `${sanitizeStableId(ip) || 'unknown'}:${sanitizeStableId(action) || 'admin'}`;
  const previous = buckets.get(key);
  const bucket = !previous || now - previous.windowStartedAt >= WINDOW_MS ? { windowStartedAt: now, count: 0, lastAt: 0 } : previous;
  if (bucket.lastAt && now - bucket.lastAt < MIN_INTERVAL_MS) return { ok: false, status: 429, reason: 'rate-limited' };
  if (bucket.count >= MAX_PER_WINDOW) return { ok: false, status: 429, reason: 'rate-limited' };
  bucket.count += 1; bucket.lastAt = now; buckets.set(key, bucket);
  return { ok: true, status: 200 };
}

export function resetAdminRateLimits() { buckets.clear(); }
export function sanitizedAdminLog({ action, giftId, targetPlayerId, source = 'control-panel' } = {}) {
  return { action: sanitizeStableId(action), giftId: String(giftId || '').replace(/[\r\n\t]/g, '').slice(0, 80), targetPlayerId: sanitizeStableId(targetPlayerId), source: source === 'control-panel' ? source : 'unknown' };
}
