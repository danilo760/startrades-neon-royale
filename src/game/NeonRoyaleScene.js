import { GameScene as BaseGameScene } from './GameScene.js';
import { applyArenaVisuals, createArenaVisuals, destroyArenaVisuals, drawArenaStorm } from './ArenaVisuals.js';
import { decorateCombatant, updateCombatantVisuals } from './CombatantVisuals.js';
import { destroyColossus, renderColossusAttack, syncColossus } from './ColossusVisuals.js';
import { playLayeredSfx, stopAudioLayers } from './AudioLayers.js';

const bossAttackSound = (pattern = '') => /METEOR/i.test(pattern) ? 'meteor' : /LASER|BEAM/i.test(pattern) ? 'laser-charge' : /OVERLOAD/i.test(pattern) ? 'boss-overload' : 'boss-phase';

export class GameScene extends BaseGameScene {
  drawArena() { createArenaVisuals(this); }

  applyArenaTheme(name = 'default') { applyArenaVisuals(this, name); }

  drawStorm(value) { drawArenaStorm(this, value); }

  ensureFighter(player) {
    const fighter = super.ensureFighter(player);
    return fighter ? decorateCombatant(this, fighter, player) : fighter;
  }

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
    if (event.reason === 'phase-warning') playLayeredSfx(bossAttackSound(event.pattern));
    else if (event.reason === 'phase-impact' && /METEOR|NOVA|SLAM|PULSE/i.test(event.pattern || '')) playLayeredSfx(/METEOR/i.test(event.pattern) ? 'meteor' : 'critical');
    if (!renderColossusAttack(this, event)) super.renderBossAttack(event);
  }

  update(time, delta) {
    super.update(time, delta);
    if (!this.state || this.juice?.isHitStopped()) return;
    for (const fighter of this.fighters.values()) updateCombatantVisuals(this, fighter, time);
  }

  cleanupScene() {
    stopAudioLayers();
    destroyColossus(this);
    destroyArenaVisuals(this);
    super.cleanupScene();
  }
}

export const NeonRoyaleScene = GameScene;
