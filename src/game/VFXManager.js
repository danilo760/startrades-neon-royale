import Phaser from 'phaser';

export class VFXManager {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.bloomed = new WeakSet();
    this.maxPool = 180;
    this.makeSparkTexture();
  }

  makeSparkTexture() {
    if (this.scene.textures.exists('neon-spark')) return;
    const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1).fillCircle(8, 8, 8);
    g.generateTexture('neon-spark', 16, 16);
    g.destroy();
  }

  acquire() {
    let dot = this.pool.find((item) => !item.active);
    if (!dot && this.pool.length < this.maxPool) {
      dot = this.scene.add.image(-100, -100, 'neon-spark')
        .setVisible(false)
        .setActive(false)
        .setDepth(1500)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.pool.push(dot);
    }
    return dot || null;
  }

  release(dot) {
    if (!dot) return;
    this.scene.tweens.killTweensOf(dot);
    dot.setVisible(false).setActive(false).setPosition(-100, -100).setScale(1).setAlpha(1).setTint(0xffffff);
  }

  burst(x, y, color = 0x2cefff, quantity = 18, distance = 100, duration = 560) {
    const count = Math.min(Math.max(1, quantity), 40);
    for (let i = 0; i < count; i++) {
      const dot = this.acquire();
      if (!dot) break;
      const angle = Math.PI * 2 * i / count + (Math.random() - 0.5) * 0.36;
      const travel = distance * (0.45 + Math.random() * 0.55);
      dot.setPosition(x, y)
        .setTint(color)
        .setScale(0.22 + Math.random() * 0.5)
        .setAlpha(0.95)
        .setVisible(true)
        .setActive(true);
      this.scene.tweens.add({
        targets: dot,
        x: x + Math.cos(angle) * travel,
        y: y + Math.sin(angle) * travel,
        scale: 0,
        alpha: 0,
        duration: duration * (0.7 + Math.random() * 0.5),
        ease: 'Cubic.easeOut',
        onComplete: () => this.release(dot),
      });
    }
  }

  trail(x, y, color = 0x2cefff, scale = 0.45) {
    const dot = this.acquire();
    if (!dot) return;
    dot.setPosition(x, y).setTint(color).setScale(scale).setAlpha(0.65).setVisible(true).setActive(true);
    this.scene.tweens.add({ targets: dot, y: y + 12, scale: 0, alpha: 0, duration: 330, onComplete: () => this.release(dot) });
  }

  ring(x, y, color = 0x2cefff, radius = 28, scale = 2.6, duration = 620, width = 4) {
    const ring = this.scene.add.circle(x, y, radius, color, 0.04).setStrokeStyle(width, color, 0.95).setDepth(1450).setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({ targets: ring, scale, alpha: 0, duration, ease: 'Sine.easeOut', onComplete: () => ring.destroy() });
    return ring;
  }

  damageNumber(x, y, amount, options = {}) {
    const value = Math.max(0, Math.round(Number(amount) || 0));
    if (!value) return;
    const heal = Boolean(options.heal);
    const critical = Boolean(options.critical);
    const text = `${heal ? '+' : '-'}${value}`;
    const color = heal ? '#75ff7b' : critical ? '#ffd24d' : '#ff5b7f';
    const label = this.scene.add.text(x, y, text, {
      fontFamily: 'Arial Black, Arial',
      fontSize: critical ? '30px' : '23px',
      fontStyle: 'bold',
      color,
      stroke: '#07010c',
      strokeThickness: 7,
    }).setOrigin(0.5).setDepth(2200).setScale(0.55).setAlpha(0);
    this.scene.tweens.chain({
      targets: label,
      tweens: [
        { y: y - 18, scale: critical ? 1.2 : 1, alpha: 1, duration: 130, ease: 'Back.easeOut' },
        { y: y - 62, alpha: 0, duration: 650, ease: 'Cubic.easeOut' },
      ],
      onComplete: () => label.destroy(),
    });
  }

  attachBloom(target, strength = 1.15) {
    if (!target || this.bloomed.has(target)) return;
    try {
      target.postFX?.addBloom?.(0xffffff, 1, 1, 1.2, strength, 4);
      this.bloomed.add(target);
    } catch {
      // Canvas renderer and some GPUs do not expose postFX. The additive glow remains the fallback.
    }
  }

  giftCinematic(payload = {}) {
    const tier = payload.tier || 'support';
    const colors = { support: 0x75ff7b, boost: 0x2cefff, event: 0xff9f2f, premium: 0xffd24d };
    const color = colors[tier] || colors.support;
    const quantity = tier === 'premium' ? 40 : tier === 'event' ? 32 : tier === 'boost' ? 24 : 16;
    this.burst(640, 360, color, quantity, tier === 'premium' ? 330 : 230, 760);
    this.ring(640, 360, color, 90, tier === 'premium' ? 5.2 : 4, 900, tier === 'premium' ? 9 : 6);
    const veil = this.scene.add.rectangle(640, 360, 1280, 720, color, tier === 'premium' ? 0.11 : 0.055).setDepth(2100).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    this.scene.tweens.chain({ targets: veil, tweens: [{ alpha: 1, duration: 90 }, { alpha: 0, duration: tier === 'premium' ? 560 : 330 }], onComplete: () => veil.destroy() });
  }

  destroy() {
    for (const dot of this.pool) dot.destroy();
    this.pool = [];
  }
}
