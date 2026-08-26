import assert from 'node:assert/strict';
import test from 'node:test';
import { clearLeaderboard } from './leaderboard.js';
import { __test, applyCombatResult, applyGiftEffect, drainEngineEvents, finish, join, reset, spawnBoss, start, state, tickGame, updateSettings } from './engine.js';

const prepare = (teamMode = false) => {
  clearLeaderboard(); reset(); updateSettings({ teamMode, giftLimits: { perPlayerPerRound: 12, perRound: 120, pendingPerUser: 3, maxComboActivations: 2 } });
};
const add = (name, id, team) => join(name, team, false, { platformUserId: id });
const gift = (overrides = {}) => applyGiftEffect({ eventId: `e-${Math.random()}`, senderUserId: 'u1', senderUsername: 'Alpha', giftId: '5655', giftName: 'Rose', repeatCount: 1, source: 'tiktok', ...overrides });

test('first round starts without bounty and stable ID survives username change', () => {
  prepare(); add('Alpha', 'u1'); start();
  assert.equal(state.bountyTargetId, null);
  join('AlphaRenamed', null, false, { platformUserId: 'u1' });
  assert.equal(state.players.length, 1);
  assert.equal(state.players[0].username, 'AlphaRenamed');
  assert.equal(state.players[0].id, 'u1');
});

test('friendly fire only blocked in team mode and server computes damage', () => {
  prepare(false); const a = add('Alpha', 'a', 'azul'), b = add('Bravo', 'b', 'azul'); start(); __test.expireSpawnProtection(a.id); __test.expireSpawnProtection(b.id);
  const solo = applyCombatResult({ attackerId: a.id, targetId: b.id, damage: 999, targetHp: 0, eliminated: true });
  assert.equal(solo.applied, true); assert.equal(state.players.find((p) => p.id === b.id).hp, 96);
  prepare(true); const x = add('X', 'x', 'azul'), y = add('Y', 'y', 'azul'); start(); __test.expireSpawnProtection(x.id); __test.expireSpawnProtection(y.id);
  assert.equal(applyCombatResult({ attackerId: x.id, targetId: y.id, attackKind: 'shot' }).reason, 'friendly-fire');
});

test('bounty still grants triple points on elimination', () => {
  prepare(); add('Leader', 'leader'); finish(); reset(); add('Leader', 'leader'); add('Hunter', 'hunter'); start();
  assert.equal(state.bountyTargetId, 'leader');
  __test.expireSpawnProtection('leader'); __test.expireSpawnProtection('hunter'); __test.setPlayerHp('leader', 4);
  const result = applyCombatResult({ attackerId: 'hunter', targetId: 'leader', attackKind: 'shot' });
  assert.equal(result.bountyClaimed, true); assert.equal(result.pointsAwarded, 12); assert.equal(state.bountyTargetId, null);
});

test('unknown gift is visual-only rejection', () => {
  prepare(); add('Alpha', 'u1'); start();
  const result = gift({ giftId: 'unknown', giftName: 'Mystery' });
  assert.equal(result.status, 'rejected'); assert.equal(result.visualOnly, true); assert.equal(result.reason, 'unknown-gift');
});

test('duplicate gift event is rejected', () => {
  prepare(); add('Alpha', 'u1'); start();
  const first = gift({ eventId: 'dup' }); const second = gift({ eventId: 'dup' });
  assert.equal(first.status, 'applied'); assert.equal(second.reason, 'duplicate-event');
});

test('support heals min 20 or 20 percent and full hp gives temporary 10 shield', () => {
  prepare(); add('Alpha', 'u1'); start(); __test.setPlayerHp('u1', 50);
  let result = gift({ eventId: 'heal-1', now: 1000 });
  assert.equal(result.status, 'applied'); assert.equal(state.players[0].hp, 70);
  __test.clearGiftCooldowns(); __test.setPlayerHp('u1', 100);
  result = gift({ eventId: 'heal-2', now: 3000 });
  assert.equal(state.players[0].shield, 10); assert.ok(state.players[0].shieldUntil <= 8000);
  tickGame(9000); assert.equal(state.players[0].shield, 0);
});

test('donor outside arena gets pending bonus and it applies once on next entry', () => {
  prepare(); add('Other', 'u2'); start();
  const result = gift({ eventId: 'pending', senderUserId: 'outside', senderUsername: 'Outside' });
  assert.equal(result.status, 'pending'); assert.equal(__test.pendingGifts.get('outside').length, 1);
  join('Outside', null, false, { platformUserId: 'outside' });
  assert.equal(__test.pendingGifts.has('outside'), false);
});

test('invalid explicit target falls back to donor deterministically', () => {
  prepare(); add('Alpha', 'u1'); start(); __test.setPlayerHp('u1', 70);
  const result = gift({ eventId: 'target-fallback', targetUserId: 'disconnected' });
  assert.equal(result.targetPlayerId, 'u1');
});

