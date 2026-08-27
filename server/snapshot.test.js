import assert from 'node:assert/strict';
import test from 'node:test';
import { __test, finish, join, reset, setStorm, spawnBoss, start, state } from './engine.js';
import { captureGameSnapshot, restoreGameSnapshot, snapshotInternals, validateSnapshotEnvelope } from './snapshot.js';

const makeExecutor = () => ({
  seen: new Map(), cooldowns: new Map(), globalCooldowns: new Map(),
  prune(now) {
    for (const map of [this.seen, this.cooldowns, this.globalCooldowns]) for (const [key, expiresAt] of map) if (expiresAt <= now) map.delete(key);
  },
});

const BASE = 1_800_000_000_000;

test('restart-safe snapshot restores running battle, boss, storm and power cooldowns', () => {
  reset({ now: BASE });
  const a = join('Snapshot-A', 'blue', true, { platformUserId: 'snapshot:a' });
  const b = join('Snapshot-B', 'red', true, { platformUserId: 'snapshot:b' });
  start({ now: BASE + 1000, countdownMs: 0 });
  __test.expireSpawnProtection(a.id);
  __test.expireSpawnProtection(b.id);
  a.hp = 63; a.score = 17; b.hp = 41; b.score = 9;
  setStorm(72);
  const boss = spawnBoss({ source: 'test', now: BASE + 1500 });
  assert.equal(boss.applied, true);
  const executor = makeExecutor();
  executor.seen.set('evt:1', BASE + 30_000);
  executor.cooldowns.set('snapshot:a:speed', BASE + 25_000);
  executor.globalCooldowns.set('meteor', BASE + 20_000);
  const snapshot = captureGameSnapshot({ powerExecutor: executor, now: BASE + 2000, reason: 'test-running' });

  reset({ now: BASE + 2100 });
  executor.seen.clear(); executor.cooldowns.clear(); executor.globalCooldowns.clear();
  const restored = restoreGameSnapshot(snapshot, { powerExecutor: executor, now: BASE + 2200 });

  assert.equal(restored.restored, true);
  assert.equal(state.phase, 'running');
  assert.equal(state.storm, 72);
  assert.equal(state.boss.active, true);
  assert.equal(state.players.length, 2);
  assert.equal(state.players.find((player) => player.id === 'snapshot:a')?.hp, 63);
  assert.equal(state.players.find((player) => player.id === 'snapshot:a')?.score, 17);
  assert.equal(executor.seen.get('evt:1'), BASE + 30_000);
  assert.equal(executor.cooldowns.get('snapshot:a:speed'), BASE + 25_000);
  assert.equal(executor.globalCooldowns.get('meteor'), BASE + 20_000);
});

test('restart-safe snapshot restores countdown', () => {
  reset({ now: BASE });
  join('Countdown-A', 'blue', true, { platformUserId: 'countdown:a' });
  join('Countdown-B', 'red', true, { platformUserId: 'countdown:b' });
  start({ now: BASE + 1000, countdownMs: 5000 });
  const snapshot = captureGameSnapshot({ now: BASE + 1200, reason: 'countdown' });
  reset({ now: BASE + 1300 });
  const restored = restoreGameSnapshot(snapshot, { now: BASE + 1400 });
  assert.equal(restored.restored, true);
  assert.equal(state.phase, 'countdown');
  assert.equal(state.countdownEndsAt, BASE + 6000);
  assert.equal(state.players.length, 2);
});

test('restart-safe snapshot restores intermission state without fabricating a new round', () => {
  reset({ now: BASE });
  const a = join('End-A', 'blue', true, { platformUserId: 'end:a' });
  const b = join('End-B', 'red', true, { platformUserId: 'end:b' });
  start({ now: BASE + 1000, countdownMs: 0 });
  __test.setPlayerAlive(b.id, false);
  const winner = finish({ now: BASE + 2000, intermissionMs: 10_000 });
  assert.equal(winner?.id, a.id);
  const roundBefore = state.round;
  const snapshot = captureGameSnapshot({ now: BASE + 2100, reason: 'round-end' });
  reset({ now: BASE + 2200 });
  const restored = restoreGameSnapshot(snapshot, { now: BASE + 2300 });
  assert.equal(restored.restored, true);
  assert.equal(state.phase, 'ended');
  assert.equal(state.round, roundBefore);
  assert.equal(state.intermissionEndsAt, BASE + 12_000);
  assert.equal(state.winner?.id, a.id);
});

test('expired, corrupt and unsupported snapshots fail closed to restore', () => {
  reset({ now: BASE });
  join('Safe-A', null, true, { platformUserId: 'safe:a' });
  const snapshot = captureGameSnapshot({ now: BASE, reason: 'validation' });
  assert.equal(validateSnapshotEnvelope(snapshot, { now: BASE + 1000 }).ok, true);
  assert.equal(validateSnapshotEnvelope({ ...snapshot, snapshotVersion: 999 }, { now: BASE + 1000 }).reason, 'snapshot-version-unsupported');
  assert.equal(validateSnapshotEnvelope({ ...snapshot, payload: null }, { now: BASE + 1000 }).reason, 'snapshot-payload-invalid');
  assert.equal(validateSnapshotEnvelope(snapshot, { now: BASE + snapshotInternals.TTL_MS + 1 }).reason, 'snapshot-expired');
});

test.after(() => reset({ now: BASE + 50_000 }));
