import Phaser from 'phaser';
import { sfx } from '../audio.js';

export class GameScene extends Phaser.Scene {
  constructor(bridge) { super('Arena'); this.bridge = bridge; this.fighters = new Map(); this.projectiles = []; this.lastSync = 0; this.lastStormHit = 0; }
  preload() { this.load.spritesheet('fighters', '/assets/fighters-atlas.png', { frameWidth: 307, frameHeight: 307 }); }
  create() {
    this.cameras.main.setBackgroundColor('#080512');
    this.drawArena();
    this.input.on('pointerdown', () => this.bridge.unlock());
  }
  drawArena() {
    const g = this.add.graphics(); g.fillStyle(0x0c0920, 1).fillRoundedRect(35, 35, 1210, 650, 32); g.lineStyle(2, 0x2cefff, .28);
    for (let x = 70; x < 1240; x += 70) g.lineBetween(x, 55, x, 665);
    for (let y = 70; y < 670; y += 70) g.lineBetween(55, y, 1225, y);
    g.lineStyle(4, 0xa84dff, .45).strokeRoundedRect(35, 35, 1210, 650, 32);
    this.stormRing = this.add.graphics();
  }
  syncState(state) {
    this.state = state;
    (state.players || []).forEach((p) => this.ensureFighter(p));
    for (const [id, f] of this.fighters) if (!(state.players || []).some((p) => p.id === id)) { f.container.destroy(); this.fighters.delete(id); }
    this.drawStorm(state.storm || 0);
  }
  ensureFighter(p) {
    let f = this.fighters.get(p.id);
    if (!f) {
      const sprite = this.add.sprite(0, 0, 'fighters', p.skin * 4).setScale(.25).setOrigin(.5, .72);
      const glow = this.add.circle(0, 12, 27, [0x2cefff, 0xff36d7, 0x75ff4d, 0xff8a2b][p.skin], .16);
      const name = this.add.text(0, -48, `@${p.id}`, { fontFamily: 'Arial', fontSize: '13px', fontStyle: 'bold', color: '#ffffff', stroke: '#05030c', strokeThickness: 4 }).setOrigin(.5);
      const hpBg = this.add.rectangle(0, -32, 64, 7, 0x160f24); const hp = this.add.rectangle(-32, -32, 64, 7, 0x75ff4d).setOrigin(0, .5); const shield = this.add.rectangle(-32, -24, 0, 4, 0x2cefff).setOrigin(0, .5);
      const container = this.add.container(p.x, p.y, [glow, sprite, name, hpBg, hp, shield]); container.setDepth(p.y);
      f = { container, sprite, hp, shield, data: p, nextShot: 0, wanderAt: 0 }; this.fighters.set(p.id, f); sfx('join');
    }
    f.data = p; f.hp.width = 64 * p.hp / 100; f.shield.width = 64 * p.shield / 100; f.container.setAlpha(p.alive ? 1 : .25); return f;
  }
  drawStorm(value) { this.stormRing.clear(); if (!value) return; const inset = 35 + value * 4.2; this.stormRing.lineStyle(Math.min(130, 18 + value), 0xa52cff, .32).strokeCircle(640, 360, Math.max(90, 610 - inset)); }
  triggerPower(event) {
    const f = this.fighters.get(event.playerId); if (!f) return; const { power } = event;
    if (['shield', 'supply'].includes(power.kind)) { const ring = this.add.circle(f.container.x, f.container.y, 24, power.color, .2).setStrokeStyle(5, power.color); this.tweens.add({ targets: ring, scale: 2.8, alpha: 0, duration: 650, onComplete: () => ring.destroy() }); sfx('shield'); return; }
    if (power.kind === 'drone') { const drone = this.add.circle(f.container.x, f.container.y - 70, 12, power.color).setStrokeStyle(3, 0xffffff); this.tweens.add({ targets: drone, angle: 360, duration: 900, repeat: 1, onComplete: () => drone.destroy() }); }
    const targets = [...this.fighters.values()].filter((t) => t.data.alive && t.data.id !== event.playerId).sort((a, b) => Phaser.Math.Distance.Between(f.container.x, f.container.y, a.container.x, a.container.y) - Phaser.Math.Distance.Between(f.container.x, f.container.y, b.container.x, b.container.y));
    const count = ['meteor', 'airstrike'].includes(power.kind) ? 5 : 1; targets.slice(0, count).forEach((t, i) => this.fire(f, t, power, i)); sfx(power.kind);
  }
  fire(attacker, target, power, delay = 0) {
    this.time.delayedCall(delay * 100, () => {
      const projectile = this.add.circle(attacker.container.x, attacker.container.y - 8, power.kind === 'meteor' ? 20 : 7, power.color).setStrokeStyle(2, 0xffffff).setDepth(1000);
      this.tweens.add({ targets: projectile, x: target.container.x, y: target.container.y, duration: power.kind === 'meteor' ? 650 : 280, ease: 'Quad.easeIn', onComplete: () => { projectile.destroy(); this.impact(attacker, target, power); } });
    });
  }
  impact(attacker, target, power) {
    const burst = this.add.circle(target.container.x, target.container.y, 8, power.color, .9).setDepth(999); this.tweens.add({ targets: burst, radius: power.radius ? 55 : 25, alpha: 0, duration: 350, onComplete: () => burst.destroy() }); this.cameras.main.shake(power.kind === 'meteor' ? 350 : 100, power.kind === 'meteor' ? .012 : .003); sfx('hit');
    let damage = power.damage || 0, shield = target.data.shield, hp = target.data.hp; const absorbed = Math.min(shield, damage); shield -= absorbed; damage -= absorbed; hp = Math.max(0, hp - damage); const eliminated = hp <= 0;
    this.bridge.combat({ attackerId: attacker.data.id, targetId: target.data.id, damage: power.damage || 0, targetHp: hp, targetShield: shield, eliminated });
  }
  update(time, delta) {
    if (!this.state || this.state.phase !== 'running') return;
    const alive = [...this.fighters.values()].filter((f) => f.data.alive);
    alive.forEach((f) => {
      if (time > f.wanderAt) { f.data.targetX = Phaser.Math.Between(90, 1190); f.data.targetY = Phaser.Math.Between(90, 630); f.wanderAt = time + Phaser.Math.Between(1600, 3500); }
      const angle = Phaser.Math.Angle.Between(f.container.x, f.container.y, f.data.targetX, f.data.targetY); const dist = Phaser.Math.Distance.Between(f.container.x, f.container.y, f.data.targetX, f.data.targetY); if (dist > 12) { f.container.x += Math.cos(angle) * delta * .035; f.container.y += Math.sin(angle) * delta * .035; f.container.setDepth(f.container.y); f.sprite.y = Math.sin(time / 95) * 3; const dx = Math.cos(angle), dy = Math.sin(angle); f.sprite.setFrame(f.data.skin * 4 + (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : (dy < 0 ? 3 : 0))); }
      const target = alive.filter((x) => x !== f).sort((a, b) => Phaser.Math.Distance.Between(f.container.x, f.container.y, a.container.x, a.container.y) - Phaser.Math.Distance.Between(f.container.x, f.container.y, b.container.x, b.container.y))[0];
      if (target && time > f.nextShot && Phaser.Math.Distance.Between(f.container.x, f.container.y, target.container.x, target.container.y) < 260) { f.nextShot = time + Phaser.Math.Between(1300, 2300); this.fire(f, target, { kind: 'shot', damage: 4, color: 0x2cefff }); sfx('shot'); }
    });
    if (time - this.lastSync > 1500) { this.lastSync = time; this.bridge.positions(alive.map((f) => ({ id: f.data.id, x: f.container.x, y: f.container.y, targetX: f.data.targetX, targetY: f.data.targetY }))); }
    if (time - this.lastStormHit > 1000 && (this.state.storm || 0) >= 15) {
      this.lastStormHit = time; const safeRadius = Math.max(90, 575 - (this.state.storm || 0) * 4.2);
      alive.filter((f) => Phaser.Math.Distance.Between(640, 360, f.container.x, f.container.y) > safeRadius).forEach((f) => { this.bridge.stormDamage(f.data.id, this.state.storm >= 75 ? 7 : this.state.storm >= 45 ? 4 : 2); const flash = this.add.circle(f.container.x, f.container.y, 35, 0xa52cff, .35); this.tweens.add({ targets: flash, alpha: 0, scale: 1.5, duration: 300, onComplete: () => flash.destroy() }); });
    }
  }
}
