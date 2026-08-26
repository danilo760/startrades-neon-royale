import { randomUUID } from 'node:crypto';
import { publishEngineEvent } from './event-bus.js';
import { getLeaderboardTop, recordRound } from './leaderboard.js';
import { publicGiftCatalog, resolveGiftDefinition, sanitizeDisplayName, sanitizeNarrationName, sanitizeStableId } from './gifts.js';

const players = new Map();
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const nowMs = () => Date.now();
const ARENA_W = 1280, ARENA_H = 720;
const SPAWN_GRACE_MS = 3000;
const GIFT_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;
const BASE_ATTACK_DAMAGE = 4;
const ATTACK_COOLDOWN_MS = 850;

export const ARENA_BACKGROUNDS = ['default', 'cyberpunk', 'space', 'retro'];
export const POWER_PRESETS = Object.freeze({ shot: { label: 'RAJADA ESTELAR', damage: BASE_ATTACK_DAMAGE, color: 0x2cefff, sound: 'shot' } });
export const POWER_CATALOG = [];

const emptyBoss = () => ({ id: null, active: false, hp: 0, maxHp: 0, x: 640, y: 360, radius: 72, spawnedAt: 0, expiresAt: 0, targetPlayerId: null, lastAttackAt: 0, attack: null, cooldownUntil: 0 });

export const state = {
  phase: 'lobby', round: 1, storm: 0, likes: 0, players: [], feed: [], winner: null,
  bountyTargetId: null, bountyTargetPlatformId: null, bountyClaimedBy: null,
  roundId: randomUUID(),
  teamScores: { blue: { score: 0, survivors: 0, eliminations: 0 }, red: { score: 0, survivors: 0, eliminations: 0 } },
  powerCatalog: POWER_CATALOG,
  giftCatalog: publicGiftCatalog(),
  hazards: [], boss: emptyBoss(), bossCooldownUntil: 0,
  settings: {
    agentEnabled: true, teamMode: false, arenaBackground: 'default', voiceMode: 'male', voiceIntensity: 3,
    narratorStyle: 'explosive', music: true, sound: true,
    giftLimits: { perPlayerPerRound: 12, perRound: 120, pendingPerUser: 3, maxComboActivations: 2 },
  },
};

let roundRecorded = false;
let roundGiftCount = 0;
let bossLastTickAt = nowMs();
const giftUsage = new Map();
const giftCooldowns = new Map();
const processedGiftIds = new Map();
const pendingGifts = new Map();
const combatCooldowns = new Map();
const bossAttackCooldowns = new Map();
const bossDamage = new Map();

const feed = (text, tone = 'info') => {
  state.feed.unshift({ id: `${Date.now()}-${Math.random()}`, text: String(text).slice(0, 160), tone, at: Date.now() });
  state.feed = state.feed.slice(0, 14);
};

const playerHealthRatio = (p) => (p.hp + p.shield) / Math.max(1, p.maxHp || 100);
const teamStats = (team) => [...players.values()].filter((p) => p.team === team).reduce((total, p) => ({ score: total.score + p.score, survivors: total.survivors + Number(p.alive), eliminations: total.eliminations + p.eliminations }), { score: 0, survivors: 0, eliminations: 0 });
const sync = () => {
  state.players = [...players.values()].sort((a, b) => Number(b.alive) - Number(a.alive) || b.score - a.score || a.username.localeCompare(b.username, 'pt-BR'));
  state.teamScores = { blue: teamStats('blue'), red: teamStats('red') };
};
const spawnPoint = () => ({ x: 130 + Math.random() * 1020, y: 115 + Math.random() * 480 });
const normalizeTeam = (choice) => ['azul', 'blue'].includes(String(choice || '').toLowerCase()) ? 'blue' : ['vermelho', 'red'].includes(String(choice || '').toLowerCase()) ? 'red' : null;
const balancedTeam = () => teamStats('blue').survivors <= teamStats('red').survivors ? 'blue' : 'red';
const localStableId = (username) => `local:${sanitizeNarrationName(username, 'fighter').toLowerCase()}`.slice(0, 80);
const normalizePlayerId = (value) => sanitizeStableId(value);
const findPlayerByPlatformId = (platformUserId) => players.get(normalizePlayerId(platformUserId)) || null;
const activePlayers = () => [...players.values()].filter((p) => p.alive);
const getGiftLimits = () => state.settings.giftLimits || {};

function pruneProcessed(now = nowMs()) {
  for (const [id, expiresAt] of processedGiftIds) if (expiresAt <= now) processedGiftIds.delete(id);
  for (const [id, list] of pendingGifts) {
    const live = list.filter((item) => item.expiresAt > now);
    if (live.length) pendingGifts.set(id, live); else pendingGifts.delete(id);
  }
}
function rememberGiftEvent(eventId, now) {
  pruneProcessed(now);
  if (!eventId || processedGiftIds.has(eventId)) return false;
  processedGiftIds.set(eventId, now + GIFT_IDEMPOTENCY_TTL_MS);
  return true;
}
function giftCooldownKey(playerId, effect) { return `${playerId}:${effect}`; }
function canUseGift(playerId, gift, now) {
  const key = giftCooldownKey(playerId, gift.effect);
  const until = giftCooldowns.get(key) || 0;
  return { ok: until <= now, cooldownUntil: until, key };
}
function setGiftCooldown(key, gift, now) { giftCooldowns.set(key, now + Math.max(0, gift.cooldownMs || 0)); }
function registerGiftUsage(senderUserId, requested) {
  const limits = getGiftLimits();
  const perPlayer = clamp(Number(limits.perPlayerPerRound) || 12, 1, 100);
  const perRound = clamp(Number(limits.perRound) || 120, 1, 1000);
  const maxCombo = clamp(Number(limits.maxComboActivations) || 2, 1, 10);
  const used = giftUsage.get(senderUserId) || 0;
  const available = Math.max(0, Math.min(perPlayer - used, perRound - roundGiftCount, maxCombo));
  const accepted = Math.max(0, Math.min(available, Math.max(1, requested)));
  if (accepted > 0) { giftUsage.set(senderUserId, used + accepted); roundGiftCount += accepted; }
  return accepted;
}

