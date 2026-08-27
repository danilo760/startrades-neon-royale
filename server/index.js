import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { TikTokLive } from 'tiktok-live-api';
import { authorizeAdminRequest, sanitizedAdminLog } from './admin.js';
import { GiftEventLedger, sanitizeDisplayName, sanitizeNarrationName } from './gifts.js';
import { addBots, applyComment, applyGiftEffect, finish, likes, pause, reset, setStorm, spawnBoss, start, state, tickGame, tickStorm, updateSettings } from './engine.js';
import { ENGINE_EVENT_CHANNEL, eventBus, publishEngineEvent } from './event-bus.js';
import { getLeaderboard, initializeLeaderboard } from './leaderboard.js';
import { createNarrator } from './narrator.js';
import { powerRegistry } from './powers/PowerRegistry.js';
import { GiftMappingService } from './powers/GiftMappingService.js';
import { PowerExecutor } from './powers/PowerExecutor.js';
import { ComboManager } from './powers/ComboManager.js';
import { RivalryManager } from './powers/RivalryManager.js';
import { NarratorDirector } from './powers/NarratorDirector.js';
import { BossPhaseDirector } from './powers/BossPhaseDirector.js';
import { GiftCinematicDirector } from './powers/GiftCinematicDirector.js';
import { LiveInteractionManager } from './powers/LiveInteractionManager.js';
import { createSnapshotController } from './snapshot.js';
import { telemetry } from './telemetry.js';

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
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/events' });
const giftMappings = new GiftMappingService();
const publicState = () => ({ ...state, arenaKings: getLeaderboard().slice(0, 3), powerCatalog: powerRegistry.publicCatalog() });
const emit = (type, payload = {}) => {
  const started = performance.now();
  const data = JSON.stringify({ type, payload, state: publicState() });
  let delivered = 0;
  wss.clients.forEach((client) => {
    if (client.readyState !== 1) return;
    client.send(data);
    delivered += 1;
  });
  telemetry.timing('ws_broadcast_latency', performance.now() - started, { 'ws.event': type, 'ws.connections': wss.clients.size, 'ws.delivered': delivered, 'round.id': state.roundId });
};
wss.on('connection', (socket) => {
  telemetry.gauge('active_connections', wss.clients.size);
  socket.send(JSON.stringify({ type: 'state', state: publicState() }));
});

const giftLedger = new GiftEventLedger();
eventBus.on(ENGINE_EVENT_CHANNEL, (event) => emit(event.type, event.payload));
const narrator = createNarrator({ emit, state, ollamaUrl: cfg.ollama, model: cfg.model });
const publish = (type, payload = {}) => publishEngineEvent(type, payload);
const powerExecutor = new PowerExecutor({ state, registry: powerRegistry, publish, spawnBoss, telemetry });
const comboManager = new ComboManager({ publish });
const rivalryManager = new RivalryManager({ publish });
const narratorDirector = new NarratorDirector({ bus: eventBus, narrator, state }).start();
const bossDirector = new BossPhaseDirector({ state, publish });
const giftCinematicDirector = new GiftCinematicDirector({ bus: eventBus, publish }).start();
const liveInteractions = new LiveInteractionManager({ publish });
const snapshots = createSnapshotController({ powerExecutor, telemetry, publish });
state.settings.effectIntensity ||= 'NORMAL';

const applyNarratorConfig = () => narratorDirector.setConfig({
  personality: state.settings.narratorPersonality || 'HYPE',
  intensity: state.settings.narratorIntensity ?? 80,
  frequency: state.settings.narratorFrequency ?? 60,
  volume: state.settings.narratorVolume ?? 100,
  enabled: state.settings.narratorEnabled ?? true,
});
applyNarratorConfig();

eventBus.on('gift:applied', (payload = {}) => {
  const target = state.players.find((player) => player.id === payload.targetPlayerId);
  comboManager.ingest({ ...payload, team: target?.team || '', at: Date.now() });
});
eventBus.on('player:eliminated', (payload = {}) => rivalryManager.recordElimination(payload));
eventBus.on('round:started', () => snapshots.critical('round-start'));
eventBus.on('boss:spawned', () => snapshots.critical('boss-spawn'));
eventBus.on('round:ended', () => {
  // Timers belong to the round. Keep idempotency/cooldowns intact across intermission.
  powerExecutor.cancelPending();
  comboManager.reset(); rivalryManager.endAll('round-ended'); liveInteractions.reset(); snapshots.critical('round-end');
});
eventBus.on('round:lobby', () => snapshots.critical('round-lobby'));

