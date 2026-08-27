const PHASES = Object.freeze({
  1: { id: 1, name: 'DESPERTAR', attackIntervalMs: 8200, weakPointRatio: 0.055, attacks: ['GROUND_SLAM', 'TARGET_MISSILE', 'LASER_SWEEP'] },
  2: { id: 2, name: 'FÚRIA NEON', attackIntervalMs: 6200, weakPointRatio: 0.07, attacks: ['DOUBLE_LASER', 'METEOR_RAIN', 'SHIELD_CORE'] },
  3: { id: 3, name: 'NÚCLEO CRÍTICO', attackIntervalMs: 4400, weakPointRatio: 0.08, attacks: ['ROTATING_BEAMS', 'GRAVITY_PULSE', 'MINI_NOVA'] },
});
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const DEFAULT_CORE_WINDOW_MS = 6000;

const defaultSchedule = (fn, delayMs) => {
  const timer = setTimeout(fn, Math.max(0, Number(delayMs) || 0));
  timer.unref?.();
  return timer;
};

export class BossPhaseDirector {
  constructor({ state, publish = () => {}, now = () => Date.now(), schedule = defaultSchedule } = {}) {
    this.state = state;
    this.publish = publish;
    this.now = now;
    this.schedule = schedule;
    this.bossId = null;
    this.phase = 0;
    this.lastPhaseAttackAt = 0;
    this.attackCursor = new Map();
    this.overload = null;
    this.overloadUsedForBoss = null;
    this.lastObservedBossHp = null;
  }

  calculatePhase(boss) {
    const ratio = Number(boss?.hp || 0) / Math.max(1, Number(boss?.maxHp) || 1);
    return ratio <= 0.33 ? 3 : ratio <= 0.66 ? 2 : 1;
  }

  safeDamage(player, amount) {
    if (!player?.alive) return 0;
    let remaining = Math.max(0, Number(amount) || 0);
    const absorbed = Math.min(Math.max(0, Number(player.shield) || 0), remaining);
    player.shield = Math.max(0, Number(player.shield || 0) - absorbed);
    remaining -= absorbed;
    const hpBefore = Math.max(0, Number(player.hp) || 0);
    const hpDamage = Math.min(Math.max(0, hpBefore - 10), remaining);
    player.hp = Math.max(10, hpBefore - hpDamage);
    return absorbed + hpDamage;
  }

  weakPointHp(boss, phase = this.calculatePhase(boss)) {
    return Math.max(70, Math.round(Number(boss.maxHp || 1000) * PHASES[phase].weakPointRatio));
  }

  buildWeakPoints(boss, phase = this.calculatePhase(boss)) {
    const hp = this.weakPointHp(boss, phase);
    return [
      { id: 'leftArm', label: 'BRAÇO ESQUERDO', hp, maxHp: hp, active: true },
      { id: 'rightArm', label: 'BRAÇO DIREITO', hp, maxHp: hp, active: true },
    ];
  }

  resetForBoss(boss, now) {
    this.bossId = boss?.id || null;
    this.phase = 0;
    this.lastPhaseAttackAt = now;
    this.attackCursor.clear();
    this.overload = null;
    this.lastObservedBossHp = Number(boss?.hp || 0);
    if (!Array.isArray(boss.weakPoints) || boss.weakPoints.length !== 2) boss.weakPoints = this.buildWeakPoints(boss);
    boss.armorActive = boss.weakPoints.some((point) => point.active);
    boss.coreOpen = Boolean(boss.coreOpen);
    boss.coreOpenUntil = Number(boss.coreOpenUntil) || 0;
    boss.animationState = 'SPAWN';
  }

  syncArmorDamage(boss, now) {
    if (!Number.isFinite(this.lastObservedBossHp)) this.lastObservedBossHp = Number(boss.hp || 0);
    const currentHp = Number(boss.hp || 0);
    const observedDamage = Math.max(0, this.lastObservedBossHp - currentHp);
    if (observedDamage > 0 && boss.armorActive && !boss.coreOpen) {
      boss.hp = Math.min(Number(boss.maxHp || currentHp), currentHp + observedDamage);
      const target = boss.weakPoints?.find((point) => point.active);
      if (target) {
        const before = target.hp;
        target.hp = Math.max(0, Number(target.hp || 0) - observedDamage);
        if (before > 0 && target.hp <= 0) {
          target.active = false;
          this.publish('boss:weakpoint-broken', { bossId: boss.id, weakPointId: target.id, label: target.label, phase: boss.phase, at: now });
        }
      }
      boss.armorActive = boss.weakPoints?.some((point) => point.active) || false;
      if (!boss.armorActive) this.openCore(boss, now, 'weakpoints-destroyed');
    }
    if (boss.coreOpen && boss.coreOpenUntil > 0 && now >= boss.coreOpenUntil) this.closeCore(boss, now);
    this.lastObservedBossHp = Number(boss.hp || 0);
  }

