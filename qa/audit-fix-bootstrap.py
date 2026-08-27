from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path, old, new):
    text = read(path)
    if text.count(old) != 1:
        raise RuntimeError(f'{path}: expected exactly one match, got {text.count(old)} for {old[:80]!r}')
    write(path, text.replace(old, new, 1))


def insert_before(path, marker, inserted):
    text = read(path)
    if text.count(marker) != 1:
        raise RuntimeError(f'{path}: marker count {text.count(marker)} for {marker!r}')
    write(path, text.replace(marker, inserted + marker, 1))


def replace_between(path, start_marker, end_marker, replacement):
    text = read(path)
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    write(path, text[:start] + replacement + text[end:])


# ESLint: Playwright specs execute browser callbacks inside page.evaluate().
insert_before('eslint.config.js', "  {\n    files: ['src/**/*.{js,jsx}'],\n", """  {
    files: ['qa/e2e/**/*.spec.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
""")

# Lint findings: strict null checks and dead imports only; preserve nullish semantics.
replace_once('qa/chaos-bot.js', "import { __test, applyGiftEffect, finish, join, pause, reset, setStorm, spawnBoss, start, state, tickGame } from '../server/engine.js';", "import { __test, applyGiftEffect, join, pause, reset, setStorm, spawnBoss, start, state, tickGame } from '../server/engine.js';")
replace_once('server/integration.test.js', 'if (child.exitCode != null)', 'if (child.exitCode !== null)')
replace_once('server/integration.test.js', 'if (child.exitCode == null)', 'if (child.exitCode === null)')
replace_once('server/replay.js', "if (value == null || typeof value === 'boolean')", "if (value === null || value === undefined || typeof value === 'boolean')")
replace_once('server/telemetry.js', "else if (raw != null && ['string', 'bigint'].includes(typeof raw))", "else if (raw !== null && raw !== undefined && ['string', 'bigint'].includes(typeof raw))")
replace_once('src/game/ArenaVisuals.js', "import Phaser from 'phaser';\n", '')
replace_once('src/main.jsx', "{diagnostics?.memoryMb != null && <span>MEM <b>{diagnostics.memoryMb} MB</b></span>}", "{diagnostics?.memoryMb !== null && diagnostics?.memoryMb !== undefined && <span>MEM <b>{diagnostics.memoryMb} MB</b></span>}")
replace_once('src/overlay/Overlay.jsx', '    let soundEnabled = null;\n', '    let soundEnabled = null;\n    const killTimerMap = killTimers.current;\n')
replace_once('src/overlay/Overlay.jsx', '        killTimers.current.delete(id);', '        killTimerMap.delete(id);')
replace_once('src/overlay/Overlay.jsx', '      killTimers.current.set(id, timer);', '      killTimerMap.set(id, timer);')
replace_once('src/overlay/Overlay.jsx', '      for (const timer of killTimers.current.values()) clearTimeout(timer);\n      killTimers.current.clear();', '      for (const timer of killTimerMap.values()) clearTimeout(timer);\n      killTimerMap.clear();')
replace_once('src/overlay/Overlay.jsx', "state.winner.survivors != null ? `${state.winner.survivors} sobreviventes • ` : ''", "state.winner.survivors !== null && state.winner.survivors !== undefined ? `${state.winner.survivors} sobreviventes • ` : ''")

# ChaosBot aggressive scenarios remain CLI/manual only. Default tests cover the safety gate itself.
write('qa/chaos-bot.test.js', """import assert from 'node:assert/strict';
import test from 'node:test';
import { assertChaosSafety } from './chaos-bot.js';

const ENV_KEYS = ['NODE_ENV', 'MOCK_MODE', 'QA_CHAOS_ACK', 'RENDER'];

test('ChaosBot safety gate requires explicit local-only acknowledgement', () => {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) delete process.env[key];
    assert.throws(() => assertChaosSafety(['node', 'qa/chaos-bot.js']), /NODE_ENV=test/);

    process.env.NODE_ENV = 'test';
    process.env.MOCK_MODE = 'true';
    process.env.QA_CHAOS_ACK = 'I_UNDERSTAND_LOCAL_ONLY';
    assert.doesNotThrow(() => assertChaosSafety(['node', 'qa/chaos-bot.js', '--i-understand-chaos']));

    process.env.RENDER = 'true';
    assert.throws(() => assertChaosSafety(['node', 'qa/chaos-bot.js', '--i-understand-chaos']), /blocked on Render/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
""")

