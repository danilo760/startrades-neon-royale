import Phaser from 'phaser';
import { sfx } from '../audio.js';
import { VFXManager } from './VFXManager.js';
import { JuiceManager } from './JuiceManager.js';

const PROJECTILE_POOL_SIZE = 42;
const TEAM_COLORS = { blue: 0x35eaff, red: 0xff334e };
const SKIN_COLORS = [0x2cefff, 0xff36d7, 0x75ff4d, 0xff8a2b];

const phaseForBoss = (boss = {}) => {
  const ratio = Number(boss.hp || 0) / Math.max(1, Number(boss.maxHp || 1));
  if (ratio <= 0.33) return { id: 3, name: 'NÚCLEO CRÍTICO', color: 0xff315f };
  if (ratio <= 0.66) return { id: 2, name: 'FÚRIA NEON', color: 0xff8a2b };
  return { id: 1, name: 'DESPERTAR', color: 0xb34dff };
};

export class GameScene extends Phaser.Scene {
  constructor(bridge) {
    super('Arena');
    this.bridge = bridge;
    this.fighters = new Map();
    this.hazardViews = new Map();
    this.lastBossPhase = 0;
  }

  create() {
    this.cameras.main.setBackgroundColor('#05020b');
    this.drawArena();
    this.vfx = new VFXManager(this);
    this.juice = new JuiceManager(this);
    this.makeProjectilePool();
    this.input.on('pointerdown', () => this.bridge.unlock?.());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanupScene());
    if (this.pendingState) {
      const pending = this.pendingState;
      this.pendingState = null;
      this.syncState(pending);
    }
  }

  makeProjectilePool() {
    this.projectilePool = Array.from({ length: PROJECTILE_POOL_SIZE }, () => this.add.circle(-100, -100, 6, 0xffffff, 1)
      .setStrokeStyle(2, 0xffffff)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false)
      .setActive(false)
      .setDepth(1500));
  }

  acquireProjectile() {
    return this.projectilePool.find((item) => !item.active) || null;
  }

  releaseProjectile(item) {
    if (!item) return;
    this.tweens.killTweensOf(item);
    item.setVisible(false).setActive(false).setPosition(-100, -100).setScale(1).setAlpha(1);
  }

  drawArena() {
    const bg = this.add.graphics().setDepth(-20);
    bg.fillGradientStyle(0x16072b, 0x090418, 0x05020b, 0x0d0520, 1).fillRect(0, 0, 1280, 720);
    this.arenaTint = this.add.rectangle(640, 360, 1280, 720, 0x2c0f50, 0.08).setDepth(-19);
    for (let i = 0; i < 75; i++) {
      const star = this.add.circle(Phaser.Math.Between(20, 1260), Phaser.Math.Between(15, 705), Phaser.Math.Between(1, 2), i % 4 ? 0x7257a8 : 0x2cefff, Phaser.Math.FloatBetween(0.18, 0.55)).setDepth(-18);
      this.tweens.add({ targets: star, alpha: Phaser.Math.FloatBetween(0.08, 0.55), duration: Phaser.Math.Between(900, 2600), yoyo: true, repeat: -1 });
    }
    const g = this.add.graphics().setDepth(-10);
    g.fillStyle(0x0c0920, 0.96).fillRoundedRect(35, 35, 1210, 650, 32);
    g.lineStyle(1, 0x2cefff, 0.12);
    for (let x = 70; x < 1240; x += 70) g.lineBetween(x, 55, x, 665);
    for (let y = 70; y < 670; y += 70) g.lineBetween(55, y, 1225, y);
    g.lineStyle(2, 0xa84dff, 0.46).strokeRoundedRect(35, 35, 1210, 650, 32);
    g.lineStyle(1, 0x2cefff, 0.28).strokeCircle(640, 360, 245).strokeCircle(640, 360, 410);
    const points = Array.from({ length: 12 }, (_, i) => new Phaser.Geom.Point(Math.cos(i * Math.PI / 6) * (i % 2 ? 105 : 118), Math.sin(i * Math.PI / 6) * (i % 2 ? 105 : 118)));
    const core = this.add.polygon(640, 360, points, 0x45106c, 0.08).setStrokeStyle(2, 0xa84dff, 0.22).setDepth(-8);
    this.tweens.add({ targets: core, angle: 360, duration: 28000, repeat: -1 });
    this.scan = this.add.rectangle(640, 55, 1160, 2, 0x2cefff, 0.08).setDepth(-7);
    this.tweens.add({ targets: this.scan, y: 665, alpha: 0.22, duration: 4200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.stormRing = this.add.graphics().setDepth(800);
    this.stormGlow = this.add.graphics().setDepth(-5);
  }

  syncState(state) {
    if (!this.sys?.isActive()) {
      this.pendingState = state;
      return;
    }
    this.state = state;
    for (const player of state.players || []) this.ensureFighter(player);
    const activeIds = new Set((state.players || []).map((player) => player.id));
    for (const [id, fighter] of this.fighters) if (!activeIds.has(id)) this.destroyFighter(id, fighter);
    this.applyArenaTheme(state.settings?.arenaBackground);
    this.drawStorm(state.storm || 0);
    this.syncBoss(state.boss);
    this.syncHazards(state.hazards || []);
  }

  ensureFighter(player) {
    let fighter = this.fighters.get(player.id);
    if (!fighter) {
      const skinColor = SKIN_COLORS[player.skin % SKIN_COLORS.length];
      const shadow = this.add.ellipse(0, 20, 62, 20, 0x000000, 0.5);
      const glow = this.add.circle(0, -4, 35, skinColor, 0.12).setStrokeStyle(2, skinColor, 0.45).setBlendMode(Phaser.BlendModes.ADD);
      const teamAura = this.add.circle(0, -4, 39, 0x35eaff, 0.06).setStrokeStyle(3, 0x35eaff, 0.9).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
      const starAura = this.add.circle(0, -4, 47, 0xffd24d, 0.07).setStrokeStyle(4, 0xffd24d, 0.95).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
      const ball = this.add.circle(0, -4, 24, skinColor, 1).setStrokeStyle(4, 0xffffff, 0.72);
      const inner = this.add.circle(0, -4, 17, 0x0b0820, 0.35).setStrokeStyle(1, 0xffffff, 0.14);
      const crown = this.add.text(0, -78, '👑', { fontSize: '25px' }).setOrigin(0.5).setVisible(false);
      const starBadge = this.add.text(0, -82, '★', { fontFamily: 'Arial', fontSize: '22px', fontStyle: 'bold', color: '#ffd24d', stroke: '#4a2500', strokeThickness: 4 }).setOrigin(0.5).setVisible(false);
      const name = this.add.text(0, -52, `@${player.username || player.id}`, { fontFamily: 'Arial', fontSize: '13px', fontStyle: 'bold', color: '#ffffff', stroke: '#05030c', strokeThickness: 5 }).setOrigin(0.5);
      const hpBg = this.add.rectangle(0, -34, 68, 8, 0x160f24).setStrokeStyle(1, 0xffffff, 0.12);
      const hp = this.add.rectangle(-34, -34, 68, 6, 0x75ff4d).setOrigin(0, 0.5);
      const shield = this.add.rectangle(-34, -25, 0, 4, 0x2cefff).setOrigin(0, 0.5);
      const container = this.add.container(player.x, player.y, [shadow, glow, teamAura, starAura, ball, inner, crown, starBadge, name, hpBg, hp, shield]).setDepth(player.y).setScale(0.2).setAlpha(0);
      fighter = { container, glow, teamAura, starAura, starBadge, crown, ball, inner, name, hp, shield, data: player, wasAlive: true, trailAt: 0, starTrailAt: 0 };
      this.fighters.set(player.id, fighter);
      this.vfx.attachBloom(glow, 1.25);
      this.vfx.attachBloom(ball, 0.85);
      this.tweens.add({ targets: crown, y: -85, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.tweens.add({ targets: starBadge, y: -88, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.tweens.add({ targets: container, scale: 1, alpha: 1, duration: 520, ease: 'Back.easeOut' });
      this.vfx.burst(player.x, player.y, skinColor, 14, 70);
      sfx('join');
    } else if (fighter.data) {
      const previousHp = Number(fighter.data.hp || 0);
      const nextHp = Number(player.hp || 0);
      if (player.alive && nextHp < previousHp - 0.5) this.vfx.damageNumber(fighter.container.x, fighter.container.y - 38, previousHp - nextHp);
      else if (player.alive && nextHp > previousHp + 0.5) this.vfx.damageNumber(fighter.container.x, fighter.container.y - 38, nextHp - previousHp, { heal: true });
    }

    if (fighter.wasAlive && !player.alive) this.eliminationEffect(fighter);
    if (!fighter.wasAlive && player.alive) {
      fighter.eliminating = false;
      fighter.container.setAlpha(1).setScale(1).setAngle(0);
    }
    const teamColor = TEAM_COLORS[player.team] || TEAM_COLORS.blue;
    const starActive = Boolean(player.alive && player.starPowerUntil);
    const baseColor = starActive ? 0xffd24d : this.state?.settings?.teamMode ? teamColor : SKIN_COLORS[player.skin % SKIN_COLORS.length];
    fighter.data = player;
    fighter.wasAlive = player.alive;
    fighter.name.setText(`@${player.username || player.id}${starActive ? ` • HYPE ${player.hype || 0}` : ''}`);
    fighter.hp.width = 68 * Number(player.hp || 0) / Math.max(1, Number(player.maxHp || 100));
    fighter.shield.width = 68 * Math.min(100, Number(player.shield || 0)) / 100;
    fighter.teamAura.setFillStyle(teamColor, 0.06).setStrokeStyle(3, teamColor, 0.9).setVisible(Boolean(this.state?.settings?.teamMode && player.alive && !starActive));
    fighter.starAura.setVisible(starActive);
    fighter.starBadge.setVisible(starActive);
    fighter.ball.setFillStyle(baseColor, 1);
    fighter.crown.setVisible(Boolean(player.alive && this.state?.bountyTargetId === player.id));
    if (player.avatarUrl && fighter.avatarLoadedUrl !== player.avatarUrl && fighter.avatarLoadingUrl !== player.avatarUrl) this.loadAvatar(fighter, player);
    if (player.alive) fighter.container.setAlpha(1);
    return fighter;
  }

  applyArenaTheme(name = 'default') {
    const allowed = ['default', 'cyberpunk', 'space', 'retro'];
    const next = allowed.includes(name) ? name : 'default';
    if (this.currentArena === next) return;
    this.currentArena = next;
    const palettes = { default: [0x2c0f50, 0.08], cyberpunk: [0xff1493, 0.12], space: [0x173b8f, 0.13], retro: [0xff7a18, 0.1] };
    this.arenaTint?.setFillStyle(...palettes[next]);
  }

  loadAvatar(fighter, player) {
    const hash = [...`${player.platformUserId || player.id}:${player.avatarUrl}`].reduce((n, c) => ((n * 31 + c.charCodeAt(0)) >>> 0), 7).toString(36);
    const key = `avatar-${hash}`;
    fighter.avatarLoadingUrl = player.avatarUrl;
    let finished = false;
    const cleanup = () => {
      this.load.off(`filecomplete-image-${key}`, success);
      this.load.off('loaderror', failure);
      clearTimeout(timer);
    };
    const failure = (file) => {
      if (file?.key && file.key !== key) return;
      if (finished) return;
      finished = true;
      cleanup();
      fighter.avatarLoadingUrl = null;
      if (this.textures.exists(key)) this.textures.remove(key);
    };
    const success = () => {
      if (finished) return;
      finished = true;
      cleanup();
      if (!this.fighters.has(player.id) || !this.textures.exists(key) || this.textures.get(key).key === '__MISSING') {
        fighter.avatarLoadingUrl = null;
        if (this.textures.exists(key)) this.textures.remove(key);
        return;
      }
      fighter.avatar?.destroy();
      fighter.avatarMaskGraphic?.destroy();
      const image = this.add.image(0, -4, key).setDisplaySize(40, 40);
      const maskGraphic = this.make.graphics({ add: false });
      maskGraphic.fillStyle(0xffffff).fillCircle(0, -4, 20).setVisible(false);
      fighter.container.addAt(image, 6);
      fighter.container.add(maskGraphic);
      image.setMask(maskGraphic.createGeometryMask());
      fighter.avatar = image;
      fighter.avatarMaskGraphic = maskGraphic;
      fighter.avatarTextureKey = key;
      fighter.avatarLoadedUrl = player.avatarUrl;
      fighter.avatarLoadingUrl = null;
    };
    const timer = setTimeout(() => failure(), 5000);
    this.load.once(`filecomplete-image-${key}`, success);
    this.load.on('loaderror', failure);
    this.load.image(key, player.avatarUrl);
    if (!this.load.isLoading()) this.load.start();
  }

  destroyFighter(id, fighter) {
    this.tweens.killTweensOf(fighter.container);
    this.tweens.killTweensOf(fighter.crown);
    this.tweens.killTweensOf(fighter.starBadge);
    fighter.avatar?.clearMask(true);
    fighter.avatarMaskGraphic?.destroy();
    fighter.container.destroy();
    if (fighter.avatarTextureKey && this.textures.exists(fighter.avatarTextureKey)) this.textures.remove(fighter.avatarTextureKey);
    this.fighters.delete(id);
  }

  drawStorm(value) {
    this.stormRing.clear();
    this.stormGlow.clear();
    if (!value) return;
    const radius = Math.max(90, 575 - value * 4.2);
    const thickness = Math.min(150, 16 + value * 1.15);
    this.stormGlow.lineStyle(thickness + 25, 0x6d17bb, 0.07 + value / 1600).strokeCircle(640, 360, radius);
    this.stormRing.lineStyle(thickness, value > 70 ? 0xff2c88 : 0xa52cff, 0.2 + value / 420).strokeCircle(640, 360, radius);
    this.stormRing.lineStyle(2, 0xffffff, 0.35).strokeCircle(640, 360, radius - thickness / 2);
  }

  floatingText(x, y, text, color = '#ffffff', size = 22) {
    const label = this.add.text(x, y, text, { fontFamily: 'Arial', fontSize: `${size}px`, fontStyle: 'bold', color, stroke: '#09020f', strokeThickness: 6 }).setOrigin(0.5).setDepth(2300).setScale(0.7);
    this.tweens.add({ targets: label, y: y - 65, scale: 1.05, alpha: 0, duration: 850, ease: 'Cubic.easeOut', onComplete: () => label.destroy() });
  }

  shieldEffect(fighter, premium = false) {
    const color = premium ? 0xffd24d : 0x2cefff;
    this.vfx.ring(fighter.container.x, fighter.container.y, color, 28, 3, 720, 5);
    this.vfx.burst(fighter.container.x, fighter.container.y, color, 18, 90);
    sfx('shield');
  }

  triggerGift(event = {}) {
    this.vfx.giftCinematic(event);
    const fighter = this.fighters.get(event.targetPlayerId);
    const premium = event.tier === 'premium';
    if (premium) this.juice.impact({ duration: 70, shake: 0.012, flash: true, color: { r: 255, g: 210, b: 77 } });
    else if (event.tier === 'event') this.juice.shake(240, 0.008);
    if (!fighter) return;
    if (event.effect === 'entry-boost') {
      this.vfx.burst(fighter.container.x, fighter.container.y, 0x2cefff, 20, 110);
      this.floatingText(fighter.container.x, fighter.container.y - 45, 'BOOST DE ENTRADA 1.2X', '#2cefff', 18);
    } else if (event.effect === 'tactical-shield') {
      this.shieldEffect(fighter, false);
    } else if (event.effect === 'speed') {
      this.vfx.burst(fighter.container.x, fighter.container.y, 0x2cefff, 20, 115);
      this.floatingText(fighter.container.x, fighter.container.y - 45, 'IMPULSO NEON', '#2cefff', 18);
      sfx('boost');
    } else if (event.effect === 'extra-projectile' && event.result?.targetId) {
      this.renderCombatShot({ attackerId: event.targetPlayerId, targetId: event.result.targetId, gift: true, damage: event.result.damageApplied });
    } else if (event.effect === 'meteor') {
      this.juice.flash({ r: 255, g: 174, b: 44 }, 150, 0.09);
      sfx('meteor');
    } else if (event.effect === 'star-power') {
      this.vfx.burst(fighter.container.x, fighter.container.y, 0xffd24d, 34, 180);
      this.floatingText(fighter.container.x, fighter.container.y - 52, `STAR POWER • +${event.result?.hypeGain || 100} HYPE`, '#ffd24d', 21);
      sfx('legendary');
    } else if (event.effect === 'colossus') {
      this.vfx.burst(640, 360, 0xffd24d, 40, 260);
      sfx('boss');
    }
  }

  renderCombatShot(event = {}) {
    const attacker = this.fighters.get(event.attackerId);
    const target = this.fighters.get(event.targetId);
    if (!attacker || !target) return;
    const projectile = this.acquireProjectile();
    if (!projectile) return;
    const color = event.gift ? 0x75ff4d : 0x2cefff;
    projectile.setPosition(attacker.container.x, attacker.container.y - 8).setFillStyle(color, 1).setStrokeStyle(2, 0xffffff).setVisible(true).setActive(true);
    this.tweens.add({
      targets: projectile,
      x: target.container.x,
      y: target.container.y,
      duration: event.gift ? 210 : 260,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.releaseProjectile(projectile);
        this.vfx.burst(target.container.x, target.container.y, color, event.gift ? 16 : 9, event.gift ? 75 : 48);
        this.juice.hitStop(event.eliminated ? 72 : 38, event.eliminated ? 0.012 : 0.0045);
        if (event.eliminated) this.eliminationEffect(target, event.attackerId);
        sfx(event.eliminated ? 'elimination' : 'hit');
      },
    });
  }

  syncBoss(boss) {
    if (!boss?.active) {
      this.destroyBossView();
      this.lastBossPhase = 0;
      return;
    }
    const phase = phaseForBoss(boss);
    if (!this.bossView) {
      const pulse = this.add.circle(0, 0, 80, phase.color, 0.13).setStrokeStyle(5, phase.color, 0.82).setBlendMode(Phaser.BlendModes.ADD);
      const body = this.add.circle(0, 0, 59, 0x250837, 1).setStrokeStyle(6, phase.color, 1);
      const core = this.add.circle(0, 0, 21, phase.color, 0.85).setStrokeStyle(3, 0xffffff, 0.75).setBlendMode(Phaser.BlendModes.ADD);
      const rune = this.add.text(0, -2, 'C', { fontFamily: 'Arial Black, Arial', fontSize: '46px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5);
      const title = this.add.text(0, -103, 'COLOSSUS NEON', { fontFamily: 'Arial', fontSize: '18px', fontStyle: 'bold', color: '#f2ddff', stroke: '#100019', strokeThickness: 5 }).setOrigin(0.5);
      const phaseText = this.add.text(0, -79, `FASE ${phase.id} • ${phase.name}`, { fontFamily: 'Arial', fontSize: '12px', fontStyle: 'bold', color: '#ffd7ff', stroke: '#100019', strokeThickness: 4 }).setOrigin(0.5);
      const hpBg = this.add.rectangle(-90, 86, 180, 12, 0x160820).setOrigin(0, 0.5).setStrokeStyle(1, 0xffffff, 0.2);
      const hp = this.add.rectangle(-90, 86, 180, 8, phase.color).setOrigin(0, 0.5);
      const container = this.add.container(boss.x, boss.y, [pulse, body, core, rune, title, phaseText, hpBg, hp]).setDepth(980).setScale(0.1).setAlpha(0);
      const tween = this.tweens.add({ targets: pulse, scale: 1.22, alpha: 0.38, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.bossView = { container, hp, pulse, body, core, phaseText, tween, attackId: null, warning: null, hpValue: boss.hp };
      this.vfx.attachBloom(core, 1.45);
      this.tweens.add({ targets: container, scale: 1, alpha: 1, duration: 650, ease: 'Back.easeOut' });
      this.vfx.burst(boss.x, boss.y, phase.color, 38, 240, 800);
      this.juice.shake(450, 0.01);
      sfx('boss');
    }

    const previousHp = Number(this.bossView.hpValue || boss.hp);
    if (boss.hp < previousHp) this.vfx.damageNumber(boss.x, boss.y - 72, previousHp - boss.hp, { critical: phase.id >= 2 });
    this.bossView.hpValue = boss.hp;
    this.bossView.container.setPosition(boss.x, boss.y);
    this.bossView.hp.width = 180 * boss.hp / Math.max(1, boss.maxHp);
    this.bossView.hp.setFillStyle(phase.color, 1);
    this.bossView.pulse.setFillStyle(phase.color, 0.13).setStrokeStyle(5, phase.color, 0.82);
    this.bossView.body.setStrokeStyle(phase.id === 3 ? 8 : 6, phase.color, 1);
    this.bossView.core.setFillStyle(phase.color, 0.9);
    this.bossView.phaseText.setText(`FASE ${phase.id} • ${phase.name}`);
    this.bossView.container.setScale(phase.id === 3 ? 1.12 : phase.id === 2 ? 1.06 : 1);

    if (this.lastBossPhase && phase.id !== this.lastBossPhase) this.bossPhaseChanged(phase);
    this.lastBossPhase = phase.id;

    const attack = boss.attack;
    if (attack && this.bossView.attackId !== attack.id) {
      if (this.bossView.warning) {
        this.tweens.killTweensOf(this.bossView.warning);
        this.bossView.warning.destroy();
      }
      const warningColor = phase.id === 3 ? 0xff315f : 0xff3f86;
      const warning = this.add.circle(attack.x, attack.y, attack.radius, warningColor, 0.07).setStrokeStyle(5, warningColor, 0.95).setDepth(900).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: warning, alpha: 0.32, scale: 0.9, duration: phase.id === 3 ? 300 : 450, yoyo: true, repeat: 5 });
      this.bossView.warning = warning;
      this.bossView.attackId = attack.id;
      sfx('warning');
    } else if (!attack && this.bossView.warning) {
      this.tweens.killTweensOf(this.bossView.warning);
      this.bossView.warning.destroy();
      this.bossView.warning = null;
      this.bossView.attackId = null;
    }
  }

  bossPhaseChanged(phaseOrPayload = {}) {
    const phase = phaseOrPayload.id ? phaseOrPayload : phaseForBoss({ hp: phaseOrPayload.hp, maxHp: phaseOrPayload.maxHp });
    if (phase.id <= 1) return;
    const title = this.add.text(640, 210, `COLOSSUS • FASE ${phase.id}\n${phase.name}`, {
      align: 'center', fontFamily: 'Arial Black, Arial', fontSize: phase.id === 3 ? '44px' : '38px', fontStyle: 'bold italic', color: phase.id === 3 ? '#ff5b7f' : '#ffb04a', stroke: '#130018', strokeThickness: 10,
    }).setOrigin(0.5).setDepth(2600).setScale(0.4).setAlpha(0);
    this.tweens.chain({ targets: title, tweens: [{ scale: 1.05, alpha: 1, duration: 330, ease: 'Back.easeOut' }, { duration: 650 }, { y: 175, alpha: 0, duration: 390 }], onComplete: () => title.destroy() });
    this.vfx.burst(640, 360, phase.color, phase.id === 3 ? 40 : 30, phase.id === 3 ? 320 : 240);
    this.juice.bossPhase(phase.id);
    sfx(phase.id === 3 ? 'boss-critical' : 'boss-phase');
  }

  renderBossAttack(event = {}) {
    if (event.reason === 'attack-warning') {
      const target = this.fighters.get(event.targetPlayerId);
      if (target) this.vfx.ring(target.container.x, target.container.y, 0xff315f, 38, 2.3, 760, 4);
      return;
    }
    if (event.reason === 'attack-resolved') {
      for (const id of event.impactedPlayerIds || []) {
        const fighter = this.fighters.get(id);
        if (fighter) {
          this.vfx.burst(fighter.container.x, fighter.container.y, 0xff315f, 18, 105);
        }
      }
      this.juice.impact({ duration: 62, shake: 0.011, flash: true });
      sfx('explosion');
    }
  }

  destroyBossView() {
    if (!this.bossView) return;
    if (this.bossView.warning) {
      this.tweens.killTweensOf(this.bossView.warning);
      this.bossView.warning.destroy();
    }
    this.bossView.tween?.stop();
    this.tweens.killTweensOf(this.bossView.container);
    this.bossView.container.destroy();
    this.bossView = null;
  }

  syncHazards(hazards) {
    const active = new Set();
    for (const hazard of hazards.slice(-12)) {
      active.add(hazard.id);
      let view = this.hazardViews.get(hazard.id);
      if (!view) {
        const circle = this.add.circle(hazard.x, hazard.y, hazard.radius, 0xff9f2f, 0.055).setStrokeStyle(4, 0xffc24c, 0.95).setDepth(880).setBlendMode(Phaser.BlendModes.ADD);
        const countdown = this.add.text(hazard.x, hazard.y, 'IMPACTO', { fontFamily: 'Arial Black, Arial', fontSize: '13px', color: '#ffd28a', stroke: '#180900', strokeThickness: 5 }).setOrigin(0.5).setDepth(890);
        const tween = this.tweens.add({ targets: circle, scale: 0.9, alpha: 0.3, duration: 420, yoyo: true, repeat: -1 });
        view = { circle, countdown, tween, resolved: false };
        this.hazardViews.set(hazard.id, view);
        sfx('warning');
      }
      if (hazard.resolved && !view.resolved) {
        view.resolved = true;
        view.tween.stop();
        view.circle.setVisible(false);
        view.countdown.setVisible(false);
        this.vfx.burst(hazard.x, hazard.y, 0xff9f2f, 34, 165);
        this.juice.impact({ duration: 58, shake: 0.009, flash: true, color: { r: 255, g: 159, b: 47 } });
        sfx('explosion');
      }
    }
    for (const [id, view] of this.hazardViews) {
      if (active.has(id)) continue;
      view.tween?.stop();
      view.circle.destroy();
      view.countdown?.destroy();
      this.hazardViews.delete(id);
    }
  }

  renderMeteorImpact(payload = {}) {
    this.vfx.burst(payload.x || 640, payload.y || 360, 0xff9f2f, 38, 180);
    this.juice.impact({ duration: 62, shake: 0.01, flash: true, color: { r: 255, g: 159, b: 47 } });
    sfx('meteor');
  }

  eliminationEffect(fighter, attackerId = '') {
    if (fighter.eliminating) return;
    fighter.eliminating = true;
    fighter.wasAlive = false;
    this.vfx.burst(fighter.container.x, fighter.container.y, 0xff315f, 28, 125);
    this.vfx.ring(fighter.container.x, fighter.container.y, 0xff315f, 24, 3.2, 520, 5);
    this.floatingText(fighter.container.x, fighter.container.y - 45, 'ELIMINADO', '#ff426b', 25);
    this.juice.impact({ duration: 68, shake: 0.009, flash: Boolean(attackerId) });
    sfx('elimination');
    this.tweens.add({ targets: fighter.container, scale: 1.35, angle: 12, alpha: 0.16, duration: 520, ease: 'Back.easeIn', onComplete: () => fighter.container.setScale(1).setAngle(0).setAlpha(0.16) });
  }

  battleStart() {
    const title = this.add.text(640, 360, 'BATALHA INICIADA', { fontFamily: 'Arial Black, Arial', fontSize: '58px', fontStyle: 'bold italic', color: '#ffffff', stroke: '#a52cff', strokeThickness: 8 }).setOrigin(0.5).setDepth(2500).setScale(0.3).setAlpha(0);
    this.tweens.chain({ targets: title, tweens: [{ scale: 1.1, alpha: 1, duration: 420, ease: 'Back.easeOut' }, { scale: 1, duration: 700 }, { scale: 1.6, alpha: 0, duration: 360 }], onComplete: () => title.destroy() });
    this.vfx.burst(640, 360, 0x2cefff, 36, 300);
    this.juice.flash({ r: 44, g: 239, b: 255 }, 350, 0.12);
    sfx('start');
  }

  suddenDeath() {
    const title = this.add.text(640, 250, 'MORTE SÚBITA', { fontFamily: 'Arial Black, Arial', fontSize: '62px', fontStyle: 'bold italic', color: '#ff426b', stroke: '#24000c', strokeThickness: 10 }).setOrigin(0.5).setDepth(2500).setScale(0.45).setAlpha(0);
    this.tweens.chain({ targets: title, tweens: [{ scale: 1.08, alpha: 1, duration: 360, ease: 'Back.easeOut' }, { scale: 1, duration: 1000 }, { y: 205, alpha: 0, duration: 420 }], onComplete: () => title.destroy() });
    this.juice.impact({ duration: 75, shake: 0.012, flash: true });
    sfx('storm');
  }

  battleEnd(winner) {
    const fighter = winner && this.fighters.get(winner.id);
    const x = fighter?.container.x || 640;
    const y = fighter?.container.y || 360;
    this.vfx.burst(x, y, 0x75ff4d, 40, 260);
    this.vfx.ring(x, y, 0xffd24d, 55, 4, 950, 8);
    this.juice.flash({ r: 255, g: 210, b: 77 }, 320, 0.12);
    sfx('win');
  }

  stormSurge(value) {
    this.juice.flash({ r: 142, g: 35, b: 255 }, 180, 0.11);
    this.floatingText(640, 165, `TEMPESTADE ${value}%`, '#d576ff', 26);
    sfx('storm');
  }

  likeBurst() {
    this.vfx.burst(640, 360, 0xff4d9d, 34, 220);
    this.floatingText(640, 330, '500 CURTIDAS • TEMPESTADE RECUOU', '#ff75b8', 22);
    sfx('like');
  }

  update(time, delta) {
    if (!this.state || this.juice?.isHitStopped()) return;
    const alive = [...this.fighters.values()].filter((fighter) => fighter.data.alive);
    for (const fighter of alive) {
      const dx = (fighter.data.x ?? fighter.container.x) - fighter.container.x;
      const dy = (fighter.data.y ?? fighter.container.y) - fighter.container.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.5) {
        const blend = Math.min(1, delta / 150);
        fighter.container.x += dx * blend;
        fighter.container.y += dy * blend;
        fighter.container.setDepth(fighter.container.y);
      }
      fighter.glow.alpha = 0.1 + (Math.sin(time / 180) + 1) * 0.035;
      fighter.ball.setScale(1 + Math.sin(time / 160 + fighter.container.x) * 0.025);
      if ((fighter.data.speedMultiplier || 1) > 1 && time > fighter.trailAt) {
        fighter.trailAt = time + 85;
        this.vfx.trail(fighter.container.x, fighter.container.y + 18, 0x2cefff, 0.48);
      }
      if (fighter.data.starPowerUntil && time > fighter.starTrailAt) {
        fighter.starTrailAt = time + 110;
        this.vfx.trail(fighter.container.x + Phaser.Math.Between(-22, 22), fighter.container.y + Phaser.Math.Between(-20, 20), 0xffd24d, 0.42);
      }
    }
  }

  cleanupScene() {
    this.input.off('pointerdown');
    this.destroyBossView();
    for (const [id, fighter] of this.fighters) this.destroyFighter(id, fighter);
    for (const view of this.hazardViews.values()) {
      view.tween?.stop();
      view.circle.destroy();
      view.countdown?.destroy();
    }
    this.hazardViews.clear();
    for (const item of this.projectilePool || []) item.destroy();
    this.projectilePool = [];
    this.vfx?.destroy();
    this.juice?.destroy();
  }
}
