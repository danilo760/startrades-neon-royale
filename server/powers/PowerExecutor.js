import { randomUUID } from 'node:crypto';
import { enforcePowerLimits } from './PowerLimits.js';

const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const MAX_TIMERS = 64;
const ARENA = Object.freeze({ minX: 55, maxX: 1225, minY: 55, maxY: 665, cx: 640, cy: 360 });
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const clean = (value, max = 80) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f<>`]/g, '').trim().slice(0, max);

export class PowerExecutor {
  constructor({ state, registry, publish = () => {}, spawnBoss = null, telemetry = null, now = () => Date.now(), random = Math.random } = {}) {
    if (!state || !registry) throw new Error('power-executor-dependencies-required');
    this.state = state;
    this.registry = registry;
    this.publish = publish;
    this.spawnBoss = spawnBoss;
    this.telemetry = telemetry;
    this.now = now;
    this.random = random;
    this.seen = new Map();
    this.cooldowns = new Map();
    this.globalCooldowns = new Map();
    this.timers = new Set();
  }

  players() { return (this.state.players || []).filter((player) => player?.alive); }
  playerById(id) { return this.players().find((player) => player.id === id || player.platformUserId === id) || null; }

  prune(now = this.now()) {
    for (const [key, expiresAt] of this.seen) if (expiresAt <= now) this.seen.delete(key);
    for (const [key, expiresAt] of this.cooldowns) if (expiresAt <= now) this.cooldowns.delete(key);
    for (const [key, expiresAt] of this.globalCooldowns) if (expiresAt <= now) this.globalCooldowns.delete(key);
  }

  isRoundActive(roundId) {
    return this.state.phase === 'running' && this.state.roundId === roundId;
  }

  schedule(fn, delayMs, roundId = this.state.roundId) {
    if (this.timers.size >= MAX_TIMERS) return null;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.isRoundActive(roundId)) return;
      try { fn(); } catch (error) { console.warn(`[power-timer] ${String(error?.message || error).slice(0, 100)}`); }
    }, Math.max(0, Math.min(10_000, Number(delayMs) || 0)));
    timer.unref?.();
    this.timers.add(timer);
    return timer;
  }

  scheduleInterval(fn, intervalMs, durationMs, roundId = this.state.roundId) {
    if (this.timers.size >= MAX_TIMERS) return null;
    const started = this.now();
    const timer = setInterval(() => {
      if (!this.isRoundActive(roundId) || this.now() - started >= durationMs) {
        clearInterval(timer);
        this.timers.delete(timer);
        return;
      }
      try { fn(); } catch (error) { console.warn(`[power-interval] ${String(error?.message || error).slice(0, 100)}`); }
    }, Math.max(60, Math.min(500, Number(intervalMs) || 120)));
    timer.unref?.();
    this.timers.add(timer);
    return timer;
  }

  resolveTargets(mode, { senderUserId, explicitTargetId } = {}) {
    const alive = this.players();
    const donor = this.playerById(senderUserId);
    const explicit = this.playerById(explicitTargetId);
    if (!alive.length) return { primary: null, targets: [], donor };
    const leader = [...alive].sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || String(a.id).localeCompare(String(b.id)))[0];
    const randomOne = (list) => list.length ? list[Math.min(list.length - 1, Math.floor(this.random() * list.length))] : null;
    const enemies = donor ? alive.filter((player) => player.id !== donor.id && (!this.state.settings?.teamMode || player.team !== donor.team)) : alive;
    const allies = donor ? alive.filter((player) => player.id !== donor.id && (!this.state.settings?.teamMode || player.team === donor.team)) : alive;
    let primary = null;
    let targets = [];
    switch (mode) {
      case 'SELF': primary = donor || explicit; targets = primary ? [primary] : []; break;
      case 'TARGET_PLAYER': primary = explicit || donor; targets = primary ? [primary] : []; break;
      case 'RANDOM_PLAYER': primary = randomOne(alive); targets = primary ? [primary] : []; break;
      case 'ALLY_LOWEST_HP': primary = [...allies].sort((a, b) => (Number(a.hp || 0) + Number(a.shield || 0)) - (Number(b.hp || 0) + Number(b.shield || 0)))[0] || donor; targets = primary ? [primary] : []; break;
      case 'ENEMY': primary = donor ? [...enemies].sort((a, b) => Math.hypot(a.x - donor.x, a.y - donor.y) - Math.hypot(b.x - donor.x, b.y - donor.y))[0] : leader; targets = primary ? [primary] : []; break;
      case 'LEADER': primary = leader; targets = primary ? [primary] : []; break;
      case 'RANDOM_ENEMY': primary = randomOne(enemies); targets = primary ? [primary] : []; break;
      case 'ALL_PLAYERS': targets = alive; primary = alive[0] || null; break;
      case 'GLOBAL': targets = alive; primary = explicit || leader || alive[0] || null; break;
      case 'BOSS': targets = []; primary = null; break;
      default: primary = explicit || donor || leader; targets = primary ? [primary] : [];
    }
    return { primary, targets, donor };
  }

  safeDamage(player, amount, floorHp = 10) {
    if (!player?.alive || Number(player.spawnInvulnerableUntil || 0) > this.now()) return 0;
    let remaining = Math.max(0, Number(amount) || 0);
    const absorbed = Math.min(Math.max(0, Number(player.shield) || 0), remaining);
    player.shield = Math.max(0, Number(player.shield || 0) - absorbed);
    remaining -= absorbed;
    const hpBefore = Math.max(0, Number(player.hp) || 0);
    const hpDamage = Math.min(Math.max(0, hpBefore - floorHp), remaining);
    player.hp = Math.max(floorHp, hpBefore - hpDamage);
    return absorbed + hpDamage;
  }

  push(player, fromX, fromY, distance) {
    const dx = Number(player.x || ARENA.cx) - fromX;
    const dy = Number(player.y || ARENA.cy) - fromY;
    const length = Math.hypot(dx, dy) || 1;
    player.x = clamp(player.x + dx / length * distance, ARENA.minX, ARENA.maxX);
    player.y = clamp(player.y + dy / length * distance, ARENA.minY, ARENA.maxY);
    player.targetX = player.x;
    player.targetY = player.y;
  }

  pull(player, toX, toY, strength) {
    const dx = toX - Number(player.x || ARENA.cx);
    const dy = toY - Number(player.y || ARENA.cy);
    player.x = clamp(Number(player.x || ARENA.cx) + dx * strength, ARENA.minX, ARENA.maxX);
    player.y = clamp(Number(player.y || ARENA.cy) + dy * strength, ARENA.minY, ARENA.maxY);
  }

  emit(type, payload) {
    this.publish(type, payload);
    this.telemetry?.event?.(type, payload);
  }

  execute(input = {}) {
    const startedAt = this.now();
    this.prune(startedAt);
    const eventId = clean(input.eventId, 100);
    const senderUserId = clean(input.senderUserId, 80);
    const senderUsername = clean(input.senderUsername || 'fighter', 32) || 'fighter';
    const mapping = input.mapping;
    const power = this.registry.get(mapping?.powerId);
    if (!eventId || !senderUserId) return this.reject('invalid-event', { eventId, senderUserId });
    if (this.seen.has(eventId)) return this.reject('duplicate-event', { eventId, senderUserId });
    this.seen.set(eventId, startedAt + IDEMPOTENCY_TTL_MS);
    if (this.state.phase !== 'running') return this.reject('round-not-running', { eventId, senderUserId });
    if (!mapping?.enabled) return this.reject('mapping-disabled', { eventId, senderUserId });
    if (!power || power.enabled === false) return this.reject('invalid-power', { eventId, senderUserId });

    const limits = enforcePowerLimits(power, mapping);
    const perKey = `${senderUserId}:${power.id}`;
    if ((this.cooldowns.get(perKey) || 0) > startedAt) return this.reject('cooldown', { eventId, senderUserId, cooldownUntil: this.cooldowns.get(perKey) });
    if ((this.globalCooldowns.get(power.id) || 0) > startedAt) return this.reject('global-cooldown', { eventId, senderUserId, cooldownUntil: this.globalCooldowns.get(power.id) });

    const targetInfo = this.resolveTargets(limits.targetMode, { senderUserId, explicitTargetId: input.targetUserId });
    if (!targetInfo.primary && !['GLOBAL', 'ALL_PLAYERS', 'BOSS'].includes(limits.targetMode) && power.id !== 'colossus') return this.reject('target-unavailable', { eventId, senderUserId, powerId: power.id });

    const context = {
      eventId,
      source: input.source === 'control-panel' ? 'control-panel' : 'tiktok',
      senderUserId,
      senderUsername,
      giftId: clean(input.giftId || mapping.giftId, 80),
      giftName: clean(input.giftName || mapping.giftName || mapping.giftId, 80),
      repeatCount: clamp(input.repeatCount || 1, 1, 100),
      power,
      limits,
      targetInfo,
      startedAt,
      roundId: this.state.roundId,
    };

    let result;
    try {
      result = this.applyPower(context);
    } catch (error) {
      return this.reject('power-error', { eventId, senderUserId, powerId: power.id, detail: clean(error?.message || error, 100) });
    }
    if (!result?.applied) return this.reject(result?.reason || 'not-applied', { eventId, senderUserId, powerId: power.id });

    this.cooldowns.set(perKey, startedAt + limits.cooldownMs);
    this.globalCooldowns.set(power.id, startedAt + limits.globalCooldownMs);
    const payload = {
      eventId, source: context.source, roundId: this.state.roundId,
      giftId: context.giftId, giftName: context.giftName, repeatCount: context.repeatCount,
      senderUserId, senderUsername, tier: power.category, powerId: power.id, powerName: power.name,
      targetMode: limits.targetMode, targetPlayerId: targetInfo.primary?.id || null,
      targetUsername: targetInfo.primary?.username || null,
      visualPreset: limits.visualPreset, soundPreset: limits.soundPreset, narrationPreset: limits.narrationPreset,
      magnitude: limits.magnitude, durationMs: limits.durationMs, cooldownMs: limits.cooldownMs,
      result,
    };
    this.emit('gift:applied', { ...payload, effect: power.id, visualEffect: limits.visualPreset, narrationPriority: power.category === 'premium' ? 5 : power.category === 'event' ? 3 : 2 });
    this.emit('power:executed', payload);
    this.telemetry?.timing?.('power_execution_latency', this.now() - startedAt, { 'power.id': power.id, 'gift.id': context.giftId, 'target.mode': limits.targetMode, 'round.id': this.state.roundId });
    return { status: 'applied', ...payload };
  }

  reject(reason, extra = {}) {
    const payload = { status: 'rejected', reason, ...extra };
    this.emit('power:rejected', payload);
    return payload;
  }

  applyPower(context) {
    const { power, limits, targetInfo, startedAt, roundId } = context;
    const target = targetInfo.primary;
    const alive = this.players();

    if (power.id === 'entry-boost') {
      if (!target) return { applied: false, reason: 'target-unavailable' };
      target.speedMultiplier = Math.min(1.2, Math.max(Number(target.speedMultiplier) || 1, limits.magnitude));
      target.speedBoostUntil = Math.max(Number(target.speedBoostUntil) || 0, startedAt + limits.durationMs);
      return { applied: true, speedMultiplier: target.speedMultiplier, durationMs: limits.durationMs };
    }

    if (power.id === 'tactical-shield') {
      if (!target) return { applied: false, reason: 'target-unavailable' };
      const maxHp = Math.max(1, Number(target.maxHp) || 100);
      const heal = Math.min(20, maxHp * 0.2, Math.max(0, maxHp - Number(target.hp || 0)));
      target.hp = Math.min(maxHp, Number(target.hp || 0) + heal);
      target.shield = Math.max(Number(target.shield) || 0, Math.min(20, limits.magnitude));
      target.shieldUntil = Math.max(Number(target.shieldUntil) || 0, startedAt + Math.min(5000, limits.durationMs));
      return { applied: true, heal, shield: target.shield, durationMs: Math.min(5000, limits.durationMs) };
    }

    if (power.id === 'speed') {
      if (!target) return { applied: false, reason: 'target-unavailable' };
      target.speedMultiplier = Math.min(1.5, Math.max(Number(target.speedMultiplier) || 1, limits.magnitude));
      target.speedBoostUntil = Math.max(Number(target.speedBoostUntil) || 0, startedAt + limits.durationMs);
      return { applied: true, speedMultiplier: target.speedMultiplier, durationMs: limits.durationMs };
    }

    if (power.id === 'extra-projectile') {
      const enemy = this.resolveTargets('ENEMY', { senderUserId: target?.id || context.senderUserId }).primary;
      if (!target || !enemy || enemy.id === target.id) return { applied: false, reason: 'no-target' };
      const damageApplied = this.safeDamage(enemy, limits.magnitude, 10);
      return { applied: damageApplied > 0, targetId: enemy.id, damageApplied, eliminated: false };
    }

    if (power.id === 'meteor') {
      const meteorTarget = target || alive[Math.floor(this.random() * alive.length)];
      if (!meteorTarget) return { applied: false, reason: 'no-target' };
      const warningMs = Math.max(1400, Math.min(2400, limits.durationMs || 2000));
      const hazard = { id: randomUUID(), type: 'meteor', x: meteorTarget.x, y: meteorTarget.y, targetPlayerId: meteorTarget.id, radius: 110, damage: Math.min(24, limits.magnitude), createdAt: startedAt, impactAt: startedAt + warningMs, expiresAt: startedAt + warningMs + 1400, visualEffect: limits.visualPreset, resolved: false };
      this.state.hazards = [...(this.state.hazards || []).slice(-11), hazard];
      return { applied: true, hazardId: hazard.id, hazardTargetPlayerId: meteorTarget.id, warningMs };
    }

    if (power.id === 'star-power') {
      if (!target) return { applied: false, reason: 'target-unavailable' };
      const hypeGain = Math.round(limits.magnitude);
      target.hype = clamp((Number(target.hype) || 0) + hypeGain, 0, 999);
      target.starPowerUntil = Math.max(Number(target.starPowerUntil) || 0, startedAt + limits.durationMs);
      return { applied: true, hypeGain, hype: target.hype, scoreMultiplier: 1, durationMs: limits.durationMs };
    }

    if (power.id === 'colossus') {
      if (typeof this.spawnBoss !== 'function') return { applied: false, reason: 'boss-unavailable' };
      const bossResult = this.spawnBoss({ source: context.source, now: startedAt });
      return { applied: Boolean(bossResult?.applied || bossResult?.reason === 'extended'), boss: bossResult?.boss, reason: bossResult?.reason };
    }

    if (power.id === 'black-hole') {
      const cx = target?.x ?? ARENA.cx;
      const cy = target?.y ?? ARENA.cy;
      const strength = clamp(limits.magnitude, 0.1, 0.55);
      const affected = alive.filter((player) => Math.hypot(player.x - cx, player.y - cy) <= 430);
      for (const player of affected) this.pull(player, cx, cy, strength * 0.3);
      this.scheduleInterval(() => {
        for (const player of this.players()) if (Math.hypot(player.x - cx, player.y - cy) <= 440) this.pull(player, cx, cy, strength * 0.08);
      }, 140, limits.durationMs, roundId);
      return { applied: true, x: cx, y: cy, affectedPlayerIds: affected.map((player) => player.id), durationMs: limits.durationMs };
    }

    if (power.id === 'chain-lightning') {
      if (!target) return { applied: false, reason: 'no-target' };
      const maxTargets = Math.max(1, Math.min(6, Number(power.maxTargets) || 4));
      const chosen = [target];
      while (chosen.length < maxTargets) {
        const last = chosen[chosen.length - 1];
        const next = alive.filter((player) => !chosen.includes(player) && (!targetInfo.donor || !this.state.settings?.teamMode || player.team !== targetInfo.donor.team))
          .sort((a, b) => Math.hypot(a.x - last.x, a.y - last.y) - Math.hypot(b.x - last.x, b.y - last.y))[0];
        if (!next || Math.hypot(next.x - last.x, next.y - last.y) > 360) break;
        chosen.push(next);
      }
      const hits = chosen.map((player, index) => ({ playerId: player.id, damage: this.safeDamage(player, Math.max(4, limits.magnitude * (1 - index * 0.16)), 10) }));
      return { applied: hits.some((hit) => hit.damage > 0), hits };
    }

    if (power.id === 'neon-tornado') {
      const cx = target?.x ?? ARENA.cx;
      const cy = target?.y ?? ARENA.cy;
      const affected = alive.filter((player) => Math.hypot(player.x - cx, player.y - cy) <= 420);
      for (const player of affected) {
        const angle = Math.atan2(player.y - cy, player.x - cx) + Math.PI / 2;
        player.x = clamp(player.x + Math.cos(angle) * limits.magnitude, ARENA.minX, ARENA.maxX);
        player.y = clamp(player.y + Math.sin(angle) * limits.magnitude, ARENA.minY, ARENA.maxY);
        player.targetX = player.x; player.targetY = player.y;
      }
      return { applied: true, x: cx, y: cy, affectedPlayerIds: affected.map((player) => player.id), durationMs: limits.durationMs };
    }

    if (power.id === 'orbital-laser') {
      if (!target) return { applied: false, reason: 'no-target' };
      const warningMs = Math.max(900, limits.durationMs);
      const x = target.x, y = target.y, targetId = target.id;
      this.emit('power:warning', { powerId: power.id, eventId: context.eventId, x, y, radius: 105, impactAt: startedAt + warningMs, targetPlayerId: targetId });
      const scheduled = this.schedule(() => {
        const hits = [];
        for (const player of this.players()) {
          if (Math.hypot(player.x - x, player.y - y) > 105) continue;
          const damage = this.safeDamage(player, limits.magnitude, 10);
          if (damage) hits.push({ playerId: player.id, damage });
        }
        this.emit('power:completed', { powerId: power.id, eventId: context.eventId, x, y, hits });
      }, warningMs, roundId);
      return { applied: Boolean(scheduled), scheduled: true, x, y, targetPlayerId: targetId, warningMs };
    }

    if (power.id === 'time-freeze') {
      const affected = targetInfo.targets.length ? targetInfo.targets : alive;
      const anchors = new Map(affected.map((player) => [player.id, { x: player.x, y: player.y }]));
      this.scheduleInterval(() => {
        for (const player of this.players()) {
          const anchor = anchors.get(player.id);
          if (!anchor) continue;
          const keep = clamp(1 - limits.magnitude, 0.45, 0.75);
          player.x = anchor.x + (player.x - anchor.x) * keep;
          player.y = anchor.y + (player.y - anchor.y) * keep;
          player.targetX = player.x; player.targetY = player.y;
        }
      }, 80, limits.durationMs, roundId);
      return { applied: true, affectedPlayerIds: affected.map((player) => player.id), slowFactor: limits.magnitude, durationMs: limits.durationMs };
    }

    if (power.id === 'shockwave') {
      const origin = targetInfo.donor || target;
      if (!origin) return { applied: false, reason: 'no-origin' };
      const affected = alive.filter((player) => player.id !== origin.id && Math.hypot(player.x - origin.x, player.y - origin.y) <= 360);
      for (const player of affected) this.push(player, origin.x, origin.y, limits.magnitude);
      return { applied: true, originPlayerId: origin.id, affectedPlayerIds: affected.map((player) => player.id) };
    }

    if (power.id === 'gravity-bomb') {
      const cx = target?.x ?? ARENA.cx;
      const cy = target?.y ?? ARENA.cy;
      const warningMs = Math.max(1200, limits.durationMs);
      this.emit('power:warning', { powerId: power.id, eventId: context.eventId, x: cx, y: cy, radius: 220, impactAt: startedAt + warningMs });
      for (const player of alive) if (Math.hypot(player.x - cx, player.y - cy) <= 360) this.pull(player, cx, cy, 0.2);
      this.schedule(() => {
        for (const player of this.players()) if (Math.hypot(player.x - cx, player.y - cy) <= 330) this.pull(player, cx, cy, 0.28);
      }, Math.floor(warningMs / 2), roundId);
      const scheduled = this.schedule(() => {
        const hits = [];
        for (const player of this.players()) {
          const distance = Math.hypot(player.x - cx, player.y - cy);
          if (distance > 220) continue;
          const damage = this.safeDamage(player, limits.magnitude, 10);
          this.push(player, cx, cy, 120);
          if (damage) hits.push({ playerId: player.id, damage });
        }
        this.emit('power:completed', { powerId: power.id, eventId: context.eventId, x: cx, y: cy, hits });
      }, warningMs, roundId);
      return { applied: Boolean(scheduled), scheduled: true, x: cx, y: cy, warningMs };
    }

    if (power.id === 'supernova') {
      const warningMs = Math.max(1800, limits.durationMs);
      this.emit('power:warning', { powerId: power.id, eventId: context.eventId, x: ARENA.cx, y: ARENA.cy, radius: 560, impactAt: startedAt + warningMs, ultimate: true });
      const scheduled = this.schedule(() => {
        const hits = this.players().map((player) => ({ playerId: player.id, damage: this.safeDamage(player, limits.magnitude, 10) }));
        this.emit('power:completed', { powerId: power.id, eventId: context.eventId, x: ARENA.cx, y: ARENA.cy, hits, ultimate: true });
      }, warningMs, roundId);
      return { applied: Boolean(scheduled), scheduled: true, warningMs, nonLethalFloorHp: 10 };
    }

    return { applied: false, reason: 'unsupported-power' };
  }

  cancelPending() {
    const pending = this.timers.size;
    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers.clear();
    return pending;
  }

  dispose() {
    this.cancelPending();
    this.seen.clear();
    this.cooldowns.clear();
    this.globalCooldowns.clear();
  }
}

export const powerExecutorConstants = Object.freeze({ IDEMPOTENCY_TTL_MS, MAX_TIMERS, ARENA });