# QA Lab defense in depth: every QA-originating admin request carries a server-checked marker.
replace_once('src/control/QALab.jsx', "      ...(token ? { authorization: `Bearer ${token}` } : {}),", "      'x-neon-qa-lab': '1',\n      ...(token ? { authorization: `Bearer ${token}` } : {}),")
replace_once('server/admin.js', "export function authorizeAdminRequest({ headers = {}, ip = 'unknown', token = process.env.ADMIN_TOKEN || '', now = Date.now(), action = 'admin' } = {}) {", "export function authorizeAdminRequest({ headers = {}, ip = 'unknown', token = process.env.ADMIN_TOKEN || '', now = Date.now(), action = 'admin', mockMode = true } = {}) {")
replace_once('server/admin.js', "  if (!secureEqual(extractToken(headers), token)) return { ok: false, status: 401, reason: 'unauthorized' };\n", "  if (!secureEqual(extractToken(headers), token)) return { ok: false, status: 401, reason: 'unauthorized' };\n  const qaLabRequest = String(headers['x-neon-qa-lab'] || headers['X-Neon-QA-Lab'] || '') === '1';\n  if (qaLabRequest && !mockMode) return { ok: false, status: 403, reason: 'qa-lab-disabled' };\n")
replace_once('server/index.js', "  const result = authorizeAdminRequest({ headers: req.headers, ip: req.ip, token: cfg.adminToken, action });", "  const result = authorizeAdminRequest({ headers: req.headers, ip: req.ip, token: cfg.adminToken, action, mockMode: cfg.mock });")
insert_before('server/admin.test.js', "\ntest('admin simulator is rate limited'", """
test('QA Lab requests are blocked server-side outside MOCK_MODE', () => {
  resetAdminRateLimits();
  const headers = { authorization: 'Bearer secret', 'x-neon-qa-lab': '1' };
  const blocked = authorizeAdminRequest({ token: 'secret', headers, mockMode: false, now: 1000 });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.reason, 'qa-lab-disabled');
  assert.equal(authorizeAdminRequest({ token: 'secret', headers, mockMode: true, now: 2000 }).ok, true);
});
""")

