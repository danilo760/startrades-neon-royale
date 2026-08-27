import assert from 'node:assert/strict';
import test from 'node:test';
import { createReplayRecorder, createSeededRandom, validateReplay, withDeterministicRuntime } from './replay.js';

test('seeded RNG produces the same sequence for the same seed', () => {
  const a = createSeededRandom('neon-seed');
  const b = createSeededRandom('neon-seed');
  assert.deepEqual(Array.from({ length: 8 }, () => a()), Array.from({ length: 8 }, () => b()));
});

test('deterministic runtime controls random and clock then restores them', () => {
  const originalNow = Date.now;
  const originalRandom = Math.random;
  const output = withDeterministicRuntime(1234, 5000, (runtime) => {
    assert.equal(Date.now(), 5000);
    const first = Math.random();
    runtime.advance(250);
    return { first, now: Date.now() };
  });
  const again = withDeterministicRuntime(1234, 5000, (runtime) => {
    const first = Math.random();
    runtime.advance(250);
    return { first, now: Date.now() };
  });
  assert.deepEqual(output, again);
  assert.equal(Date.now, originalNow);
  assert.equal(Math.random, originalRandom);
});

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

test('replay recorder removes secret-like fields and validates order', () => {
  const recorder = createReplayRecorder({ roundId: 'round-safe', seed: 77, startedAt: 1000 });
  recorder.record('COMMENT', { comment: '!space', adminToken: 'never-store', nested: { authorization: 'Bearer secret', ok: 'yes' } }, 1010);
  const replay = recorder.snapshot();
  assert.equal(replay.events[0].payload.adminToken, undefined);
  assert.equal(replay.events[0].payload.nested.authorization, undefined);
  assert.equal(replay.events[0].payload.nested.ok, 'yes');
  assert.equal(validateReplay(replay).events[0].atMs, 10);
});
