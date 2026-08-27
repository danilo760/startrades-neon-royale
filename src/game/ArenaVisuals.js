import Phaser from 'phaser';
import { arenaPresetFor, requestedVisualMode, visualQualityFor } from './visualPresets.js';

const inside = (scene, object) => { scene.arenaDecor.add(object); return object; };

export function createArenaVisuals(scene) {
  scene.cameras.main.setBackgroundColor('#05020b');
  scene.arenaBase = scene.add.graphics().setDepth(-22);
  scene.arenaDecor = scene.add.container(0, 0).setDepth(-18);
  scene.arenaForeground = scene.add.graphics().setDepth(-10);
  scene.arenaTint = scene.add.rectangle(640, 360, 1280, 720, 0x2c0f50, 0.05).setDepth(-19);
  scene.stormRing = scene.add.graphics().setDepth(800);
  scene.stormGlow = scene.add.graphics().setDepth(-5);
  scene.currentArena = null;
  applyArenaVisuals(scene, 'default', true);
}

export function applyArenaVisuals(scene, name = 'default', force = false) {
  const theme = arenaPresetFor(name);
  const quality = visualQualityFor(requestedVisualMode(scene));
  if (!force && scene.currentArena === theme.id && scene.currentArenaQuality === quality.id) return;
  scene.currentArena = theme.id;
  scene.currentArenaQuality = quality.id;
  scene.cameras.main.setBackgroundColor(theme.background);
  scene.arenaTint?.setFillStyle(theme.primary, 0.025);
  scene.arenaBase.clear(); scene.arenaForeground.clear(); scene.arenaDecor.removeAll(true);
  const base = scene.arenaBase;
  base.fillStyle(theme.background, 1).fillRect(0, 0, 1280, 720);
  base.fillStyle(theme.floor, 0.98).fillRoundedRect(35, 35, 1210, 650, 32);
  base.lineStyle(3, theme.secondary, 0.56 * quality.decorationAlpha).strokeRoundedRect(35, 35, 1210, 650, 32);
  base.lineStyle(1, theme.primary, 0.24 * quality.decorationAlpha).strokeRoundedRect(44, 44, 1192, 632, 26);
  drawPattern(scene, theme, quality);
  inside(scene, scene.add.text(62, 58, theme.label, {
    fontFamily: 'Arial Black, Arial', fontSize: '12px', fontStyle: 'bold',
    color: `#${theme.primary.toString(16).padStart(6, '0')}`, stroke: '#05020b', strokeThickness: 4,
  }).setAlpha(0.62).setDepth(-6));
  makeAmbient(scene, theme, quality);
}

