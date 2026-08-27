import assert from 'node:assert/strict';
import test from 'node:test';
import { eventBus } from './event-bus.js';
import { clearLeaderboard } from './leaderboard.js';
import { __test, applyCombatResult, applyGiftEffect, finish, join, reset, spawnBoss, start, state, tickGame, updateSettings } from './engine.js';

const prepare = (teamMode = false) => {
  clearLeaderboard(); reset(); updateSettings({ teamMode, giftLimits: { perPlayerPerRound: 12, perRound: 120, pendingPerUser: 3, maxComboActivations: 2 } });
};
const startNow = () => start({ countdownMs: 0 });
const add = (name, id, team) => join(name, team, false, { platformUserId: id });
const gift = (overrides = {}) => applyGiftEffect({ eventId: `e-${Math.random()}`, senderUserId: 'u1', senderUsername: 'Alpha', giftId: '5655', giftName: 'Rose', repeatCount: 1, source: 'tiktok', ...overrides });

test('stable ID survives username change', () => {
  prepare(); add('Alpha', 'u1'); startNow(); join('AlphaRenamed', null, false, { platformUserId: 'u1' });
  assert.equal(state.players.length, 1); assert.equal(state.players[0].username, 'AlphaRenamed'); assert.equal(state.players[0].id, 'u1');
});

test('countdown transitions to a server-authoritative round start', () => {
  prepare(); add('Alpha', 'u1'); add('Bravo', 'u2');
  start({ now: 1000, countdownMs: 5000 });
  assert.equal(state.phase, 'countdown'); assert.equal(state.countdownEndsAt, 6000);
  tickGame(5999); assert.equal(state.phase, 'countdown');
  tickGame(6000); assert.equal(state.phase, 'running'); assert.equal(state.countdownEndsAt, 0); assert.equal(state.roundStartedAt, 6000);
});

test('last two fighters trigger sudden death and raise the storm once', () => {
  prepare(); const a = add('Alpha', 'a'), b = add('Bravo', 'b'), c = add('Charlie', 'c'); startNow();
  [a, b, c].forEach((p) => __test.expireSpawnProtection(p.id)); __test.setPlayerHp('c', 4);
  applyCombatResult({ attackerId: 'a', targetId: 'c', attackKind: 'shot' }); tickGame(2000);
  assert.equal(state.suddenDeath.active, true); assert.equal(state.suddenDeath.startedAt, 2000); assert.ok(state.storm >= 75);
  const startedAt = state.suddenDeath.startedAt; tickGame(3000); assert.equal(state.suddenDeath.startedAt, startedAt);
});

test('team mode does not trigger sudden death after one team already owns both survivors', () => {
  prepare(true);
  const a = add('Alpha', 'a', 'azul'), b = add('Bravo', 'b', 'azul'), c = add('Charlie', 'c', 'vermelho'), d = add('Delta', 'd', 'vermelho');
  startNow(); [a, b, c, d].forEach((p) => __test.expireSpawnProtection(p.id));
  __test.setPlayerAlive('c', false); __test.setPlayerAlive('d', false); tickGame(2000);
  assert.equal(state.suddenDeath.active, false); assert.equal(state.storm, 0);
});

test('intermission returns to lobby, publishes round:lobby and preserves the restored roster', () => {
  prepare(); add('Alpha', 'a'); add('Bravo', 'b'); startNow(); __test.setPlayerHp('a', 12); __test.setPlayerAlive('b', false);
  const lobbyEvents = [];
  const onLobby = (payload) => lobbyEvents.push(payload);
  eventBus.on('round:lobby', onLobby);
  try {
    finish({ now: 5000, intermissionMs: 10000 });
    assert.equal(state.phase, 'ended'); assert.equal(state.intermissionEndsAt, 15000);
    tickGame(14999); assert.equal(state.phase, 'ended');
    tickGame(15000); assert.equal(state.phase, 'lobby'); assert.equal(state.players.length, 2); assert.equal(lobbyEvents.length, 1);
    assert.equal(lobbyEvents[0].playerCount, 2);
    for (const player of state.players) { assert.equal(player.alive, true); assert.equal(player.hp, player.maxHp); assert.equal(player.score, 0); }
  } finally { eventBus.off('round:lobby', onLobby); }
});

test('automatic intermission preserves a pending gift inbox until the next round', () => {
  prepare(); add('Other', 'u2'); startNow();
  const pending = gift({ eventId: 'pending-cross-round', senderUserId: 'outside', senderUsername: 'Outside', now: 1000 });
  assert.equal(pending.status, 'pending'); assert.equal(__test.pendingGifts.get('outside').length, 1);
  finish({ now: 2000, intermissionMs: 100 }); tickGame(2100);
  assert.equal(state.phase, 'lobby'); assert.equal(__test.pendingGifts.get('outside').length, 1);
  join('Outside', null, false, { platformUserId: 'outside' }); start({ now: 2200, countdownMs: 0 });
  assert.equal(__test.pendingGifts.has('outside'), false); assert.equal(state.players.find((p) => p.id === 'outside').speedMultiplier, 1.2);
});