# Engine legacy Gift runtime: snapshot idempotency/cooldown/usage/pending state without serializing timers.
replace_once('server/engine.js', "const PENDING_TTL_MS = 10 * 60 * 1000;", "const PENDING_TTL_MS = 10 * 60 * 1000;\nconst LEGACY_RUNTIME_MAP_LIMIT = 500;\nconst LEGACY_RUNTIME_PENDING_USERS_LIMIT = 200;")
insert_before('server/engine.js', "function applyPendingForPlayer(player, now = nowMs()) {", r"""
function runtimeExpiryEntries(map, now, limit = LEGACY_RUNTIME_MAP_LIMIT) {
  return [...map]
    .filter(([key, expiresAt]) => sanitizeStableId(key) && Number(expiresAt) > now)
    .slice(-limit)
    .map(([key, expiresAt]) => [sanitizeStableId(key), Number(expiresAt)]);
}

export function captureLegacyGiftRuntime(now = nowMs()) {
  pruneProcessed(now);
  const limits = getGiftLimits();
  const perPlayer = clamp(Number(limits.perPlayerPerRound) || 12, 1, 100);
  const perRound = clamp(Number(limits.perRound) || 120, 1, 1000);
  const pendingPerUser = clamp(Number(limits.pendingPerUser) || 3, 1, 10);
  const usage = [...giftUsage]
    .slice(-LEGACY_RUNTIME_MAP_LIMIT)
    .map(([key, count]) => [sanitizeStableId(key), clamp(Math.trunc(Number(count) || 0), 0, perPlayer)])
    .filter(([key]) => Boolean(key));
  const pending = [];
  for (const [ownerIdRaw, list] of [...pendingGifts].slice(-LEGACY_RUNTIME_PENDING_USERS_LIMIT)) {
    const ownerId = sanitizeStableId(ownerIdRaw);
    if (!ownerId) continue;
    const items = (Array.isArray(list) ? list : []).filter((item) => Number(item?.expiresAt) > now).slice(-pendingPerUser).map((item) => {
      const gift = item?.gift || resolveGiftDefinition(item?.giftId, item?.giftName);
      const eventId = sanitizeStableId(item?.eventId);
      const senderUserId = sanitizeStableId(item?.senderUserId || ownerId);
      if (!gift || !eventId || !senderUserId) return null;
      return {
        eventId,
        senderUserId,
        senderUsername: sanitizeDisplayName(item?.senderUsername, 'fighter', 32),
        giftId: String(gift.giftId || '').slice(0, 80),
        giftName: sanitizeDisplayName(item?.giftName || gift.aliases?.[0], 'Presente', 48),
        repeatCount: clamp(Math.trunc(Number(item?.repeatCount) || 1), 1, 100),
        source: item?.source === 'control-panel' ? 'control-panel' : 'tiktok',
        expiresAt: Number(item.expiresAt),
      };
    }).filter(Boolean);
    if (items.length) pending.push([ownerId, items]);
  }
  return {
    roundGiftCount: clamp(Math.trunc(Number(roundGiftCount) || 0), 0, perRound),
    giftUsage: usage,
    giftCooldowns: runtimeExpiryEntries(giftCooldowns, now),
    processedGiftIds: runtimeExpiryEntries(processedGiftIds, now),
    pendingGifts: pending,
  };
}

export function restoreLegacyGiftRuntime(runtime = {}, now = nowMs()) {
  const limits = getGiftLimits();
  const perPlayer = clamp(Number(limits.perPlayerPerRound) || 12, 1, 100);
  const perRound = clamp(Number(limits.perRound) || 120, 1, 1000);
  const pendingPerUser = clamp(Number(limits.pendingPerUser) || 3, 1, 10);
  roundGiftCount = clamp(Math.trunc(Number(runtime?.roundGiftCount) || 0), 0, perRound);
  giftUsage.clear(); giftCooldowns.clear(); processedGiftIds.clear(); pendingGifts.clear();

  for (const item of Array.isArray(runtime?.giftUsage) ? runtime.giftUsage.slice(-LEGACY_RUNTIME_MAP_LIMIT) : []) {
    if (!Array.isArray(item) || item.length !== 2) continue;
    const key = sanitizeStableId(item[0]);
    const count = clamp(Math.trunc(Number(item[1]) || 0), 0, perPlayer);
    if (key && count > 0) giftUsage.set(key, count);
  }
  for (const [targetMap, entries] of [[giftCooldowns, runtime?.giftCooldowns], [processedGiftIds, runtime?.processedGiftIds]]) {
    for (const item of Array.isArray(entries) ? entries.slice(-LEGACY_RUNTIME_MAP_LIMIT) : []) {
      if (!Array.isArray(item) || item.length !== 2) continue;
      const key = sanitizeStableId(item[0]);
      const expiresAt = Number(item[1]);
      if (key && Number.isFinite(expiresAt) && expiresAt > now) targetMap.set(key, expiresAt);
    }
  }
  for (const entry of Array.isArray(runtime?.pendingGifts) ? runtime.pendingGifts.slice(-LEGACY_RUNTIME_PENDING_USERS_LIMIT) : []) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const ownerId = sanitizeStableId(entry[0]);
    if (!ownerId) continue;
    const restored = (Array.isArray(entry[1]) ? entry[1] : []).slice(-pendingPerUser).map((item) => {
      const gift = resolveGiftDefinition(item?.giftId, item?.giftName);
      const eventId = sanitizeStableId(item?.eventId);
      const senderUserId = sanitizeStableId(item?.senderUserId || ownerId);
      const expiresAt = Number(item?.expiresAt);
      if (!gift || !eventId || !senderUserId || !Number.isFinite(expiresAt) || expiresAt <= now) return null;
      return {
        gift,
        eventId,
        senderUserId,
        senderUsername: sanitizeDisplayName(item?.senderUsername, 'fighter', 32),
        giftName: sanitizeDisplayName(item?.giftName || gift.aliases?.[0], 'Presente', 48),
        repeatCount: clamp(Math.trunc(Number(item?.repeatCount) || 1), 1, 100),
        source: item?.source === 'control-panel' ? 'control-panel' : 'tiktok',
        expiresAt,
      };
    }).filter(Boolean);
    if (restored.length) pendingGifts.set(ownerId, restored);
  }
  pruneProcessed(now);
  return { roundGiftCount, processedGiftIds: processedGiftIds.size, pendingUsers: pendingGifts.size };
}

""")

