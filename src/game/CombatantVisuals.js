import Phaser from 'phaser';
import { combatantPresetFor, visualQualityFor } from './visualPresets.js';

const TEAM_COLORS = { blue: 0x35eaff, red: 0xff334e };

export function decorateCombatant(scene, fighter, player) {
  const preset = combatantPresetFor(player);
  if (fighter.materialId !== preset.id) {
    fighter.materialRing?.destroy(); fighter.materialCore?.destroy(); fighter.materialAccent?.destroy();
    const ring = scene.add.circle(0, -4, 29, preset.primary, 0.025).setStrokeStyle(2, preset.secondary, 0.56).setBlendMode(Phaser.BlendModes.ADD);
    const core = scene.add.circle(0, -4, 8, preset.secondary, 0.18).setStrokeStyle(1, preset.primary, 0.5).setBlendMode(Phaser.BlendModes.ADD);
    const accent = scene.add.graphics();
    drawPattern(accent, preset);
    fighter.container.addAt(ring, 4); fighter.container.addAt(accent, 6); fighter.container.addAt(core, 7);
    Object.assign(fighter, { materialRing: ring, materialCore: core, materialAccent: accent, materialId: preset.id });
    scene.vfx?.attachBloom?.(ring, visualQualityFor(scene.state?.settings?.effectIntensity).bloom);
  }
  applyMaterial(scene, fighter, player, preset);
  return fighter;
}

function drawPattern(g, preset) {
  g.clear(); g.lineStyle(2, preset.secondary, 0.62);
  if (preset.pattern === 'ring' || preset.pattern === 'orbit') {
    g.strokeEllipse(0, -4, 42, preset.pattern === 'orbit' ? 18 : 30);
    if (preset.pattern === 'orbit') g.fillStyle(preset.accent, 0.9).fillCircle(20, -4, 3);
  } else if (preset.pattern === 'flare') {
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.lineBetween(Math.cos(a) * 17, -4 + Math.sin(a) * 17, Math.cos(a) * 25, -4 + Math.sin(a) * 25); }
  } else if (preset.pattern === 'crystal') {
    g.strokeTriangle(0, -23, 19, 8, -19, 8); g.strokeTriangle(0, 15, 15, -7, -15, -7);
  } else if (preset.pattern === 'void') {
    g.strokeCircle(0, -4, 18); g.lineStyle(3, preset.accent, 0.72).strokeCircle(0, -4, 11);
  } else if (preset.pattern === 'crown') {
    g.lineBetween(-18, 8, -13, -13); g.lineBetween(-13, -13, -4, -5); g.lineBetween(-4, -5, 4, -16); g.lineBetween(4, -16, 12, -5); g.lineBetween(12, -5, 18, -13); g.lineBetween(18, -13, 18, 8);
  } else if (preset.pattern === 'bubbles') {
    g.strokeCircle(-10, -10, 5).strokeCircle(8, 3, 4).strokeCircle(11, -14, 3);
  } else if (preset.pattern === 'circuit') {
    g.lineBetween(-18, -12, -7, -12).lineBetween(-7, -12, -7, 8).lineBetween(-7, 8, 9, 8).lineBetween(9, 8, 9, -3).lineBetween(9, -3, 19, -3);
    g.fillStyle(preset.accent, 1).fillCircle(-18, -12, 2).fillCircle(19, -3, 2);
  }
}

function applyMaterial(scene, fighter, player, preset) {
  const teamMode = Boolean(scene.state?.settings?.teamMode);
  const starActive = Boolean(player.alive && player.starPowerUntil);
  const teamColor = TEAM_COLORS[player.team] || TEAM_COLORS.blue;
  const primary = starActive ? 0xffd24d : teamMode ? teamColor : preset.primary;
  const secondary = starActive ? 0xfff3b0 : preset.secondary;
  fighter.ball.setFillStyle(primary, 1).setStrokeStyle(4, secondary, 0.82);
  fighter.glow.setFillStyle(primary, 0.1).setStrokeStyle(2, primary, 0.38);
  fighter.materialRing?.setStrokeStyle(starActive ? 3 : 2, secondary, starActive ? 0.8 : 0.5);
  fighter.materialCore?.setFillStyle(secondary, starActive ? 0.3 : 0.16).setStrokeStyle(1, primary, 0.55);
  if (fighter.materialAccent) drawPattern(fighter.materialAccent, { ...preset, primary, secondary });
  fighter.materialPreset = { ...preset, trail: starActive ? 0xffd24d : teamMode ? teamColor : preset.trail };
}

export function updateCombatantVisuals(scene, fighter, time) {
  if (!fighter?.data?.alive || !fighter.materialPreset) return;
  const preset = fighter.materialPreset;
  const quality = visualQualityFor(scene.state?.settings?.effectIntensity || 'NORMAL');
  const pulse = 1 + Math.sin(time / 260 + fighter.container.x * 0.01) * ((preset.pulse || 1.04) - 1);
  fighter.materialRing?.setScale(pulse);
  fighter.materialAccent?.setRotation(preset.pattern === 'orbit' ? time / 1600 : 0);
  const moving = Math.hypot((fighter.data.x ?? fighter.container.x) - fighter.container.x, (fighter.data.y ?? fighter.container.y) - fighter.container.y) > 1;
  if (moving && time > (fighter.materialTrailAt || 0)) {
    fighter.materialTrailAt = time + quality.trailInterval;
    scene.vfx.trail(fighter.container.x, fighter.container.y + 18, preset.trail, quality.id === 'REDUCED' ? 0.28 : 0.38);
  }
}