test('friendly fire only blocked in team mode and server computes damage', () => {
  prepare(false); const a = add('Alpha', 'a', 'azul'), b = add('Bravo', 'b', 'azul'); startNow(); __test.expireSpawnProtection(a.id); __test.expireSpawnProtection(b.id);
  const solo = applyCombatResult({ attackerId: a.id, targetId: b.id, damage: 999, targetHp: 0, eliminated: true });
  assert.equal(solo.applied, true); assert.equal(state.players.find((p) => p.id === b.id).hp, 96);
  prepare(true); const x = add('X', 'x', 'azul'), y = add('Y', 'y', 'azul'); startNow(); __test.expireSpawnProtection(x.id); __test.expireSpawnProtection(y.id);
  assert.equal(applyCombatResult({ attackerId: x.id, targetId: y.id, attackKind: 'shot' }).reason, 'friendly-fire');
});

test('bounty still grants triple points on elimination', () => {
  prepare(); add('Leader', 'leader'); finish(); reset(); add('Leader', 'leader'); add('Hunter', 'hunter'); startNow();
  assert.equal(state.bountyTargetId, 'leader'); __test.expireSpawnProtection('leader'); __test.expireSpawnProtection('hunter'); __test.setPlayerHp('leader', 4);
  const result = applyCombatResult({ attackerId: 'hunter', targetId: 'leader', attackKind: 'shot' });
  assert.equal(result.bountyClaimed, true); assert.equal(result.pointsAwarded, 12); assert.equal(state.bountyTargetId, null);
});

test('rose gives only a mild 1.2x entry boost for at most five seconds', () => {
  prepare(); add('Alpha', 'u1'); startNow();
  const result = gift({ eventId: 'entry-boost', now: 1000 });
  assert.equal(result.status, 'applied'); assert.equal(state.players[0].speedMultiplier, 1.2); assert.ok(state.players[0].speedBoostUntil <= 6000);
  tickGame(7000); assert.equal(state.players[0].speedMultiplier, 1);
});

test('donor outside arena gets pending entry bonus and it applies once on next entry', () => {
  prepare(); add('Other', 'u2'); startNow();
  const result = gift({ eventId: 'pending', senderUserId: 'outside', senderUsername: 'Outside', now: Date.now() });
  assert.equal(result.status, 'pending'); assert.equal(__test.pendingGifts.get('outside').length, 1);
  join('Outside', null, false, { platformUserId: 'outside' });
  assert.equal(__test.pendingGifts.has('outside'), false); assert.equal(state.players.find((p) => p.id === 'outside').speedMultiplier, 1.2);
});

test('tactical shield heals modestly and never grants invulnerability', () => {
  prepare(); add('Alpha', 'u1'); startNow(); __test.setPlayerHp('u1', 50);
  const result = gift({ eventId: 'shield', giftId: 'neon-shield', giftName: 'Hat', now: 1000 });
  const player = state.players[0];
  assert.equal(result.status, 'applied'); assert.equal(player.hp, 65); assert.equal(player.shield, 10); assert.ok(player.shieldUntil <= 4000); assert.equal('invulnerableUntil' in player, false);
});

test('speed boost stays capped below pay-to-win extremes', () => {
  prepare(); add('Alpha', 'u1'); startNow();
  const result = gift({ eventId: 'speed', giftId: 'neon-speed', giftName: 'GG', now: 1000 });
  assert.equal(result.status, 'applied'); assert.equal(state.players[0].speedMultiplier, 1.35); assert.ok(state.players[0].speedBoostUntil <= 6000);
});

test('meteor is server-selected, telegraphed, spawn-safe, non-lethal and emits meteor:impacted only', () => {
  prepare(); add('Alpha', 'u1'); add('Bravo', 'u2'); startNow(); __test.expireSpawnProtection('u1'); __test.expireSpawnProtection('u2');
  __test.setPlayerPosition('u1', 200, 200); __test.setPlayerPosition('u2', 900, 500); __test.setPlayerHp('u1', 12); __test.setPlayerHp('u2', 12);
  const meteorImpacts = [], legacyMeteorBossUpdates = [];
  const onMeteorImpacted = (payload) => meteorImpacts.push(payload);
  const onBossUpdated = (payload) => { if (payload.reason === 'meteor-impact') legacyMeteorBossUpdates.push(payload); };
  eventBus.on('meteor:impacted', onMeteorImpacted); eventBus.on('boss:updated', onBossUpdated);
  try {
    const result = gift({ eventId: 'meteor', giftId: 'neon-meteor', giftName: 'Rocket', targetUserId: 'u2', now: 1000 });
    assert.equal(result.status, 'applied'); assert.equal(state.hazards.length, 1); assert.ok(state.hazards[0].impactAt - state.hazards[0].createdAt >= 1400);
    assert.ok(['u1','u2'].includes(result.result.hazardTargetPlayerId));
    tickGame(4000);
    assert.equal(meteorImpacts.length, 1); assert.equal(meteorImpacts[0].hazardId, result.result.hazardId); assert.equal(legacyMeteorBossUpdates.length, 0);
    for (const p of state.players) { assert.equal(p.alive, true); assert.ok(p.hp >= 10); }
  } finally { eventBus.off('meteor:impacted', onMeteorImpacted); eventBus.off('boss:updated', onBossUpdated); }
});

