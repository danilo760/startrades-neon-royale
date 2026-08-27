import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const REPLAY_VERSION = 1;
export const REPLAY_EVENT_TYPES = Object.freeze([
  'JOIN', 'START', 'COMMENT', 'SHOT', 'DAMAGE', 'ELIMINATION', 'GIFT', 'POWER',
  'BOSS', 'BOSS_ATTACK', 'STORM', 'PAUSE', 'TICK', 'ROUND_END',
]);

const ALLOWED_EVENT_TYPES = new Set(REPLAY_EVENT_TYPES);
const FORBIDDEN_KEY = /token|cookie|secret|authorization|service[_-]?role|password|api[_-]?key|avatarurl/i;
const MAX_EVENTS = 5000;
const MAX_OBJECT_KEYS = 40;
const MAX_ARRAY_ITEMS = 64;
const MAX_STRING = 200;

const cleanString = (value, max = MAX_STRING) => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
  .slice(0, max);

function safeValue(value, key = '', depth = 0) {
  if (FORBIDDEN_KEY.test(key) || depth > 4) return undefined;
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'string') return cleanString(value);
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => safeValue(item, key, depth + 1)).filter((item) => item !== undefined);
  if (typeof value === 'object') {
    const result = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      const safe = safeValue(childValue, childKey, depth + 1);
      if (safe !== undefined) result[cleanString(childKey, 80)] = safe;
    }
    return result;
  }
  return undefined;
}