test('speed boost is capped at 1.5x and renews without stacking', () => {
  prepare(); add('Alpha', 'u1'); start();
  const first = gift({ eventId: 'speed-1', giftId: 'neon-speed', giftName: 'GG', now: 1000 });
  assert.equal(first.status, 'applied'); assert.equal(state.players[0].speedMultiplier, 1.5);
  __test.clearGiftCooldowns();
  gift({ eventId: 'speed-2', giftId: 'neon-speed', giftName: 'GG', now: 3000 });
  assert.equal(state.players[0].speedMultiplier, 1.5); assert.ok(state.players[0].speedBoostUntil <= 8000);
});

test('boss rejects spawn without players and concurrent spawn only extends up to 10 seconds', () => {
  prepare(); start(); assert.equal(spawnBoss({ now: 1000 }).reason, 'no-active-players');
  prepare(); add('Alpha', 'u1'); start();
  const first = spawnBoss({ now: 1000 }); assert.equal(first.applied, true); const expiry = state.boss.expiresAt;
  const second = spawnBoss({ now: 1001 }); assert.equal(state.boss.expiresAt, expiry + 10000); assert.equal(second.reason, 'extended');
  spawnBoss({ now: 1002 }); assert.equal(state.boss.expiresAt, expiry + 10000);
});

test('boss is removed on round end without victory reward', () => {
  prepare(); add('Alpha', 'u1'); start(); spawnBoss({ now: 1000 }); const before = state.players[0].score;
  finish(); assert.equal(state.boss.active, false); assert.equal(state.players[0].score, before);
});

test('map invalid falls back to default and valid maps remain', () => {
  prepare(); updateSettings({ arenaBackground: 'javascript:alert(1)' }); assert.equal(state.settings.arenaBackground, 'default');
  updateSettings({ arenaBackground: 'space' }); assert.equal(state.settings.arenaBackground, 'space');
});

test('gift cooldown rejects repeated boost before cooldown expires', () => {
  prepare(); add('Alpha', 'u1'); start();
  const first = gift({ eventId: 'cooldown-1', giftId: 'neon-speed', giftName: 'GG', now: 1000 });
  const second = gift({ eventId: 'cooldown-2', giftId: 'neon-speed', giftName: 'GG', now: 1200 });
  assert.equal(first.status, 'applied'); assert.equal(second.status, 'rejected'); assert.equal(second.reason, 'cooldown');
});

test('premium shield never stacks and lasts at most three seconds', () => {
  prepare(); add('Alpha', 'u1'); start();
  gift({ eventId: 'ward-1', giftId: 'neon-ward', giftName: 'Castle', now: 1000 });
  assert.equal(state.players[0].shield, 15); assert.ok(state.players[0].shieldUntil <= 4000);
  __test.clearGiftCooldowns();
  gift({ eventId: 'ward-2', giftId: 'neon-ward', giftName: 'Castle', now: 2000 });
  assert.equal(state.players[0].shield, 15); assert.ok(state.players[0].shieldUntil <= 5000);
});

test('meteor is telegraphed, respects spawn protection and cannot force an elimination', () => {
  prepare(); add('Alpha', 'u1'); add('Bravo', 'u2'); start();
  __test.setPlayerHp('u2', 30);
  const result = gift({ eventId: 'meteor-1', giftId: 'neon-meteor', giftName: 'Meteor', now: 1000 });
  assert.equal(result.status, 'applied'); assert.equal(state.hazards.length, 1); assert.ok(state.hazards[0].impactAt > state.hazards[0].createdAt);
  tickGame(3000); assert.equal(state.players.find((p) => p.id === 'u2').hp, 30);
  prepare(); add('Alpha', 'u1'); add('Bravo', 'u2'); start(); __test.expireSpawnProtection('u1'); __test.expireSpawnProtection('u2'); __test.setPlayerHp('u2', 12);
  gift({ eventId: 'meteor-2', giftId: 'neon-meteor', giftName: 'Meteor', now: 1000 }); tickGame(3000);
  const target = state.players.find((p) => p.id === 'u2'); assert.equal(target.alive, true); assert.ok(target.hp >= 10);
});

test('boss retargets when current player disconnects and emits escaped on expiry without reward', () => {
  prepare(); add('Alpha', 'u1'); add('Bravo', 'u2'); start(); spawnBoss({ now: 1000 }); drainEngineEvents();
  tickGame(9000); const firstTarget = state.boss.targetPlayerId; assert.ok(firstTarget);
  __test.setPlayerAlive(firstTarget, false); tickGame(10000); assert.notEqual(state.boss.targetPlayerId, firstTarget);
  const scores = new Map(state.players.map((p) => [p.id, p.score])); tickGame(47000);
  assert.equal(state.boss.active, false); assert.ok(drainEngineEvents().some((e) => e.type === 'boss:escaped'));
  for (const p of state.players) assert.equal(p.score, scores.get(p.id));
});

test('configurable per-player gift limit is enforced per round', () => {
  prepare(); updateSettings({ giftLimits: { perPlayerPerRound: 1, perRound: 4, pendingPerUser: 1, maxComboActivations: 1 } }); add('Alpha', 'u1'); start();
  assert.equal(gift({ eventId: 'limit-1' }).status, 'applied');
  const rejected = gift({ eventId: 'limit-2' }); assert.equal(rejected.reason, 'round-limit');
});
