const RIVALRY_TTL_MS = 5 * 60 * 1000;
const MAX_PAIRS = 100;
const clean = (value, max = 80) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f<>`]/g, '').trim().slice(0, max);

export class RivalryManager {
  constructor({ publish = () => {}, now = () => Date.now() } = {}) {
    this.publish = publish;
    this.now = now;
    this.pairs = new Map();
  }

  key(a, b) { return [a, b].sort().join('|'); }

  prune(now = this.now()) {
    for (const [key, rivalry] of this.pairs) {
      if (now - rivalry.updatedAt <= RIVALRY_TTL_MS) continue;
      if (rivalry.started) this.publish('rivalry:ended', { ...rivalry, reason: 'expired' });
      this.pairs.delete(key);
    }
    while (this.pairs.size > MAX_PAIRS) this.pairs.delete(this.pairs.keys().next().value);
  }

  recordElimination(payload = {}) {
    const now = this.now();
    this.prune(now);
    const attackerId = clean(payload.attackerId);
    const targetId = clean(payload.targetId);
    if (!attackerId || !targetId || attackerId === targetId) return null;
    const key = this.key(attackerId, targetId);
    const existing = this.pairs.get(key) || { key, playerAId: attackerId, playerBId: targetId, aKills: 0, bKills: 0, started: false, createdAt: now };
    if (existing.playerAId === attackerId) existing.aKills += 1; else existing.bKills += 1;
    existing.playerAName = existing.playerAId === attackerId ? clean(payload.attackerUsername, 32) : existing.playerAName || clean(payload.targetUsername, 32);
    existing.playerBName = existing.playerBId === targetId ? clean(payload.targetUsername, 32) : existing.playerBName || clean(payload.attackerUsername, 32);
    existing.updatedAt = now;
    const total = existing.aKills + existing.bKills;
    if (!existing.started && total >= 2) {
      existing.started = true;
      this.publish('rivalry:started', { ...existing });
    } else if (existing.started) {
      this.publish('rivalry:updated', { ...existing });
    }
    this.pairs.set(key, existing);
    return { ...existing };
  }

  evaluateArenaChallenge(player = {}, leaderboard = []) {
    const id = clean(player.platformUserId || player.id);
    if (!id || !Array.isArray(leaderboard) || leaderboard.length < 2) return null;
    const rank = leaderboard.findIndex((entry) => clean(entry.platformUserId || entry.id) === id) + 1;
    if (!rank || rank > 5) return null;
    const king = leaderboard[0];
    const kingId = clean(king?.platformUserId || king?.id);
    if (!kingId || kingId === id) return null;
    const payload = {
      kind: 'ARENA_KING_CHALLENGE', challengerId: id, challengerName: clean(player.username, 32),
      challengerRank: rank, kingId, kingName: clean(king.username, 32), statusOnly: true, reward: null,
    };
    this.publish('rivalry:challenge', payload);
    return payload;
  }

  endAll(reason = 'round-ended') {
    for (const rivalry of this.pairs.values()) if (rivalry.started) this.publish('rivalry:ended', { ...rivalry, reason });
    this.pairs.clear();
  }
}

export const rivalryConstants = Object.freeze({ RIVALRY_TTL_MS, MAX_PAIRS });
