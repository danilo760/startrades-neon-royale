import { duckMusic, sfx } from '../audio.js';

export const AUDIO_LAYERS = Object.freeze({
  shot: { channel: 'SFX', cooldownMs: 35, layers: [{ sound: 'shot', at: 0 }] },
  hit: { channel: 'SFX', cooldownMs: 35, layers: [{ sound: 'hit', at: 0 }] },
  critical: { channel: 'SFX', cooldownMs: 120, layers: [{ sound: 'hit', at: 0 }, { sound: 'lightning', at: 24 }] },
  shield: { channel: 'SFX', cooldownMs: 100, layers: [{ sound: 'shield', at: 0 }] },
  'shield-break': { channel: 'SFX', cooldownMs: 160, layers: [{ sound: 'shield', at: 0 }, { sound: 'explosion', at: 90 }] },
  heal: { channel: 'SFX', cooldownMs: 120, layers: [{ sound: 'heal', at: 0 }, { sound: 'like', at: 90 }] },
  boost: { channel: 'SFX', cooldownMs: 100, layers: [{ sound: 'boost', at: 0 }] },
  meteor: { channel: 'BOSS', cooldownMs: 600, duck: [1500, 0.36], layers: [{ sound: 'warning', at: 0 }, { sound: 'meteor', at: 260 }, { sound: 'explosion', at: 820 }] },
  'laser-charge': { channel: 'BOSS', cooldownMs: 300, layers: [{ sound: 'warning', at: 0 }, { sound: 'laser', at: 280 }] },
  'boss-spawn': { channel: 'BOSS', cooldownMs: 1400, duck: [2200, 0.24], layers: [{ sound: 'boss', at: 0 }, { sound: 'gravity', at: 180 }, { sound: 'legendary', at: 520 }] },
  'boss-phase': { channel: 'BOSS', cooldownMs: 900, duck: [1800, 0.3], layers: [{ sound: 'warning', at: 0 }, { sound: 'boss-phase', at: 160 }, { sound: 'lightning', at: 420 }] },
  'boss-critical': { channel: 'BOSS', cooldownMs: 1200, duck: [2200, 0.22], layers: [{ sound: 'warning', at: 0 }, { sound: 'boss-critical', at: 160 }, { sound: 'explosion', at: 650 }] },
  'boss-overload': { channel: 'BOSS', cooldownMs: 1600, duck: [2500, 0.2], layers: [{ sound: 'boss-critical', at: 0 }, { sound: 'gravity', at: 240 }, { sound: 'explosion', at: 700 }, { sound: 'lightning', at: 820 }] },
  'boss-death': { channel: 'BOSS', cooldownMs: 1800, duck: [2800, 0.18], layers: [{ sound: 'boss-critical', at: 0 }, { sound: 'explosion', at: 260 }, { sound: 'legendary', at: 700 }, { sound: 'win', at: 1040 }] },
  'gift-support': { channel: 'UI', cooldownMs: 120, layers: [{ sound: 'like', at: 0 }] },
  'gift-event': { channel: 'SFX', cooldownMs: 350, layers: [{ sound: 'warning', at: 0 }, { sound: 'boost', at: 140 }] },
  'gift-premium': { channel: 'SFX', cooldownMs: 900, duck: [1600, 0.32], layers: [{ sound: 'legendary', at: 0 }, { sound: 'like', at: 180 }, { sound: 'boost', at: 360 }] },
  victory: { channel: 'UI', cooldownMs: 1500, duck: [2200, 0.3], layers: [{ sound: 'start', at: 0 }, { sound: 'win', at: 320 }] },
  storm: { channel: 'BOSS', cooldownMs: 700, layers: [{ sound: 'storm', at: 0 }, { sound: 'warning', at: 160 }] },
});

const lastPlayedAt = new Map();
const timers = new Set();

export function audioLayerPlan(kind) {
  return AUDIO_LAYERS[kind] || { channel: 'SFX', cooldownMs: 40, layers: [{ sound: kind || 'shot', at: 0 }] };
}

export function playLayeredSfx(kind, { now = performance.now(), schedule = setTimeout } = {}) {
  const plan = audioLayerPlan(kind);
  const last = lastPlayedAt.get(kind) || 0;
  if (now - last < plan.cooldownMs) return false;
  lastPlayedAt.set(kind, now);
  if (plan.duck) duckMusic(plan.duck[0], plan.duck[1]);
  for (const layer of plan.layers) {
    if (!layer.at) { sfx(layer.sound); continue; }
    const timer = schedule(() => { timers.delete(timer); sfx(layer.sound); }, layer.at);
    timer?.unref?.();
    timers.add(timer);
  }
  return true;
}

export function stopAudioLayers() {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  lastPlayedAt.clear();
}