function drawPattern(scene, theme, quality) {
  const g = scene.arenaForeground;
  if (theme.pattern === 'grid') {
    g.lineStyle(1, theme.primary, 0.105 * quality.decorationAlpha);
    const step = quality.id === 'EMERGENCY' ? 140 : quality.id === 'LOW' ? 105 : 70;
    for (let x = 70; x < 1240; x += step) g.lineBetween(x, 55, x, 665);
    for (let y = 70; y < 670; y += step) g.lineBetween(55, y, 1225, y);
    if (quality.secondaryVfx) g.lineStyle(2, theme.secondary, 0.22).strokeCircle(640, 360, 245).strokeCircle(640, 360, 410);
    return;
  }
  if (theme.pattern === 'city') {
    g.lineStyle(1, theme.primary, 0.13 * quality.decorationAlpha);
    for (let y = 120; y <= 620; y += quality.secondaryVfx ? 100 : 200) g.lineBetween(60, y, 1220, y);
    for (let x = 115; x <= 1180; x += quality.secondaryVfx ? 118 : 236) {
      const h = 36 + (x % 4) * 14;
      g.fillStyle(theme.ambient, 0.34 * quality.decorationAlpha).fillRect(x - 25, 70, 50, h).fillRect(x - 20, 650 - h, 40, h);
      g.lineStyle(2, x % 2 ? theme.primary : theme.secondary, 0.28 * quality.decorationAlpha).lineBetween(x, 70, x, 70 + h).lineBetween(x, 650 - h, x, 650);
    }
    if (quality.secondaryVfx) g.lineStyle(2, theme.secondary, 0.18).strokeRect(180, 170, 920, 380);
    return;
  }
  if (theme.pattern === 'space') {
    g.lineStyle(2, theme.primary, 0.13 * quality.decorationAlpha).strokeEllipse(640, 360, 820, 390);
    if (quality.secondaryVfx) g.strokeEllipse(640, 360, 520, 520).lineStyle(1, theme.secondary, 0.12).strokeCircle(640, 360, 112);
    const stars = quality.id === 'EMERGENCY' ? 2 : quality.id === 'LOW' ? 4 : 7;
    for (let i = 0; i < stars; i++) {
      const a = i * Math.PI * 2 / Math.max(1, stars);
      g.fillStyle(i % 2 ? theme.primary : theme.secondary, 0.22 * quality.decorationAlpha).fillCircle(640 + Math.cos(a) * 440, 360 + Math.sin(a) * 230, 4 + (i % 3));
    }
    return;
  }
  g.lineStyle(2, theme.primary, 0.2 * quality.decorationAlpha);
  const cracks = [[55,190,190,250,250,340],[55,540,190,480,285,405],[1225,170,1090,245,1010,335],[1225,560,1100,485,1010,410],[410,55,470,155,560,210],[870,55,810,155,725,212],[390,665,470,565,560,510],[890,665,810,565,720,510]];
  const count = quality.id === 'EMERGENCY' ? 2 : quality.id === 'LOW' ? 4 : cracks.length;
  for (const [x1,y1,x2,y2,x3,y3] of cracks.slice(0, count)) { g.lineBetween(x1,y1,x2,y2); g.lineBetween(x2,y2,x3,y3); }
  if (quality.secondaryVfx) g.lineStyle(4, theme.secondary, 0.18).strokeCircle(640, 360, 125);
}

function makeAmbient(scene, theme, quality) {
  for (let i = 0; i < quality.ambientCount; i++) {
    const dot = inside(scene, scene.add.circle(70 + ((i * 97) % 1140), 65 + ((i * 61) % 590), i % 5 === 0 ? 2 : 1,
      i % 4 === 0 ? theme.primary : i % 7 === 0 ? theme.secondary : theme.ambient, 0.18 + (i % 4) * 0.06).setDepth(-12));
    if (quality.secondaryVfx && i % 3 === 0) scene.tweens.add({ targets: dot, alpha: 0.06, duration: 1100 + (i % 6) * 250, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }
}

export function drawArenaStorm(scene, value) {
  scene.stormRing.clear(); scene.stormGlow.clear();
  if (!value) return;
  const theme = arenaPresetFor(scene.state?.settings?.arenaBackground || 'default');
  const quality = visualQualityFor(requestedVisualMode(scene));
  const radius = Math.max(90, 575 - value * 4.2);
  const thickness = Math.min(150, 16 + value * 1.15);
  if (quality.id !== 'EMERGENCY') scene.stormGlow.lineStyle(thickness + 28, theme.danger, (0.055 + value / 1700) * quality.decorationAlpha).strokeCircle(640, 360, radius);
  scene.stormRing.lineStyle(thickness, theme.danger, 0.2 + value / 420).strokeCircle(640, 360, radius);
  scene.stormRing.lineStyle(3, theme.primary, 0.28).strokeCircle(640, 360, radius - thickness / 2);
  if (quality.secondaryVfx) scene.stormRing.lineStyle(1, 0xffffff, 0.28).strokeCircle(640, 360, radius + thickness / 2);
}

export function destroyArenaVisuals(scene) { scene.arenaDecor?.removeAll(true); }
