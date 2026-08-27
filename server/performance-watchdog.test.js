import test from 'node:test';
import assert from 'node:assert/strict';
import { PerformanceWatchdog, qualityCandidate } from '../src/game/PerformanceWatchdog.js';
import { visualQualityFor } from '../src/game/visualPresets.js';

test('performance quality thresholds follow HIGH NORMAL LOW EMERGENCY bands', () => {
  assert.equal(qualityCandidate({ fps: 60 }), 'HIGH');
  assert.equal(qualityCandidate({ fps: 50 }), 'NORMAL');
  assert.equal(qualityCandidate({ fps: 36 }), 'LOW');
  assert.equal(qualityCandidate({ fps: 24 }), 'EMERGENCY');
});

test('heavy arena pressure can reduce candidate quality even with high FPS', () => {
  assert.equal(qualityCandidate({ fps: 60, players: 50 }), 'NORMAL');
  assert.equal(qualityCandidate({ fps: 60, players: 80 }), 'LOW');
  assert.equal(qualityCandidate({ fps: 60, players: 110 }), 'EMERGENCY');
  assert.equal(qualityCandidate({ fps: 60, projectiles: 170 }), 'EMERGENCY');
});

test('watchdog degrades after sustained pressure, not on a single bad frame', () => {
  let now = 0;
  const watchdog = new PerformanceWatchdog({ now: () => now, degradeAfterMs: 1000, recoverAfterMs: 2000, switchCooldownMs: 500, sampleWindow: 20 });
  watchdog.sample(30);
  assert.equal(watchdog.level, 'NORMAL');
  for (let i = 0; i < 40; i++) { now += 30; watchdog.sample(30); }
  assert.equal(watchdog.level, 'LOW');
});

test('watchdog recovers gradually with hysteresis', () => {
  let now = 0;
  const watchdog = new PerformanceWatchdog({ now: () => now, initialLevel: 'EMERGENCY', degradeAfterMs: 500, recoverAfterMs: 1000, switchCooldownMs: 500, sampleWindow: 20 });
  for (let i = 0; i < 70; i++) { now += 17; watchdog.sample(17); }
  assert.equal(watchdog.level, 'LOW', 'first recovery only moves one quality level');
  for (let i = 0; i < 70; i++) { now += 17; watchdog.sample(17); }
  assert.equal(watchdog.level, 'NORMAL', 'second sustained window moves to normal');
});

test('emergency visuals preserve essentials while dropping decoration', () => {
  const emergency = visualQualityFor('EMERGENCY');
  const low = visualQualityFor('LOW');
  const normal = visualQualityFor('NORMAL');
  assert.ok(emergency.ambientCount < low.ambientCount);
  assert.ok(low.ambientCount < normal.ambientCount);
  assert.equal(emergency.secondaryVfx, false);
  assert.ok(emergency.trailInterval > low.trailInterval);
  assert.ok(emergency.bloom < low.bloom);
});
