import Phaser from 'phaser';
import { sfx } from '../audio.js';

const POWER_IDS = new Set(['black-hole', 'chain-lightning', 'neon-tornado', 'orbital-laser', 'time-freeze', 'shockwave', 'gravity-bomb', 'supernova']);

export class VFXManager {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.bloomed = new WeakSet();
    this.maxPool = 180;
    this.makeSparkTexture();
  }

  effectScale() {
    const intensity = String(this.scene?.state?.settings?.effectIntensity || 'NORMAL').toUpperCase();
    return intensity === 'BAIXA' ? 0.65 : intensity === 'ALTA' ? 1.2 : 1;
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
    const count = Math.min(Math.max(1, Math.round(quantity * this.effectScale())), 40);
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

  veil(color, alpha = 0.12, duration = 520, depth = 2100) {
    const veil = this.scene.add.rectangle(640, 360, 1280, 720, color, alpha).setDepth(depth).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    this.scene.tweens.chain({ targets: veil, tweens: [{ alpha: 1, duration: 90 }, { alpha: 0, duration }], onComplete: () => veil.destroy() });
    return veil;
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

  targetPosition(payload = {}) {
    const fighter = this.scene?.fighters?.get(payload.targetPlayerId);
    return { x: Number(payload.result?.x ?? fighter?.container?.x ?? 640), y: Number(payload.result?.y ?? fighter?.container?.y ?? 360) };
  }

  lightning(payload = {}) {
    const hits = payload.result?.hits || [];
    if (!hits.length) return;
    const graphics = this.scene.add.graphics().setDepth(1750).setBlendMode(Phaser.BlendModes.ADD);
    graphics.lineStyle(5, 0x8cf7ff, 0.95);
    let previous = this.scene?.fighters?.get(payload.targetPlayerId)?.container || { x: 640, y: 360 };
    for (const hit of hits) {
      const next = this.scene?.fighters?.get(hit.playerId)?.container;
      if (!next) continue;
      graphics.lineBetween(previous.x, previous.y, next.x, next.y);
      this.burst(next.x, next.y, 0x8cf7ff, 12, 70, 420);
      previous = next;
    }
    this.scene.tweens.add({ targets: graphics, alpha: 0, duration: 420, onComplete: () => graphics.destroy() });
  }

  powerPreset(payload = {}) {
    const id = payload.powerId || payload.effect;
    if (!POWER_IDS.has(id)) return;
    const { x, y } = this.targetPosition(payload);
    if (id === 'black-hole') {
      sfx('gravity');
      const core = this.scene.add.circle(x, y, 38, 0x020006, 0.95).setStrokeStyle(5, 0xa84dff, 0.9).setDepth(1700);
      this.attachBloom(core, 1.5);
      this.ring(x, y, 0xa84dff, 52, 5, Math.min(1400, payload.durationMs || 1200), 6);
      this.burst(x, y, 0x8d4dff, 30, 170, 900);
      this.scene.tweens.add({ targets: core, scale: 2.1, angle: 180, alpha: 0, duration: Math.min(1800, payload.durationMs || 1600), ease: 'Sine.easeInOut', onComplete: () => core.destroy() });
    } else if (id === 'chain-lightning') {
      sfx('lightning');
      this.lightning(payload);
      this.veil(0x9afcff, 0.07, 180);
    } else if (id === 'neon-tornado') {
      sfx('tornado');
      for (let i = 0; i < 4; i++) this.ring(x, y - i * 24, 0x2cefff, 30 + i * 12, 3.4, 700 + i * 100, 3);
      this.burst(x, y, 0x2cefff, 30, 180, 900);
    } else if (id === 'orbital-laser') {
      sfx('laser');
      const beam = this.scene.add.rectangle(x, y - 280, 34, 620, 0xeaffff, 0.82).setDepth(1900).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
      this.attachBloom(beam, 1.8);
      this.ring(x, y, 0x5ff7ff, 48, 3.6, 650, 7);
      this.scene.tweens.chain({ targets: beam, tweens: [{ alpha: 1, duration: 100 }, { scaleX: 2.2, alpha: 0, duration: 420 }], onComplete: () => beam.destroy() });
    } else if (id === 'time-freeze') {
      sfx('time-freeze');
      this.veil(0x3c78ff, 0.18, Math.min(1300, payload.durationMs || 1100));
      this.ring(640, 360, 0x8ab8ff, 120, 6, 1200, 8);
    } else if (id === 'shockwave') {
      sfx('explosion');
      this.ring(x, y, 0xffffff, 36, 8, 700, 8);
      this.burst(x, y, 0x2cefff, 24, 180, 650);
    } else if (id === 'gravity-bomb') {
      sfx('gravity');
      const bomb = this.scene.add.circle(x, y, 30, 0x14001f, 0.96).setStrokeStyle(5, 0xff4dff, 0.9).setDepth(1720);
      this.ring(x, y, 0xff4dff, 55, 4.4, 900, 5);
      this.scene.tweens.add({ targets: bomb, scale: 1.9, alpha: 0, duration: 1000, ease: 'Back.easeIn', onComplete: () => bomb.destroy() });
    } else if (id === 'supernova') {
      sfx('legendary');
      this.veil(0xffffff, 0.48, 460, 2250);
      this.burst(640, 360, 0xffd24d, 40, 360, 1000);
      this.ring(640, 360, 0xffffff, 60, 9, 1000, 12);
      this.ring(640, 360, 0xffd24d, 100, 7, 1300, 8);
    }
  }

  giftCinematic(payload = {}) {
    const tier = payload.tier || 'support';
    const colors = { support: 0x75ff7b, boost: 0x2cefff, event: 0xff9f2f, premium: 0xffd24d };
    const color = colors[tier] || colors.support;
    const quantity = tier === 'premium' ? 40 : tier === 'event' ? 32 : tier === 'boost' ? 24 : 16;
    this.burst(640, 360, color, quantity, tier === 'premium' ? 330 : 230, 760);
    this.ring(640, 360, color, 90, tier === 'premium' ? 5.2 : 4, 900, tier === 'premium' ? 9 : 6);
    this.veil(color, tier === 'premium' ? 0.11 : 0.055, tier === 'premium' ? 560 : 330);
    this.powerPreset(payload);
  }

  destroy() {
    for (const dot of this.pool) dot.destroy();
    this.pool = [];
  }
}
