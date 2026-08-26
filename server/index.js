import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { WebSocketServer } from 'ws';
import { TikTokLive } from 'tiktok-live-api';
import { authorizeAdminRequest, sanitizedAdminLog } from './admin.js';
import { GiftEventLedger, resolveGiftDefinition, sanitizeDisplayName, sanitizeNarrationName } from './gifts.js';
import { addBots, applyComment, applyGiftEffect, finish, likes, pause, reset, setStorm, spawnBoss, start, state, tickGame, tickStorm, updateSettings } from './engine.js';
import { ENGINE_EVENT_CHANNEL, eventBus } from './event-bus.js';
import { getLeaderboard, initializeLeaderboard } from './leaderboard.js';
import { createNarrator } from './narrator.js';

const cfg = {
  username: process.env.TIKTOK_USERNAME || 'startrades01',
  apiKey: process.env.TIKTOOL_API_KEY || '',
  ollama: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  model: process.env.OLLAMA_MODEL || 'llama3.2:3b',
  mock: process.env.MOCK_MODE !== 'false',
  port: Number(process.env.PORT || 4173),
  adminToken: process.env.ADMIN_TOKEN || '',
  countdownMs: Math.max(0, Math.min(15000, Number(process.env.BATTLE_COUNTDOWN_MS ?? 5000) || 0)),
  intermissionMs: Math.max(0, Math.min(60000, Number(process.env.BATTLE_INTERMISSION_MS ?? 10000) || 0)),
};

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));
app.use(express.static('dist'));
const server = app.listen(cfg.port, () => console.log(`StarTrades LIVE http://127.0.0.1:${cfg.port} (${cfg.mock ? 'SIMULAÇÃO' : '@' + cfg.username})`));
const wss = new WebSocketServer({ server, path: '/events' });
const publicState = () => ({ ...state, arenaKings: getLeaderboard().slice(0, 3) });
const emit = (type, payload = {}) => {
  const data = JSON.stringify({ type, payload, state: publicState() });
  wss.clients.forEach((client) => client.readyState === 1 && client.send(data));
};
wss.on('connection', (socket) => socket.send(JSON.stringify({ type: 'state', state: publicState() })));
void initializeLeaderboard().then(() => emit('leaderboard:ready', { count: getLeaderboard().length }));

const giftLedger = new GiftEventLedger();
eventBus.on(ENGINE_EVENT_CHANNEL, (event) => emit(event.type, event.payload));
const narrator = createNarrator({ emit, state, ollamaUrl: cfg.ollama, model: cfg.model });

function chat(event) {
  const user = event.user || {};
  const senderUserId = String(user.userId || '');
  const username = sanitizeDisplayName(user.uniqueId || event.username || 'fighter', 'fighter', 32);
  const avatarUrl = /^https:\/\//i.test(user.profilePictureUrl || '') ? String(user.profilePictureUrl).slice(0, 500) : '';
  const comment = String(event.comment || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 160);
  if (!senderUserId) { emit('comment', { username, comment, rejected: 'missing-user-id' }); return; }
  const result = applyComment({ username, platformUserId: senderUserId, avatarUrl, comment });
  emit('comment', { username, comment, result });
  if (result.kind === 'join') narrator.local(`${sanitizeNarrationName(result.player.username)} entrou na arena.`, { priority: 1, emotion: 'welcome', eventType: 'player:joined' });
  else if (/^(oi|olá|ola|como joga|!ajuda)$/i.test(comment.trim())) narrator.local('Use exclamação entrar para participar. Gifts ativam efeitos balanceados de entretenimento.', { priority: 1, emotion: 'friendly', eventType: 'help' });
}

