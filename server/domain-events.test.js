import assert from 'node:assert/strict';
import test from 'node:test';
import { ENGINE_EVENT_CHANNEL, eventBus } from './event-bus.js';
import { clearLeaderboard } from './leaderboard.js';
import { __test, applyCombatResult, applyGiftEffect, finish, join, reset, spawnBoss, start, state, tickGame, updateSettings } from './engine.js';

const prepare = (teamMode = false) => {
  clearLeaderboard();
  reset();
  updateSettings({ teamMode, giftLimits: { perPlayerPerRound: 12, perRound: 120, pendingPerUser: 3, maxComboActivations: 2 } });
};
const add = (name, id, team) => join(name, team, false, { platformUserId: id });
const captureEvents = () => {
  const events = [];
  const listener = (event) => events.push(event);
  eventBus.on(ENGINE_EVENT_CHANNEL, listener);
  return { events, close: () => eventBus.off(ENGINE_EVENT_CHANNEL, listener) };
};

test('round lifecycle emits round:started and round:ended with score context', () => {
  prepare(); add('Alpha', 'a'); add('Bravo', 'b');
  const capture = captureEvents();
  try {
    start();
    const started = capture.events.find((event) => event.type === 'round:started');
    assert.ok(started); assert.equal(started.payload.roundId, state.roundId); assert.equal(started.payload.playerCount, 2);
    finish();
    const ended = capture.events.find((event) => event.type === 'round:ended');
    assert.ok(ended); assert.equal(ended.payload.roundId, state.roundId); assert.ok(Array.isArray(ended.payload.standings)); assert.equal(ended.payload.standings.length, 2);
  } finally { capture.close(); }
});

test('combat elimination emits player:eliminated and bounty:claimed', () => {
  prepare(); add('Leader', 'leader'); finish(); reset(); add('Leader', 'leader'); add('Hunter', 'hunter'); start();
  assert.equal(state.bountyTargetId, 'leader'); __test.expireSpawnProtection('leader'); __test.expireSpawnProtection('hunter'); __test.setPlayerHp('leader', 4);
  const capture = captureEvents();
  try {
    const result = applyCombatResult({ attackerId: 'hunter', targetId: 'leader', attackKind: 'shot' });
    assert.equal(result.bountyClaimed, true);
    const eliminated = capture.events.find((event) => event.type === 'player:eliminated');
    assert.ok(eliminated); assert.equal(eliminated.payload.attackerId, 'hunter'); assert.equal(eliminated.payload.targetId, 'leader');
    const claimed = capture.events.find((event) => event.type === 'bounty:claimed');
    assert.ok(claimed); assert.equal(claimed.payload.attackerId, 'hunter'); assert.equal(claimed.payload.targetId, 'leader'); assert.equal(claimed.payload.multiplier, 3);
  } finally { capture.close(); }
});

test('tactical shield emits player:healed only for actual healing', () => {
  prepare(); add('Alpha', 'u1'); start(); __test.setPlayerHp('u1', 50);
  const capture = captureEvents();
  try {
    const result = applyGiftEffect({ eventId: 'heal-domain', senderUserId: 'u1', senderUsername: 'Alpha', giftId: 'neon-shield', giftName: 'Hat', repeatCount: 1, source: 'tiktok', now: 1000 });
    assert.equal(result.status, 'applied');
    const healed = capture.events.find((event) => event.type === 'player:healed');
    assert.ok(healed); assert.equal(healed.payload.playerId, 'u1'); assert.equal(healed.payload.amount, 15); assert.equal(healed.payload.hp, 65);
  } finally { capture.close(); }
});

test('boss emits boss:attacked for aggro changes and attack phases', () => {
  prepare(); add('Alpha', 'u1'); add('Bravo', 'u2'); start(); spawnBoss({ now: 1000 });
  const capture = captureEvents();
  try {
    tickGame(9000);
    const bossEvents = capture.events.filter((event) => event.type === 'boss:attacked');
    assert.ok(bossEvents.some((event) => event.payload.reason === 'aggro-changed'));
    assert.ok(bossEvents.some((event) => event.payload.reason === 'attack-warning'));
    tickGame(13000);
    assert.ok(capture.events.some((event) => event.type === 'boss:attacked' && event.payload.reason === 'attack-resolved'));
  } finally { capture.close(); }
});