test('star power grants hype and golden status but never multiplies competitive score', () => {
  prepare(); const a = add('Alpha', 'u1'); const b = add('Bravo', 'u2'); startNow(); __test.expireSpawnProtection(a.id); __test.expireSpawnProtection(b.id);
  const star = gift({ eventId: 'star', giftId: 'neon-star-power', giftName: 'Lion', now: 1000 });
  assert.equal(star.status, 'applied'); assert.equal(state.players.find((p) => p.id === 'u1').hype, 100); assert.ok(state.players.find((p) => p.id === 'u1').starPowerUntil <= 61000); assert.equal(star.result.scoreMultiplier, 1);
  const combat = applyCombatResult({ attackerId: 'u1', targetId: 'u2', attackKind: 'shot' });
  assert.equal(combat.pointsAwarded, 4);
});

test('star power expires cleanly without changing accumulated score', () => {
  prepare(); add('Alpha', 'u1'); startNow(); gift({ eventId: 'star-expire', giftId: 'neon-star-power', giftName: 'Lion', now: 1000 });
  const score = state.players[0].score; tickGame(62000); assert.equal(state.players[0].starPowerUntil, 0); assert.equal(state.players[0].score, score);
});

test('unknown and duplicate gifts remain rejected', () => {
  prepare(); add('Alpha', 'u1'); startNow();
  assert.equal(gift({ eventId: 'unknown', giftId: 'unknown', giftName: 'Mystery' }).reason, 'unknown-gift');
  const first = gift({ eventId: 'dup' }); const second = gift({ eventId: 'dup' }); assert.equal(first.status, 'applied'); assert.equal(second.reason, 'duplicate-event');
});

test('gift cooldown remains server-authoritative', () => {
  prepare(); add('Alpha', 'u1'); startNow();
  const first = gift({ eventId: 'cooldown-1', giftId: 'neon-speed', giftName: 'GG', now: 1000 });
  const second = gift({ eventId: 'cooldown-2', giftId: 'neon-speed', giftName: 'GG', now: 1200 });
  assert.equal(first.status, 'applied'); assert.equal(second.reason, 'cooldown');
});

test('boss rejects spawn without players and active reinvocation only extends ten seconds', () => {
  prepare(); startNow(); assert.equal(spawnBoss({ now: 1000 }).reason, 'no-active-players');
  prepare(); add('Alpha', 'u1'); startNow(); const first = spawnBoss({ now: 1000 }); const expiry = state.boss.expiresAt;
  assert.equal(first.applied, true); assert.equal(spawnBoss({ now: 1001 }).reason, 'extended'); assert.equal(state.boss.expiresAt, expiry + 10000); spawnBoss({ now: 1002 }); assert.equal(state.boss.expiresAt, expiry + 10000);
});

test('boss is removed on round end without gift-linked economic reward', () => {
  prepare(); add('Alpha', 'u1'); startNow(); spawnBoss({ now: 1000 }); const before = state.players[0].score; finish(); assert.equal(state.boss.active, false); assert.equal(state.players[0].score, before);
});

test('boss retargets and escape gives no reward through event bus', () => {
  const escaped = [];
  const onEscaped = (payload) => escaped.push(payload);
  eventBus.on('boss:escaped', onEscaped);
  try {
    prepare(); add('Alpha', 'u1'); add('Bravo', 'u2'); startNow(); spawnBoss({ now: 1000 }); tickGame(9000);
    const firstTarget = state.boss.targetPlayerId; assert.ok(firstTarget); __test.setPlayerAlive(firstTarget, false); tickGame(10000); assert.notEqual(state.boss.targetPlayerId, firstTarget);
    const scores = new Map(state.players.map((p) => [p.id, p.score])); tickGame(47000); assert.equal(state.boss.active, false); assert.equal(escaped.length, 1); for (const p of state.players) assert.equal(p.score, scores.get(p.id));
  } finally { eventBus.off('boss:escaped', onEscaped); }
});

test('map validation and configurable gift limits remain enforced', () => {
  prepare(); updateSettings({ arenaBackground: 'javascript:alert(1)' }); assert.equal(state.settings.arenaBackground, 'default'); updateSettings({ arenaBackground: 'space' }); assert.equal(state.settings.arenaBackground, 'space');
  updateSettings({ giftLimits: { perPlayerPerRound: 1, perRound: 4, pendingPerUser: 1, maxComboActivations: 1 } }); add('Alpha', 'u1'); startNow(); assert.equal(gift({ eventId: 'limit-1' }).status, 'applied'); assert.equal(gift({ eventId: 'limit-2' }).reason, 'round-limit');
});
