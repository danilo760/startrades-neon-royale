import { createClient } from '@supabase/supabase-js';

const totals = new Map(), pending = [], pendingIds = new Set(), localResultIds = new Set();
const MAX_QUEUE = Math.max(10, Number(process.env.LEADERBOARD_QUEUE_LIMIT) || 500);
const TOP_LIMIT = Math.max(1, Math.min(100, Number(process.env.LEADERBOARD_TOP_LIMIT) || 50));
const TIMEOUT_MS = Math.max(1000, Number(process.env.SUPABASE_TIMEOUT_MS) || 5000);
const client = process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
let retryTimer = null, retryAttempt = 0, flushing = false;
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

function applyLocal(item) {
  const previous = totals.get(item.platformUserId) || { id: item.platformUserId, platformUserId: item.platformUserId, username: item.username, score: 0, wins: 0, roundsPlayed: 0 };
  totals.set(item.platformUserId, { ...previous, username: item.username, score: previous.score + item.score, wins: previous.wins + item.wins, roundsPlayed: previous.roundsPlayed + 1 });
}
function scheduleRetry() {
  if (!client || retryTimer || !pending.length) return;
  retryTimer = setTimeout(() => { retryTimer = null; void flushPending(); }, Math.min(60000, 1000 * 2 ** retryAttempt++)); retryTimer.unref?.();
}
async function send(item) {
  const { error } = await timeout(client.rpc('record_leaderboard_result', { p_result_id: item.resultId, p_platform_user_id: item.platformUserId, p_username: item.username, p_score_increment: item.score, p_win_increment: item.wins }));
  if (error) throw error;
}
export async function flushPending() {
  if (!client || flushing) return false; flushing = true;
  try { while (pending.length) { const item = pending[0]; await send(item); pending.shift(); pendingIds.delete(item.resultId); retryAttempt = 0; } return true; }
  catch (error) { console.warn(`[leaderboard] sincronização adiada: ${String(error?.message || 'erro').slice(0, 120)}`); scheduleRetry(); return false; }
  finally { flushing = false; }
}
export async function initializeLeaderboard() {
  if (!client) { console.info('[leaderboard] Supabase não configurado; usando memória.'); return false; }
  try {
    const { data, error } = await timeout(client.from('leaderboard').select('platform_user_id,username,total_score,wins,rounds_played').order('total_score', { ascending: false }).order('wins', { ascending: false }).order('username', { ascending: true }).limit(TOP_LIMIT));
    if (error) throw error;
    for (const row of data || []) totals.set(row.platform_user_id, { id: row.platform_user_id, platformUserId: row.platform_user_id, username: row.username, score: Number(row.total_score), wins: Number(row.wins), roundsPlayed: Number(row.rounds_played) });
    void flushPending(); return true;
  } catch (error) { console.warn(`[leaderboard] boot em modo local: ${String(error?.message || 'erro').slice(0, 120)}`); scheduleRetry(); return false; }
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
export function clearLeaderboard() { totals.clear(); pending.length = 0; pendingIds.clear(); localResultIds.clear(); retryAttempt = 0; if (retryTimer) clearTimeout(retryTimer); retryTimer = null; }