function gift(event) {
  const parsed = giftLedger.ingest(event, { source: 'tiktok' });
  if (parsed.status === 'pending') {
    emit('gift:pending', { eventId: parsed.event.eventId, senderUserId: parsed.event.senderUserId, senderUsername: parsed.event.senderUsername, giftId: parsed.event.giftId, giftName: parsed.event.giftName, repeatCount: parsed.event.repeatCount, reason: parsed.reason });
    return;
  }
  if (parsed.status !== 'ready') {
    emit('gift:rejected', { eventId: parsed.event?.eventId || null, reason: parsed.reason || parsed.status, visualOnly: parsed.reason === 'missing-gift' });
    return;
  }
  const e = parsed.event;
  applyGiftEffect({ eventId: e.eventId, senderUserId: e.senderUserId, senderUsername: e.senderUsername, targetUserId: e.targetUserId, giftId: e.giftId, giftName: e.giftName, repeatCount: e.repeatCount, source: 'tiktok' });
}

if (!cfg.mock) {
  if (!cfg.apiKey) throw new Error('TIKTOOL_API_KEY ausente');
  const live = new TikTokLive(cfg.username, { apiKey: cfg.apiKey, autoReconnect: true, maxReconnectAttempts: 30 });
  live.on('chat', chat); live.on('gift', gift);
  live.on('like', (event) => {
    const bonus = likes(event.likeCount);
    emit('like', { count: event.likeCount, bonus });
    if (bonus) narrator.local('Quinhentas curtidas repeliram a tempestade.', { priority: 2, emotion: 'triumph', eventType: 'like:milestone' });
  });
  live.on('connected', () => {
    emit('connection', { online: true });
    narrator.local('Conexão com a LIVE confirmada. A arena está online.', { priority: 4, emotion: 'welcome', eventType: 'connection' });
  });
  live.on('disconnected', () => emit('connection', { online: false }));
  live.on('error', (error) => console.error('[tiktok]', error));
  live.connect().catch((error) => console.error('[tiktok-connect]', error));
}

const ok = (res) => res.json({ ok: true, state: publicState() });
const conflict = (res, error) => res.status(409).json({ ok: false, error, state: publicState() });
const admin = (action) => (req, res, next) => {
  const result = authorizeAdminRequest({ headers: req.headers, ip: req.ip, token: cfg.adminToken, action });
  if (!result.ok) return res.status(result.status).json({ ok: false, error: result.reason });
  next();
};
const adminLog = (data) => console.info('[admin]', JSON.stringify(sanitizedAdminLog(data)));

app.post('/api/battle/start', admin('battle-start'), (_req, res) => {
  if (state.phase !== 'lobby') return conflict(res, 'battle-not-in-lobby');
  start({ countdownMs: cfg.countdownMs }); ok(res);
});
app.post('/api/battle/pause', admin('battle-pause'), (_req, res) => {
  if (!['running', 'paused'].includes(state.phase)) return conflict(res, 'battle-not-pausable');
  const previousPhase = state.phase;
  pause();
  const changed = state.phase !== previousPhase;
  if (!changed) return conflict(res, 'battle-not-pausable');
  emit('battle-pause', { phase: state.phase });
  narrator.local(state.phase === 'paused' ? 'Batalha pausada.' : 'Batalha retomada.', { priority: 3, emotion: state.phase === 'paused' ? 'calm' : 'battle', eventType: 'round:paused' });
  ok(res);
});
app.post('/api/battle/end', admin('battle-end'), (_req, res) => {
  if (!['countdown', 'running', 'paused'].includes(state.phase)) return conflict(res, 'battle-not-active');
  const winner = finish({ intermissionMs: cfg.intermissionMs }); emit('battle-end', { winner }); ok(res);
});
app.post('/api/battle/reset', admin('battle-reset'), (_req, res) => { reset(); emit('reset'); ok(res); });
app.post('/api/test/players', admin('test-players'), (req, res) => { if (!cfg.mock) return res.status(403).json({ ok: false, error: 'test-mode-disabled' }); addBots(req.body.names || []); emit('players'); ok(res); });
app.post('/api/storm', admin('storm'), (req, res) => {
  setStorm(req.body.value); emit('storm', { value: state.storm });
  if (state.storm >= 60) narrator.local(`Tempestade em ${state.storm} por cento.`, { priority: 2, emotion: 'urgent', eventType: 'storm' });
  ok(res);
});
app.post('/api/settings', admin('settings'), (req, res) => { updateSettings(req.body); emit('settings'); ok(res); });