# Snapshot v2: explicit secret scrubbing/whitelist, app-side byte cap, envelope consistency and legacy runtime.
replace_once('server/snapshot.js', "import { join, reset, state } from './engine.js';", "import { captureLegacyGiftRuntime, join, reset, restoreLegacyGiftRuntime, state } from './engine.js';")
replace_once('server/snapshot.js', 'export const SNAPSHOT_VERSION = 1;', 'export const SNAPSHOT_VERSION = 2;')
replace_once('server/snapshot.js', 'const MAX_FEED = 14;', 'const MAX_FEED = 14;\nconst MAX_SNAPSHOT_PAYLOAD_BYTES = 262_144;')
replace_between('server/snapshot.js', 'const safeString', 'const timeout', r"""const SENSITIVE_KEY_RE = /token|cookie|secret|authorization|service[_-]?role|password|api[_-]?key/i;
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
""")
insert_before('server/snapshot.js', 'function computeTeamScores(players) {', r"""function sanitizeSettings(settings = {}) {
  const giftLimits = settings?.giftLimits && typeof settings.giftLimits === 'object' ? settings.giftLimits : {};
  const arenaBackground = ['default', 'cyberpunk', 'space', 'retro'].includes(settings.arenaBackground) ? settings.arenaBackground : 'default';
  const voiceMode = ['male', 'female'].includes(settings.voiceMode) ? settings.voiceMode : 'male';
  const narratorStyle = ['explosive', 'esports', 'cinematic'].includes(settings.narratorStyle) ? settings.narratorStyle : 'explosive';
  const effectIntensity = ['BAIXA', 'NORMAL', 'ALTA'].includes(String(settings.effectIntensity || '').toUpperCase()) ? String(settings.effectIntensity).toUpperCase() : 'NORMAL';
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

""")
replace_between('server/snapshot.js', 'export function captureGameSnapshot', 'export function validateSnapshotEnvelope', r"""export function captureGameSnapshot({ powerExecutor = null, now = Date.now(), reason = 'periodic' } = {}) {
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

""")
replace_between('server/snapshot.js', 'export function validateSnapshotEnvelope', 'export function restoreGameSnapshot', r"""export function validateSnapshotEnvelope(input, { now = Date.now(), ttlMs = TTL_MS } = {}) {
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

""")
replace_between('server/snapshot.js', 'export function restoreGameSnapshot', 'async function saveRemoteSnapshot', r"""export function restoreGameSnapshot(input, { powerExecutor = null, now = Date.now() } = {}) {
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

""")
replace_between('server/snapshot.js', 'async function saveRemoteSnapshot', 'async function loadRemoteSnapshot', r"""async function saveRemoteSnapshot(snapshot) {
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

""")
replace_once('server/snapshot.js', 'export const snapshotInternals = Object.freeze({ TTL_MS, INTERVAL_MS, TIMEOUT_MS });', 'export const snapshotInternals = Object.freeze({ TTL_MS, INTERVAL_MS, TIMEOUT_MS, MAX_SNAPSHOT_PAYLOAD_BYTES });')

