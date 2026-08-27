const PHASES = Object.freeze({
  1: { id: 1, name: 'DESPERTAR', attackIntervalMs: 9000, radius: 105, damage: 12 },
  2: { id: 2, name: 'FÚRIA NEON', attackIntervalMs: 6500, radius: 125, damage: 16 },
  3: { id: 3, name: 'NÚCLEO CRÍTICO', attackIntervalMs: 4500, radius: 145, damage: 20 },
});
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

export class BossPhaseDirector {
  constructor({ state, publish = () => {}, now = () => Date.now() } = {}) {
    this.state = state;
    this.publish = publish;
    this.now = now;
    this.bossId = null;
    this.phase = 0;
    this.lastPhaseAttackAt = 0;
    this.overload = null;
    this.overloadUsedForBoss = null;
  }

  calculatePhase(boss) {
    const ratio = Number(boss?.hp || 0) / Math.max(1, Number(boss?.maxHp) || 1);
    return ratio <= 0.33 ? 3 : ratio <= 0.66 ? 2 : 1;
  }

  safeDamage(player, amount) {
    if (!player?.alive) return 0;
    let remaining = Math.max(0, Number(amount) || 0);
    const absorbed = Math.min(Number(player.shield || 0), remaining);
    player.shield = Math.max(0, Number(player.shield || 0) - absorbed);
    remaining -= absorbed;
    const hpBefore = Number(player.hp || 0);
    const hpDamage = Math.min(Math.max(0, hpBefore - 10), remaining);
    player.hp = Math.max(10, hpBefore - hpDamage);
    return absorbed + hpDamage;
  }

  resetForBoss(boss, now) {
    this.bossId = boss?.id || null;
    this.phase = 0;
    this.lastPhaseAttackAt = now;
    this.overload = null;
  }

  tick(now = this.now()) {
    const boss = this.state?.boss;
    if (!boss?.active) {
      this.bossId = null;
      this.phase = 0;
      this.overload = null;
      return null;
    }
    if (boss.id !== this.bossId) this.resetForBoss(boss, now);
    const nextPhase = this.calculatePhase(boss);
    boss.phase = nextPhase;
    boss.phaseName = PHASES[nextPhase].name;
    if (nextPhase !== this.phase) {
      const previousPhase = this.phase;
      this.phase = nextPhase;
      this.lastPhaseAttackAt = now;
      this.publish('boss:phase', { bossId: boss.id, previousPhase, phase: nextPhase, name: PHASES[nextPhase].name, hp: boss.hp, maxHp: boss.maxHp });
    }

    const phase = PHASES[nextPhase];
    if (nextPhase >= 2 && now - this.lastPhaseAttackAt >= phase.attackIntervalMs) {
      this.lastPhaseAttackAt = now;
      this.phaseAttack(boss, phase, now);
    }

    const ratio = Number(boss.hp || 0) / Math.max(1, Number(boss.maxHp) || 1);
    if (ratio <= 0.12 && this.overloadUsedForBoss !== boss.id && !this.overload) {
      this.overload = { bossId: boss.id, startedAt: now, dueAt: now + 5000, lastCountdown: 6 };
    }
    if (this.overload?.bossId === boss.id) this.tickOverload(boss, now);
    return { phase: nextPhase, overload: this.overload ? { ...this.overload } : null };
  }

  phaseAttack(boss, phase, now) {
    const alive = (this.state.players || []).filter((player) => player.alive);
    if (!alive.length) return;
    const target = [...alive].sort((a, b) => Math.hypot(a.x - boss.x, a.y - boss.y) - Math.hypot(b.x - boss.x, b.y - boss.y))[0];
    const attackId = `phase-${boss.id}-${now}`;
    const warningMs = phase.id === 3 ? 900 : 1200;
    const attack = { attackId, bossId: boss.id, phase: phase.id, pattern: phase.id === 2 ? 'LASER_STOMP' : 'CRITICAL_PULSE', x: target.x, y: target.y, radius: phase.radius, damage: phase.damage, impactAt: now + warningMs, targetPlayerId: target.id };
    this.publish('boss:phase-attack-warning', attack);
    setTimeout(() => {
      if (!this.state?.boss?.active || this.state.boss.id !== boss.id) return;
      const hits = [];
      for (const player of (this.state.players || []).filter((item) => item.alive)) {
        if (Math.hypot(player.x - attack.x, player.y - attack.y) > attack.radius) continue;
        const damage = this.safeDamage(player, attack.damage);
        if (damage) hits.push({ playerId: player.id, damage });
      }
      this.publish('boss:phase-attack', { ...attack, hits, resolvedAt: this.now() });
    }, warningMs).unref?.();
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
    this.publish('boss:overload', { bossId: boss.id, phase: boss.phase, hits, nonLethalFloorHp: 10, resolvedAt: now });
    this.overload = null;
  }
}

export const bossPhaseDefinitions = PHASES;
