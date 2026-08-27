import { GameScene as BaseGameScene } from './GameScene.js';
import { applyArenaVisuals, createArenaVisuals, destroyArenaVisuals, drawArenaStorm } from './ArenaVisuals.js';
import { decorateCombatant, updateCombatantVisuals } from './CombatantVisuals.js';
import { destroyColossus, renderColossusAttack, syncColossus } from './ColossusVisuals.js';
import { playLayeredSfx, stopAudioLayers } from './AudioLayers.js';
import { ArenaDirector } from './ArenaDirector.js';
import { PerformanceWatchdog } from './PerformanceWatchdog.js';

const bossAttackSound = (pattern = '') => /METEOR/i.test(pattern) ? 'meteor' : /LASER|BEAM/i.test(pattern) ? 'laser-charge' : /OVERLOAD/i.test(pattern) ? 'boss-overload' : 'boss-phase';
const normalizeManualQuality = (value = 'NORMAL') => {
  const mode = String(value || 'NORMAL').toUpperCase();
  if (['BAIXA', 'LOW', 'REDUCED'].includes(mode)) return 'LOW';
  if (['ALTA', 'HIGH'].includes(mode)) return 'HIGH';
  if (mode === 'EMERGENCY') return 'EMERGENCY';
  return 'NORMAL';
};
const selectedPerformanceMode = (scene) => {
  const stored = typeof localStorage !== 'undefined' ? String(localStorage.getItem('neon-effect-mode') || '').toUpperCase() : '';
  if (['AUTO', 'BAIXA', 'NORMAL', 'ALTA', 'LOW', 'HIGH', 'EMERGENCY'].includes(stored)) return stored;
  return String(scene.state?.settings?.effectIntensity || 'AUTO').toUpperCase();
};

export class GameScene extends BaseGameScene {
  constructor(bridge) {
    super(bridge);
    this.arenaDirector = new ArenaDirector();
    this.presentation = this.arenaDirector.status();
    this.performanceWatchdog = new PerformanceWatchdog();
    this.performanceDiagnostics = this.performanceWatchdog.status();
    this.effectiveEffectIntensity = 'NORMAL';
  }

  drawArena() { createArenaVisuals(this); }

  applyArenaTheme(name = 'default') { applyArenaVisuals(this, name); }

  drawStorm(value) { drawArenaStorm(this, value); }

  syncState(next) {
    super.syncState(next);
    if (next) this.presentation = this.arenaDirector.update(next);
  }

  ensureFighter(player) {
    const fighter = super.ensureFighter(player);
    return fighter ? decorateCombatant(this, fighter, player) : fighter;
  }

  present(kind, payload, run) { return this.arenaDirector.enqueue(kind, payload, run); }

  triggerGift(event = {}) {
    this.arenaDirector.observe('gift:applied');
    const kind = event.tier === 'premium' ? 'gift-premium' : event.tier === 'event' ? 'gift-event' : 'gift-support';
    this.present(kind, event, () => super.triggerGift(event));
  }

  battleStart() { this.present('storm', {}, () => super.battleStart()); }
  battleEnd(winner) { this.present('victory', { winner }, () => super.battleEnd(winner)); }
  suddenDeath() { this.present('sudden-death', {}, () => super.suddenDeath()); }
  stormSurge(value) { this.present('storm', { value }, () => super.stormSurge(value)); }
  likeBurst() { this.present('like', {}, () => super.likeBurst()); }

  syncBoss(boss) {
    const previous = this.audioBossState || { active: false, phase: 0, critical: false };
    const phase = Number(boss?.phase) || 0;
    const critical = Boolean(boss?.active && Number(boss.hp || 0) / Math.max(1, Number(boss.maxHp || 1)) <= 0.12);
    if (boss?.active && !previous.active) playLayeredSfx('boss-spawn');
    else if (boss?.active && phase && previous.phase && phase !== previous.phase) playLayeredSfx(phase === 3 ? 'boss-critical' : 'boss-phase');
    if (critical && !previous.critical) playLayeredSfx('boss-critical');
    if (!boss?.active && previous.active) playLayeredSfx('boss-death');
    this.audioBossState = { active: Boolean(boss?.active), phase, critical };
    syncColossus(this, boss);
  }

  renderBossAttack(event = {}) {
    const warning = event.reason === 'phase-warning';
    const kind = warning ? 'boss-warning' : Number(event.phase) === 3 ? 'boss-critical' : 'boss-impact';
    this.present(kind, event, () => {
      if (event.reason === 'phase-warning') playLayeredSfx(bossAttackSound(event.pattern));
      else if (event.reason === 'phase-impact' && /METEOR|NOVA|SLAM|PULSE/i.test(event.pattern || '')) playLayeredSfx(/METEOR/i.test(event.pattern) ? 'meteor' : 'critical');
      if (!renderColossusAttack(this, event)) super.renderBossAttack(event);
    });
  }

  updatePerformance(delta) {
    const children = this.children?.list?.length || 0;
    const projectiles = Number(this.projectiles?.children?.size || this.projectilePool?.children?.size || this.shots?.size || 0);
    const diagnostics = this.performanceWatchdog.sample(delta, {
      players: this.state?.players?.length || 0,
      projectiles,
      vfx: children,
    });
    this.performanceDiagnostics = diagnostics;
    const mode = selectedPerformanceMode(this);
    const next = mode === 'AUTO' ? diagnostics.level : normalizeManualQuality(mode);
    const qualityChanged = next !== this.effectiveEffectIntensity;
    this.effectiveEffectIntensity = next;
    if (qualityChanged && this.arenaBase) applyArenaVisuals(this, this.state?.settings?.arenaBackground || 'default');
    if (typeof window !== 'undefined') window.__NEON_PERF__ = { ...diagnostics, requestedMode: mode, effectiveLevel: next, arenaDirector: this.presentation?.level || 'CALM' };
  }

  update(time, delta) {
    super.update(time, delta);
    if (!this.state || this.juice?.isHitStopped()) return;
    this.presentation = this.arenaDirector.update(this.state);
    this.updatePerformance(delta);
    for (const fighter of this.fighters.values()) updateCombatantVisuals(this, fighter, time);
  }

  cleanupScene() {
    this.arenaDirector.clear();
    stopAudioLayers();
    destroyColossus(this);
    destroyArenaVisuals(this);
    if (typeof window !== 'undefined') delete window.__NEON_PERF__;
    super.cleanupScene();
  }
}

export const NeonRoyaleScene = GameScene;
