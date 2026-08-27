import { createClient } from '@supabase/supabase-js';

const totals = new Map(), pending = [], pendingIds = new Set(), localResultIds = new Set();
const MAX_QUEUE = Math.max(10, Number(process.env.LEADERBOARD_QUEUE_LIMIT) || 500);
const TOP_LIMIT = Math.max(1, Math.min(100, Number(process.env.LEADERBOARD_TOP_LIMIT) || 50));
const TIMEOUT_MS = Math.max(1000, Number(process.env.SUPABASE_TIMEOUT_MS) || 5000);
const client = process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const BOOT_RETRY_DELAYS_MS = [0, 250, 750];
const BACKGROUND_RETRY_MAX_MS = 60_000;
let retryTimer = null, retryAttempt = 0, flushing = false;
let bootstrapTimer = null, bootstrapAttempt = 0, remoteReady = false, lastError = null, lastSuccessAt = null;
const cleanId = (value = '') => String(value).trim().slice(0, 64);
const cleanName = (value = 'fighter') => String(value).replace(/[\r\n<>]/g, '').trim().slice(0, 40) || 'fighter';
const sorted = () => [...totals.values()].sort((a, b) => b.score - a.score || b.wins - a.wins || a.username.localeCompare(b.username, 'pt-BR'));
const timeout = async (promise) => {
  let timer = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Supabase timeout')), TIMEOUT_MS);
      timer.unref?.();
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errorMessage = (error) => String(error?.message || 'erro').slice(0, 120);
const isTransientBootstrapError = (error) => {
  const message = errorMessage(error).toLowerCase();
  const status = Number(error?.status || error?.statusCode || error?.code);
  return message.includes('jwt issued at future')
    || message.includes('timeout')
    || message.includes('fetch failed')
    || message.includes('temporarily unavailable')
    || message.includes('connection')
    || status === 429
    || status >= 500;
};

function applyLocal(item) {
  const previous = totals.get(item.platformUserId) || { id: item.platformUserId, platformUserId: item.platformUserId, username: item.username, score: 0, wins: 0, roundsPlayed: 0 };
  totals.set(item.platformUserId, { ...previous, username: item.username, score: previous.score + item.score, wins: previous.wins + item.wins, roundsPlayed: previous.roundsPlayed + 1 });
}
function scheduleRetry() {
  if (!client || retryTimer || !pending.length) return;
  retryTimer = setTimeout(() => { retryTimer = null; void flushPending(); }, Math.min(60000, 1000 * 2 ** retryAttempt++)); retryTimer.unref?.();
}
function scheduleBootstrapRetry() {
  if (!client || bootstrapTimer || remoteReady) return;
  const delayMs = Math.min(BACKGROUND_RETRY_MAX_MS, 2000 * 2 ** Math.min(bootstrapAttempt++, 5));
  bootstrapTimer = setTimeout(() => {
    bootstrapTimer = null;
    void initializeLeaderboard({ background: true });
  }, delayMs);
  bootstrapTimer.unref?.();
}
async function send(item) {
  const { error } = await timeout(client.rpc('record_leaderboard_result', { p_result_id: item.resultId, p_platform_user_id: item.platformUserId, p_username: item.username, p_score_increment: item.score, p_win_increment: item.wins }));
  if (error) throw error;
}
async function fetchRemoteRows() {
  const { data, error } = await timeout(client.from('leaderboard').select('platform_user_id,username,total_score,wins,rounds_played').order('total_score', { ascending: false }).order('wins', { ascending: false }).order('username', { ascending: true }).limit(TOP_LIMIT));
  if (error) throw error;
  return data || [];
}
async function fetchRemoteRowsWithBootRetry() {
  let last;
  for (let index = 0; index < BOOT_RETRY_DELAYS_MS.length; index += 1) {
    if (BOOT_RETRY_DELAYS_MS[index] > 0) await sleep(BOOT_RETRY_DELAYS_MS[index]);
    try {
      return await fetchRemoteRows();
    } catch (error) {
      last = error;
      if (!isTransientBootstrapError(error) || index === BOOT_RETRY_DELAYS_MS.length - 1) throw error;
    }
  }
  throw last || new Error('leaderboard-bootstrap-failed');
}
export async function flushPending() {
  if (!client || flushing) return false; flushing = true;
  try { while (pending.length) { const item = pending[0]; await send(item); pending.shift(); pendingIds.delete(item.resultId); retryAttempt = 0; } return true; }
  catch (error) { console.warn(`[leaderboard] sincronização adiada: ${errorMessage(error)}`); scheduleRetry(); return false; }
  finally { flushing = false; }
}
export async function initializeLeaderboard({ background = false } = {}) {
  if (!client) { console.info('[leaderboard] Supabase não configurado; usando memória.'); return false; }
  try {
    if (background && pending.length) {
      const flushed = await flushPending();
      if (!flushed && pending.length) throw new Error('leaderboard-pending-sync-not-ready');
    }
    const rows = background ? await fetchRemoteRows() : await fetchRemoteRowsWithBootRetry();
    for (const row of rows) totals.set(row.platform_user_id, { id: row.platform_user_id, platformUserId: row.platform_user_id, username: row.username, score: Number(row.total_score), wins: Number(row.wins), roundsPlayed: Number(row.rounds_played) });
    const recovered = background && !remoteReady;
    remoteReady = true; lastError = null; lastSuccessAt = Date.now(); bootstrapAttempt = 0;
    if (bootstrapTimer) clearTimeout(bootstrapTimer); bootstrapTimer = null;
    if (recovered) console.info('[leaderboard] persistência Supabase recuperada.');
    void flushPending(); return true;
  } catch (error) {
    remoteReady = false; lastError = errorMessage(error);
    if (!background) console.warn(`[leaderboard] boot em modo local: ${lastError}`);
    scheduleBootstrapRetry(); return false;
  }
}
export function recordRound(players = [], roundId = `round-${Date.now()}`) {
  for (const player of players) {
    const platformUserId = cleanId(player?.platformUserId || player?.id); if (!platformUserId) continue;
    const item = { resultId: `${cleanId(roundId)}:${platformUserId}`, platformUserId, username: cleanName(player.username || player.id), score: Math.max(0, Math.round(Number(player.score) || 0)), wins: Number(Boolean(player.roundWinner)) };
    if (localResultIds.has(item.resultId)) continue; localResultIds.add(item.resultId);
    applyLocal(item);
    if (!client || pendingIds.has(item.resultId)) continue;
    if (pending.length >= MAX_QUEUE) { console.warn(`[leaderboard] fila cheia (${MAX_QUEUE}); atualização mantida apenas em memória.`); continue; }
    pending.push(item); pendingIds.add(item.resultId);
  }
  void flushPending();
}
export function getLeaderboard() { return sorted().slice(0, TOP_LIMIT); }
export function getLeaderboardTop() { return sorted()[0] || null; }
export function getQueueSize() { return pending.length; }
export function getLeaderboardStatus() { return { configured: Boolean(client), persistenceAvailable: remoteReady, queueSize: pending.length, lastError, lastSuccessAt }; }
export function clearLeaderboard() {
  totals.clear(); pending.length = 0; pendingIds.clear(); localResultIds.clear(); retryAttempt = 0; bootstrapAttempt = 0; remoteReady = false; lastError = null; lastSuccessAt = null;
  if (retryTimer) clearTimeout(retryTimer); retryTimer = null;
  if (bootstrapTimer) clearTimeout(bootstrapTimer); bootstrapTimer = null;
}

export const leaderboardInternals = Object.freeze({ BOOT_RETRY_DELAYS_MS, isTransientBootstrapError });
