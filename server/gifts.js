const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;
const MAX_REPEAT = 100;

export const GIFT_CATALOG = Object.freeze([
  Object.freeze({ giftId: '5655', aliases: ['rose', 'rosa'], tier: 'support', effect: 'entry-boost', magnitude: 1.2, durationMs: 5000, cooldownMs: 5000, visualEffect: 'entry-spark', narrationPriority: 1 }),
  Object.freeze({ giftId: 'neon-shield', aliases: ['hat', 'chapéu', 'chapeu', 'glasses', 'óculos', 'oculos', 'castle', 'castelo'], tier: 'boost', effect: 'tactical-shield', magnitude: 10, durationMs: 3000, cooldownMs: 12000, visualEffect: 'shield-ring', narrationPriority: 2 }),
  Object.freeze({ giftId: 'neon-speed', aliases: ['gg', 'perfume', 'coffee', 'café'], tier: 'boost', effect: 'speed', magnitude: 1.35, durationMs: 5000, cooldownMs: 7000, visualEffect: 'speed-trail', narrationPriority: 2 }),
  Object.freeze({ giftId: 'neon-extra-shot', aliases: ['finger gun', 'dedo em pistola'], tier: 'boost', effect: 'extra-projectile', magnitude: 1, durationMs: 0, cooldownMs: 7000, visualEffect: 'neon-projectile', narrationPriority: 2 }),
  Object.freeze({ giftId: 'neon-meteor', aliases: ['meteor', 'meteoro', 'rocket', 'foguete', 'car', 'carro'], tier: 'event', effect: 'meteor', magnitude: 22, durationMs: 2000, cooldownMs: 12000, visualEffect: 'meteor-warning', narrationPriority: 3 }),
  Object.freeze({ giftId: 'neon-star-power', aliases: ['lion', 'leão', 'leao'], tier: 'premium', effect: 'star-power', magnitude: 100, durationMs: 60000, cooldownMs: 30000, visualEffect: 'golden-aura', narrationPriority: 5 }),
  Object.freeze({ giftId: 'neon-colossus', aliases: ['universe', 'universo', 'galaxy', 'galáxia', 'galaxia'], tier: 'premium', effect: 'colossus', magnitude: 1, durationMs: 45000, cooldownMs: 60000, visualEffect: 'colossus-neon', narrationPriority: 5 }),
]);

const byId = new Map(GIFT_CATALOG.map((gift) => [String(gift.giftId), gift]));
const byAlias = new Map(GIFT_CATALOG.flatMap((gift) => gift.aliases.map((alias) => [alias.normalize('NFKC').trim().toLocaleLowerCase('pt-BR'), gift])));