# Snapshot regression tests: timer cancellation, legacy idempotency, secret redaction/size and fail-closed envelope.
replace_once('server/snapshot.test.js', "import { __test, finish, join, reset, setStorm, spawnBoss, start, state } from './engine.js';", "import { __test, applyGiftEffect, finish, join, reset, setStorm, spawnBoss, start, state } from './engine.js';")
replace_once('server/snapshot.test.js', "  seen: new Map(), cooldowns: new Map(), globalCooldowns: new Map(),\n  prune(now) {", "  seen: new Map(), cooldowns: new Map(), globalCooldowns: new Map(), cancelPendingCalls: 0,\n  cancelPending() { this.cancelPendingCalls += 1; return 0; },\n  prune(now) {")
replace_once('server/snapshot.test.js', "  const executor = makeExecutor();\n  executor.seen.set('evt:1', BASE + 30_000);", "  const legacyGiftInput = { eventId: 'legacy-before-restart', senderUserId: a.id, senderUsername: a.username, targetUserId: a.id, giftId: '5655', giftName: 'Rose', repeatCount: 1 };\n  assert.equal(applyGiftEffect({ ...legacyGiftInput, now: BASE + 1800 }).status, 'applied');\n  const executor = makeExecutor();\n  executor.seen.set('evt:1', BASE + 30_000);")
replace_once('server/snapshot.test.js', "  assert.equal(executor.globalCooldowns.get('meteor'), BASE + 20_000);\n});", "  assert.equal(executor.globalCooldowns.get('meteor'), BASE + 20_000);\n  assert.equal(executor.cancelPendingCalls, 1);\n  assert.equal(applyGiftEffect({ ...legacyGiftInput, now: BASE + 2300 }).reason, 'duplicate-event');\n});")
insert_before('server/snapshot.test.js', "\ntest('expired, corrupt and unsupported snapshots fail closed to restore'", r"""
test('snapshot payload is secret-safe, byte-bounded and envelope-consistent', () => {
  const previousAdminToken = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = 'snapshot-admin-secret-xyz';
  try {
    reset({ now: BASE });
    join('Secret-Safe', null, true, { platformUserId: 'secret-safe' });
    state.settings.adminToken = process.env.ADMIN_TOKEN;
    state.feed.unshift({ id: 'secret-feed', text: `token=${process.env.ADMIN_TOKEN}`, tone: 'info', at: BASE });
    const snapshot = captureGameSnapshot({ now: BASE + 100, reason: 'security-check' });
    const serialized = JSON.stringify(snapshot.payload);
    assert.equal(serialized.includes(process.env.ADMIN_TOKEN), false);
    assert.equal(Object.hasOwn(snapshot.payload.settings, 'adminToken'), false);
    assert.ok(Buffer.byteLength(serialized, 'utf8') <= snapshotInternals.MAX_SNAPSHOT_PAYLOAD_BYTES);
    assert.equal(validateSnapshotEnvelope({ ...snapshot, roundId: 'other-round' }, { now: BASE + 200 }).reason, 'snapshot-round-mismatch');
    assert.equal(validateSnapshotEnvelope({ ...snapshot, phase: 'running' }, { now: BASE + 200 }).reason, 'snapshot-phase-mismatch');
    const oversized = { ...snapshot, payload: { ...snapshot.payload, padding: 'x'.repeat(snapshotInternals.MAX_SNAPSHOT_PAYLOAD_BYTES) } };
    assert.equal(validateSnapshotEnvelope(oversized, { now: BASE + 200 }).reason, 'snapshot-payload-too-large');
  } finally {
    delete state.settings.adminToken;
    if (previousAdminToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = previousAdminToken;
  }
});
""")
replace_once('server/snapshot.test.js', "  assert.equal(validateSnapshotEnvelope({ ...snapshot, snapshotVersion: 999 }, { now: BASE + 1000 }).reason, 'snapshot-version-unsupported');", "  assert.equal(validateSnapshotEnvelope({ ...snapshot, snapshotVersion: 1 }, { now: BASE + 1000 }).reason, 'snapshot-version-unsupported');\n  assert.equal(validateSnapshotEnvelope({ ...snapshot, snapshotVersion: 999 }, { now: BASE + 1000 }).reason, 'snapshot-version-unsupported');")

