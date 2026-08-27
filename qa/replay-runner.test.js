import assert from 'node:assert/strict';
import test from 'node:test';
import { REPLAY_VERSION } from '../server/replay.js';
import { runReplay } from './replay-runner.js';

const buildReplay = () => {
  let seq = 0;
  const events = [];
  const add = (type, atMs, payload = {}) => events.push({ seq: seq++, type, atMs, payload });
  add('JOIN', 0, { username: 'Replay-A', platformUserId: 'replay:a', bot: true });
  add('JOIN', 1, { username: 'Replay-B', platformUserId: 'replay:b', bot: true });
  add('START', 10, { countdownMs: 0, expireSpawnProtection: true, bountyTargetId: null, bountyTargetPlatformId: null });
  add('SHOT', 20, { attackerId: 'replay:a', targetId: 'replay:b', expected: { applied: true, status: null, reason: 'combat', eliminated: false } });
  add('SHOT', 30, { attackerId: 'replay:a', targetId: 'replay:b', expected: { applied: false, status: null, reason: 'attack-cooldown', eliminated: false } });
  const giftInput = { eventId: 'replay-gift-1', senderUserId: 'replay:a', senderUsername: 'Replay-A', targetUserId: 'replay:a', giftId: '5655', giftName: 'Rose', repeatCount: 1 };
  add('GIFT', 40, { input: giftInput, expected: { applied: false, status: 'applied', reason: null, eliminated: false } });
  add('GIFT', 50, { input: giftInput, expected: { applied: false, status: 'rejected', reason: 'duplicate-event', eliminated: false } });
  add('BOSS', 60, { source: 'replay-test', bossId: 'replay-boss', expected: { applied: true, status: null, reason: null, eliminated: false } });
  add('PAUSE', 70, { expectedPhase: 'paused' });
  add('PAUSE', 80, { expectedPhase: 'running' });
  add('STORM', 90, { value: 100 });
  for (let index = 0; index < 14; index += 1) {
    add('DAMAGE', 100 + index, { source: 'storm', targetId: 'replay:b', expected: { applied: true, status: null, reason: null, eliminated: index === 13 } });
  }
  add('ROUND_END', 200, { intermissionMs: 0, expectedWinnerId: 'replay:a' });
  return { replayVersion: REPLAY_VERSION, roundId: 'replay-determinism-1', roundSeed: 0x1234abcd, round: 7, startedAt: 700000, context: { source: 'test' }, events };
};

test('the same replay produces the same final logical state twice', () => {
  const replay = buildReplay();
  const first = runReplay(replay);
  const second = runReplay(replay);
  assert.deepEqual(second.digest, first.digest);
  assert.equal(first.digest.winner?.id, 'replay:a');
  assert.equal(first.digest.phase, 'ended');
});

test('expected final state is enforced by the replay runner', () => {
  const replay = buildReplay();
  const first = runReplay(replay);
  const verified = runReplay({ ...replay, expectedFinal: first.digest });
  assert.deepEqual(verified.digest, first.digest);
});


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
