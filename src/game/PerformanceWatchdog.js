const LEVELS = Object.freeze(['EMERGENCY', 'LOW', 'NORMAL', 'HIGH']);
const LEVEL_INDEX = new Map(LEVELS.map((level, index) => [level, index]));
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

export function qualityCandidate({ fps = 60, players = 0, projectiles = 0, vfx = 0 } = {}) {
  let level = fps < 30 ? 'EMERGENCY' : fps < 42 ? 'LOW' : fps < 55 ? 'NORMAL' : 'HIGH';
  const pressure = Math.max(
    players >= 100 ? 3 : players >= 70 ? 2 : players >= 45 ? 1 : 0,
    projectiles >= 160 ? 3 : projectiles >= 100 ? 2 : projectiles >= 60 ? 1 : 0,
    vfx >= 650 ? 3 : vfx >= 420 ? 2 : vfx >= 250 ? 1 : 0,
  );
  if (pressure >= 3) level = 'EMERGENCY';
  else if (pressure === 2 && LEVEL_INDEX.get(level) > LEVEL_INDEX.get('LOW')) level = 'LOW';
  else if (pressure === 1 && LEVEL_INDEX.get(level) > LEVEL_INDEX.get('NORMAL')) level = 'NORMAL';
  return level;
}

export class PerformanceWatchdog {
  constructor({
    now = () => performance.now(),
    initialLevel = 'NORMAL',
    degradeAfterMs = 2200,
    recoverAfterMs = 5200,
    switchCooldownMs = 3000,
    sampleWindow = 90,
  } = {}) {
    this.now = now;
    this.level = LEVEL_INDEX.has(initialLevel) ? initialLevel : 'NORMAL';
    this.degradeAfterMs = Math.max(500, Number(degradeAfterMs) || 2200);
    this.recoverAfterMs = Math.max(this.degradeAfterMs, Number(recoverAfterMs) || 5200);
    this.switchCooldownMs = Math.max(500, Number(switchCooldownMs) || 3000);
    this.sampleWindow = clamp(Math.trunc(sampleWindow), 20, 180);
    this.frameTimes = [];
    this.candidate = this.level;
    this.candidateSince = this.now();
    this.lastSwitchAt = -Infinity;
    this.lastMetrics = { fps: 60, frameTimeMs: 16.67, players: 0, projectiles: 0, vfx: 0, memoryMb: null };
  }

  sample(deltaMs, metrics = {}) {
    const now = this.now();
    const frame = clamp(deltaMs, 1, 250);
    this.frameTimes.push(frame);
    if (this.frameTimes.length > this.sampleWindow) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, this.frameTimes.length);
    const fps = clamp(1000 / Math.max(1, avg), 1, 240);
    const memoryBytes = Number(globalThis.performance?.memory?.usedJSHeapSize || 0);
    this.lastMetrics = {
      fps: Number(fps.toFixed(1)),
      frameTimeMs: Number(avg.toFixed(2)),
      players: Math.max(0, Math.trunc(Number(metrics.players) || 0)),
      projectiles: Math.max(0, Math.trunc(Number(metrics.projectiles) || 0)),
      vfx: Math.max(0, Math.trunc(Number(metrics.vfx) || 0)),
      memoryMb: memoryBytes > 0 ? Number((memoryBytes / 1024 / 1024).toFixed(1)) : null,
    };
    const nextCandidate = qualityCandidate(this.lastMetrics);
    if (nextCandidate !== this.candidate) {
      this.candidate = nextCandidate;
      this.candidateSince = now;
    }
    if (nextCandidate === this.level) return this.status(false);
    if (now - this.lastSwitchAt < this.switchCooldownMs) return this.status(false);

    const currentIndex = LEVEL_INDEX.get(this.level);
    const candidateIndex = LEVEL_INDEX.get(nextCandidate);
    const degrading = candidateIndex < currentIndex;
    const requiredMs = degrading ? this.degradeAfterMs : this.recoverAfterMs;
    if (now - this.candidateSince < requiredMs) return this.status(false);

    const previous = this.level;
    if (degrading) this.level = nextCandidate;
    else this.level = LEVELS[Math.min(LEVELS.length - 1, currentIndex + 1)];
    this.lastSwitchAt = now;
    this.candidate = this.level;
    this.candidateSince = now;
    return this.status(previous !== this.level, previous);
  }

  status(changed = false, previous = null) {
    return {
      level: this.level,
      candidate: this.candidate,
      changed,
      previous,
      ...this.lastMetrics,
    };
  }

  reset(level = 'NORMAL') {
    this.level = LEVEL_INDEX.has(level) ? level : 'NORMAL';
    this.candidate = this.level;
    this.candidateSince = this.now();
    this.lastSwitchAt = -Infinity;
    this.frameTimes.length = 0;
  }
}

export const performanceQualityLevels = LEVELS;