  openCore(boss, now, reason = 'system') {
    boss.coreOpen = true;
    boss.armorActive = false;
    boss.coreOpenUntil = now + DEFAULT_CORE_WINDOW_MS;
    boss.animationState = 'RAGE';
    this.publish('boss:core-opened', { bossId: boss.id, phase: boss.phase, reason, coreOpenUntil: boss.coreOpenUntil });
  }

  closeCore(boss, now) {
    const ratio = Number(boss.hp || 0) / Math.max(1, Number(boss.maxHp) || 1);
    if (ratio <= 0.12) {
      boss.coreOpenUntil = 0;
      boss.coreOpen = true;
      boss.armorActive = false;
      return;
    }
    boss.coreOpen = false;
    boss.coreOpenUntil = 0;
    boss.weakPoints = this.buildWeakPoints(boss, this.calculatePhase(boss));
    boss.armorActive = true;
    boss.animationState = 'IDLE';
    this.publish('boss:core-closed', { bossId: boss.id, phase: boss.phase, rearmed: true, at: now });
  }

  tick(now = this.now()) {
    const boss = this.state?.boss;
    if (!boss?.active) {
      this.bossId = null;
      this.phase = 0;
      this.overload = null;
      this.lastObservedBossHp = null;
      return null;
    }
    if (boss.id !== this.bossId) this.resetForBoss(boss, now);

    this.syncArmorDamage(boss, now);
    const nextPhase = this.calculatePhase(boss);
    boss.phase = nextPhase;
    boss.phaseName = PHASES[nextPhase].name;
    boss.lastAttackAt = now; // BossPhaseDirector owns cinematic attacks; suppresses legacy generic attack in production.
    if (nextPhase !== this.phase) {
      const previousPhase = this.phase;
      this.phase = nextPhase;
      this.lastPhaseAttackAt = now;
      boss.animationState = 'PHASE_CHANGE';
      this.publish('boss:phase', { bossId: boss.id, previousPhase, phase: nextPhase, name: PHASES[nextPhase].name, hp: boss.hp, maxHp: boss.maxHp, weakPoints: boss.weakPoints, coreOpen: boss.coreOpen });
    }

    const phase = PHASES[nextPhase];
    if (now - this.lastPhaseAttackAt >= phase.attackIntervalMs) {
      this.lastPhaseAttackAt = now;
      this.phaseAttack(boss, phase, now);
    }

    const ratio = Number(boss.hp || 0) / Math.max(1, Number(boss.maxHp) || 1);
    if (ratio <= 0.12) {
      if (!boss.coreOpen) this.openCore(boss, now, 'critical-phase');
      boss.coreOpenUntil = 0;
      boss.armorActive = false;
      if (this.overloadUsedForBoss !== boss.id && !this.overload) this.overload = { bossId: boss.id, startedAt: now, dueAt: now + 5000, lastCountdown: 6 };
    }
    if (this.overload?.bossId === boss.id) this.tickOverload(boss, now);
    this.lastObservedBossHp = Number(boss.hp || 0);
    return { phase: nextPhase, weakPoints: boss.weakPoints, coreOpen: boss.coreOpen, overload: this.overload ? { ...this.overload } : null };
  }

  nextPattern(phase) {
    const index = this.attackCursor.get(phase.id) || 0;
    this.attackCursor.set(phase.id, (index + 1) % phase.attacks.length);
    return phase.attacks[index % phase.attacks.length];
  }

  phaseAttack(boss, phase, now) {
    const alive = (this.state.players || []).filter((player) => player.alive);
    if (!alive.length) return;
    const pattern = this.nextPattern(phase);
    const target = [...alive].sort((a, b) => Math.hypot(a.x - boss.x, a.y - boss.y) - Math.hypot(b.x - boss.x, b.y - boss.y))[0];
    const specs = this.attackSpec(pattern, boss, target, alive, now);
    const attack = { attackId: `phase-${boss.id}-${now}-${pattern}`, bossId: boss.id, phase: phase.id, phaseName: phase.name, pattern, targetPlayerId: target?.id || null, ...specs };
    boss.animationState = 'ATTACK';
    boss.attackPattern = pattern;
    this.publish('boss:phase-attack-warning', attack);
    this.publish('boss:attacked', { ...attack, reason: 'phase-warning' });
    this.schedule(() => this.resolveAttack(boss.id, attack), attack.warningMs);
  }