function chat(event) {
  const user = event.user || {};
  const senderUserId = String(user.userId || '');
  const username = sanitizeDisplayName(user.uniqueId || event.username || 'fighter', 'fighter', 32);
  const avatarUrl = /^https:\/\//i.test(user.profilePictureUrl || '') ? String(user.profilePictureUrl).slice(0, 500) : '';
  const comment = String(event.comment || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 160);
  if (!senderUserId) { emit('comment', { username, comment, rejected: 'missing-user-id' }); return; }
  const result = applyComment({ username, platformUserId: senderUserId, avatarUrl, comment });
  emit('comment', { username, comment, result });
  if (result.kind === 'join') {
    narrator.local(`${sanitizeNarrationName(result.player.username)} entrou na arena.`, { priority: 1, emotion: 'welcome', eventType: 'player:joined' });
    rivalryManager.evaluateArenaChallenge(result.player, getLeaderboard());
  } else if (/^(oi|olá|ola|como joga|!ajuda)$/i.test(comment.trim())) narrator.local('Use exclamação entrar para participar. Gifts ativam efeitos balanceados de entretenimento.', { priority: 1, emotion: 'friendly', eventType: 'help' });
  liveInteractions.ingestComment({ senderUserId, comment, roundId: state.roundId });
}

function processMappedGift(input = {}) {
  const started = performance.now();
  const mapping = giftMappings.resolve(input.giftId, input.giftName);
  telemetry.event('tiktok.gift.received', { 'gift.id': input.giftId || '', 'round.id': state.roundId, source: input.source || 'tiktok' });
  if (!mapping) {
    const result = { status: 'rejected', reason: 'unknown-gift', visualOnly: true, eventId: input.eventId, giftId: input.giftId, giftName: sanitizeDisplayName(input.giftName, 'Presente', 48) };
    publish('gift:rejected', result);
    telemetry.timing('gift_processing_latency', performance.now() - started, { 'gift.id': input.giftId || '', result: 'unknown-gift' });
    return result;
  }
  telemetry.event('gift.mapping.resolve', { 'gift.id': mapping.giftId, 'power.id': mapping.powerId, 'target.mode': mapping.targetMode, 'round.id': state.roundId });
  if (!mapping.enabled) {
    const result = { status: 'rejected', reason: 'mapping-disabled', visualOnly: true, eventId: input.eventId, giftId: mapping.giftId };
    publish('gift:rejected', result);
    return result;
  }
  let result;
  if (giftMappings.isLegacyDefault(mapping)) result = applyGiftEffect({ ...input, giftId: mapping.giftId, giftName: input.giftName || mapping.giftName });
  else result = powerExecutor.execute({ ...input, giftId: mapping.giftId, giftName: input.giftName || mapping.giftName, mapping });
  telemetry.timing('gift_processing_latency', performance.now() - started, { 'gift.id': mapping.giftId, 'power.id': mapping.powerId, 'target.mode': mapping.targetMode, 'round.id': state.roundId, result: result?.status || 'unknown' });
  return result;
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
  processMappedGift({ eventId: e.eventId, senderUserId: e.senderUserId, senderUsername: e.senderUsername, targetUserId: e.targetUserId, giftId: e.giftId, giftName: e.giftName, repeatCount: e.repeatCount, source: 'tiktok' });
}

let live = null;
function startTikTok() {
  if (cfg.mock) return;
  if (!cfg.apiKey) throw new Error('TIKTOOL_API_KEY ausente');
  live = new TikTokLive(cfg.username, { apiKey: cfg.apiKey, autoReconnect: true, maxReconnectAttempts: 30 });
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
  snapshots.critical(state.phase === 'paused' ? 'pause' : 'resume');
  ok(res);
});
app.post('/api/battle/end', admin('battle-end'), (_req, res) => {
  if (!['countdown', 'running', 'paused'].includes(state.phase)) return conflict(res, 'battle-not-active');
  const winner = finish({ intermissionMs: cfg.intermissionMs }); emit('battle-end', { winner }); ok(res);
});
app.post('/api/battle/reset', admin('battle-reset'), (_req, res) => {
  powerExecutor.cancelPending();
  reset(); comboManager.reset(); rivalryManager.endAll('admin-reset'); liveInteractions.reset(); emit('reset'); snapshots.critical('admin-reset'); ok(res);
});
app.post('/api/test/players', admin('test-players'), (req, res) => { if (!cfg.mock) return res.status(403).json({ ok: false, error: 'test-mode-disabled' }); addBots(req.body.names || []); emit('players'); ok(res); });
app.post('/api/storm', admin('storm'), (req, res) => {
  setStorm(req.body.value); emit('storm', { value: state.storm });
  if (state.storm >= 60) narrator.local(`Tempestade em ${state.storm} por cento.`, { priority: 2, emotion: 'urgent', eventType: 'storm' });
  snapshots.critical('storm-admin'); ok(res);
});
app.post('/api/settings', admin('settings'), (req, res) => {
  updateSettings(req.body);
  if (['BAIXA', 'NORMAL', 'ALTA'].includes(String(req.body.effectIntensity || '').toUpperCase())) state.settings.effectIntensity = String(req.body.effectIntensity).toUpperCase();
  narratorDirector.setConfig(req.body);
  emit('settings'); snapshots.critical('settings'); ok(res);
});