export function sanitizeDisplayName(value, fallback = 'fighter', max = 32) {
  const cleaned = String(value ?? '').normalize('NFKC').replace(CONTROL_RE, '').replace(/[<>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  return cleaned || fallback;
}

export function sanitizeNarrationName(value, fallback = 'fighter') {
  const cleaned = sanitizeDisplayName(value, fallback, 32).replace(/[^\p{L}\p{N}_.-]/gu, '').slice(0, 24);
  return cleaned || fallback;
}

export function sanitizeStableId(value) {
  return String(value ?? '').replace(CONTROL_RE, '').trim().replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80);
}

export function resolveGiftDefinition(giftId, giftName = '') {
  const id = String(giftId ?? '').trim();
  if (id && byId.has(id)) return byId.get(id);
  const alias = String(giftName ?? '').normalize('NFKC').trim().toLocaleLowerCase('pt-BR');
  return alias ? byAlias.get(alias) || null : null;
}

export function publicGiftCatalog() {
  return GIFT_CATALOG.map(({ giftId, aliases, tier, effect, magnitude, durationMs, cooldownMs, visualEffect, narrationPriority }) => ({ giftId, aliases: [...aliases], tier, effect, magnitude, durationMs, cooldownMs, visualEffect, narrationPriority }));
}

export function normalizeGiftEvent(raw = {}, source = 'tiktok') {
  const user = raw.user && typeof raw.user === 'object' ? raw.user : {};
  const senderUserId = sanitizeStableId(source === 'control-panel' ? (raw.senderUserId || 'control-panel') : user.userId);
  const giftId = String(raw.giftId ?? raw.gift?.id ?? raw.gift?.gift_id ?? '').trim().slice(0, 80);
  const giftName = sanitizeDisplayName(raw.giftName ?? raw.gift?.name ?? 'Presente', 'Presente', 48);
  const senderUsername = sanitizeDisplayName(user.uniqueId ?? raw.uniqueId ?? raw.senderUsername ?? raw.username ?? 'fighter', 'fighter', 32);
  const senderNickname = sanitizeDisplayName(user.nickname ?? raw.nickname ?? senderUsername, senderUsername, 40);
  const targetUserId = sanitizeStableId(raw.targetUserId ?? '');
  const repeatCount = Math.max(1, Math.min(MAX_REPEAT, Math.trunc(Number(raw.repeatCount) || 1)));
  const giftType = Math.trunc(Number(raw.giftType ?? raw.gift?.type ?? raw.gift?.gift_type) || 0);
  const repeatEnd = raw.repeatEnd === true || raw.repeatEnd === 1 || raw.repeatEnd === '1';
  const transactionId = sanitizeStableId(raw.transactionId ?? '');
  const msgId = sanitizeStableId(raw.msgId ?? raw.messageId ?? '');
  const groupId = sanitizeStableId(raw.groupId ?? raw.gift?.groupId ?? raw.monitorExtra?.log_id ?? '');
  const eventId = sanitizeStableId(raw.eventId) || msgId || transactionId;
  const comboKey = transactionId || groupId || (giftType === 1 ? eventId : '');
  const diamondCount = Math.max(0, Math.trunc(Number(raw.diamondCount) || 0));
  return { eventId, comboKey, senderUserId, senderUsername, senderNickname, targetUserId: targetUserId || null, giftId, giftName, repeatCount, giftType, repeatEnd, diamondCount, source };
}

export class GiftEventLedger {
  constructor({ ttlMs = 10 * 60 * 1000, maxEntries = 5000 } = {}) {
    this.ttlMs = Math.max(30_000, ttlMs);
    this.maxEntries = Math.max(100, maxEntries);
    this.seen = new Map();
    this.combos = new Map();
  }
  prune(now = Date.now()) {
    for (const [key, expiresAt] of this.seen) if (expiresAt <= now) this.seen.delete(key);
    for (const [key, item] of this.combos) if (item.expiresAt <= now) this.combos.delete(key);
    while (this.seen.size > this.maxEntries) this.seen.delete(this.seen.keys().next().value);
    while (this.combos.size > this.maxEntries) this.combos.delete(this.combos.keys().next().value);
  }
  markSeen(key, now) { if (key) this.seen.set(key, now + this.ttlMs); }
  ingest(raw, { source = 'tiktok', now = Date.now() } = {}) {
    this.prune(now);
    const event = normalizeGiftEvent(raw, source);
    if (!event.senderUserId) return { status: 'rejected', reason: 'missing-sender-id', event };
    if (!event.giftId && !event.giftName) return { status: 'rejected', reason: 'missing-gift', event };
    if (!event.eventId) return { status: 'rejected', reason: 'missing-event-id', event };
    if (this.seen.has(event.eventId)) return { status: 'duplicate', reason: 'duplicate-event', event };

    if (event.giftType === 1) {
      const comboKey = event.comboKey;
      if (!comboKey) return { status: 'rejected', reason: 'missing-combo-id', event };
      const previous = this.combos.get(comboKey);
      if (previous?.closed) return { status: 'duplicate', reason: 'duplicate-combo', event };
      const confirmed = Math.max(previous?.confirmed || 0, event.repeatCount);
      if (!event.repeatEnd) {
        this.combos.set(comboKey, { confirmed, closed: false, expiresAt: now + this.ttlMs });
        this.markSeen(event.eventId, now);
        return { status: 'pending', reason: 'combo-open', event: { ...event, repeatCount: confirmed } };
      }
      this.combos.set(comboKey, { confirmed, closed: true, expiresAt: now + this.ttlMs });
      this.markSeen(event.eventId, now);
      return { status: 'ready', event: { ...event, repeatCount: confirmed } };
    }

    this.markSeen(event.eventId, now);
    return { status: 'ready', event };
  }
}