# Deterministic replay timers: PowerExecutor delayed powers advance only with replay time and are restorable after the run.
replace_between('server/replay.js', 'export function withDeterministicRuntime', 'export function logicalStateDigest', r"""export function withDeterministicRuntime(seed, startedAt, fn) {
  const originalRandom = Math.random;
  const originalDateNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const random = createSeededRandom(seed);
  let currentTime = Math.max(0, Math.trunc(Number(startedAt) || 0));
  let nextTimerId = 1;
  const timers = new Map();

  const clearTimer = (handle) => {
    const id = typeof handle === 'object' && handle ? handle.id : Number(handle);
    if (Number.isFinite(id)) timers.delete(id);
  };
  const schedule = (fn, delayMs, intervalMs = 0, args = []) => {
    const id = nextTimerId++;
    const delay = Math.max(0, Math.trunc(Number(delayMs) || 0));
    const interval = intervalMs > 0 ? Math.max(1, Math.trunc(Number(intervalMs) || 1)) : 0;
    const handle = { id, unref() { return handle; }, ref() { return handle; } };
    timers.set(id, { id, handle, fn, args, dueAt: currentTime + delay, interval });
    return handle;
  };
  const flushUntil = (targetTime) => {
    const target = Math.max(0, Math.trunc(Number(targetTime) || 0));
    let executions = 0;
    while (true) {
      const next = [...timers.values()].filter((timer) => timer.dueAt <= target).sort((a, b) => a.dueAt - b.dueAt || a.id - b.id)[0];
      if (!next) break;
      if (++executions > 20_000) throw new Error('deterministic-timer-overflow');
      currentTime = next.dueAt;
      if (next.interval > 0) next.dueAt += next.interval;
      else timers.delete(next.id);
      next.fn(...next.args);
    }
    currentTime = target;
    return currentTime;
  };
  const runtime = Object.freeze({
    random,
    now: () => currentTime,
    setNow: (value) => {
      const target = Math.max(0, Math.trunc(Number(value) || currentTime));
      if (target >= currentTime) return flushUntil(target);
      currentTime = target;
      return currentTime;
    },
    advance: (deltaMs) => flushUntil(currentTime + Math.max(0, Math.trunc(Number(deltaMs) || 0))),
    pendingTimers: () => timers.size,
  });

  const restoreGlobals = () => {
    Math.random = originalRandom;
    Date.now = originalDateNow;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  };

  Math.random = random;
  Date.now = () => currentTime;
  globalThis.setTimeout = (fn, delay, ...args) => schedule(fn, delay, 0, args);
  globalThis.clearTimeout = clearTimer;
  globalThis.setInterval = (fn, delay, ...args) => schedule(fn, delay, Math.max(1, Number(delay) || 1), args);
  globalThis.clearInterval = clearTimer;
  let result;
  try {
    result = fn(runtime);
  } catch (error) {
    restoreGlobals();
    throw error;
  }
  if (result && typeof result.then === 'function') return result.finally(restoreGlobals);
  restoreGlobals();
  return result;
}

""")