app.post('/api/admin/gift', admin('gift'), (req, res) => {
  if (!cfg.mock) return res.status(403).json({ ok: false, error: 'test-mode-disabled' });
  const giftDef = resolveGiftDefinition(req.body.giftId, '');
  const target = state.players.find((p) => p.id === String(req.body.targetPlayerId || '') && p.alive);
  if (!giftDef) return res.status(400).json({ ok: false, error: 'gift-not-allowlisted' });
  if (!target) return res.status(400).json({ ok: false, error: 'invalid-target-player' });
  adminLog({ action: 'simulate-gift', giftId: giftDef.giftId, targetPlayerId: target.id, source: 'control-panel' });
  const result = applyGiftEffect({ eventId: `admin:${randomUUID()}`, senderUserId: 'admin-simulator', senderUsername: 'SIMULAÇÃO', targetUserId: target.id, giftId: giftDef.giftId, giftName: giftDef.aliases[0], repeatCount: 1, source: 'control-panel' });
  res.json({ ok: result.status === 'applied', result, state: publicState() });
});
app.post('/api/admin/boss', admin('boss'), (req, res) => {
  if (!cfg.mock) return res.status(403).json({ ok: false, error: 'test-mode-disabled' });
  adminLog({ action: 'spawn-boss', source: 'control-panel' });
  const result = spawnBoss({ source: 'control-panel' });
  res.status(result.applied || result.reason === 'extended' ? 200 : 409).json({ ok: Boolean(result.applied), result, state: publicState() });
});
app.post('/api/mock/gift', (_req, res) => res.status(410).json({ ok: false, error: 'use-admin-gift-simulator' }));
app.post('/api/mock/comment', admin('mock-comment'), (req, res) => { if (!cfg.mock) return res.status(403).json({ ok: false, error: 'test-mode-disabled' }); chat({ ...req.body, user: { userId: req.body.user?.userId || 'mock-user', uniqueId: req.body.user?.uniqueId || req.body.username || 'mock' } }); ok(res); });

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'startrades-neon-royale', uptimeSeconds: Math.floor(process.uptime()) }));
app.get('/api/leaderboard', (_req, res) => res.json({ ok: true, kings: getLeaderboard().slice(0, 3) }));
app.get('/api/config', (_req, res) => res.json({ username: cfg.username, mock: cfg.mock, model: cfg.model, adminConfigured: Boolean(cfg.adminToken), countdownMs: cfg.countdownMs, intermissionMs: cfg.intermissionMs, giftCatalog: state.giftCatalog }));

function autoFinish() {
  const alive = state.players.filter((p) => p.alive), joinedTeams = new Set(state.players.map((p) => p.team)), aliveTeams = new Set(alive.map((p) => p.team));
  const battleOver = state.settings.teamMode ? joinedTeams.size >= 2 && aliveTeams.size <= 1 : alive.length <= 1;
  if (state.phase === 'running' && state.players.length >= 2 && battleOver) {
    const winner = finish({ intermissionMs: cfg.intermissionMs }); emit('battle-end', { winner });
  }
}
let lastStateBroadcastAt = 0;
setInterval(() => { const now = Date.now(); tickGame(now); autoFinish(); if (['countdown', 'running', 'ended'].includes(state.phase) && now - lastStateBroadcastAt >= 500) { lastStateBroadcastAt = now; emit('tick'); } }, 250).unref?.();
setInterval(() => { tickStorm(); if (state.phase === 'running') emit('tick'); }, 7000).unref?.();

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal}`);
  narrator.dispose();
  const forceExit = setTimeout(() => process.exit(1), 15_000);
  forceExit.unref?.();
  for (const client of wss.clients) client.close(1001, 'server-shutdown');
  wss.close(() => {
    server.close(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
  });
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

app.get('*', (_req, res) => res.sendFile(new URL('../dist/index.html', import.meta.url).pathname));
