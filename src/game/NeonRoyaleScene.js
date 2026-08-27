import { GameScene } from './GameScene.js';
import { applyArenaVisuals, createArenaVisuals, destroyArenaVisuals, drawArenaStorm } from './ArenaVisuals.js';
import { decorateCombatant, updateCombatantVisuals } from './CombatantVisuals.js';

export class NeonRoyaleScene extends GameScene {
  drawArena() { createArenaVisuals(this); }

  applyArenaTheme(name = 'default') { applyArenaVisuals(this, name); }

  drawStorm(value) { drawArenaStorm(this, value); }

  ensureFighter(player) {
    const fighter = super.ensureFighter(player);
    return fighter ? decorateCombatant(this, fighter, player) : fighter;
  }

  update(time, delta) {
    super.update(time, delta);
    if (!this.state || this.juice?.isHitStopped()) return;
    for (const fighter of this.fighters.values()) updateCombatantVisuals(this, fighter, time);
  }

  cleanupScene() {
    destroyArenaVisuals(this);
    super.cleanupScene();
  }
}