  attackSpec(pattern, boss, target, alive, now) {
    const common = { x: target?.x ?? boss.x, y: target?.y ?? boss.y, impactAt: now + 1400, warningMs: 1400, damage: 14, radius: 120 };
    switch (pattern) {
      case 'GROUND_SLAM': return { ...common, x: boss.x, y: boss.y, warningMs: 1500, impactAt: now + 1500, radius: 185, damage: 12 };
      case 'TARGET_MISSILE': return { ...common, warningMs: 1800, impactAt: now + 1800, radius: 92, damage: 16 };
      case 'LASER_SWEEP': return { ...common, warningMs: 1500, impactAt: now + 1500, axis: 'horizontal', band: 48, damage: 13 };
      case 'DOUBLE_LASER': return { ...common, warningMs: 1300, impactAt: now + 1300, axis: 'cross', band: 42, damage: 16 };
      case 'METEOR_RAIN': return { ...common, warningMs: 1700, impactAt: now + 1700, radius: 78, damage: 17, points: alive.slice(0, 4).map((player) => ({ x: player.x, y: player.y, playerId: player.id })) };
      case 'SHIELD_CORE': return { ...common, warningMs: 1100, impactAt: now + 1100, radius: 0, damage: 0 };
      case 'ROTATING_BEAMS': return { ...common, x: boss.x, y: boss.y, warningMs: 1100, impactAt: now + 1100, axis: 'rotating-cross', band: 50, damage: 18 };
      case 'GRAVITY_PULSE': return { ...common, x: boss.x, y: boss.y, warningMs: 1300, impactAt: now + 1300, radius: 260, damage: 17, pull: 0.18 };
      case 'MINI_NOVA': return { ...common, x: boss.x, y: boss.y, warningMs: 1600, impactAt: now + 1600, radius: 330, damage: 20 };
      default: return common;
    }
  }

  resolveAttack(bossId, attack) {
    const boss = this.state?.boss;
    if (!boss?.active || boss.id !== bossId) return;
    const now = this.now();
    const hits = [];
    if (attack.pattern === 'SHIELD_CORE') {
      boss.coreOpen = false;
      boss.coreOpenUntil = 0;
      boss.weakPoints = this.buildWeakPoints(boss, boss.phase);
      boss.armorActive = true;
      this.publish('boss:core-shielded', { bossId, phase: boss.phase, weakPoints: boss.weakPoints, resolvedAt: now });
    } else {
      for (const player of (this.state.players || []).filter((item) => item.alive)) {
        if (!this.attackHitsPlayer(attack, player, boss)) continue;
        const damage = this.safeDamage(player, attack.damage);
        if (attack.pattern === 'GRAVITY_PULSE') {
          player.x = clamp(player.x + (boss.x - player.x) * attack.pull, 55, 1225);
          player.y = clamp(player.y + (boss.y - player.y) * attack.pull, 55, 665);
          player.targetX = player.x; player.targetY = player.y;
        }
        if (damage) hits.push({ playerId: player.id, damage });
      }
    }
    boss.animationState = 'IDLE';
    const payload = { ...attack, hits, nonLethalFloorHp: 10, resolvedAt: now };
    this.publish('boss:phase-attack', payload);
    this.publish('boss:attacked', { ...payload, reason: 'phase-impact' });
  }

  attackHitsPlayer(attack, player, boss) {
    if (attack.points?.length) return attack.points.some((point) => Math.hypot(player.x - point.x, player.y - point.y) <= attack.radius);
    if (attack.axis === 'horizontal') return Math.abs(player.y - attack.y) <= attack.band;
    if (attack.axis === 'cross' || attack.axis === 'rotating-cross') return Math.abs(player.x - boss.x) <= attack.band || Math.abs(player.y - boss.y) <= attack.band;
    return Math.hypot(player.x - attack.x, player.y - attack.y) <= Number(attack.radius || 0);
  }

  tickOverload(boss, now) {
    const seconds = Math.max(0, Math.ceil((this.overload.dueAt - now) / 1000));
    if (seconds > 0 && seconds < this.overload.lastCountdown) {
      this.overload.lastCountdown = seconds;
      this.publish('boss:overload-warning', { bossId: boss.id, countdown: seconds, dueAt: this.overload.dueAt, phase: boss.phase });
      return;
    }
    if (now < this.overload.dueAt) return;
    const hits = [];
    for (const player of (this.state.players || []).filter((item) => item.alive)) {
      const damage = this.safeDamage(player, 26);
      const dx = player.x - boss.x, dy = player.y - boss.y, length = Math.hypot(dx, dy) || 1;
      player.x = clamp(player.x + dx / length * 120, 55, 1225);
      player.y = clamp(player.y + dy / length * 120, 55, 665);
      player.targetX = player.x; player.targetY = player.y;
      if (damage) hits.push({ playerId: player.id, damage });
    }
    this.overloadUsedForBoss = boss.id;
    boss.animationState = 'OVERLOAD';
    this.publish('boss:overload', { bossId: boss.id, phase: boss.phase, hits, nonLethalFloorHp: 10, resolvedAt: now });
    this.overload = null;
  }
}

export const bossPhaseDefinitions = PHASES;