app.get('/api/admin/gift-mappings', admin('gift-mappings-read'), (_req, res) => res.json({ ok: true, mappings: giftMappings.list(), powers: powerRegistry.publicCatalog(), persistence: giftMappings.status() }));
app.post('/api/admin/gift-mappings', admin('gift-mappings-write'), async (req, res) => {
  try {
    const saved = await giftMappings.save(req.body || {});
    adminLog({ action: 'save-gift-mapping', giftId: saved.mapping.giftId, powerId: saved.mapping.powerId, source: 'control-panel' });
    publish('gift-mapping:updated', { mapping: saved.mapping, persisted: saved.persisted });
    res.json({ ok: true, ...saved });
  } catch (error) {
    res.status(400).json({ ok: false, error: String(error?.message || 'invalid-mapping').slice(0, 100) });
  }
});
app.post('/api/admin/gift-mappings/:giftId/disable', admin('gift-mappings-write'), async (req, res) => {
  try {
    const saved = await giftMappings.disable(req.params.giftId);
    publish('gift-mapping:updated', { mapping: saved.mapping, persisted: saved.persisted });
    res.json({ ok: true, ...saved });
  } catch (error) {
    res.status(404).json({ ok: false, error: String(error?.message || 'mapping-not-found').slice(0, 100) });
  }
});

app.post('/api/admin/gift', admin('gift'), (req, res) => {
  if (!cfg.mock) return res.status(403).json({ ok: false, error: 'test-mode-disabled' });
  const mapping = giftMappings.resolve(req.body.giftId, req.body.giftName || '');
  const target = state.players.find((p) => p.id === String(req.body.targetPlayerId || '') && p.alive);
  if (!mapping) return res.status(400).json({ ok: false, error: 'gift-not-mapped' });
  if (!target) return res.status(400).json({ ok: false, error: 'invalid-target-player' });
  adminLog({ action: 'simulate-gift', giftId: mapping.giftId, powerId: mapping.powerId, targetPlayerId: target.id, source: 'control-panel' });
  const result = processMappedGift({ eventId: `admin:${randomUUID()}`, senderUserId: 'admin-simulator', senderUsername: 'SIMULAÇÃO', targetUserId: target.id, giftId: mapping.giftId, giftName: mapping.giftName, repeatCount: 1, source: 'control-panel' });
  res.status(result.status === 'applied' ? 200 : 409).json({ ok: result.status === 'applied', result, state: publicState() });
});
app.post('/api/admin/boss', admin('boss'), (req, res) => {
  if (!cfg.mock) return res.status(403).json({ ok: false, error: 'test-mode-disabled' });
  adminLog({ action: 'spawn-boss', source: 'control-panel' });
  const result = spawnBoss({ source: 'control-panel' });
  res.status(result.applied || result.reason === 'extended' ? 200 : 409).json({ ok: Boolean(result.applied), result, state: publicState() });
});
app.post('/api/mock/gift', (_req, res) => res.status(410).json({ ok: false, error: 'use-admin-gift-simulator' }));
app.post('/api/mock/comment', admin('mock-comment'), (req, res) => { if (!cfg.mock) return res.status(403).json({ ok: false, error: 'test-mode-disabled' }); chat({ ...req.body, user: { userId: req.body.user?.userId || 'mock-user', uniqueId: req.body.user?.uniqueId || req.body.username || 'mock' } }); ok(res); });

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  service: 'startrades-neon-royale',
  uptimeSeconds: Math.floor(process.uptime()),
  mappings: giftMappings.status(),
  snapshots: snapshots.status(),
  telemetry: telemetry.status(),
}));
app.get('/api/leaderboard', (_req, res) => res.json({ ok: true, kings: getLeaderboard().slice(0, 3) }));
app.get('/api/config', (_req, res) => res.json({ username: cfg.username, mock: cfg.mock, model: cfg.model, adminConfigured: Boolean(cfg.adminToken), countdownMs: cfg.countdownMs, intermissionMs: cfg.intermissionMs, giftCatalog: state.giftCatalog, powerCatalog: powerRegistry.publicCatalog(), effectIntensity: state.settings.effectIntensity }));

