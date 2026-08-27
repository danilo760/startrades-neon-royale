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
  } else if (/^(oi|olÃ¡|ola|como joga|!ajuda)$/i.test(comment.trim())) narrator.local('Use exclamaÃ§Ã£o entrar para participar. Gifts ativam efeitos balanceados de entretenimento.', { priority: 1, emotion: 'friendly', eventType: 'help' });
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
    if (bonus) narrator.local('Quinhentas curtidas repeliram a tempestadkkºwµç_¢·b²™ZÉ»­q©er‰íj)Þuû¥–ö¥¹