function applyPendingForPlayer(player, now = nowMs()) {
  if (state.phase !== 'running') return [];
  const list = pendingGifts.get(player.platformUserId) || [];
  const valid = list.filter((item) => item.expiresAt > now);
  pendingGifts.delete(player.platformUserId);
  const results = [];
  for (const item of valid) results.push(applyResolvedGift({ ...item, targetPlayer: player, now, fromPending: true }));
  return results;
}

export function join(username, teamChoice = null, bot = false, identity = {}) {
  const platformUserId = normalizePlayerId(identity.platformUserId) || localStableId(username);
  const displayName = sanitizeDisplayName(username, 'fighter', 32);
  let player = players.get(platformUserId);
  const isNew = !player;
  if (!player) {
    const pos = spawnPoint();
    player = {
      id: platformUserId, username: displayName, platformUserId,
      avatarUrl: /^https:\/\//i.test(identity.avatarUrl || '') ? String(identity.avatarUrl).slice(0, 500) : '',
      ...pos, targetX: pos.x, targetY: pos.y,
      maxHp: 100, hp: 100, shield: 0, shieldUntil: 0,
      speedMultiplier: 1, speedBoostUntil: 0,
      hype: 0, starPowerUntil: 0,
      energy: 0, score: 0, eliminations: 0, alive: true,
      skin: players.size % 4, team: normalizeTeam(teamChoice) || balancedTeam(), bot,
      spawnInvulnerableUntil: state.phase === 'running' ? nowMs() + SPAWN_GRACE_MS : 0,
      lastMoveAt: nowMs(), wanderAt: 0, nextServerShotAt: nowMs() + 1400,
    };
    players.set(platformUserId, player);
    feed(`@${displayName} aterrissou na arena`, 'join');
  } else {
    player.username = displayName;
    if (identity.avatarUrl && /^https:\/\//i.test(identity.avatarUrl)) player.avatarUrl = String(identity.avatarUrl).slice(0, 500);
  }
  if (state.bountyTargetPlatformId && player.platformUserId === state.bountyTargetPlatformId) state.bountyTargetId = player.id;
  if (isNew || state.phase === 'running') applyPendingForPlayer(player);
  sync();
  return player;
}

export function addBots(names = []) { names.slice(0, 30).forEach((name) => join(name, null, true, { platformUserId: localStableId(name) })); return state; }

export function start() {
  const leader = getLeaderboardTop();
  const now = nowMs();
  state.phase = 'running'; state.winner = null; state.roundId = randomUUID();
  state.bountyTargetPlatformId = leader?.platformUserId || leader?.id || null;
  state.bountyTargetId = [...players.values()].find((p) => p.platformUserId === state.bountyTargetPlatformId)?.id || null;
  state.bountyClaimedBy = null; state.hazards = []; state.boss = emptyBoss(); state.bossCooldownUntil = 0;
  roundRecorded = false; roundGiftCount = 0;
  giftUsage.clear(); giftCooldowns.clear(); bossDamage.clear(); bossAttackCooldowns.clear(); combatCooldowns.clear();
  for (const player of players.values()) {
    player.spawnInvulnerableUntil = now + SPAWN_GRACE_MS; player.lastMoveAt = now; player.wanderAt = now + 500 + Math.random() * 900;
    player.shield = 0; player.shieldUntil = 0; player.speedMultiplier = 1; player.speedBoostUntil = 0; player.hype = 0; player.starPowerUntil = 0;
  }
  feed(`RODADA ${state.round} INICIADA`, 'system');
  if (state.bountyTargetId) {
    const target = players.get(state.bountyTargetId);
    feed(`CAÇADA ATIVA: @${target?.username || 'líder'} vale pontuação tripla`, 'bounty');
  }
  for (const player of players.values()) applyPendingForPlayer(player, now);
  sync();
  publishEngineEvent('round:started', {
    roundId: state.roundId,
    round: state.round,
    teamMode: state.settings.teamMode,
    bountyTargetId: state.bountyTargetId,
    playerCount: state.players.length,
    teamScores: { blue: { ...state.teamScores.blue }, red: { ...state.teamScores.red } },
  });
  return state;
}

export function pause() { state.phase = state.phase === 'paused' ? 'running' : 'paused'; feed(state.phase === 'paused' ? 'Batalha pausada' : 'Batalha retomada', 'system'); return state; }
export function setStorm(value) { state.storm = clamp(Number(value) || 0, 0, 100); feed(`Tempestade em ${state.storm}%`, 'storm'); return state; }
export function updateSettings(next = {}) {
  if ('agentEnabled' in next) state.settings.agentEnabled = Boolean(next.agentEnabled);
  if ('teamMode' in next) state.settings.teamMode = Boolean(next.teamMode);
  if ('voiceMode' in next && ['male', 'female'].includes(next.voiceMode)) state.settings.voiceMode = next.voiceMode;
  if ('voiceIntensity' in next) state.settings.voiceIntensity = clamp(Math.trunc(Number(next.voiceIntensity) || 3), 1, 3);
  if ('narratorStyle' in next && ['explosive', 'esports', 'cinematic'].includes(next.narratorStyle)) state.settings.narratorStyle = next.narratorStyle;
  if ('music' in next) state.settings.music = Boolean(next.music);
  if ('sound' in next) state.settings.sound = Boolean(next.sound);
  if ('arenaBackground' in next) state.settings.arenaBackground = ARENA_BACKGROUNDS.includes(next.arenaBackground) ? next.arenaBackground : 'default';
  if (next.giftLimits && typeof next.giftLimits === 'object') {
    const current = state.settings.giftLimits;
    state.settings.giftLimits = {
      perPlayerPerRound: clamp(Number(next.giftLimits.perPlayerPerRound ?? current.perPlayerPerRound) || current.perPlayerPerRound, 1, 100),
      perRound: clamp(Number(next.giftLimits.perRound ?? current.perRound) || current.perRound, 1, 1000),
      pendingPerUser: clamp(Number(next.giftLimits.pendingPerUser ?? current.pendingPerUser) || current.pendingPerUser, 1, 10),
      maxComboActivations: clamp(Number(next.giftLimits.maxComboActivations ?? current.maxComboActivations) || current.maxComboActivations, 1, 10),
    };
  }
  return state;
}

export function giftPower(_diamonds = 1, name = '') {
  const gift = resolveGiftDefinition('', name);
  return gift ? { ...gift, kind: gift.effect, label: gift.effect.toUpperCase(), color: gift.tier === 'premium' ? 0xffd24d : gift.tier === 'event' ? 0xff8a2b : gift.tier === 'boost' ? 0x2cefff : 0x75ff4d } : null;
}

function resolveBeneficiary(senderUserId, explicitTargetId) {
  const explicit = explicitTargetId ? players.get(normalizePlayerId(explicitTargetId)) : null;
  if (explicit?.alive) return { player: explicit, reason: 'explicit-target' };
  const donor = findPlayerByPlatformId(senderUserId);
  if (donor?.alive) return { player: donor, reason: 'donor' };
  if (state.settings.teamMode && donor?.team) {
    const ally = activePlayers().filter((p) => p.team === donor.team).sort((a, b) => playerHealthRatio(a) - playerHealthRatio(b) || a.id.localeCompare(b.id))[0];
    if (ally) return { player: ally, reason: 'lowest-health-ally' };
  }
  return { player: null, reason: explicitTargetId ? 'target-unavailable' : 'donor-not-in-arena' };
}

function storePendingGift(payload, now) {
  const limits = getGiftLimits();
  const max = clamp(Number(limits.pendingPerUser) || 3, 1, 10);
  const current = (pendingGifts.get(payload.senderUserId) || []).filter((item) => item.expiresAt > now).slice(-(max - 1));
  current.push({ ...payload, expiresAt: now + PENDING_TTL_MS });
  pendingGifts.set(payload.senderUserId, current);
}

function damagePlayer(target, amount, { allowElimination = true, now = nowMs() } = {}) {
  if (!target?.alive || target.spawnInvulnerableUntil > now) return { applied: false, reason: 'spawn-invulnerable', damage: 0, eliminated: false };
  let remaining = Math.max(0, Number(amount) || 0);
  const absorbed = Math.min(target.shield, remaining); target.shield -= absorbed; remaining -= absorbed;
  const maxHpDamage = allowElimination ? target.hp : Math.max(0, target.hp - 10);
  const hpDamage = Math.min(maxHpDamage, remaining);
  target.hp = clamp(target.hp - hpDamage, 0, target.maxHp);
  const eliminated = target.hp <= 0;
  if (eliminated) target.alive = false;
  return { applied: absorbed + hpDamage > 0, damage: absorbed + hpDamage, eliminated };
}

function attackPlayer(attacker, target, { damage = BASE_ATTACK_DAMAGE, awardPoints = true, allowElimination = true, now = nowMs(), reason = 'combat' } = {}) {
  if (!attacker || !target || !attacker.alive || !target.alive || attacker.id === target.id) return { applied: false, reason: 'invalid-combatants' };
  if (state.settings.teamMode && attacker.team === target.team) return { applied: false, reason: 'friendly-fire' };
  const result = damagePlayer(target, damage, { allowElimination, now });
  if (!result.applied) return result;
  const bountyClaimed = Boolean(result.eliminated && target.id === state.bountyTargetId);
  const points = awardPoints ? Math.max(1, Math.round(result.damage)) * (bountyClaimed ? 3 : 1) : 0;
  attacker.score += points;
  if (result.eliminated) {
    attacker.eliminations++;
    feed(`@${attacker.username} eliminou @${target.username}`, 'elimination');
    publishEngineEvent('player:eliminated', {
      roundId: state.roundId,
      attackerId: attacker.id,
      attackerUsername: attacker.username,
      targetId: target.id,
      targetUsername: target.username,
      reason,
      bountyClaimed,
      pointsAwarded: points,
    });
    if (bountyClaimed) {
      state.bountyClaimedBy = attacker.id; state.bountyTargetId = null; state.bountyTargetPlatformId = null;
      feed(`@${attacker.username} conquistou a CAÇADA TRIPLA`, 'bounty');
      publishEngineEvent('bounty:claimed', {
        roundId: state.roundId,
        attackerId: attacker.id,
        attackerUsername: attacker.username,
        targetId: target.id,
        targetUsername: target.username,
        pointsAwarded: points,
        multiplier: 3,
      });
    }
  }
  sync();
  return { applied: true, reason, eliminated: result.eliminated, bountyClaimed, attackerId: attacker.id, targetId: target.id, pointsAwarded: points, damageApplied: result.damage };
}

function nearestOpponent(player, maxDistance = Infinity) {
  if (!player) return null;
  let best = null, bestSq = maxDistance * maxDistance;
  for (const candidate of activePlayers()) {
    if (candidate.id === player.id || (state.settings.teamMode && candidate.team === player.team)) continue;
    const dx = candidate.x - player.x, dy = candidate.y - player.y, d = dx * dx + dy * dy;
    if (d < bestSq) { best = candidate; bestSq = d; }
  }
  return best;
}

function chooseNeutralMeteorTarget(now) {
  const eligible = activePlayers().filter((p) => p.spawnInvulnerableUntil <= now);
  const pool = eligible.length ? eligible : activePlayers();
  if (!pool.length) return null;
  const sorted = [...pool].sort((a, b) => a.id.localeCompare(b.id));
  return sorted[state.hazards.length % sorted.length];
}
function spawnMeteor(gift, now) {
  const target = chooseNeutralMeteorTarget(now);
  if (!target) return null;
  const hazard = {
    id: randomUUID(), type: 'meteor', x: target.x, y: target.y, targetPlayerId: target.id,
    radius: 110, damage: Math.min(24, Math.max(1, gift.magnitude || 22)), createdAt: now,
    impactAt: now + Math.min(2400, Math.max(1400, gift.durationMs || 2000)), expiresAt: now + 3400,
    visualEffect: gift.visualEffect, resolved: false,
  };
  state.hazards.push(hazard); state.hazards = state.hazards.slice(-12);
  return hazard;
}

function bossHpForPlayers(count) { return clamp(850 + count * 210, 1000, 5000); }
export function spawnBoss({ source = 'system', now = nowMs() } = {}) {
  const active = activePlayers();
  if (state.phase !== 'running' || !active.length) return { applied: false, reason: 'no-active-players', boss: state.boss };
  if (state.boss.active) {
    const maxExpiry = state.boss.spawnedAt + 55_000;
    const nextExpiry = Math.min(maxExpiry, state.boss.expiresAt + 10_000);
    const extended = Math.max(0, nextExpiry - state.boss.expiresAt);
    state.boss.expiresAt = nextExpiry;
    publishEngineEvent('boss:updated', { reason: extended ? 'extended' : 'visual-only', extendedMs: extended, source, boss: { ...state.boss } });
    return { applied: Boolean(extended), reason: extended ? 'extended' : 'already-active', boss: state.boss };
  }
  if (state.bossCooldownUntil > now) return { applied: false, reason: 'cooldown', cooldownUntil: state.bossCooldownUntil, boss: state.boss };
  const maxHp = bossHpForPlayers(active.length);
  state.boss = { id: `colossus:${randomUUID()}`, active: true, hp: maxHp, maxHp, x: 640, y: 360, radius: 72, spawnedAt: now, expiresAt: now + 45_000, targetPlayerId: null, lastAttackAt: now, attack: null, cooldownUntil: now + 60_000 };
  state.bossCooldownUntil = now + 60_000;
  bossDamage.clear(); bossAttackCooldowns.clear(); bossLastTickAt = now;
  feed('COLOSSUS NEON entrou na arena', 'boss');
  publishEngineEvent('boss:spawned', { source, boss: { ...state.boss } });
  return { applied: true, boss: state.boss };
}

function clearBoss(reason, { reward = false } = {}) {
  if (!state.boss.active) return null;
  const old = { ...state.boss };
  if (reward) {
    const active = activePlayers();
    const totalDamage = [...bossDamage.values()].reduce((sum, n) => sum + n, 0) || 1;
    for (const player of active) {
      const contribution = bossDamage.get(player.id) || 0;
      const ratio = contribution / totalDamage;
      const base = state.settings.teamMode ? 10 : 15;
      const bonus = Math.min(state.settings.teamMode ? 10 : 20, Math.round(ratio * 30));
      player.score += base + bonus;
    }
    feed('COLOSSUS NEON foi derrotado pela arena', 'boss');
    publishEngineEvent('boss:defeated', { boss: old, participants: active.length });
  } else if (reason === 'expired') {
    feed('COLOSSUS NEON escapou da arena', 'boss');
    publishEngineEvent('boss:escaped', { boss: old });
  }
  state.boss = { ...emptyBoss(), cooldownUntil: state.bossCooldownUntil };
  bossDamage.clear(); bossAttackCooldowns.clear(); sync(); return old;
}

function applyResolvedGift({ gift, senderUserId, senderUsername, giftName, repeatCount, source, eventId, targetPlayer, now, fromPending = false }) {
  if (!gift || !targetPlayer?.alive) return { status: 'rejected', reason: 'invalid-beneficiary' };
  const cooldown = canUseGift(targetPlayer.id, gift, now);
  if (!cooldown.ok && gift.effect !== 'colossus') return { status: 'rejected', reason: 'cooldown', cooldownUntil: cooldown.cooldownUntil };
  let effectResult = { applied: true };

  if (gift.effect === 'entry-boost') {
    targetPlayer.speedMultiplier = Math.max(targetPlayer.speedMultiplier || 1, Math.min(1.2, Math.max(1, Number(gift.magnitude) || 1.2)));
    targetPlayer.speedBoostUntil = Math.max(targetPlayer.speedBoostUntil || 0, now + Math.min(5000, Math.max(1000, gift.durationMs || 5000)));
    effectResult = { applied: true, speedMultiplier: targetPlayer.speedMultiplier, durationMs: targetPlayer.speedBoostUntil - now, entryBonus: true };
  } else if (gift.effect === 'tactical-shield') {
    const heal = Math.min(15, targetPlayer.maxHp * 0.15, Math.max(0, targetPlayer.maxHp - targetPlayer.hp));
    targetPlayer.hp += heal;
    if (heal > 0) {
      publishEngineEvent('player:healed', {
        roundId: state.roundId,
        playerId: targetPlayer.id,
        username: targetPlayer.username,
        amount: heal,
        hp: targetPlayer.hp,
        maxHp: targetPlayer.maxHp,
        source: 'gift',
        giftId: gift.giftId,
        senderUserId,
        senderUsername: sanitizeDisplayName(senderUsername, 'fighter', 32),
      });
    }
    targetPlayer.shield = Math.max(targetPlayer.shield, Math.min(10, Math.max(1, gift.magnitude || 10)));
    targetPlayer.shieldUntil = Math.max(targetPlayer.shieldUntil || 0, now + Math.min(3000, Math.max(1000, gift.durationMs || 3000)));
    effectResult = { applied: true, heal, shield: targetPlayer.shield, durationMs: targetPlayer.shieldUntil - now };
  } else if (gift.effect === 'speed') {
    targetPlayer.speedMultiplier = Math.min(1.5, Math.max(targetPlayer.speedMultiplier || 1, Number(gift.magnitude) || 1.35));
    targetPlayer.speedBoostUntil = Math.max(targetPlayer.speedBoostUntil || 0, now + Math.min(5000, Math.max(1000, gift.durationMs || 5000)));
    effectResult = { applied: true, speedMultiplier: targetPlayer.speedMultiplier, durationMs: targetPlayer.speedBoostUntil - now };
  } else if (gift.effect === 'extra-projectile') {
    const target = nearestOpponent(targetPlayer, 520);
    effectResult = target ? attackPlayer(targetPlayer, target, { damage: 7, now, reason: 'gift-extra-projectile' }) : { applied: false, reason: 'no-target' };
  } else if (gift.effect === 'meteor') {
    const hazard = spawnMeteor(gift, now);
    effectResult = hazard ? { applied: true, hazardId: hazard.id, hazardTargetPlayerId: hazard.targetPlayerId } : { applied: false, reason: 'no-target' };
  } else if (gift.effect === 'star-power') {
    const hypeGain = clamp(Math.trunc(Number(gift.magnitude) || 100), 1, 250);
    targetPlayer.hype = clamp((targetPlayer.hype || 0) + hypeGain, 0, 999);
    targetPlayer.starPowerUntil = Math.max(targetPlayer.starPowerUntil || 0, now + Math.min(60_000, Math.max(5000, gift.durationMs || 60_000)));
    effectResult = { applied: true, hypeGain, hype: targetPlayer.hype, durationMs: targetPlayer.starPowerUntil - now, scoreMultiplier: 1 };
  } else if (gift.effect === 'colossus') {
    effectResult = spawnBoss({ source, now });
  } else {
    effectResult = { applied: false, reason: 'unsupported-effect' };
  }

  if (effectResult.applied && gift.effect !== 'colossus') setGiftCooldown(cooldown.key, gift, now);
  const payload = {
    eventId, source, tier: gift.tier, effect: gift.effect, visualEffect: gift.visualEffect, narrationPriority: gift.narrationPriority,
    giftId: gift.giftId, giftName: sanitizeDisplayName(giftName || gift.aliases[0], 'Presente', 48), repeatCount,
    senderUserId, senderUsername: sanitizeDisplayName(senderUsername, 'fighter', 32), targetPlayerId: targetPlayer.id, targetUsername: targetPlayer.username,
    fromPending, result: effectResult,
  };
  if (effectResult.applied) {
    feed(`@${payload.senderUsername} enviou ${payload.giftName} — ${gift.effect} em @${targetPlayer.username}`, gift.tier === 'premium' ? 'boss' : 'gift');
    publishEngineEvent('gift:applied', payload);
  }
  sync();
  return { status: effectResult.applied ? 'applied' : 'rejected', reason: effectResult.reason, ...payload };
}

export function applyGiftEffect(input = {}) {
  const now = Number(input.now) || nowMs();
  const eventId = sanitizeStableId(input.eventId);
  const senderUserId = sanitizeStableId(input.senderUserId);
  const senderUsername = sanitizeDisplayName(input.senderUsername, 'fighter', 32);
  const source = input.source === 'control-panel' ? 'control-panel' : 'tiktok';
  const repeatCount = clamp(Math.trunc(Number(input.repeatCount) || 1), 1, 100);
  const gift = resolveGiftDefinition(input.giftId, input.giftName);
  if (!eventId || !senderUserId) {
    const rejected = { eventId, source, status: 'rejected', reason: 'invalid-event', senderUsername };
    publishEngineEvent('gift:rejected', rejected); return rejected;
  }
  if (!rememberGiftEvent(eventId, now)) {
    const duplicate = { eventId, source, status: 'rejected', reason: 'duplicate-event', senderUsername };
    publishEngineEvent('gift:rejected', duplicate); return duplicate;
  }
  if (!gift) {
    const unknown = { eventId, source, status: 'rejected', reason: 'unknown-gift', visualOnly: true, giftName: sanitizeDisplayName(input.giftName, 'Presente', 48), senderUsername };
    publishEngineEvent('gift:rejected', unknown); return unknown;
  }
  if (state.phase !== 'running') {
    const rejected = { eventId, source, status: 'rejected', reason: 'round-not-running', giftId: gift.giftId, giftName: sanitizeDisplayName(input.giftName, gift.aliases[0], 48), senderUsername };
    publishEngineEvent('gift:rejected', rejected); return rejected;
  }
  const acceptedActivations = registerGiftUsage(senderUserId, repeatCount);
  if (!acceptedActivations) {
    const rejected = { eventId, source, status: 'rejected', reason: 'round-limit', giftId: gift.giftId, senderUsername };
    publishEngineEvent('gift:rejected', rejected); return rejected;
  }
  const beneficiary = resolveBeneficiary(senderUserId, input.targetUserId);
  if (!beneficiary.player) {
    const pendingPayload = { gift, eventId, senderUserId, senderUsername, giftName: input.giftName || gift.aliases[0], repeatCount: acceptedActivations, source };
    storePendingGift(pendingPayload, now);
    const pending = { eventId, source, status: 'pending', reason: beneficiary.reason, giftId: gift.giftId, giftName: sanitizeDisplayName(input.giftName, gift.aliases[0], 48), senderUserId, senderUsername, expiresAt: now + PENDING_TTL_MS };
    publishEngineEvent('gift:pending', pending); return pending;
  }
  let result = null;
  for (let i = 0; i < acceptedActivations; i++) {
    const applied = applyResolvedGift({ gift, eventId: i === 0 ? eventId : `${eventId}:${i + 1}`, senderUserId, senderUsername, giftName: input.giftName, repeatCount: acceptedActivations, source, targetPlayer: beneficiary.player, now: now + i, fromPending: false });
    result = result || applied;
    if (applied.status !== 'applied' || !['tactical-shield'].includes(gift.effect)) break;
  }
  if (result?.status === 'rejected') publishEngineEvent('gift:rejected', { ...result, eventId, source, senderUsername });
  return result || { status: 'rejected', reason: 'not-applied' };
}

export function applyGift({ username, platformUserId, giftName = 'Presente', repeatCount = 1, giftId = '', eventId = randomUUID(), source = 'control-panel' }) {
  return applyGiftEffect({ eventId, senderUserId: platformUserId || localStableId(username), senderUsername: username, giftId, giftName, repeatCount, source });
}

export function applyComment({ username, platformUserId, avatarUrl, comment = '' }) {
  const stableId = normalizePlayerId(platformUserId) || localStableId(username);
  const display = sanitizeDisplayName(username, 'fighter', 32);
  const cmd = String(comment).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().toLowerCase();
  const joinCommand = cmd.match(/^!(?:entrar|join)(?:\s+(azul|blue|vermelho|red))?$/);
  if (joinCommand) return { kind: 'join', player: join(display, joinCommand[1] || null, false, { platformUserId: stableId, avatarUrl }) };
  const p = players.get(stableId);
  if (p) { p.username = display; if (avatarUrl && /^https:\/\//i.test(avatarUrl)) p.avatarUrl = String(avatarUrl).slice(0, 500); }
  if (!p || !p.alive || state.phase !== 'running') return { kind: 'chat' };
  if (cmd === '!esquerda') p.targetX = clamp(p.x - 180, 70, 1210);
  if (cmd === '!direita') p.targetX = clamp(p.x + 180, 70, 1210);
  if (cmd === '!cima') p.targetY = clamp(p.y - 140, 80, 630);
  if (cmd === '!baixo') p.targetY = clamp(p.y + 140, 80, 630);
  if (['!esquerda', '!direita', '!cima', '!baixo'].includes(cmd)) p.wanderAt = nowMs() + 1500;
  return { kind: cmd.startsWith('!') ? 'command' : 'chat', player: p };
}

export function applyCombatResult({ attackerId, targetId, attackKind = 'shot' }) {
  const attacker = players.get(normalizePlayerId(attackerId));
  const target = players.get(normalizePlayerId(targetId));
  if (attackKind !== 'shot') return { applied: false, reason: 'invalid-attack' };
  if (!attacker || !target) return { applied: false, reason: 'invalid-combatants' };
  const now = nowMs();
  const key = `${attacker.id}:${attackKind}`;
  if ((combatCooldowns.get(key) || 0) > now) return { applied: false, reason: 'attack-cooldown' };
  combatCooldowns.set(key, now + ATTACK_COOLDOWN_MS);
  return attackPlayer(attacker, target, { damage: BASE_ATTACK_DAMAGE, now, reason: 'combat' });
}

export function applyStormDamage(targetId) {
  const target = players.get(normalizePlayerId(targetId));
  if (!target || !target.alive || state.phase !== 'running') return { applied: false, reason: 'invalid-target' };
  const damage = state.storm >= 75 ? 7 : state.storm >= 45 ? 4 : 2;
  const result = damagePlayer(target, damage, { allowElimination: true });
  if (result.eliminated) feed(`@${target.username} foi engolido pela tempestade`, 'storm');
  sync(); return result;
}

export function likes(count = 1) { state.likes += Math.max(0, Number(count) || 0); if (state.likes >= 500) { state.likes -= 500; state.storm = clamp(state.storm - 12, 0, 100); feed('500 curtidas repeliram a tempestade!', 'like'); return true; } return false; }
export function tickStorm() { if (state.phase === 'running') state.storm = clamp(state.storm + 1, 0, 100); }

function tickMovement(now) {
  for (const player of activePlayers()) {
    const previous = player.lastMoveAt || now;
    const dt = clamp((now - previous) / 1000, 0, 0.5);
    player.lastMoveAt = now;
    let dx = player.targetX - player.x, dy = player.targetY - player.y, distance = Math.hypot(dx, dy);
    if (!player.wanderAt || now >= player.wanderAt || distance < 10) {
      player.targetX = 90 + Math.random() * (ARENA_W - 180); player.targetY = 90 + Math.random() * (ARENA_H - 180); player.wanderAt = now + 1600 + Math.random() * 1900;
      dx = player.targetX - player.x; dy = player.targetY - player.y; distance = Math.hypot(dx, dy);
    }
    if (distance > 1 && dt > 0) {
      const step = Math.min(distance, 38 * clamp(player.speedMultiplier || 1, 1, 1.5) * dt);
      player.x = clamp(player.x + dx / distance * step, 55, ARENA_W - 55); player.y = clamp(player.y + dy / distance * step, 55, ARENA_H - 55);
    }
  }
}
function tickPlayerCombat(now) {
  for (const attacker of activePlayers()) {
    if ((attacker.nextServerShotAt || 0) > now) continue;
    attacker.nextServerShotAt = now + 1600;
    const target = nearestOpponent(attacker, 260); if (!target) continue;
    const result = attackPlayer(attacker, target, { damage: BASE_ATTACK_DAMAGE, now, reason: 'combat' });
    if (result.applied) publishEngineEvent('combat:shot', { attackerId: attacker.id, targetId: target.id, damage: result.damageApplied, eliminated: result.eliminated, bountyClaimed: result.bountyClaimed });
  }
}
function tickEffects(now) {
  for (const p of players.values()) {
    if (p.shieldUntil && p.shieldUntil <= now) { p.shield = 0; p.shieldUntil = 0; }
    if (p.speedBoostUntil && p.speedBoostUntil <= now) { p.speedMultiplier = 1; p.speedBoostUntil = 0; }
    if (p.starPowerUntil && p.starPowerUntil <= now) p.starPowerUntil = 0;
  }
}
function tickHazards(now) {
  const keep = [];
  for (const hazard of state.hazards) {
    if (hazard.type === 'meteor' && !hazard.resolved && now >= hazard.impactAt) {
      hazard.resolved = true;
      const impactedPlayers = [];
      for (const player of activePlayers()) {
        if (Math.hypot(player.x - hazard.x, player.y - hazard.y) > hazard.radius) continue;
        const result = damagePlayer(player, hazard.damage, { allowElimination: false, now });
        if (result.applied) impactedPlayers.push({ playerId: player.id, username: player.username, damage: result.damage, hp: player.hp });
      }
      publishEngineEvent('meteor:impacted', {
        hazardId: hazard.id,
        targetPlayerId: hazard.targetPlayerId,
        x: hazard.x,
        y: hazard.y,
        radius: hazard.radius,
        damage: hazard.damage,
        impactedPlayers,
      });
    }
    if (now < hazard.expiresAt) keep.push(hazard);
  }
  state.hazards = keep;
}
function chooseBossTarget() {
  let best = null, bestDist = Infinity;
  for (const p of activePlayers()) {
    const d = Math.hypot(p.x - state.boss.x, p.y - state.boss.y);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best;
}
function tickBoss(now) {
  const boss = state.boss;
  if (!boss.active) return;
  if (state.phase !== 'running') { clearBoss('round-ended', { reward: false }); return; }
  if (now >= boss.expiresAt) { clearBoss('expired', { reward: false }); return; }
  const target = chooseBossTarget();
  const previousTargetPlayerId = boss.targetPlayerId;
  const nextTargetPlayerId = target?.id || null;
  boss.targetPlayerId = nextTargetPlayerId;
  if (previousTargetPlayerId !== nextTargetPlayerId) {
    publishEngineEvent('boss:attacked', {
      reason: 'aggro-changed',
      bossId: boss.id,
      previousTargetPlayerId,
      targetPlayerId: nextTargetPlayerId,
    });
  }
  const dt = clamp((now - bossLastTickAt) / 1000, 0, 1); bossLastTickAt = now;
  if (target) {
    const dx = target.x - boss.x, dy = target.y - boss.y, d = Math.hypot(dx, dy) || 1;
    const step = Math.min(d, 42 * dt); boss.x = clamp(boss.x + dx / d * step, 90, 1190); boss.y = clamp(boss.y + dy / d * step, 90, 630);
  }
  if (boss.attack && now >= boss.attack.impactAt) {
    const resolvedAttack = { ...boss.attack };
    const impactedPlayerIds = [];
    for (const p of activePlayers()) {
      if (Math.hypot(p.x - resolvedAttack.x, p.y - resolvedAttack.y) > resolvedAttack.radius) continue;
      const result = damagePlayer(p, resolvedAttack.damage, { allowElimination: false, now });
      if (result.applied) impactedPlayerIds.push(p.id);
    }
    boss.lastAttackAt = now; boss.attack = null;
    publishEngineEvent('boss:updated', { reason: 'attack-resolved', boss: { ...boss } });
    publishEngineEvent('boss:attacked', {
      reason: 'attack-resolved',
      bossId: boss.id,
      attackId: resolvedAttack.id,
      targetPlayerId: resolvedAttack.targetPlayerId,
      impactedPlayerIds,
    });
  } else if (!boss.attack && target && now - boss.lastAttackAt >= 8000) {
    boss.attack = { id: randomUUID(), x: target.x, y: target.y, radius: 120, damage: 22, warnedAt: now, impactAt: now + 3000, targetPlayerId: target.id };
    publishEngineEvent('boss:updated', { reason: 'attack-warning', boss: { ...boss } });
    publishEngineEvent('boss:attacked', {
      reason: 'attack-warning',
      bossId: boss.id,
      attackId: boss.attack.id,
      targetPlayerId: boss.attack.targetPlayerId,
      impactAt: boss.attack.impactAt,
      radius: boss.attack.radius,
      damage: boss.attack.damage,
    });
  }
  for (const p of activePlayers()) {
    if (Math.hypot(p.x - boss.x, p.y - boss.y) > 380) continue;
    const until = bossAttackCooldowns.get(p.id) || 0; if (until > now) continue;
    bossAttackCooldowns.set(p.id, now + 1500);
    const damage = 6; boss.hp = Math.max(0, boss.hp - damage); bossDamage.set(p.id, (bossDamage.get(p.id) || 0) + damage);
    if (boss.hp <= 0) { clearBoss('defeated', { reward: true }); return; }
  }
}
function tickStormDamage(now) {
  if (state.storm < 15) return;
  const safeRadius = Math.max(90, 575 - state.storm * 4.2);
  for (const p of activePlayers()) {
    if (Math.hypot(p.x - 640, p.y - 360) <= safeRadius) continue;
    if ((p.nextStormHitAt || 0) > now) continue;
    p.nextStormHitAt = now + 1000; applyStormDamage(p.id);
  }
}
export function tickGame(now = nowMs()) {
  pruneProcessed(now); tickEffects(now);
  if (state.phase === 'running') { tickMovement(now); tickPlayerCombat(now); tickHazards(now); tickBoss(now); tickStormDamage(now); }
  sync(); return state;
}

export function finish() {
  if (state.boss.active) clearBoss('round-ended', { reward: false });
  state.hazards = []; state.phase = 'ended'; sync();
  if (state.settings.teamMode && players.size > 0) {
    const blue = { type: 'team', team: 'blue', label: 'TIME AZUL', ...state.teamScores.blue };
    const red = { type: 'team', team: 'red', label: 'TIME VERMELHO', ...state.teamScores.red };
    const comparison = blue.survivors - red.survivors || blue.score - red.score || blue.eliminations - red.eliminations;
    state.winner = comparison === 0 ? { type: 'team', team: 'draw', label: 'EMPATE', score: blue.score, survivors: blue.survivors, eliminations: blue.eliminations } : comparison > 0 ? blue : red;
    feed(`${state.winner.label} VENCEU A RODADA!`, 'winner');
  } else if (!state.settings.teamMode) {
    const winner = [...players.values()].filter((p) => p.alive).sort((a, b) => b.hp - a.hp || b.score - a.score)[0] || [...players.values()].sort((a, b) => b.score - a.score)[0] || null;
    state.winner = winner ? { ...winner, type: 'player' } : null;
    feed(winner ? `@${winner.username} É O CAMPEÃO!` : 'Rodada sem vencedor', 'winner');
  } else { state.winner = null; feed('Rodada sem vencedor', 'winner'); }
  if (!roundRecorded) {
    recordRound([...players.values()].map((p) => ({ ...p, roundWinner: state.winner?.type === 'player' ? state.winner.id === p.id : state.winner?.team === p.team })), state.roundId);
    roundRecorded = true;
    publishEngineEvent('round:ended', {
      roundId: state.roundId,
      round: state.round,
      teamMode: state.settings.teamMode,
      winner: state.winner ? { ...state.winner } : null,
      teamScores: { blue: { ...state.teamScores.blue }, red: { ...state.teamScores.red } },
      standings: state.players.map((p) => ({ id: p.id, username: p.username, score: p.score, eliminations: p.eliminations, alive: p.alive, hp: p.hp, team: p.team })),
    });
  }
  return state.winner;
}

export function reset() {
  players.clear(); roundRecorded = false; roundGiftCount = 0;
  giftUsage.clear(); giftCooldowns.clear(); processedGiftIds.clear(); pendingGifts.clear(); combatCooldowns.clear(); bossAttackCooldowns.clear(); bossDamage.clear();
  Object.assign(state, { phase: 'lobby', round: state.round + 1, roundId: randomUUID(), storm: 0, likes: 0, players: [], feed: [], winner: null, bountyTargetId: null, bountyTargetPlatformId: null, bountyClaimedBy: null, hazards: [], boss: emptyBoss(), bossCooldownUntil: 0, teamScores: { blue: { score: 0, survivors: 0, eliminations: 0 }, red: { score: 0, survivors: 0, eliminations: 0 } } });
  return state;
}

export const __test = {
  get players() { return players; },
  get pendingGifts() { return pendingGifts; },
  setPlayerHp(id, hp) { const p = players.get(id); if (p) p.hp = clamp(hp, 0, p.maxHp); sync(); },
  setPlayerAlive(id, alive) { const p = players.get(id); if (p) p.alive = Boolean(alive); sync(); },
  setPlayerPosition(id, x, y) { const p = players.get(id); if (p) { p.x = x; p.y = y; p.targetX = x; p.targetY = y; sync(); } },
  expireSpawnProtection(id) { const p = players.get(id); if (p) p.spawnInvulnerableUntil = 0; },
  clearGiftCooldowns() { giftCooldowns.clear(); },
};