# Replay runner can now replay both legacy GIFT and mapped PowerExecutor GIFT paths.
replace_once('qa/replay-runner.js', "import { logicalStateDigest, loadReplayFile, validateReplay, withDeterministicRuntime } from '../server/replay.js';", "import { logicalStateDigest, loadReplayFile, validateReplay, withDeterministicRuntime } from '../server/replay.js';\nimport { PowerExecutor } from '../server/powers/PowerExecutor.js';\nimport { normalizeGiftMapping } from '../server/powers/PowerLimits.js';\nimport { powerRegistry } from '../server/powers/PowerRegistry.js';")
replace_between('qa/replay-runner.js', 'export function runReplay', "if (import.meta.url === pathToFileURL(process.argv[1]).href)", r"""export function runReplay(input) {
  const replay = validateReplay(input);
  reset();
  return withDeterministicRuntime(replay.roundSeed, replay.startedAt, (runtime) => {
    const powerExecutor = new PowerExecutor({ state, registry: powerRegistry, spawnBoss, publish: () => {}, now: () => runtime.now() });
    try {
      for (const event of replay.events) {
        runtime.setNow(replay.startedAt + event.atMs);
        const payload = event.payload || {};
        let result = null;
        switch (event.type) {
          case 'JOIN':
            result = join(payload.username, payload.team || null, payload.bot !== false, { platformUserId: payload.platformUserId, avatarUrl: payload.avatarUrl || '' });
            break;
          case 'START':
            start({ now: runtime.now(), countdownMs: payload.countdownMs ?? 0 });
            if (payload.expireSpawnProtection) state.players.forEach((player) => __test.expireSpawnProtection(player.id));
            state.roundId = replay.roundId;
            if ('bountyTargetId' in payload) state.bountyTargetId = payload.bountyTargetId || null;
            if ('bountyTargetPlatformId' in payload) state.bountyTargetPlatformId = payload.bountyTargetPlatformId || null;
            result = state;
            break;
          case 'COMMENT':
            result = applyComment(payload);
            break;
          case 'SHOT':
            result = applyCombatResult({ attackerId: payload.attackerId, targetId: payload.targetId, attackKind: payload.attackKind || 'shot' });
            assertExpected(event, result);
            break;
          case 'DAMAGE':
            if (payload.source !== 'storm') throw new Error(`unsupported-replay-damage:${payload.source}`);
            result = applyStormDamage(payload.targetId);
            assertExpected(event, result);
            break;
          case 'GIFT':
            if (payload.mapping) {
              const mapping = normalizeGiftMapping(payload.mapping, powerRegistry);
              result = powerExecutor.execute({ ...(payload.input || {}), mapping });
            } else result = applyGiftEffect({ ...(payload.input || payload), now: runtime.now() });
            assertExpected(event, result);
            break;
          case 'BOSS':
            result = spawnBoss({ source: payload.source || 'replay', now: runtime.now() });
            assertExpected(event, result);
            if (payload.bossId && result?.boss) result.boss.id = payload.bossId;
            break;
          case 'PAUSE':
            result = pause();
            if (payload.expectedPhase) assert.equal(state.phase, payload.expectedPhase, `replay event ${event.seq} phase mismatch`);
            break;
          case 'STORM':
            result = setStorm(payload.value);
            break;
          case 'TICK':
            result = tickGame(runtime.now());
            break;
          case 'ROUND_END': {
            powerExecutor.cancelPending();
            const winner = finish({ now: runtime.now(), intermissionMs: payload.intermissionMs ?? 0 });
            if (payload.expectedWinnerId !== undefined) assert.equal(winner?.id || null, payload.expectedWinnerId || null, `replay event ${event.seq} winner mismatch`);
            result = winner;
            break;
          }
          case 'ELIMINATION':
          case 'POWER':
          case 'BOSS_ATTACK':
            // Derived domain events are represented by their authoritative input event and are not applied twice.
            break;
          default:
            throw new Error(`unsupported-replay-event:${event.type}`);
        }
      }
      const digest = logicalStateDigest(state);
      if (replay.expectedFinal) assert.deepEqual(digest, replay.expectedFinal, 'replay final state diverged');
      return { replayVersion: replay.replayVersion, roundId: replay.roundId, digest, state, pendingPowerTimers: powerExecutor.timers.size };
    } finally {
      powerExecutor.dispose();
    }
  });
}

""")