function autoFinish() {
  const alive = state.players.filter((p) => p.alive), joinedTeams = new Set(state.players.map((p) => p.team)), aliveTeams = new Set(alive.map((p) => p.team));
  const battleOver = state.settings.teamMode ? joinedTeams.size >= 2 && aliveTeams.size <= 1 : alive.length <= 1;
  if (state.phase === 'running' && state.players.length >= 2 && battleOver) {
    const winner = finish({ intermissionMs: cfg.intermissionMs }); emit('battle-end', { winner });
  }
}
let lastStateBroadcastAt = 0;
let lastMetricsAt = 0;
let gameLoopTimer = null;
let stormTimer = null;
function startLoops() {
  if (gameLoopTimer || stormTimer) return;
  gameLoopTimer = setInterval(() => {
    const now = Date.now();
    const tickStarted = performance.now();
    tickGame(now);
    telemetry.timing('game_tick_duration', performance.now() - tickStarted, { 'round.id': state.roundId, phase: state.phase });
    const bossStarted = performance.now();
    bossDirector.tick(now);
    telemetry.timing('boss_tick_duration', performance.now() - bossStarted, { 'boss.phase': state.boss?.phase || 0, 'round.id': state.roundId });
    autoFinish();
    if (now - lastMetricsAt >= 10_000) {
      lastMetricsAt = now;
      telemetry.gauge('active_players', state.players.filter((player) => player.alive).length, { 'round.id': state.roundId });
      telemetry.gauge('active_connections', wss.clients.size, { 'round.id': state.roundId });
    }
    if (['countdown', 'running', 'ended'].includes(state.phase) && now - lastStateBroadcastAt >= 500) { lastStateBroadcastAt = now; emit('tick'); }
  }, 250);
  gameLoopTimer.unref?.();
  stormTimer = setInterval(() => { tickStorm(); if (state.phase === 'running') emit('tick'); }, 7000);
  stormTimer.unref?.();
}
function stopLoops() {
  if (gameLoopTimer) clearInterval(gameLoopTimer);
  if (stormTimer) clearInterval(stormTimer);
  gameLoopTimer = null; stormTimer = null;
}

async function listen() {
  await new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(cfg.port);
  });
  console.log(`StarTrades LIVE http://127.0.0.1:${cfg.port} (${cfg.mock ? 'SIMULAÇÃO' : '@' + cfg.username})`);
}

async function bootstrap() {
  const [leaderboardReady, mappingStatus] = await Promise.all([initializeLeaderboard(), giftMappings.initialize()]);
  const restoreResult = await snapshots.restore();
  state.settings.effectIntensity ||= 'NORMAL';
  applyNarratorConfig();
  await listen();
  startLoops();
  snapshots.start();
  emit('leaderboard:ready', { count: getLeaderboard().length, persistenceAvailable: Boolean(leaderboardReady) });
  emit('gift-mappings:ready', mappingStatus);
  emit('snapshot:ready', { restored: Boolean(restoreResult.restored), reason: restoreResult.reason || null, status: snapshots.status() });
  startTikTok();
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal}`);
  const forceExit = setTimeout(() => process.exit(1), 15_000);
  forceExit.unref?.();
  stopLoops();
  snapshots.stop();
  await snapshots.save(`shutdown-${String(signal).toLowerCase()}`);
  giftCinematicDirector.dispose();
  narratorDirector.dispose();
  narrator.dispose();
  powerExecutor.dispose();
  comboManager.reset();
  rivalryManager.endAll('shutdown');
  liveInteractions.reset();
  try { live?.disconnect?.(); } catch {}
  for (const client of wss.clients) client.close(1001, 'server-shutdown');
  wss.close(() => {
    server.close(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
  });
}
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });

app.get('*', (_req, res) => res.sendFile(new URL('../dist/index.html', import.meta.url).pathname));

void bootstrap().catch((error) => {
  console.error(`[boot] ${String(error?.message || error).slice(0, 160)}`);
  process.exitCode = 1;
  if (!server.listening) void listen().catch(() => process.exit(1));
});