export function seedToUint32(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return Math.trunc(seed) >>> 0;
  let hash = 2166136261;
  for (const char of cleanString(seed, 160)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed) {
  let value = seedToUint32(seed);
  return () => {
    value = (value + 0x6D2B79F5) | 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function withDeterministicRuntime(seed, startedAt, fn) {
  const originalRandom = Math.random;
  const originalDateNow = Date.now;
  const random = createSeededRandom(seed);
  let currentTime = Math.max(0, Math.trunc(Number(startedAt) || 0));
  const runtime = Object.freeze({
    random,
    now: () => currentTime,
    setNow: (value) => { currentTime = Math.max(0, Math.trunc(Number(value) || currentTime)); return currentTime; },
    advance: (deltaMs) => { currentTime += Math.max(0, Math.trunc(Number(deltaMs) || 0)); return currentTime; },
  });

  Math.random = random;
  Date.now = () => currentTime;
  let result;
  try {
    result = fn(runtime);
  } catch (error) {
    Math.random = originalRandom;
    Date.now = originalDateNow;
    throw error;
  }
  if (result && typeof result.then === 'function') {
    return result.finally(() => {
      Math.random = originalRandom;
      Date.now = originalDateNow;
    });
  }
  Math.random = originalRandom;
  Date.now = originalDateNow;
  return result;
}

export function logicalStateDigest(state = {}) {
  const players = [...(state.players || [])]
    .map((player) => ({
      id: cleanString(player.id, 80), username: cleanString(player.username, 32), team: cleanString(player.team, 12),
      alive: Boolean(player.alive), hp: Number(player.hp || 0), shield: Number(player.shield || 0),
      score: Number(player.score || 0), eliminations: Number(player.eliminations || 0),
      x: Number(Number(player.x || 0).toFixed(4)), y: Number(Number(player.y || 0).toFixed(4)),
      speedMultiplier: Number(Number(player.speedMultiplier || 1).toFixed(4)), hype: Number(player.hype || 0),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const hazards = [...(state.hazards || [])]
    .map((hazard) => ({
      type: cleanString(hazard.type, 32), targetPlayerId: cleanString(hazard.targetPlayerId, 80),
      x: Number(Number(hazard.x || 0).toFixed(4)), y: Number(Number(hazard.y || 0).toFixed(4)),
      radius: Number(hazard.radius || 0), damage: Number(hazard.damage || 0), resolved: Boolean(hazard.resolved),
    }))
    .sort((a, b) => `${a.type}:${a.targetPlayerId}:${a.x}:${a.y}`.localeCompare(`${b.type}:${b.targetPlayerId}:${b.x}:${b.y}`));
  return {
    roundId: cleanString(state.roundId, 100), round: Number(state.round || 0), phase: cleanString(state.phase, 20),
    storm: Number(state.storm || 0), likes: Number(state.likes || 0), bountyTargetId: state.bountyTargetId ? cleanString(state.bountyTargetId, 80) : null,
    suddenDeath: { active: Boolean(state.suddenDeath?.active) },
    winner: state.winner ? {
      id: cleanString(state.winner.id || '', 80), type: cleanString(state.winner.type || '', 20), team: cleanString(state.winner.team || '', 12),
      score: Number(state.winner.score || 0), eliminations: Number(state.winner.eliminations || 0),
    } : null,
    boss: {
      active: Boolean(state.boss?.active), hp: Number(state.boss?.hp || 0), maxHp: Number(state.boss?.maxHp || 0), phase: Number(state.boss?.phase || 0),
    },
    teamScores: safeValue(state.teamScores || {}), players, hazards,
  };
}

export function createReplayRecorder({ roundId, seed, round = 1, startedAt = Date.now(), context = {} } = {}) {
  const replay = {
    replayVersion: REPLAY_VERSION,
    roundId: cleanString(roundId || `replay-${seedToUint32(seed)}`, 100),
    roundSeed: seedToUint32(seed),
    round: Math.max(1, Math.trunc(Number(round) || 1)),
    startedAt: Math.max(0, Math.trunc(Number(startedAt) || 0)),
    context: safeValue(context) || {},
    events: [],
  };
  let sequence = 0;
  return {
    record(type, payload = {}, at = replay.startedAt) {
      const normalizedType = cleanString(type, 32).toUpperCase();
      if (!ALLOWED_EVENT_TYPES.has(normalizedType)) throw new Error(`unsupported-replay-event:${normalizedType}`);
      if (replay.events.length >= MAX_EVENTS) throw new Error('replay-event-limit');
      replay.events.push({
        seq: sequence++, type: normalizedType,
        atMs: Math.max(0, Math.trunc(Number(at) || replay.startedAt) - replay.startedAt),
        payload: safeValue(payload) || {},
      });
      return replay.events.at(-1);
    },
    setContext(next = {}) { replay.context = { ...replay.context, ...(safeValue(next) || {}) }; },
    finalize(finalState, extra = {}) {
      replay.expectedFinal = logicalStateDigest(finalState);
      replay.result = safeValue(extra) || {};
      return structuredClone(replay);
    },
    snapshot(extra = {}) { return structuredClone({ ...replay, ...(safeValue(extra) || {}) }); },
  };
}

export function validateReplay(input = {}) {
  if (Number(input.replayVersion) !== REPLAY_VERSION) throw new Error('unsupported-replay-version');
  if (!Array.isArray(input.events) || input.events.length > MAX_EVENTS) throw new Error('invalid-replay-events');
  const replay = {
    replayVersion: REPLAY_VERSION,
    roundId: cleanString(input.roundId, 100),
    roundSeed: seedToUint32(input.roundSeed),
    round: Math.max(1, Math.trunc(Number(input.round) || 1)),
    startedAt: Math.max(0, Math.trunc(Number(input.startedAt) || 0)),
    context: safeValue(input.context || {}) || {},
    events: [],
  };
  let lastSeq = -1;
  for (const raw of input.events) {
    const type = cleanString(raw?.type, 32).toUpperCase();
    const seq = Math.trunc(Number(raw?.seq));
    if (!ALLOWED_EVENT_TYPES.has(type) || !Number.isInteger(seq) || seq <= lastSeq) throw new Error('invalid-replay-event-order');
    lastSeq = seq;
    replay.events.push({ seq, type, atMs: Math.max(0, Math.trunc(Number(raw?.atMs) || 0)), payload: safeValue(raw?.payload || {}) || {} });
  }
  if (input.expectedFinal) replay.expectedFinal = safeValue(input.expectedFinal);
  if (input.result) replay.result = safeValue(input.result);
  if (input.failure) replay.failure = safeValue(input.failure);
  return replay;
}

export function saveReplayFile(input, { directory = '.qa-replays', prefix = 'replay' } = {}) {
  const replay = validateReplay(input);
  const dir = resolve(directory);
  mkdirSync(dir, { recursive: true });
  const safeId = replay.roundId.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'round';
  const file = resolve(dir, `${cleanString(prefix, 32).replace(/[^a-zA-Z0-9_.-]/g, '_')}-${safeId}.json`);
  writeFileSync(file, `${JSON.stringify(replay, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return file;
}

export function loadReplayFile(file) {
  return validateReplay(JSON.parse(readFileSync(resolve(file), 'utf8')));
}
