import { createClient } from '@supabase/supabase-js';
import { captureLegacyGiftRuntime, join, reset, restoreLegacyGiftRuntime, state } from './engine.js';

export const SNAPSHOT_VERSION = 2;
const SNAPSHOT_KEY = 'active';
const MAX_PLAYERS = 200;
const MAX_HAZARDS = 24;
const MAX_FEED = 14;
const MAX_SNAPSHOT_PAYLOAD_BYTES = 262_144;
const PHASES = new Set(['lobby', 'countdown', 'running', 'paused', 'ended']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const TTL_MS = clamp(Number(process.env.GAME_SNAPSHOT_TTL_MS) || 10 * 60 * 1000, 60_000, 30 * 60 * 1000);
const INTERVAL_MS = clamp(Number(process.env.GAME_SNAPSHOT_INTERVAL_MS) || 5_000, 2_000, 30_000);
const TIMEOUT_MS = clamp(Number(process.env.SUPABASE_TIMEOUT_MS) || 5_000, 1_000, 10_000);
const client = process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const runtimeStatus = {
  configured: Boolean(client),
  persistenceAvailable: false,
  snapshotVersion: SNAPSHOT_VERSION,
  ttlMs: TTL_MS,
  intervalMs: INTERVAL_MS,
  lastError: null,
  lastSavedAt: null,
  lastRestoredAt: null,
  lastReason: null,
};

const SENSITIVE_KEY_RE = /token|cookie|secret|authorization|service[_-]?role|password|api[_-]?key/i;
const snapshotSecretValues = () => [
  process.env.ADMIN_TOKEN,
  process.env.SUPABASE_SECRET_KEY,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  process.env.TIKTOOL_API_KEY,
  process.env.OTEL_EXPORTER_OTLP_HEADERS,
].map((value) => String(value || '')).filter((value) => value.length >= 6);
const redactSecrets = (value) => {
  let output = String(value ?? '');
  for (const secret of snapshotSecretValues()) output = output.split(secret).join('[redacted]');
  return output;
};
const safeString = (value, max = 120) => redactSecrets(value).replace(/[\u0000-\u001f\u007f-\u009f<>`]/g, '').trim().slice(0, max);
const scrubClone = (value, depth = 0) => {
  if (depth > 6) return null;
  if (value === null || value === undefined || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'bigint') return safeString(value, 500);
  if (Array.isArray(value)) return value.slice(0, 128).map((item) => scrubClone(item, depth + 1));
  if (typeof value === 'object') {
    const result = {};
    for (const [key, child] of Object.entries(value).slice(0, 128)) {
      if (SENSITIVE_KEY_RE.test(key)) continue;
      const cleanKey = safeString(key, 80);
      if (cleanKey) result[cleanKey] = scrubClone(child, depth + 1);
    }
    return result;
  }
  return null;
};
const safeClone = (value, fallback = null) => {
  try {
    const cloned = JSON.parse(JSON.stringify(value));
    const safe = scrubClone(cloned);
    return safe === undefined ? fallback : safe;
  } catch { return fallback; }
};
const snapshotPayloadBytes = (payload) => {
  try { return Buffer.byteLength(JSON.stringify(payload), 'utf8'); } catch { return Number.POSITIVE_INFINITY; }
};
const timeout = async (promise) => {
  let timer = null;
  try {
    const guard = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Supabase snapshot timeout')), TIMEOUT_MS);
      timer.unref?.();
    });
    return await Promise.race([promise, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
const mapEntries = (map, now, limit = 500) => [...(map instanceof Map ? map : new Map())]
  .filter(([key, expiresAt]) => safeString(key, 160) && Number(expiresAt) > now)
  .slice(-limit)
  .map(([key, expiresAt]) => [safeString(key, 160), Number(expiresAt)]);
const restoreMap = (map, entries, now) => {
  if (!(map instanceof Map)) return;
  map.clear();
  for (const item of Array.isArray(entries) ? entries.slice(-500) : []) {
    if (!Array.isArray(item) || item.length !== 2) continue;
    const key = safeString(item[0], 160);
    const expiresAt = Number(item[1]);
    if (key && Number.isFinite(expiresAt) && expiresAt > now) map.set(key, expiresAt);
  }
};

function sanitizePlayer(player = {}) {
  const maxHp = clamp(player.maxHp || 100, 1, 10000);
  return {
    id: safeString(player.id || player.platformUserId, 80),
    platformUserId: safeString(player.platformUserId || player.id, 80),
    username: safeString(player.username || 'fighter', 32) || 'fighter',
    avatarUrl: /^https:\/\//i.test(player.avatarUrl || '') ? String(player.avatarUrl).slice(0, 500) : '',
    x: clamp(player.x, 0, 1280), y: clamp(player.y, 0, 720),
    targetX: clamp(player.targetX, 0, 1280), targetY: clamp(player.targetY, 0, 720),
    maxHp, hp: clamp(player.hp, 0, maxHp), shield: clamp(player.shield, 0, 1000),
    shieldUntil: Math.max(0, Number(player.shieldUntil) || 0),
    speedMultiplier: clamp(player.speedMultiplier || 1, 1, 1.5),
    speedBoostUntil: Math.max(0, Number(player.speedBoostUntil) || 0),
    hype: clamp(player.hype, 0, 999), starPowerUntil: Math.max(0, Number(player.starPowerUntil) || 0),
    energy: clamp(player.energy, 0, 10000), score: Math.max(0, Number(player.score) || 0),
    eliminations: Math.max(0, Math.trunc(Number(player.eliminations) || 0)), alive: Boolean(player.alive),
    skin: clamp(Math.trunc(Number(player.skin) || 0), 0, 32), team: player.team === 'red' ? 'red' : 'blue', bot: Boolean(player.bot),
    spawnInvulnerableUntil: Math.max(0, Number(player.spawnInvulnerableUntil) || 0),
    lastMoveAt: Math.max(0, Number(player.lastMoveAt) || 0), wanderAt: Math.max(0, Number(player.wanderAt) || 0),
    nextServerShotAt: Math.max(0, Number(player.nextServerShotAt) || 0), nextStormHitAt: Math.max(0, Number(player.nextStormHitAt) || 0),
  };
}

function sanitizeBoss(boss = {}) {
  return {
    id: boss?.id ? safeString(boss.id, 120) : null,
    active: Boolean(boss?.active),
    hp: Math.max(0, Number(boss?.hp) || 0), maxHp: Math.max(0, Number(boss?.maxHp) || 0),
    x: clamp(boss?.x, 0, 1280), y: clamp(boss?.y, 0, 720), radius: clamp(boss?.radius || 72, 1, 500),
    spawnedAt: Math.max(0, Number(boss?.spawnedAt) || 0), expiresAt: Math.max(0, Number(boss?.expiresAt) || 0),
    targetPlayerId: boss?.targetPlayerId ? safeString(boss.targetPlayerId, 80) : null,
    lastAttackAt: Math.max(0, Number(boss?.lastAttackAt) || 0),
    attack: boss?.attack && typeof boss.attack === 'object' ? safeClone(boss.attack, null) : null,
    cooldownUntil: Math.max(0, Number(boss?.cooldownUntil) || 0),
    phase: Math.max(0, Math.trunc(Number(boss?.phase) || 0)),
  };
}

function sanitizeHazards(hazards = []) {
  return (Array.isArray(hazards) ? hazards : []).slice(-MAX_HAZARDS).map((hazard) => ({
    id: safeString(hazard?.id, 120), type: safeString(hazard?.type, 40),
    x: clamp(hazard?.x, 0, 1280), y: clamp(hazard?.y, 0, 720),
    targetPlayerId: hazard?.targetPlayerId ? safeString(hazard.targetPlayerId, 80) : null,
    radius: clamp(hazard?.radius, 0, 500), damage: clamp(hazard?.damage, 0, 1000),
    createdAt: Math.max(0, Number(hazard?.createdAt) || 0), impactAt: Math.max(0, Number(hazard?.impactAt) || 0),
    expiresAt: Math.max(0, Number(hazard?.expiresAt) || 0), visualEffect: safeString(hazard?.visualEffect, 80),
    resolved: Boolean(hazard?.resolved),
  })).filter((hazard) => hazard.id && hazard.type);
}

function sanitizeSettings(settings = {}) {
  const giftLimits = settings?.giftLimits && typeof settings.giftLimits === 'object' ? settings.giftLimits : {};
  const arenaBackground = ['default', 'cyberpunk', 'space', 'retro'].includes(settings.arenaBackground) ? settings.arenaBackground : 'default';
  const voiceMode = ['male', 'female'].includes(settings.voiceMode) ? settings.voiceMode : 'male';
  const narratorStyle = ['explosive', 'esports', 'cinematic'].includes(settings.narratorStyle) ? settings.narratorStyle : 'explosive';
  const effectIntensity = ['AUTO', 'BAIXA', 'NORMAL', 'ALTA'].includes(String(settings.effectIntensity || '').toUpperCase()) ? String(settings.effectIntensity).toUpperCase() : 'AUTO';
  const narratorPersonalityRaw = String(settings.narratorPersonality || 'HYPE').toUpperCase();
  const narratorPersonality = ['ESPORTS', 'HYPE', 'CINEMATIC', 'CHAOTIC', 'SARCASTIC'].includes(narratorPersonalityRaw) ? narratorPersonalityRaw : 'HYPE';
  return {
    agentEnabled: settings.agentEnabled !== false,
    teamMode: Boolean(settings.teamMode),
    arenaBackground,
    voiceMode,
    voiceIntensity: clamp(Math.trunc(Number(settings.voiceIntensity) || 3), 1, 3),
    narratorStyle,
    music: settings.music !== false,
    sound: settings.sound !== false,
    effectIntensity,
    narratorPersonality,
    narratorIntensity: clamp(settings.narratorIntensity ?? 80, 0, 100),
    narratorFrequency: clamp(settings.narratorFrequency ?? 60, 0, 100),
    narratorVolume: clamp(settings.narratorVolume ?? 100, 0, 100),
    narratorEnabled: settings.narratorEnabled !== false,
    giftLimits: {
      perPlayerPerRound: clamp(giftLimits.perPlayerPerRound || 12, 1, 100),
      perRound: clamp(giftLimits.perRound || 120, 1, 1000),
      pendingPerUser: clamp(giftLimits.pendingPerUser || 3, 1, 10),
      maxComboActivations: clamp(giftLimits.maxComboActivations || 2, 1, 10),
    },
  };
}

function computeTeamScores(players) {
  const scoreFor = (team) => players.filter((player) => player.team === team).reduce((total, player) => ({
    score: total.score + Number(player.score || 0),
    survivors: total.survivors + Number(player.alive),
    eliminations: total.eliminations + Number(player.eliminations || 0),
  }), { score: 0, survivors: 0, eliminations: 0 });
  return { blue: scoreFor('blue'), red: scoreFor('red') };
}

export function captureGameSnapshot({ powerExecutor = null, now = Date.now(), reason = 'periodic' } = {}) {
  const savedAt = Number(now);
  const expiresAt = savedAt + TTL_MS;
  const safeReason = safeString(reason, 80) || 'periodic';
  const players = (state.players || []).slice(0, MAX_PLAYERS).map(sanitizePlayer).filter((player) => player.id && player.platformUserId);
  const roundId = safeString(state.roundId || `round-${savedAt}`, 120) || `round-${savedAt}`;
  const phase = PHASES.has(state.phase) ? state.phase : 'lobby';
  const payload = {
    snapshotReason: safeReason,
    roundId, phase,
    round: Math.max(1, Math.trunc(Number(state.round) || 1)), storm: clamp(state.storm, 0, 100), likes: Math.max(0, Number(state.likes) || 0),
    players,
    winner: state.winner ? safeClone(state.winner, null) : null,
    countdownEndsAt: Math.max(0, Number(state.countdownEndsAt) || 0), intermissionEndsAt: Math.max(0, Number(state.intermissionEndsAt) || 0),
    roundStartedAt: Math.max(0, Number(state.roundStartedAt) || 0), suddenDeath: safeClone(state.suddenDeath, { active: false, startedAt: 0 }),
    bountyTargetId: state.bountyTargetId ? safeString(state.bountyTargetId, 80) : null,
    bountyTargetPlatformId: state.bountyTargetPlatformId ? safeString(state.bountyTargetPlatformId, 80) : null,
    bountyClaimedBy: state.bountyClaimedBy ? safeString(state.bountyClaimedBy, 80) : null,
    settings: sanitizeSettings(state.settings), hazards: sanitizeHazards(state.hazards), boss: sanitizeBoss(state.boss),
    bossCooldownUntil: Math.max(0, Number(state.bossCooldownUntil) || 0),
    teamScores: computeTeamScores(players),
    feed: (Array.isArray(state.feed) ? state.feed : []).slice(0, MAX_FEED).map((item) => ({
      id: safeString(item?.id, 120), text: safeString(item?.text, 160), tone: safeString(item?.tone, 32), at: Math.max(0, Number(item?.at) || 0),
    })),
    legacyGiftRuntime: captureLegacyGiftRuntime(savedAt),
    powerRuntime: powerExecutor ? {
      seen: mapEntries(powerExecutor.seen, savedAt),
      cooldowns: mapEntries(powerExecutor.cooldowns, savedAt),
      globalCooldowns: mapEntries(powerExecutor.globalCooldowns, savedAt),
    } : null,
  };
  if (snapshotPayloadBytes(payload) > MAX_SNAPSHOT_PAYLOAD_BYTES) throw new Error('snapshot-payload-too-large');
  return {
    snapshotKey: SNAPSHOT_KEY,
    snapshotVersion: SNAPSHOT_VERSION,
    roundId,
    phase,
    savedAt,
    expiresAt,
    reason: safeReason,
    payload,
  };
}

export function validateSnapshotEnvelope(input, { now = Date.now(), ttlMs = TTL_MS } = {}) {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'snapshot-missing' };
  const savedRaw = input.savedAt ?? input.saved_at;
  const expiresRaw = input.expiresAt ?? input.expires_at;
  const snapshot = {
    snapshotKey: input.snapshotKey ?? input.snapshot_key,
    snapshotVersion: Number(input.snapshotVersion ?? input.snapshot_version),
    roundId: safeString(input.roundId ?? input.round_id, 120),
    phase: input.phase,
    savedAt: typeof savedRaw === 'number' ? savedRaw : new Date(savedRaw).getTime(),
    expiresAt: typeof expiresRaw === 'number' ? expiresRaw : new Date(expiresRaw).getTime(),
    reason: safeString(input.reason ?? input.payload?.snapshotReason ?? 'unknown', 80),
    payload: input.payload,
  };
  if (snapshot.snapshotKey !== SNAPSHOT_KEY) return { ok: false, reason: 'snapshot-key-invalid' };
  if (snapshot.snapshotVersion !== SNAPSHOT_VERSION) return { ok: false, reason: 'snapshot-version-unsupported' };
  if (!snapshot.roundId) return { ok: false, reason: 'snapshot-round-invalid' };
  if (!PHASES.has(snapshot.phase)) return { ok: false, reason: 'snapshot-phase-invalid' };
  if (!snapshot.payload || typeof snapshot.payload !== 'object') return { ok: false, reason: 'snapshot-payload-invalid' };
  if (snapshotPayloadBytes(snapshot.payload) > MAX_SNAPSHOT_PAYLOAD_BYTES) return { ok: false, reason: 'snapshot-payload-too-large' };
  if (safeString(snapshot.payload.roundId, 120) !== snapshot.roundId) return { ok: false, reason: 'snapshot-round-mismatch' };
  if (snapshot.payload.phase !== snapshot.phase) return { ok: false, reason: 'snapshot-phase-mismatch' };
  if (!snapshot.payload.legacyGiftRuntime || typeof snapshot.payload.legacyGiftRuntime !== 'object') return { ok: false, reason: 'snapshot-runtime-invalid' };
  if (!Number.isFinite(snapshot.savedAt) || !Number.isFinite(snapshot.expiresAt)) return { ok: false, reason: 'snapshot-time-invalid' };
  if (snapshot.expiresAt <= now || now - snapshot.savedAt > ttlMs || snapshot.savedAt > now + 30_000) return { ok: false, reason: 'snapshot-expired' };
  if (!Array.isArray(snapshot.payload.players) || snapshot.payload.players.length > MAX_PLAYERS) return { ok: false, reason: 'snapshot-players-invalid' };
  return { ok: true, snapshot };
}

export function restoreGameSnapshot(input, { powerExecutor = null, now = Date.now() } = {}) {
  const validation = validateSnapshotEnvelope(input, { now });
  if (!validation.ok) return { restored: false, reason: validation.reason };
  const snapshot = validation.snapshot;
  const payload = snapshot.payload;
  powerExecutor?.cancelPending?.();
  reset({ preservePlayers: false, preserveGiftInbox: false, now });
  const restoredPlayers = [];
  for (const raw of payload.players.slice(0, MAX_PLAYERS)) {
    const saved = sanitizePlayer(raw);
    if (!saved.id || !saved.platformUserId) continue;
    const player = join(saved.username, saved.team, saved.bot, { platformUserId: saved.platformUserId, avatarUrl: saved.avatarUrl });
    Object.assign(player, saved);
    restoredPlayers.push(player);
  }
  const currentSettings = state.settings || {};
  const savedSettings = sanitizeSettings(payload.settings);
  Object.assign(state, {
    roundId: snapshot.roundId,
    phase: snapshot.phase,
    round: Math.max(1, Math.trunc(Number(payload.round) || 1)),
    storm: clamp(payload.storm, 0, 100), likes: Math.max(0, Number(payload.likes) || 0), players: restoredPlayers,
    winner: payload.winner ? safeClone(payload.winner, null) : null,
    countdownEndsAt: Math.max(0, Number(payload.countdownEndsAt) || 0), intermissionEndsAt: Math.max(0, Number(payload.intermissionEndsAt) || 0),
    roundStartedAt: Math.max(0, Number(payload.roundStartedAt) || 0),
    suddenDeath: payload.suddenDeath && typeof payload.suddenDeath === 'object' ? safeClone(payload.suddenDeath, { active: false, startedAt: 0 }) : { active: false, startedAt: 0 },
    bountyTargetId: payload.bountyTargetId ? safeString(payload.bountyTargetId, 80) : null,
    bountyTargetPlatformId: payload.bountyTargetPlatformId ? safeString(payload.bountyTargetPlatformId, 80) : null,
    bountyClaimedBy: payload.bountyClaimedBy ? safeString(payload.bountyClaimedBy, 80) : null,
    settings: { ...currentSettings, ...savedSettings, giftLimits: { ...(currentSettings.giftLimits || {}), ...(savedSettings.giftLimits || {}) } },
    hazards: sanitizeHazards(payload.hazards), boss: sanitizeBoss(payload.boss),
    bossCooldownUntil: Math.max(0, Number(payload.bossCooldownUntil) || 0),
    teamScores: computeTeamScores(restoredPlayers),
    feed: (Array.isArray(payload.feed) ? payload.feed : []).slice(0, MAX_FEED).map((item) => ({ id: safeString(item?.id, 120), text: safeString(item?.text, 160), tone: safeString(item?.tone, 32), at: Math.max(0, Number(item?.at) || 0) })),
  });
  restoreLegacyGiftRuntime(payload.legacyGiftRuntime, now);
  if (powerExecutor && payload.powerRuntime) {
    restoreMap(powerExecutor.seen, payload.powerRuntime.seen, now);
    restoreMap(powerExecutor.cooldowns, payload.powerRuntime.cooldowns, now);
    restoreMap(powerExecutor.globalCooldowns, payload.powerRuntime.globalCooldowns, now);
    powerExecutor.prune?.(now);
  }
  return { restored: true, roundId: state.roundId, phase: state.phase, playerCount: state.players.length, savedAt: snapshot.savedAt };
}

async function saveRemoteSnapshot(snapshot) {
  if (!client) return { saved: false, reason: 'not-configured' };
  if (snapshotPayloadBytes(snapshot.payload) > MAX_SNAPSHOT_PAYLOAD_BYTES) throw new Error('snapshot-payload-too-large');
  const { error } = await timeout(client.from('game_snapshots').upsert({
    snapshot_key: SNAPSHOT_KEY,
    snapshot_version: snapshot.snapshotVersion,
    round_id: snapshot.roundId,
    phase: snapshot.phase,
    saved_at: new Date(snapshot.savedAt).toISOString(),
    expires_at: new Date(snapshot.expiresAt).toISOString(),
    payload: snapshot.payload,
  }, { onConflict: 'snapshot_key' }));
  if (error) throw error;
  return { saved: true };
}

async function loadRemoteSnapshot() {
  if (!client) return { data: null, reason: 'not-configured' };
  const { data, error } = await timeout(client.from('game_snapshots').select('snapshot_key,snapshot_version,round_id,phase,saved_at,expires_at,payload').eq('snapshot_key', SNAPSHOT_KEY).maybeSingle());
  if (error) throw error;
  return { data: data || null, reason: data ? null : 'not-found' };
}

export function createSnapshotController({ powerExecutor = null, telemetry = null, publish = () => {} } = {}) {
  let timer = null;
  let saveChain = Promise.resolve({ saved: false, reason: 'not-started' });
  const status = () => ({ ...runtimeStatus });

  const save = (reason = 'periodic') => {
    const execute = async () => {
      const started = performance.now();
      if (!client) return { saved: false, reason: 'not-configured' };
      try {
        const snapshot = captureGameSnapshot({ powerExecutor, reason });
        const result = await saveRemoteSnapshot(snapshot);
        runtimeStatus.persistenceAvailable = true;
        runtimeStatus.lastError = null;
        runtimeStatus.lastSavedAt = snapshot.savedAt;
        runtimeStatus.lastReason = snapshot.reason;
        telemetry?.timing?.('snapshot_save_duration', performance.now() - started, { 'round.id': snapshot.roundId, reason: snapshot.reason });
        return { ...result, roundId: snapshot.roundId, phase: snapshot.phase, savedAt: snapshot.savedAt };
      } catch (error) {
        runtimeStatus.persistenceAvailable = false;
        runtimeStatus.lastError = safeString(error?.message || error, 120) || 'snapshot-save-failed';
        console.warn(`[snapshot] save adiado: ${runtimeStatus.lastError}`);
        telemetry?.timing?.('snapshot_save_duration', performance.now() - started, { result: 'error' });
        return { saved: false, reason: 'save-failed', error: runtimeStatus.lastError };
      }
    };
    saveChain = saveChain.catch(() => null).then(execute);
    return saveChain;
  };

  const restore = async () => {
    const started = performance.now();
    if (!client) return { restored: false, reason: 'not-configured' };
    try {
      const loaded = await loadRemoteSnapshot();
      if (!loaded.data) {
        runtimeStatus.persistenceAvailable = true;
        runtimeStatus.lastError = null;
        return { restored: false, reason: loaded.reason || 'not-found' };
      }
      const result = restoreGameSnapshot(loaded.data, { powerExecutor });
      runtimeStatus.persistenceAvailable = true;
      runtimeStatus.lastError = result.restored ? null : result.reason;
      if (result.restored) {
        runtimeStatus.lastRestoredAt = Date.now();
        runtimeStatus.lastReason = loaded.data.payload?.snapshotReason || 'restore';
        publish('snapshot:restored', { roundId: result.roundId, phase: result.phase, playerCount: result.playerCount });
      }
      telemetry?.timing?.('snapshot_restore_duration', performance.now() - started, { result: result.restored ? 'restored' : result.reason, 'round.id': result.roundId || '' });
      return result;
    } catch (error) {
      runtimeStatus.persistenceAvailable = false;
      runtimeStatus.lastError = safeString(error?.message || error, 120) || 'snapshot-restore-failed';
      console.warn(`[snapshot] boot sem restore: ${runtimeStatus.lastError}`);
      telemetry?.timing?.('snapshot_restore_duration', performance.now() - started, { result: 'error' });
      return { restored: false, reason: 'restore-failed', error: runtimeStatus.lastError };
    }
  };

  const start = () => {
    if (timer) return;
    timer = setInterval(() => {
      if (['countdown', 'running', 'paused', 'ended'].includes(state.phase)) void save('periodic');
    }, INTERVAL_MS);
    timer.unref?.();
  };
  const stop = () => { if (timer) clearInterval(timer); timer = null; };
  const critical = (reason) => { if (client) void save(reason); };
  return { save, restore, start, stop, critical, status };
}

export const snapshotInternals = Object.freeze({ TTL_MS, INTERVAL_MS, TIMEOUT_MS, MAX_SNAPSHOT_PAYLOAD_BYTES });
