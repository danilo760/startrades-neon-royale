import Phaser from 'phaser';
import { sfx } from '../audio.js';

const PHASE = {
  1: { color: 0xb34dff, core: 0x7d32ff },
  2: { color: 0xff8a2b, core: 0xffd24d },
  3: { color: 0xff315f, core: 0xffffff },
};

const phaseId = (boss = {}) => Number(boss.phase) || (Number(boss.hp || 0) / Math.max(1, Number(boss.maxHp || 1)) <= 0.33 ? 3 : Number(boss.hp || 0) / Math.max(1, Number(boss.maxHp || 1)) <= 0.66 ? 2 : 1);

export function syncColossus(scene, boss) {
  if (!boss?.active) {
    destroyColossus(scene);
    scene.lastBossPhase = 0;
    return;
  }
  const phase = phaseId(boss);
  const palette = PHASE[phase];
  if (!scene.bossView) createColossus(scene, boss, phase, palette);
  const view = scene.bossView;
  view.container.setPosition(boss.x, boss.y).setDepth(980);
  view.hp.width = 180 * Math.max(0, Number(boss.hp || 0)) / Math.max(1, Number(boss.maxHp || 1));
  view.hp.setFillStyle(palette.color, 1);
  view.phaseText.setText(`FASE ${phase} • ${boss.phaseName || ['','DESPERTAR','FÚRIA NEON','NÚCLEO CRÍTICO'][phase]}`);
  view.phaseText.setColor(`#${palette.color.toString(16).padStart(6, '0')}`);
  view.core.setFillStyle(palette.core, boss.coreOpen ? 0.95 : 0.32).setStrokeStyle(boss.coreOpen ? 5 : 2, palette.color, boss.coreOpen ? 1 : 0.62);
  view.coreGlow.setFillStyle(palette.color, boss.coreOpen ? 0.22 : 0.07).setStrokeStyle(2, palette.color, boss.coreOpen ? 0.8 : 0.3);
  view.armor.setStrokeStyle(boss.armorActive ? 5 : 2, palette.color, boss.armorActive ? 0.75 : 0.16).setAlpha(boss.armorActive ? 1 : 0.35);
  updateWeakPoint(view.leftArm, boss.weakPoints?.find((item) => item.id === 'leftArm'), palette);
  updateWeakPoint(view.rightArm, boss.weakPoints?.find((item) => item.id === 'rightArm'), palette);
  view.weapon.setRotation((boss.attackPattern === 'ROTATING_BEAMS' ? scene.time.now / 350 : Math.sin(scene.time.now / 500) * 0.08));
  view.eyeLeft.setFillStyle(phase === 3 ? 0xffffff : palette.color, 1);
  view.eyeRight.setFillStyle(phase === 3 ? 0xffffff : palette.color, 1);
  view.rage.setVisible(phase >= 2).setAlpha(phase === 3 ? 0.35 : 0.18);
  view.stateText.setText(boss.coreOpen ? 'CORE EXPOSTO' : boss.armorActive ? 'ARMADURA ATIVA' : String(boss.animationState || 'IDLE').replaceAll('_', ' '));
  view.stateText.setColor(boss.coreOpen ? '#ffffff' : `#${palette.color.toString(16).padStart(6, '0')}`);
  if (scene.lastBossPhase && scene.lastBossPhase !== phase) {
    scene.vfx.burst(boss.x, boss.y, palette.color, phase === 3 ? 42 : 30, phase === 3 ? 330 : 240, 850);
    scene.juice.bossPhase(phase);
    sfx(phase === 3 ? 'boss-critical' : 'boss-phase');
  }
  scene.lastBossPhase = phase;
  view.hpValue = boss.hp;
}