# Replay regression: mapped delayed power is idempotent and cannot fire after round end.
append_replay_test = r"""

test('mapped PowerExecutor gift replay preserves idempotency and cancels delayed power at round end', () => {
  let seq = 0;
  const events = [];
  const add = (type, atMs, payload = {}) => events.push({ seq: seq++, type, atMs, payload });
  add('JOIN', 0, { username: 'Replay-A', platformUserId: 'mapped:a', bot: true });
  add('JOIN', 1, { username: 'Replay-B', platformUserId: 'mapped:b', bot: true });
  add('START', 10, { countdownMs: 0, expireSpawnProtection: true, bountyTargetId: null, bountyTargetPlatformId: null });
  const mapping = { giftId: 'mapped-laser', giftName: 'Mapped Laser', enabled: true, powerId: 'orbital-laser', targetMode: 'TARGET_PLAYER', magnitude: 18, durationMs: 1300, cooldownMs: 0, visualPreset: 'orbital-laser', soundPreset: 'laser', narrationPreset: 'cinematic' };
  const input = { eventId: 'mapped-gift-1', senderUserId: 'mapped:a', senderUsername: 'Replay-A', targetUserId: 'mapped:b', giftId: 'mapped-laser', giftName: 'Mapped Laser', repeatCount: 1 };
  add('GIFT', 20, { input, mapping, expected: { applied: false, status: 'applied', reason: null, eliminated: false } });
  add('GIFT', 30, { input, mapping, expected: { applied: false, status: 'rejected', reason: 'duplicate-event', eliminated: false } });
  add('ROUND_END', 100, { intermissionMs: 10_000, expectedWinnerId: 'mapped:a' });
  add('TICK', 2_000, {});
  const replay = { replayVersion: REPLAY_VERSION, roundId: 'mapped-power-round', roundSeed: 0x44556677, round: 1, startedAt: 900000, context: { source: 'test' }, events };
  const first = runReplay(replay);
  const second = runReplay(replay);
  assert.deepEqual(second.digest, first.digest);
  assert.equal(first.digest.players.find((player) => player.id === 'mapped:b')?.hp, 100);
  assert.equal(first.pendingPowerTimers, 0);
});
"""
with Path('qa/replay-runner.test.js').open('a', encoding='utf-8') as handle:
    handle.write(append_replay_test)

# Deterministic runtime timer regression.
insert_before('server/replay.test.js', "\ntest('replay recorder removes secret-like fields and validates order'", r"""
test('deterministic runtime advances and clears scheduled timers without leaking globals', () => {
  const originalSetTimeout = globalThis.setTimeout;
  const calls = [];
  withDeterministicRuntime(7, 1000, (runtime) => {
    const cancelled = setTimeout(() => calls.push('cancelled'), 20);
    setTimeout(() => calls.push(`timeout:${Date.now()}`), 50);
    const interval = setInterval(() => calls.push(`interval:${Date.now()}`), 30);
    clearTimeout(cancelled);
    runtime.advance(65);
    clearInterval(interval);
    runtime.advance(100);
    assert.deepEqual(calls, ['interval:1030', 'timeout:1050', 'interval:1060']);
    assert.equal(runtime.pendingTimers(), 0);
  });
  assert.equal(globalThis.setTimeout, originalSetTimeout);
});
""")

# CI final state: browser cache only; no lint gate and no temporary bootstrap job.
ci = read('.github/workflows/ci.yml')
marker = '\n  audit-fix-bootstrap:\n'
if marker not in ci:
    raise RuntimeError('temporary audit-fix-bootstrap job marker missing')
ci = ci.split(marker, 1)[0].rstrip() + '\n'
old_install = '      - run: npx playwright install --with-deps chromium\n'
cache_block = """      - name: Cache Playwright browsers
        id: playwright-cache
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
      - name: Install Chromium system dependencies
        run: npx playwright install-deps chromium
      - name: Install Playwright Chromium
        if: steps.playwright-cache.outputs.cache-hit != 'true'
        run: npx playwright install chromium
"""
if ci.count(old_install) != 1:
    raise RuntimeError(f'expected one Playwright install step, got {ci.count(old_install)}')
ci = ci.replace(old_install, cache_block, 1)
write('.github/workflows/ci.yml', ci)

# Remove temporary artifacts/scripts from final tree.
Path('.eslint-audit.txt').unlink(missing_ok=True)
Path(__file__).unlink(missing_ok=True)
