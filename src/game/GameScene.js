import Phaser from 'phaser';
import { sfx } from '../audio.js';

const DOT_POOL_SIZE = 140;
const PROJECTILE_POOL_SIZE = 36;
const TEAM_COLORS = { blue: 0x35eaff, red: 0xff334e };

export class GameScene extends Phaser.Scene {
  constructor(bridge) {
    super('Arena');
    this.bridge = bridge;
    this.fighters = new Map();
    this.hazardViews = new Map();
    this.lastSync = 0;
    this.trailAt = 0;
  }
  preload() { this.load.spritesheet('fighters', '/assets/fighters-atlas.png', { frameWidth: 307, frameHeight: 307 }); }
  create() {
    this.cameras.main.setBackgroundColor('#05020b');
    this.drawArena();
    this.makeSparkTexture();
    this.makePools();
    this.input.on('pointerdown', () => this.bridge.unlock?.());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanupScene());
    if (this.pendingState) { const pending = this.pendingState; this.pendingState = null; this.syncState(pending); }
  }
  makeSparkTexture() {
    if (this.textures.exists('spark')) return;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1).fillCircle(8, 8, 8); g.generateTexture('spark', 16, 16); g.destroy();
  }
  makePools() {
    this.dotPool = Array.from({ length: DOT_POOL_SIZE }, () => this.add.circle(-100, -100, 4, 0xffffff, 1).setVisible(false).setActive(false).setDepth(1200));
    this.projectilePool = Array.from({ length: PROJECTILE_POOL_SIZE }, () => this.add.circle(-100, -100, 6, 0xffffff, 1).setStrokeStyle(2, 0xffffff).setVisible(false).setActive(false).setDepth(1050));
  }
  acquire(pool) { return pool.find((item) => !item.active) || null; }
  release(item) { if (!item) return; this.tweens.killTweensOf(item); item.setVisible(false).setActive(false).setPosition(-100, -100).setScale(1).setAlpha(1); }
  pooledBurst(x, y, color, quantity = 16, distance = 80) {
    for (let i = 0; i < Math.min(quantity, 30); i++) {
      const dot = this.acquire(this.dotPool); if (!dot) break;
      const angle = Math.PI * 2 * i / Math.max(1, quantity) + Phaser.Math.FloatBetween(-.18, .18);
      dot.setPosition(x, y).setRadius(Phaser.Math.Between(2, 6)).setFillStyle(color, .95).setVisible(true).setActive(true).setScale(1).setAlpha(1);
      this.tweens.add({ targets: dot, x: x + Math.cos(angle) * Phaser.Math.Between(distance * .5, distance), y: y + Math.sin(angle) * Phaser.Math.Between(distance * .5, distance), scale: 0, alpha: 0, duration: Phaser.Math.Between(330, 650), ease: 'Quad.easeOut', onComplete: () => this.release(dot) });
    }
  }
  drawArena() {
    const bg = this.add.graphics().setDepth(-20);
    bg.fillGradientStyle(0x16072b, 0x090418, 0x05020b, 0x0d0520, 1).fillRect(0, 0, 1280, 720);
    this.arenaTint = this.add.rectangle(640, 360, 1280, 720, 0x2c0f50, .08).setDepth(-19);
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
    const activeIds = new Set((state.players || []).map((p) => p.id));
    for (const [id, f] of this.fighters) if (!activeIds.has(id)) this.destroyFighter(id, f);
    this.applyArenaTheme(state.settings?.arenaBackground);
    this.drawStorm(state.storm || 0);
    this.syncBoss(state.boss);
    this.syncHazards(state.hazards || []);
  }
  ensureFighter(p) {
    let f = this.fighters.get(p.id);
    if (!f) {
      const skinColor = [0x2cefff, 0xff36d7, 0x75ff4d, 0xff8a2b][p.skin % 4];
      const shadow = this.add.ellipse(0, 19, 58, 20, 0x000000, .5);
      const glow = this.add.circle(0, 9, 31, skinColor, .13).setStrokeStyle(1, skinColor, .45);
      const teamAura = this.add.circle(0, 8, 37, 0x35eaff, .08).setStrokeStyle(3, 0x35eaff, .9).setVisible(false);
      const starAura = this.add.circle(0, 7, 45, 0xffd24d, .08).setStrokeStyle(4, 0xffd24d, .95).setVisible(false);
      const sprite = this.add.sprite(0, 0, 'fighters', (p.skin % 4) * 4).setScale(.25).setOrigin(.5, .72);
      const avatarBase = this.add.circle(0, -4, 22, 0x2cefff, 1).setStrokeStyle(3, 0xffffff, .65);
      const crown = this.add.text(0, -78, '👑', { fontSize: '25px' }).setOrigin(.5).setVisible(false);
      const starBadge = this.add.text(0, -82, '★', { fontFamily: 'Arial', fontSize: '22px', fontStyle: 'bold', color: '#ffd24d', stroke: '#4a2500', strokeThickness: 4 }).setOrigin(.5).setVisible(false);
      const name = this.add.text(0, -52, `@${p.username || p.id}`, { fontFamily: 'Arial', fontSize: '13px', fontStyle: 'bold', color: '#ffffff', stroke: '#05030c', strokeThickness: 5 }).setOrigin(.5);
      const hpBg = this.add.rectangle(0, -34, 68, 8, 0x160f24).setStrokeStyle(1, 0xffffff, .12);
      const hp = this.add.rectangle(-34, -34, 68, 6, 0x75ff4d).setOrigin(0, .5);
      const shield = this.add.rectangle(-34, -25, 0, 4, 0x2cefff).setOrigin(0, .5);
      const container = this.add.container(p.x, p.y, [shadow, glow, teamAura, starAura, sprite, avatarBase, crown, starBadge, name, hpBg, hp, shield]).setDepth(p.y).setScale(.15).setAlpha(0);
      f = { container, sprite, avatarBase, glow, teamAura, starAura, starBadge, crown, name, hp, shield, data: p, wanderAt: 0, wasAlive: true, trailAt: 0, starTrailAt: 0 };
      this.fighters.set(p.id, f);
      this.tweens.add({ targets: crown, y: -85, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.tweens.add({ targets: starBadge, y: -88, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.tweens.add({ targets: container, scale: 1, alpha: 1, duration: 520, ease: 'Back.easeOut' });
      this.pooledBurst(p.x, p.y, skinColor, 12, 55); sfx('join');
    }
    if (f.wasAlive && !p.alive) this.eliminationEffect(f);
    const teamColor = TEAM_COLORS[p.team] || TEAM_COLORS.blue;
    const starActive = Boolean(p.alive && p.starPowerUntil);
    f.data = p; f.wasAlive = p.alive; f.name.setText(`@${p.username || p.id}${starActive ? ` • HYPE ${p.hype || 0}` : ''}`);
    f.hp.width = 68 * (p.hp || 0) / Math.max(1, p.maxHp || 100); f.shield.width = 68 * Math.min(100, p.shield || 0) / 100;
    f.teamAura.setFillStyle(teamColor, .08).setStrokeStyle(3, teamColor, .9).setVisible(Boolean(this.state?.settings?.teamMode && p.alive && !starActive));
    f.starAura.setVisible(starActive); f.starBadge.setVisible(starActive);
    f.avatarBase.setFillStyle(starActive ? 0xffd24d : this.state?.settings?.teamMode ? teamColor : 0x2cefff, 1);
    f.crown.setVisible(Boolean(p.alive && this.state?.bountyTargetId === p.id));
    if (p.avatarUrl && f.avatarLoadedUrl !== p.avatarUrl && f.avatarLoadingUrl !== p.avatarUrl) this.loadAvatar(f, p);
    if (p.alive) f.container.setAlpha(1); return f;
  }
  applyArenaTheme(name = 'default') {
    const allowed = ['default', 'cyberpunk', 'space', 'retro'], next = allowed.includes(name) ? name : 'default';
    if (this.currentArena === next) return; this.currentArena = next;
    const palettes = { default: [0x2c0f50, .08], cyberpunk: [0xff1493, .12], space: [0x173b8f, .13], retro: [0xff7a18, .1] };
    this.arenaTint?.setFillStyle(...palettes[next]);
  }
  loadAvatar(f, p) {
    const hash = [...`${p.platformUserId || p.id}:${p.avatarUrl}`].reduce((n, c) => ((n * 31 + c.charCodeAt(0)) >>> 0), 7).toString(36), key = `avatar-${hash}`;
    f.avatarLoadingUrl = p.avatarUrl; let finished = false;
    const cleanup = () => { this.load.off(`filecomplete-image-${key}`, success); this.load.off('loaderror', failure); clearTimeout(timer); };
    const failure = (file) => { if (file?.key && file.key !== key) return; if (finished) return; finished = true; cleanup(); f.avatarLoadingUrl = null; if (this.textures.exists(key)) this.textures.remove(key); };
    const success = () => {
      if (finished) return; finished = true; cleanup();
      if (!this.fighters.has(p.id) || !this.textures.exists(key) || this.textures.get(key).key === '__MISSING') { f.avatarLoadingUrl = null; if (this.textures.exists(key)) this.textures.remove(key); return; }
      f.avatar?.destroy(); f.avatarMaskGraphic?.destroy();
      const image = this.add.image(0, -4, key).setDisplaySize(42, 42), maskGraphic = this.make.graphics({ add: false }); maskGraphic.fillStyle(0xffffff).fillCircle(0, -4, 21).setVisible(false);
      f.container.add([image, maskGraphic]); image.setMask(maskGraphic.createGeometryMask()); f.avatar = image; f.avatarMaskGraphic = maskGraphic; f.avatarTextureKey = key; f.avatarLoadedUrl = p.avatarUrl; f.avatarLoadingUrl = null;
    };
    const timer = setTimeout(() => failure(), 5000);
    this.load.once(`filecomplete-image-${key}`, success); this.load.on('loaderror', failure); this.load.image(key, p.avatarUrl); if (!this.load.isLoading()) this.load.start();
  }
  destroyFighter(id, f) {
    this.tweens.killTweensOf(f.container); this.tweens.killTweensOf(f.crown); this.tweens.killTweensOf(f.starBadge);
    f.avatar?.clearMask(true); f.avatarMaskGraphic?.destroy(); f.container.destroy();
    if (f.avatarTextureKey && this.textures.exists(f.avatarTextureKey)) this.textures.remove(f.avatarTextureKey);
    this.fighters.delete(id);
  }
  drawStorm(value) {
    this.stormRing.clear(); this.stormGlow.clear(); if (!value) return;
    const radius = Math.max(90, 575 - value * 4.2), thickness = Math.min(150, 16 + value * 1.15);
    this.stormGlow.lineStyle(thickness + 25, 0x6d17bb, .07 + value / 1600).strokeCircle(640, 360, radius);
    this.stormRing.lineStyle(thickness, value > 70 ? 0xff2c88 : 0xa52cff, .2 + value / 420).strokeCircle(640, 360, radius);
    this.stormRing.lineStyle(2, 0xffffff, .35).strokeCircle(640, 360, radius - thickness / 2);
  }
  floatingText(x, y, text, color = '#ffffff', size = 22) {
    const label = this.add.text(x, y, text, { fontFamily: 'Arial', fontSize: `${size}px`, fontStyle: 'bold', color, stroke: '#09020f', strokeThickness: 6 }).setOrigin(.5).setDepth(1300).setScale(.7);
    this.tweens.add({ targets: label, y: y - 65, scale: 1.05, alpha: 0, duration: 850, ease: 'Cubic.easeOut', onComplete: () => label.destroy() });
  }
  shieldEffect(f, premium = false) {
    const color = premium ? 0xffd24d : 0x2cefff;
    const ring = this.add.circle(f.container.x, f.container.y, 28, color, .08).setStrokeStyle(5, color, .95).setDepth(950);
    this.tweens.add({ targets: ring, scale: 3, alpha: 0, duration: 720, ease: 'Sine.easeOut', onComplete: () => ring.destroy() });
    this.pooledBurst(f.container.x, f.container.y, color, 18, 90); sfx('shield');
  }
  triggerGift(event) {
    const f = this.fighters.get(event.targetPlayerId); if (!f) return;
    if (event.effect === 'entry-boost') { this.pooledBurst(f.container.x, f.container.y, 0x2cefff, 18, 105); this.floatingText(f.container.x, f.container.y - 45, 'BOOST DE ENTRADA 1.2X', '#2cefff', 18); }
    else if (event.effect === 'tactical-shield') { this.shieldEffect(f, false); if (event.result?.heal) this.floatingText(f.container.x, f.container.y - 45, `+${Math.ceil(event.result.heal)} HP`, '#75ff7b', 18); }
    else if (event.effect === 'speed') { this.pooledBurst(f.container.x, f.container.y, 0x2cefff, 18, 105); this.floatingText(f.container.x, f.container.y - 45, 'IMPULSO NEON', '#2cefff', 18); }
    else if (event.effect === 'extra-projectile' && event.result?.targetId) this.renderCombatShot({ attackerId: event.targetPlayerId, targetId: event.result.targetId, gift: true });
    else if (event.effect === 'meteor') this.cameras.main.flash(120, 255, 174, 44, false, undefined, .08);
    else if (event.effect === 'star-power') { this.cameras.main.flash(180, 255, 210, 77, false, undefined, .1); this.pooledBurst(f.container.x, f.container.y, 0xffd24d, 30, 170); this.floatingText(f.container.x, f.container.y - 52, `STAR POWER • +${event.result?.hypeGain || 100} HYPE`, '#ffd24d', 21); }
    else if (event.effect === 'colossus') { this.cameras.main.flash(250, 255, 210, 77, false, undefined, .12); this.pooledBurst(640, 360, 0xffd24d, 30, 220); }
  }
  renderCombatShot(event) {
    const attacker = this.fighters.get(event.attackerId), target = this.fighters.get(event.targetId); if (!attacker || !target) return;
    const projectile = this.acquire(this.projectilePool); if (!projectile) return;
    const color = event.gift ? 0x75ff4d : 0x2cefff;
    projectile.setPosition(attacker.container.x, attacker.container.y - 8).setFillStyle(color, 1).setStrokeStyle(2, 0xffffff).setVisible(true).setActive(true);
    this.tweens.add({ targets: projectile, x: target.container.x, y: target.container.y, duration: 260, ease: 'Quad.easeIn', onComplete: () => { this.release(projectile); this.pooledBurst(target.container.x, target.container.y, color, event.gift ? 14 : 8, event.gift ? 70 : 45); if (event.eliminated) this.eliminationEffect(target, event.attackerId); sfx('hit'); } });
  }
  syncBoss(boss) {
    if (!boss?.active) { this.destroyBossView(); return; }
    if (!this.bossView) {
      const pulse = this.add.circle(0, 0, 78, 0x7c28ff, .16).setStrokeStyle(5, 0xc56cff, .8);
      const body = this.add.circle(0, 0, 58, 0x2b0b45, 1).setStrokeStyle(5, 0x9e44ff, 1);
      const core = this.add.text(0, -3, 'C', { fontFamily: 'Arial', fontSize: '62px', fontStyle: 'bold', color: '#e6c8ff' }).setOrigin(.5);
      const title = this.add.text(0, -96, 'COLOSSUS NEON', { fontFamily: 'Arial', fontSize: '18px', fontStyle: 'bold', color: '#f2ddff', stroke: '#100019', strokeThickness: 5 }).setOrigin(.5);
      const hpBg = this.add.rectangle(-90, 83, 180, 12, 0x160820).setOrigin(0, .5).setStrokeStyle(1, 0xffffff, .2);
      const hp = this.add.rectangle(-90, 83, 180, 8, 0xb34dff).setOrigin(0, .5);
      const container = this.add.container(boss.x, boss.y, [pulse, body, core, title, hpBg, hp]).setDepth(980);
      const tween = this.tweens.add({ targets: pulse, scale: 1.18, alpha: .4, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.bossView = { container, hp, pulse, tween, attackId: null, warning: null };
    }
    this.bossView.container.setPosition(boss.x, boss.y); this.bossView.hp.width = 180 * boss.hp / Math.max(1, boss.maxHp);
    const attack = boss.attack;
    if (attack && this.bossView.attackId !== attack.id) {
      if (this.bossView.warning) { this.tweens.killTweensOf(this.bossView.warning); this.bossView.warning.destroy(); }
      const warning = this.add.circle(attack.x, attack.y, attack.radius, 0xff3f86, .08).setStrokeStyle(5, 0xff3f86, .95).setDepth(900);
      this.tweens.add({ targets: warning, alpha: .3, scale: .9, duration: 450, yoyo: true, repeat: 4 });
      this.bossView.warning = warning; this.bossView.attackId = attack.id;
    } else if (!attack && this.bossView.warning) { this.tweens.killTweensOf(this.bossView.warning); this.bossView.warning.destroy(); this.bossView.warning = null; this.bossView.attackId = null; }
  }
  destroyBossView() {
    if (!this.bossView) return;
    if (this.bossView.warning) { this.tweens.killTweensOf(this.bossView.warning); this.bossView.warning.destroy(); }
    this.bossView.tween?.stop(); this.tweens.killTweensOf(this.bossView.container); this.bossView.container.destroy(); this.bossView = null;
  }
  syncHazards(hazards) {
    const active = new Set();
    for (const hazard of hazards.slice(-12)) {
      active.add(hazard.id); let view = this.hazardViews.get(hazard.id);
      if (!view) {
        const circle = this.add.circle(hazard.x, hazard.y, hazard.radius, 0xff9f2f, .06).setStrokeStyle(4, 0xffc24c, .95).setDepth(880);
        const tween = this.tweens.add({ targets: circle, scale: .9, alpha: .28, duration: 420, yoyo: true, repeat: -1 });
        view = { circle, tween, resolved: false }; this.hazardViews.set(hazard.id, view);
      }
      if (hazard.resolved && !view.resolved) { view.resolved = true; view.tween.stop(); view.circle.setVisible(false); this.pooledBurst(hazard.x, hazard.y, 0xff9f2f, 30, 150); this.cameras.main.shake(220, .008); sfx('explosion'); }
    }
    for (const [id, view] of this.hazardViews) if (!active.has(id)) { view.tween?.stop(); view.circle.destroy(); this.hazardViews.delete(id); }
  }
  eliminationEffect(f, attackerId = '') {
    if (f.eliminating) return; f.eliminating = true; f.wasAlive = false; this.pooledBurst(f.container.x, f.container.y, 0xff315f, 24, 110); this.floatingText(f.container.x, f.container.y - 45, 'ELIMINADO', '#ff426b', 25); sfx('elimination');
    this.tweens.add({ targets: f.container, scale: 1.35, angle: 12, alpha: .16, duration: 520, ease: 'Back.easeIn', onComplete: () => f.container.setScale(1).setAngle(0).setAlpha(.16) });
    if (attackerId) this.cameras.main.flash(90, 255, 45, 90, false, undefined, .08);
  }
  battleStart() {
    const title = this.add.text(640, 360, 'BATALHA INICIADA', { fontFamily: 'Arial', fontSize: '58px', fontStyle: 'bold italic', color: '#ffffff', stroke: '#a52cff', strokeThickness: 8 }).setOrigin(.5).setDepth(2500).setScale(.3).setAlpha(0);
    this.tweens.chain({ targets: title, tweens: [{ scale: 1.1, alpha: 1, duration: 420, ease: 'Back.easeOut' }, { scale: 1, duration: 700 }, { scale: 1.6, alpha: 0, duration: 360 }], onComplete: () => title.destroy() }); this.cameras.main.flash(350, 44, 239, 255); sfx('start');
  }
  suddenDeath() {
    const title = this.add.text(640, 250, 'MORTE SÚBITA', { fontFamily: 'Arial', fontSize: '62px', fontStyle: 'bold italic', color: '#ff426b', stroke: '#24000c', strokeThickness: 10 }).setOrigin(.5).setDepth(2500).setScale(.45).setAlpha(0);
    this.tweens.chain({ targets: title, tweens: [{ scale: 1.08, alpha: 1, duration: 360, ease: 'Back.easeOut' }, { scale: 1, duration: 1000 }, { y: 205, alpha: 0, duration: 420 }], onComplete: () => title.destroy() });
    this.cameras.main.flash(280, 255, 35, 75, false, undefined, .14); this.cameras.main.shake(380, .009); sfx('storm');
  }
  battleEnd(winner) {
    const f = winner && this.fighters.get(winner.id), x = f?.container.x || 640, y = f?.container.y || 360; this.pooledBurst(x, y, 0x75ff4d, 30, 220); sfx('win');
  }
  stormSurge(value) { this.cameras.main.flash(180, 142, 35, 255, false, undefined, .11); this.floatingText(640, 165, `TEMPESTADE ${value}%`, '#d576ff', 26); sfx('storm'); }
  likeBurst() { this.pooledBurst(640, 360, 0xff4d9d, 30, 210); this.floatingText(640, 330, '500 CURTIDAS • TEMPESTADE RECUOU', '#ff75b8', 22); sfx('like'); }
  update(time, delta) {
    if (!this.state) return;
    const alive = [...this.fighters.values()].filter((f) => f.data.alive);
    alive.forEach((f) => {
      const dx = (f.data.x ?? f.container.x) - f.container.x, dy = (f.data.y ?? f.container.y) - f.container.y, dist = Math.hypot(dx, dy);
      if (dist > .5) {
        const blend = Math.min(1, delta / 150);
        f.container.x += dx * blend; f.container.y += dy * blend; f.container.setDepth(f.container.y);
        f.sprite.y = Math.sin(time / 90) * 3; f.glow.alpha = .12 + Math.sin(time / 180) * .04;
        f.sprite.setFrame((f.data.skin % 4) * 4 + (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : (dy < 0 ? 3 : 0)));
      }
      if ((f.data.speedMultiplier || 1) > 1 && time > f.trailAt) {
        f.trailAt = time + 90; const dot = this.acquire(this.dotPool);
        if (dot) { dot.setPosition(f.container.x, f.container.y + 18).setRadius(5).setFillStyle(0x2cefff, .55).setVisible(true).setActive(true); this.tweens.add({ targets: dot, alpha: 0, scale: 0, duration: 320, onComplete: () => this.release(dot) }); }
      }
      if (f.data.starPowerUntil && time > f.starTrailAt) {
        f.starTrailAt = time + 120; f.starAura.alpha = .08 + (Math.sin(time / 130) + 1) * .07;
        const dot = this.acquire(this.dotPool);
        if (dot) { dot.setPosition(f.container.x + Phaser.Math.Between(-24, 24), f.container.y + Phaser.Math.Between(-28, 22)).setRadius(Phaser.Math.Between(3, 6)).setFillStyle(0xffd24d, .8).setVisible(true).setActive(true); this.tweens.add({ targets: dot, y: dot.y - 35, alpha: 0, scale: 0, duration: 520, onComplete: () => this.release(dot) }); }
      }
    });
  }
  cleanupScene() {
    this.input.off('pointerdown'); this.destroyBossView();
    for (const [id, f] of this.fighters) this.destroyFighter(id, f);
    for (const view of this.hazardViews.values()) { view.tween?.stop(); view.circle.destroy(); }
    this.hazardViews.clear();
    [...(this.dotPool || []), ...(this.projectilePool || [])].forEach((item) => item.destroy());
    this.dotPool = []; this.projectilePool = [];
  }
}
