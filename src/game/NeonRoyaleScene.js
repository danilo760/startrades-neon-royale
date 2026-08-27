import { GameScene as BaseGameScene } from './GameScene.js';
import { applyArenaVisuals, createArenaVisuals, destroyArenaVisuals, drawArenaStorm } from './ArenaVisuals.js';
import { decorateCombatant, updateCombatantVisuals } from './CombatantVisuals.js';
import { destroyColossus, renderColossusAttack, syncColossus } from './ColossusVisuals.js';
import { playLayeredSfx, stopAudioLayers } from './AudioLayers.js';
import { ArenaDirector } from './ArenaDirector.js';

const bossAttackSound = (pattern = '') => /METEOR/i.test(pattern) ? 'meteor' : /LASER|BEAM/i.test(pattern) ? 'laser-charge' : /OVERLOAD/i.test(pattern) ? 'boss-overload' : 'boss-phase';

export class GameScene extends BaseGameScene {
  constructor(bridge) {
    super(bridge);
    this.arenaDirector = new ArenaDirector();
    this.presentation = this.arenaDirector.status();
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

  present(kind, payload, run) {
    return this.arenaDirector.enqueue(kind, payload, run);
  }

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

  update(time, delta) {
    super.update(time, delta);
    if (!this.state || this.juice?.isHitStopped()) return;
    this.presentation = this.arenaDirector.update(this.state);
    for (const fighter of this.fighters.values()) updateCombatantVisuals(this, fighter, time);
  }

  cleanupScene() {
    this.arenaDirector.clear();
    stopAudioLayers();
    destroyColossus(this);
    destroyArenaVisuals(this);
    super.cleanupScene();
  }
}

export const NeonRoyaleScene = GameScene;
