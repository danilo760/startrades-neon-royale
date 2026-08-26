import Phaser from 'phaser';
import { sfx } from '../audio.js';

const POWER_ICONS = { shot: '✦', shield: '⬡', supply: '✚', grenade: '◉', airstrike: '⌖', drone: '◆', meteor: '☄' };

export class GameScene extends Phaser.Scene {
  constructor(bridge) {
    super('Arena'); this.bridge = bridge; this.fighters = new Map(); this.lastSync = 0; this.lastStormHit = 0; this.trailAt = 0;
  }
  preload() { this.load.spritesheet('fighters', '/assets/fighters-atlas.png', { frameWidth: 307, frameHeight: 307 }); }
  create() {
    this.cameras.main.setBackgroundColor('#05020b'); this.drawArena();
    this.input.on('pointerdown', () => this.bridge.unlock());
    if (this.pendingState) { const pending = this.pendingState; this.pendingState = null; this.syncState(pending); }
  }
  drawArena() {
    const bg = this.add.graphics().setDepth(-20);
    bg.fillGradientStyle(0x16072b, 0x090418, 0x05020b, 0x0d0520, 1).fillRect(0, 0, 1280, 720);
    for (let i = 0; i < 75; i++) {
      const star = this.add.circle(Phaser.Math.Between(20, 1260), Phaser.Math.Between(15, 705), Phaser.Math.Between(1, 2), i % 4 ? 0x7257a8 : 0x2cefff, Phaser.Math.FloatBetween(.18, .55)).setDepth(-18);
      this.tweens.add({ targets: star, alpha: Phaser.Math.FloatBetween(.08, .55), duration: Phaser.Math.Between(900, 2600), yoyo: true, repeat: -1 });
    }
    const g = this.add.graphics().setDepth(-10);
    g.fillStyle(0x0c0920, .96).fillRoundedRect(35, 35, 1210, 650, 32); g.lineStyle(1, 0x2cefff, .12);
    for (let x = 70; x < 1240; x += 70) g.lineBetween(x, 55, x, 665);
    for (let y = 70; y < 670; y += 70) g.lineBetween(55, y, 1225, y);
    g.lineStyle(2, 0xa84dff, .46).strokeRoundedRect(35, 35, 1210, 650, 32);
    g.lineStyle(1, 0x2cefff, .28).strokeCircle(640, 360, 245).strokeCircle(640, 360, 410);
    g.fillStyle(0x2cefff, .8); [[45,45],[1235,45],[45,675],[1235,675]].forEach(([x,y]) => g.fillCircle(x,y,4));
    const points = Array.from({ length: 12 }, (_, i) => new Phaser.Geom.Point(Math.cos(i * Math.PI / 6) * (i % 2 ? 105 : 118), Math.sin(i * Math.PI / 6) * (i % 2 ? 105 : 118)));
    const core = this.add.polygon(640, 360, points, 0x45106c, .08).setStrokeStyle(2, 0xa84dff, .22).setDepth(-8);
    this.tweens.add({ targets: core, angle: 360, duration: 28000, repeat: -1 });
    this.scan = this.add.rectangle(640, 55, 1160, 2, 0x2cefff, .08).setDepth(-7);
    this.tweens.add({ targets: this.scan, y: 665, alpha: .22, duration: 4200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.stormRing = this.add.graphics().setDepth(800); this.stormGlow = this.add.graphics().setDepth(-5);
  }
  syncState(state) {
    if (!this.sys?.isActive()) { this.pendingState = state; return; }
    this.state = state;
    (state.players || []).forEach((p) => this.ensureFighter(p));
    for (const [id, f] of this.fighters) if (!(state.players || []).some((p) => p.id === id)) { f.container.destroy(); this.fighters.delete(id); }
    this.drawStorm(state.storm || 0);
  }
  ensureFighter(p) {
    let f = this.fighters.get(p.id);
    if (!f) {
      const shadow = this.add.ellipse(0, 19, 58, 20, 0x000000, .5);
      const glow = this.add.circle(0, 9, 31, [0x2cefff, 0xff36d7, 0x75ff4d, 0xff8a2b][p.skin], .13).setStrokeStyle(1, [0x2cefff, 0xff36d7, 0x75ff4d, 0xff8a2b][p.skin], .45);
      const sprite = this.add.sprite(0, 0, 'fighters', p.skin * 4).setScale(.25).setOrigin(.5, .72);
      const name = this.add.text(0, -52, `@${p.id}`, { fontFamily: 'Arial', fontSize: '13px', fontStyle: 'bold', color: '#ffffff', stroke: '#05030c', strokeThickness: 5 }).setOrigin(.5);
      const hpBg = this.add.rectangle(0, -34, 68, 8, 0x160f24).setStrokeStyle(1, 0xffffff, .12); const hp = this.add.rectangle(-34, -34, 68, 6, 0x75ff4d).setOrigin(0, .5); const shield = this.add.rectangle(-34, -25, 0, 4, 0x2cefff).setOrigin(0, .5);
      const container = this.add.container(p.x, p.y, [shadow, glow, sprite, name, hpBg, hp, shield]).setDepth(p.y).setScale(.15).setAlpha(0);
      f = { container, sprite, glow, hp, shield, data: p, nextShot: 0, wanderAt: 0, wasAlive: true }; this.fighters.set(p.id, f);
      this.tweens.add({ targets: container, scale: 1, alpha: 1, duration: 520, ease: 'Back.easeOut' }); this.radialBurst(p.x, p.y, [0x2cefff, 0xff36d7, 0x75ff4d, 0xff8a2b][p.skin], 12, 55); sfx('join');
    }
    if (f.wasAlive && !p.alive) this.eliminationEffect(f);
    f.data = p; f.wasAlive = p.alive; f.hp.width = 68 * p.hp / 100; f.shield.width = 68 * p.shield / 100;
    if (p.alive) f.container.setAlpha(1); return f;
  }
  drawStorm(value) {
    this.stormRing.clear(); this.stormGlow.clear(); if (!value) return;
    const radius = Math.max(90, 575 - value * 4.2), thickness = Math.min(150, 16 + value * 1.15);
    this.stormGlow.lineStyle(thickness + 25, 0x6d17bb, .07 + value / 1600).strokeCircle(640, 360, radius);
    this.stormRing.lineStyle(thickness, value > 70 ? 0xff2c88 : 0xa52cff, .2 + value / 420).strokeCircle(640, 360, radius);
    this.stormRing.lineStyle(2, 0xffffff, .35).strokeCircle(640, 360, radius - thickness / 2);
  }
  radialBurst(x, y, color, count = 14, distance = 75) {
    for (let i = 0; i < count; i++) {
      const angle = Math.PI * 2 * i / count + Phaser.Math.FloatBetween(-.18, .18), dot = this.add.circle(x, y, Phaser.Math.Between(2, 6), color, .9).setDepth(1100);
      this.tweens.add({ targets: dot, x: x + Math.cos(angle) * Phaser.Math.Between(distance * .5, distance), y: y + Math.sin(angle) * Phaser.Math.Between(distance * .5, distance), scale: 0, alpha: 0, duration: Phaser.Math.Between(350, 720), ease: 'Quad.easeOut', onComplete: () => dot.destroy() });
    }
  }
  floatingText(x, y, text, color = '#ffffff', size = 22) {
    const label = this.add.text(x, y, text, { fontFamily: 'Arial', fontSize: `${size}px`, fontStyle: 'bold', color, stroke: '#09020f', strokeThickness: 6 }).setOrigin(.5).setDepth(1300).setScale(.7);
    this.tweens.add({ targets: label, y: y - 65, scale: 1.05, alpha: 0, duration: 850, ease: 'Cubic.easeOut', onComplete: () => label.destroy() });
  }
  powerAnnouncement(event) {
    const color = event.power.color, label = this.add.text(0, 0, `${event.power.icon || POWER_ICONS[event.power.kind]}  ${event.power.label}`, { fontFamily: 'Arial', fontSize: '25px', fontStyle: 'bold', color: '#ffffff', stroke: Phaser.Display.Color.IntegerToColor(color).rgba, strokeThickness: 2 }).setOrigin(.5);
    const user = this.add.text(0, 29, `@${event.playerId} • ${event.total} moedas`, { fontFamily: 'Arial', fontSize: '12px', color: '#d9c9ef' }).setOrigin(.5);
    const panel = this.add.rectangle(0, 14, Math.max(390, label.width + 82), 72, 0x090411, .93).setStrokeStyle(2, color, .9);
    const c = this.add.container(640, -70, [panel, label, user]).setDepth(2000);
    this.tweens.chain({ targets: c, tweens: [{ y: 94, duration: 340, ease: 'Back.easeOut' }, { y: 94, duration: 1050 }, { y: -80, alpha: 0, duration: 300, ease: 'Back.easeIn' }], onComplete: () => c.destroy() });
  }
  triggerPower(event) {
    const f = this.fighters.get(event.playerId); if (!f) return; const { power } = event; this.powerAnnouncement(event);
    this.cameras.main.flash(power.kind === 'meteor' ? 280 : 90, (power.color >> 16) & 255, (power.color >> 8) & 255, power.color & 255, false, undefined, .12);
    if (power.kind === 'shield') { this.shieldEffect(f, power); return; }
    if (power.kind === 'supply') { this.supplyEffect(f, power); return; }
    const targets = [...this.fighters.values()].filter((t) => t.data.alive && t.data.id !== event.playerId).sort((a, b) => Phaser.Math.Distance.Between(f.container.x, f.container.y, a.container.x, a.container.y) - Phaser.Math.Distance.Between(f.container.x, f.container.y, b.container.x, b.container.y));
    if (power.kind === 'drone') { if (targets[0]) this.droneEffect(f, targets[0], power); return; }
    const count = ['meteor', 'airstrike'].includes(power.kind) ? 5 : 1; targets.slice(0, count).forEach((t, i) => this.fire(f, t, power, i)); sfx(power.sound || power.kind);
  }
  shieldEffect(f, power) {
    [0, 130, 260].forEach((delay) => this.time.delayedCall(delay, () => { const ring = this.add.circle(f.container.x, f.container.y, 25, power.color, .12).setStrokeStyle(5, power.color, .95).setDepth(900); this.tweens.add({ targets: ring, scale: 3.1, alpha: 0, duration: 720, ease: 'Sine.easeOut', onComplete: () => ring.destroy() }); }));
    this.radialBurst(f.container.x, f.container.y, power.color, 16, 80); this.floatingText(f.container.x, f.container.y - 50, `+${power.shield} ESCUDO`, '#35eaff', 18); sfx('shield');
  }
  supplyEffect(f, power) {
    const crate = this.add.container(f.container.x, -40, [this.add.rectangle(0, 0, 48, 40, 0x173c25).setStrokeStyle(3, power.color), this.add.text(0, 0, '+', { fontSize: '28px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(.5)]).setDepth(1200);
    this.tweens.add({ targets: crate, y: f.container.y - 22, angle: 360, duration: 650, ease: 'Bounce.easeOut', onComplete: () => { this.radialBurst(crate.x, crate.y, power.color, 18, 70); crate.destroy(); } });
    this.floatingText(f.container.x, f.container.y - 55, `+${power.heal} VIDA  +${power.shield} ESCUDO`, '#5dff70', 16); sfx('supply');
  }
  droneEffect(attacker, target, power) {
    const drone = this.add.container(attacker.container.x, attacker.container.y - 82, [this.add.circle(0, 0, 14, 0x16071f).setStrokeStyle(3, power.color), this.add.triangle(0, 0, -18, 8, 0, -14, 18, 8, power.color, .9)]).setDepth(1200);
    const orbit = { t: 0 }; this.tweens.add({ targets: orbit, t: Math.PI * 2, duration: 900, onUpdate: () => { drone.x = attacker.container.x + Math.cos(orbit.t) * 55; drone.y = attacker.container.y - 45 + Math.sin(orbit.t) * 24; }, onComplete: () => {
      const beam = this.add.graphics().setDepth(1150); beam.lineStyle(5, power.color, .95).lineBetween(drone.x, drone.y, target.container.x, target.container.y); beam.lineStyle(1, 0xffffff, 1).lineBetween(drone.x, drone.y, target.container.x, target.container.y);
      this.tweens.add({ targets: beam, alpha: 0, duration: 220, onComplete: () => beam.destroy() }); this.impact(attacker, target, power); drone.destroy();
    } }); sfx('drone');
  }
  fire(attacker, target, power, delay = 0) {
    this.time.delayedCall(delay * 130, () => {
      if (power.kind === 'meteor') return this.meteorStrike(attacker, target, power);
      if (power.kind === 'airstrike') return this.airstrike(attacker, target, power);
      if (power.kind === 'grenade') return this.grenade(attacker, target, power);
      const projectile = this.add.circle(attacker.container.x, attacker.container.y - 8, 6, power.color).setStrokeStyle(2, 0xffffff).setDepth(1000);
      const trail = this.add.circle(attacker.container.x, attacker.container.y - 8, 13, power.color, .2).setDepth(999);
      this.tweens.add({ targets: [projectile, trail], x: target.container.x, y: target.container.y, duration: 260, ease: 'Quad.easeIn', onComplete: (_t, items) => { items.forEach((x) => x.destroy()); this.impact(attacker, target, power); } });
    });
  }
  grenade(attacker, target, power) {
    const orb = this.add.circle(attacker.container.x, attacker.container.y, 11, power.color).setStrokeStyle(3, 0xffffff).setDepth(1100), progress = { t: 0 }, sx = orb.x, sy = orb.y, ex = target.container.x, ey = target.container.y;
    this.tweens.add({ targets: progress, t: 1, duration: 620, ease: 'Quad.easeInOut', onUpdate: () => { const t = progress.t; orb.x = Phaser.Math.Linear(sx, ex, t); orb.y = Phaser.Math.Linear(sy, ey, t) - Math.sin(Math.PI * t) * 115; orb.angle += 18; }, onComplete: () => { orb.destroy(); this.impact(attacker, target, power); } });
  }
  airstrike(attacker, target, power) {
    const reticle = this.add.circle(target.container.x, target.container.y, 48, power.color, .05).setStrokeStyle(3, power.color, .95).setDepth(950), cross = this.add.text(target.container.x, target.container.y, '⌖', { fontSize: '48px', color: '#ff334e' }).setOrigin(.5).setDepth(960);
    this.tweens.add({ targets: [reticle, cross], scale: .55, alpha: 1, duration: 430, yoyo: true, onComplete: () => { const beam = this.add.rectangle(target.container.x, target.container.y - 230, 16, 470, power.color, .88).setDepth(1050); this.tweens.add({ targets: beam, scaleX: 2.4, alpha: 0, duration: 260, onComplete: () => beam.destroy() }); reticle.destroy(); cross.destroy(); this.impact(attacker, target, power); } });
  }
  meteorStrike(attacker, target, power) {
    const meteor = this.add.circle(target.container.x - 210, -90, 32, power.color).setStrokeStyle(8, 0xffdf75, .65).setDepth(1250), tail = this.add.rectangle(meteor.x - 65, meteor.y - 65, 150, 18, power.color, .42).setRotation(Math.PI / 4).setDepth(1240);
    this.tweens.add({ targets: [meteor, tail], x: target.container.x, y: target.container.y, duration: 760, ease: 'Cubic.easeIn', onComplete: (_t, items) => { items.forEach((x) => x.destroy()); this.impact(attacker, target, power); } });
  }
  impact(attacker, target, power) {
    const big = ['meteor', 'airstrike', 'grenade'].includes(power.kind), radius = power.kind === 'meteor' ? 105 : power.kind === 'airstrike' ? 70 : power.radius ? 58 : 28;
    const burst = this.add.circle(target.container.x, target.container.y, 9, power.color, .92).setDepth(999).setStrokeStyle(3, 0xffffff, .65); this.tweens.add({ targets: burst, scale: radius / 9, alpha: 0, duration: big ? 520 : 280, ease: 'Quad.easeOut', onComplete: () => burst.destroy() });
    this.radialBurst(target.container.x, target.container.y, power.color, big ? 26 : 10, big ? 120 : 55); this.cameras.main.shake(power.kind === 'meteor' ? 480 : big ? 260 : 90, power.kind === 'meteor' ? .018 : big ? .009 : .0025); sfx('hit');
    let damage = power.damage || 0, shield = target.data.shield, hp = target.data.hp; const absorbed = Math.min(shield, damage); shield -= absorbed; damage -= absorbed; hp = Math.max(0, hp - damage); const eliminated = hp <= 0;
    target.data = { ...target.data, hp, shield, alive: !eliminated }; target.hp.width = 68 * hp / 100; target.shield.width = 68 * shield / 100;
    this.floatingText(target.container.x, target.container.y - 40, `-${power.damage || 0}`, '#ff668d', big ? 28 : 20);
    if (eliminated) this.eliminationEffect(target, attacker.data.id);
    this.bridge.combat({ attackerId: attacker.data.id, targetId: target.data.id, damage: power.damage || 0, targetHp: hp, targetShield: shield, eliminated });
  }
  eliminationEffect(f, attackerId = '') {
    if (f.eliminating) return; f.eliminating = true; f.wasAlive = false; this.radialBurst(f.container.x, f.container.y, 0xff315f, 24, 110); this.floatingText(f.container.x, f.container.y - 45, 'ELIMINADO', '#ff426b', 25); sfx('elimination');
    this.tweens.add({ targets: f.container, scale: 1.35, angle: 12, alpha: .16, duration: 520, ease: 'Back.easeIn', onComplete: () => { f.container.setScale(1).setAngle(0).setAlpha(.16); } });
    if (attackerId) this.cameras.main.flash(90, 255, 45, 90, false, undefined, .08);
  }
  battleStart() {
    const title = this.add.text(640, 360, 'BATALHA INICIADA', { fontFamily: 'Arial', fontSize: '58px', fontStyle: 'bold italic', color: '#ffffff', stroke: '#a52cff', strokeThickness: 8 }).setOrigin(.5).setDepth(2500).setScale(.3).setAlpha(0);
    this.tweens.chain({ targets: title, tweens: [{ scale: 1.1, alpha: 1, duration: 420, ease: 'Back.easeOut' }, { scale: 1, duration: 700 }, { scale: 1.6, alpha: 0, duration: 360 }], onComplete: () => title.destroy() }); this.cameras.main.flash(350, 44, 239, 255); sfx('start');
  }
  battleEnd(winner) {
    const f = winner && this.fighters.get(winner.id), x = f?.container.x || 640, y = f?.container.y || 360; this.radialBurst(x, y, 0x75ff4d, 48, 240);
    for (let i = 0; i < 34; i++) { const dot = this.add.rectangle(Phaser.Math.Between(160, 1120), -20, 6, 15, [0x75ff4d, 0x2cefff, 0xffd24d, 0xff4dff][i % 4]).setDepth(1900).setAngle(Phaser.Math.Between(0, 180)); this.tweens.add({ targets: dot, y: 740, x: dot.x + Phaser.Math.Between(-120, 120), angle: dot.angle + 540, duration: Phaser.Math.Between(1800, 3000), delay: Phaser.Math.Between(0, 500), onComplete: () => dot.destroy() }); }
    sfx('win');
  }
  stormSurge(value) { this.cameras.main.flash(180, 142, 35, 255, false, undefined, .11); this.floatingText(640, 165, `TEMPESTADE ${value}%`, '#d576ff', 26); sfx('storm'); }
  likeBurst() { this.radialBurst(640, 360, 0xff4d9d, 36, 210); this.floatingText(640, 330, '500 CURTIDAS • TEMPESTADE RECUOU', '#ff75b8', 22); sfx('like'); }
  update(time, delta) {
    if (!this.state || this.state.phase !== 'running') return;
    const alive = [...this.fighters.values()].filter((f) => f.data.alive);
    alive.forEach((f) => {
      if (time > f.wanderAt) { f.data.targetX = Phaser.Math.Between(90, 1190); f.data.targetY = Phaser.Math.Between(90, 630); f.wanderAt = time + Phaser.Math.Between(1600, 3500); }
      const angle = Phaser.Math.Angle.Between(f.container.x, f.container.y, f.data.targetX, f.data.targetY), dist = Phaser.Math.Distance.Between(f.container.x, f.container.y, f.data.targetX, f.data.targetY);
      if (dist > 12) { f.container.x += Math.cos(angle) * delta * .038; f.container.y += Math.sin(angle) * delta * .038; f.container.setDepth(f.container.y); f.sprite.y = Math.sin(time / 90) * 3; f.glow.alpha = .12 + Math.sin(time / 180) * .04; const dx = Math.cos(angle), dy = Math.sin(angle); f.sprite.setFrame(f.data.skin * 4 + (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : (dy < 0 ? 3 : 0))); }
      const target = alive.filter((x) => x !== f).sort((a, b) => Phaser.Math.Distance.Between(f.container.x, f.container.y, a.container.x, a.container.y) - Phaser.Math.Distance.Between(f.container.x, f.container.y, b.container.x, b.container.y))[0];
      if (target && time > f.nextShot && Phaser.Math.Distance.Between(f.container.x, f.container.y, target.container.x, target.container.y) < 260) { f.nextShot = time + Phaser.Math.Between(1400, 2400); this.fire(f, target, { kind: 'shot', damage: 4, color: 0x2cefff }); sfx('shot'); }
    });
    if (time - this.lastSync > 1500) { this.lastSync = time; this.bridge.positions(alive.map((f) => ({ id: f.data.id, x: f.container.x, y: f.container.y, targetX: f.data.targetX, targetY: f.data.targetY }))); }
    if (time - this.lastStormHit > 1000 && (this.state.storm || 0) >= 15) {
      this.lastStormHit = time; const safeRadius = Math.max(90, 575 - (this.state.storm || 0) * 4.2);
      alive.filter((f) => Phaser.Math.Distance.Between(640, 360, f.container.x, f.container.y) > safeRadius).forEach((f) => { this.bridge.stormDamage(f.data.id, this.state.storm >= 75 ? 7 : this.state.storm >= 45 ? 4 : 2); const flash = this.add.circle(f.container.x, f.container.y, 35, 0xa52cff, .35).setDepth(920); this.tweens.add({ targets: flash, alpha: 0, scale: 1.7, duration: 320, onComplete: () => flash.destroy() }); });
    }
  }
}
