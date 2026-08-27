const WINDOW_MS = 10_000;
const MAX_EVENTS = 500;
const MILESTONES = Object.freeze([2, 3, 5, 10, 20]);
const clean = (value, max = 80) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f<>`]/g, '').trim().slice(0, max);

export class ComboManager {
  constructor({ publish = () => {}, now = () => Date.now() } = {}) {
    this.publish = publish;
    this.now = now;
    this.events = [];
    this.currentMilestone = 0;
    this.active = false;
  }

  prune(now = this.now()) {
    this.events = this.events.filter((event) => now - event.at <= WINDOW_MS).slice(-MAX_EVENTS);
    if (this.active && !this.events.length) {
      this.active = false;
      this.currentMilestone = 0;
      this.publish('combo:ended', { at: now });
    }
  }

  ingest(payload = {}) {
    const now = Number(payload.at) || this.now();
    this.prune(now);
    const count = Math.max(1, Math.min(100, Math.trunc(Number(payload.repeatCount) || 1)));
    const event = { at: now, giftId: clean(payload.giftId), senderUserId: clean(payload.senderUserId), team: clean(payload.team, 16), count };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    const total = this.events.reduce((sum, item) => sum + item.count, 0);
    if (!this.active && total >= 2) {
      this.active = true;
      this.publish('combo:started', { combo: 2, total, windowMs: WINDOW_MS });
    }
    this.publish('combo:updated', { combo: Math.min(20, total), total, windowMs: WINDOW_MS });
    const milestone = [...MILESTONES].reverse().find((value) => total >= value) || 0;
    if (milestone > this.currentMilestone) {
      this.currentMilestone = milestone;
      this.publish('combo:milestone', { combo: milestone, total, spectacleMultiplier: milestone, damageMultiplier: 1 });
    }
    const roseCount = this.events.filter((item) => item.giftId === '5655').reduce((sum, item) => sum + item.count, 0);
    if (roseCount >= 10 && !this.roseStormAt) {
      this.roseStormAt = now;
      this.publish('combo:milestone', { combo: milestone || 10, total, special: 'ROSE_STORM', roseCount, spectacleMultiplier: 10, damageMultiplier: 1 });
    }
    const teamTotals = new Map();
    for (const item of this.events) if (item.team) teamTotals.set(item.team, (teamTotals.get(item.team) || 0) + item.count);
    for (const [team, teamTotal] of teamTotals) {
      if (teamTotal >= 50 && this.lastTeamOverdrive !== `${team}:${Math.floor(now / WINDOW_MS)}`) {
        this.lastTeamOverdrive = `${team}:${Math.floor(now / WINDOW_MS)}`;
        this.publish('combo:milestone', { special: `${team.toUpperCase()}_OVERDRIVE`, team, total: teamTotal, spectacleMultiplier: 20, damageMultiplier: 1 });
      }
    }
    return { total, milestone, roseCount };
  }

  reset() {
    if (this.active) this.publish('combo:ended', { at: this.now(), reason: 'reset' });
    this.events = [];
    this.currentMilestone = 0;
    this.active = false;
    this.roseStormAt = 0;
    this.lastTeamOverdrive = '';
  }
}

export const comboConstants = Object.freeze({ WINDOW_MS, MAX_EVENTS, MILESTONES });
