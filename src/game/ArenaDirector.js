const LEVELS = Object.freeze(['CALM', 'ACTIVE', 'HYPE', 'CHAOS', 'CLIMAX']);
const PRIORITY = Object.freeze({
  victory: 100,
  'sudden-death': 95,
  'boss-critical': 90,
  'boss-warning': 82,
  'gift-premium': 78,
  'boss-impact': 74,
  'gift-event': 66,
  elimination: 55,
  storm: 45,
  'gift-support': 35,
  like: 15,
});
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

export function classifyArenaIntensity(state = {}, activity = {}, now = Date.now()) {
  const players = Array.isArray(state.players) ? state.players : [];
  const alive = players.filter((player) => player?.alive);
  const boss = state.boss || {};
  const bossRatio = boss.active ? Number(boss.hp || 0) / Math.max(1, Number(boss.maxHp || 1)) : 1;
  const phase = String(state.phase || 'lobby');
  const storm = clamp(state.storm, 0, 100);
  const recentKills = Number(activity.kills || 0);
  const recentGifts = Number(activity.gifts || 0);
  const roundAgeMs = Math.max(0, now - Number(state.roundStartedAt || now));
  const avgHp = alive.length ? alive.reduce((sum, player) => sum + (Number(player.hp || 0) / Math.max(1, Number(player.maxHp || 100))), 0) / alive.length : 1;

  if (phase === 'ended' || state.winner) return { level: 'CLIMAX', score: 100, reason: 'round-finale' };
  if (state.suddenDeath?.active || (boss.active && bossRatio <= 0.12) || (phase === 'running' && players.length >= 3 && alive.length <= 2)) {
    return { level: 'CLIMAX', score: 95, reason: state.suddenDeath?.active ? 'sudden-death' : boss.active && bossRatio <= 0.12 ? 'boss-critical' : 'last-fighters' };
  }
  let score = phase === 'running' ? 24 : phase === 'countdown' ? 18 : 0;
  score += boss.active ? 26 : 0;
  score += storm * 0.28;
  score += Math.min(20, recentKills * 6);
  score += Math.min(16, recentGifts * 4);
  score += avgHp < 0.45 ? 8 : 0;
  score += roundAgeMs > 90_000 ? 6 : 0;
  const level = score >= 72 ? 'CHAOS' : score >= 50 ? 'HYPE' : score >= 18 ? 'ACTIVE' : 'CALM';
  return { level, score: Math.round(score), reason: boss.active ? 'boss-pressure' : storm >= 60 ? 'storm-pressure' : phase };
}

export function presentationProfile(level = 'CALM') {
  const profiles = {
    CALM: { visualScale: 0.62, shakeScale: 0.45, narratorBudget: 1, bannerBudget: 1, musicEnergy: 0.45 },
    ACTIVE: { visualScale: 0.78, shakeScale: 0.65, narratorBudget: 2, bannerBudget: 2, musicEnergy: 0.62 },
    HYPE: { visualScale: 0.92, shakeScale: 0.82, narratorBudget: 3, bannerBudget: 2, musicEnergy: 0.78 },
    CHAOS: { visualScale: 1, shakeScale: 0.9, narratorBudget: 3, bannerBudget: 2, musicEnergy: 0.9 },
    CLIMAX: { visualScale: 1.08, shakeScale: 1, narratorBudget: 4, bannerBudget: 2, musicEnergy: 1 },
  };
  return profiles[LEVELS.includes(level) ? level : 'CALM'];
}

export class ArenaDirector {
  constructor({ now = () => Date.now(), schedule = (fn, delay) => setTimeout(fn, delay), minCueGapMs = 260 } = {}) {
    this.now = now;
    this.schedule = schedule;
    this.minCueGapMs = Math.max(120, Number(minCueGapMs) || 260);
    this.queue = [];
    this.running = false;
    this.lastCueAt = 0;
    this.level = 'CALM';
    this.activity = { kills: 0, gifts: 0, windowStartedAt: this.now() };
    this.timer = null;
  }

  observe(type = '') {
    const now = this.now();
    if (now - this.activity.windowStartedAt > 10_000) this.activity = { kills: 0, gifts: 0, windowStartedAt: now };
    if (type === 'player:eliminated') this.activity.kills += 1;
    if (type === 'gift:applied') this.activity.gifts += 1;
  }

  update(state = {}) {
    const result = classifyArenaIntensity(state, this.activity, this.now());
    const changed = result.level !== this.level;
    this.level = result.level;
    return { ...result, changed, profile: presentationProfile(result.level) };
  }

  enqueue(kind, payload, run) {
    if (typeof run !== 'function') return false;
    const cue = { kind, payload, run, priority: PRIORITY[kind] ?? 40, queuedAt: this.now() };
    if (this.queue.length >= 12) {
      this.queue.sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt);
      const lowest = this.queue.at(-1);
      if (lowest && lowest.priority > cue.priority) return false;
      this.queue.pop();
    }
    this.queue.push(cue);
    this.queue.sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt);
    this.drain();
    return true;
  }

  drain() {
    if (this.running || !this.queue.length) return;
    const delay = Math.max(0, this.minCueGapMs - (this.now() - this.lastCueAt));
    const execute = () => {
      this.timer = null;
      const cue = this.queue.shift();
      if (!cue) { this.running = false; return; }
      this.running = true;
      try { cue.run(cue.payload); } finally {
        this.lastCueAt = this.now();
        this.running = false;
        if (this.queue.length) this.drain();
      }
    };
    if (delay === 0) execute();
    else this.timer = this.schedule(execute, delay);
  }

  clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.queue.length = 0;
    this.running = false;
  }

  status() { return { level: this.level, queued: this.queue.length, profile: presentationProfile(this.level) }; }
}

export const arenaPresentationPriority = PRIORITY;
