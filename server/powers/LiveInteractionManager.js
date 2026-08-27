const COMMENT_WINDOW_MS = 10_000;
const VOTE_COOLDOWN_MS = 5_000;
const MAX_COMMENTS = 500;
const MAX_USERS = 1000;
const MAPS = new Set(['lava', 'space', 'cyber']);
const clean = (value, max = 80) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f<>`]/g, '').trim().slice(0, max);

export class LiveInteractionManager {
  constructor({ publish = () => {}, now = () => Date.now() } = {}) {
    this.publish = publish;
    this.now = now;
    this.comments = [];
    this.userCooldowns = new Map();
    this.voteCounts = new Map();
    this.commentMilestoneBucket = 0;
  }

  prune(now = this.now()) {
    this.comments = this.comments.filter((item) => now - item.at <= COMMENT_WINDOW_MS).slice(-MAX_COMMENTS);
    for (const [userId, expiresAt] of this.userCooldowns) if (expiresAt <= now) this.userCooldowns.delete(userId);
    while (this.userCooldowns.size > MAX_USERS) this.userCooldowns.delete(this.userCooldowns.keys().next().value);
  }

  ingestComment({ senderUserId, comment, roundId = '' } = {}) {
    const now = this.now();
    this.prune(now);
    const userId = clean(senderUserId);
    const text = clean(comment, 160).toLowerCase();
    if (!userId || !text) return { accepted: false, reason: 'invalid-comment' };
    this.comments.push({ at: now, userId });
    if (this.comments.length > MAX_COMMENTS) this.comments.splice(0, this.comments.length - MAX_COMMENTS);

    const bucket = Math.floor(this.comments.length / 100);
    if (bucket > this.commentMilestoneBucket) {
      this.commentMilestoneBucket = bucket;
      this.publish('interaction:milestone', { type: 'comments', count: bucket * 100, roundId: clean(roundId), effect: 'GLOBAL_VISUAL_BONUS' });
    }

    const match = text.match(/^!(lava|space|cyber)$/);
    if (!match || !MAPS.has(match[1])) return { accepted: true, kind: 'comment' };
    if ((this.userCooldowns.get(userId) || 0) > now) return { accepted: false, reason: 'vote-cooldown' };
    this.userCooldowns.set(userId, now + VOTE_COOLDOWN_MS);
    const vote = match[1];
    this.voteCounts.set(vote, (this.voteCounts.get(vote) || 0) + 1);
    const counts = Object.fromEntries(this.voteCounts);
    this.publish('map:vote', { senderUserId: userId, vote, counts, roundId: clean(roundId), source: 'comment' });
    return { accepted: true, kind: 'map-vote', vote, counts };
  }

  reset() {
    this.comments = [];
    this.userCooldowns.clear();
    this.voteCounts.clear();
    this.commentMilestoneBucket = 0;
  }
}

export const liveInteractionConstants = Object.freeze({ COMMENT_WINDOW_MS, VOTE_COOLDOWN_MS, MAX_COMMENTS, MAX_USERS });