function createColossus(scene, boss, phase, palette) {
  const shadow = scene.add.ellipse(0, 72, 190, 42, 0x000000, 0.58);
  const rage = scene.add.circle(0, 0, 112, palette.color, 0.16).setBlendMode(Phaser.BlendModes.ADD).setVisible(phase >= 2);
  const armor = scene.add.circle(0, 2, 76, 0x090514, 0.16).setStrokeStyle(5, palette.color, 0.75);
  const body = scene.add.rectangle(0, 8, 104, 104, 0x151126, 1).setStrokeStyle(4, 0x7655a6, 0.8);
  const chest = scene.add.rectangle(0, 18, 74, 48, 0x080812, 0.95).setStrokeStyle(2, palette.color, 0.55);
  const head = scene.add.rectangle(0, -58, 70, 42, 0x171225, 1).setStrokeStyle(3, palette.color, 0.8);
  const eyeLeft = scene.add.rectangle(-17, -61, 12, 5, palette.color, 1).setBlendMode(Phaser.BlendModes.ADD);
  const eyeRight = scene.add.rectangle(17, -61, 12, 5, palette.color, 1).setBlendMode(Phaser.BlendModes.ADD);
  const leftArm = makeArm(scene, -78, 5, palette);
  const rightArm = makeArm(scene, 78, 5, palette);
  const coreGlow = scene.add.circle(0, 16, 27, palette.color, 0.08).setStrokeStyle(2, palette.color, 0.35).setBlendMode(Phaser.BlendModes.ADD);
  const core = scene.add.circle(0, 16, 17, palette.core, 0.4).setStrokeStyle(2, palette.color, 0.7).setBlendMode(Phaser.BlendModes.ADD);
  const weapon = scene.add.graphics();
  weapon.lineStyle(3, palette.color, 0.7).lineBetween(-34, 0, 34, 0).lineBetween(0, -34, 0, 34);
  weapon.setPosition(0, 16).setBlendMode(Phaser.BlendModes.ADD);
  const title = scene.add.text(0, -110, '⚡ COLOSSUS NEON', { fontFamily: 'Arial Black, Arial', fontSize: '18px', fontStyle: 'bold', color: '#ffffff', stroke: '#090011', strokeThickness: 6 }).setOrigin(0.5);
  const phaseText = scene.add.text(0, -88, '', { fontFamily: 'Arial', fontSize: '12px', fontStyle: 'bold', color: '#ffffff', stroke: '#090011', strokeThickness: 4 }).setOrigin(0.5);
  const stateText = scene.add.text(0, 104, '', { fontFamily: 'Arial', fontSize: '10px', fontStyle: 'bold', color: '#ffffff', stroke: '#05030c', strokeThickness: 4 }).setOrigin(0.5);
  const hpBg = scene.add.rectangle(-90, 86, 180, 12, 0x160820).setOrigin(0, 0.5).setStrokeStyle(1, 0xffffff, 0.2);
  const hp = scene.add.rectangle(-90, 86, 180, 8, palette.color).setOrigin(0, 0.5);
  const container = scene.add.container(boss.x, boss.y, [shadow, rage, armor, body, chest, leftArm.container, rightArm.container, head, eyeLeft, eyeRight, coreGlow, core, weapon, title, phaseText, hpBg, hp, stateText]).setDepth(980).setScale(0.08).setAlpha(0);
  const coreTween = scene.tweens.add({ targets: coreGlow, scale: 1.28, alpha: 0.24, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  const floatTween = scene.tweens.add({ targets: [head, eyeLeft, eyeRight], y: '-=4', duration: 780, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  scene.bossView = { container, hp, rage, armor, body, chest, head, eyeLeft, eyeRight, leftArm, rightArm, coreGlow, core, weapon, title, phaseText, stateText, coreTween, floatTween, attackId: null, warning: null, hpValue: boss.hp };
  scene.vfx.attachBloom(core, 1.5);
  scene.vfx.attachBloom(coreGlow, 1.15);
  scene.tweens.add({ targets: container, scale: 1, alpha: 1, duration: 720, ease: 'Back.easeOut' });
  scene.vfx.burst(boss.x, boss.y, palette.color, 46, 270, 900);
  scene.juice.shake(500, 0.012);
  sfx('boss');
}

function makeArm(scene, x, y, palette) {
  const glow = scene.add.rectangle(0, 0, 38, 72, palette.color, 0.06).setStrokeStyle(2, palette.color, 0.35).setBlendMode(Phaser.BlendModes.ADD);
  const plate = scene.add.rectangle(0, 0, 32, 66, 0x181326, 1).setStrokeStyle(3, palette.color, 0.8);
  const weak = scene.add.circle(0, 5, 7, palette.color, 0.7).setStrokeStyle(2, 0xffffff, 0.6).setBlendMode(Phaser.BlendModes.ADD);
  const container = scene.add.container(x, y, [glow, plate, weak]);
  return { container, glow, plate, weak };
}

function updateWeakPoint(arm, point, palette) {
  if (!arm) return;
  const active = point ? Boolean(point.active) : true;
  const ratio = point ? Number(point.hp || 0) / Math.max(1, Number(point.maxHp || 1)) : 1;
  arm.container.setAlpha(active ? 1 : 0.32).setScale(active ? 1 : 0.92);
  arm.plate.setStrokeStyle(active ? 3 : 1, active ? palette.color : 0x555566, active ? 0.8 : 0.3);
  arm.weak.setFillStyle(active ? (ratio < 0.4 ? 0xff315f : palette.color) : 0x20202c, active ? 0.8 : 0.2);
  arm.glow.setAlpha(active ? 0.12 + ratio * 0.15 : 0.02);
}

export function renderColossusAttack(scene, event = {}) {
  if (!event?.pattern || !String(event.reason || '').startsWith('phase-')) return false;
  const color = PHASE[Number(event.phase) || 1]?.color || 0xff315f;
  if (event.reason === 'phase-warning') {
    if (event.points?.length) for (const point of event.points) scene.vfx.ring(point.x, point.y, color, Number(event.radius || 80), 2.3, Number(event.warningMs || 1200), 4);
    else if (event.axis) {
      const g = scene.add.graphics().setDepth(900);
      g.lineStyle(Math.max(8, Number(event.band || 40) * 2), color, 0.14);
      if (event.axis === 'horizontal') g.lineBetween(55, event.y, 1225, event.y);
      else { g.lineBetween(640, 55, 640, 665); g.lineBetween(55, 360, 1225, 360); }
      scene.tweens.add({ targets: g, alpha: 0, duration: Number(event.warningMs || 1200), onComplete: () => g.destroy() });
    } else scene.vfx.ring(event.x, event.y, color, Number(event.radius || 120), 2.3, Number(event.warningMs || 1200), 4);
    sfx('boss-phase');
    return true;
  }
  if (event.reason === 'phase-impact') {
    scene.vfx.burst(Number(event.x ?? 640), Number(event.y ?? 360), color, 26, Math.max(120, Number(event.radius || 120)), 620);
    scene.juice.shake(Number(event.phase) === 3 ? 300 : 220, Number(event.phase) === 3 ? 0.009 : 0.006);
    return true;
  }
  return false;
}

export function destroyColossus(scene) {
  if (!scene.bossView) return;
  scene.bossView.warning?.destroy?.();
  scene.bossView.coreTween?.stop?.();
  scene.bossView.floatTween?.stop?.();
  scene.tweens.killTweensOf(scene.bossView.container);
  scene.bossView.container.destroy();
  scene.bossView = null;
}
