export const COMBATANT_MATERIALS = Object.freeze([
  { id: 'NEON', primary: 0x2cefff, secondary: 0xaef9ff, accent: 0x675cff, trail: 0x2cefff, pulse: 1.04, pattern: 'ring' },
  { id: 'PLASMA', primary: 0xff36d7, secondary: 0xffa6ec, accent: 0x7d32ff, trail: 0xff36d7, pulse: 1.07, pattern: 'orbit' },
  { id: 'FIRE', primary: 0xff6b2c, secondary: 0xffd24d, accent: 0xff2f45, trail: 0xff8a2b, pulse: 1.06, pattern: 'flare' },
  { id: 'ICE', primary: 0x62d7ff, secondary: 0xe8fbff, accent: 0x4386ff, trail: 0x8de8ff, pulse: 1.03, pattern: 'crystal' },
  { id: 'VOID', primary: 0x6f39d8, secondary: 0xc39aff, accent: 0x160525, trail: 0x8b5cff, pulse: 1.08, pattern: 'void' },
  { id: 'GOLD', primary: 0xffc83d, secondary: 0xfff2a6, accent: 0xb96a12, trail: 0xffd24d, pulse: 1.04, pattern: 'crown' },
  { id: 'GALAXY', primary: 0x6f68ff, secondary: 0xff73de, accent: 0x2cefff, trail: 0xa978ff, pulse: 1.05, pattern: 'orbit' },
  { id: 'TOXIC', primary: 0x82ff42, secondary: 0xd9ff65, accent: 0x18a86d, trail: 0x75ff4d, pulse: 1.06, pattern: 'bubbles' },
  { id: 'CYBER', primary: 0x00f0ff, secondary: 0xffffff, accent: 0xff2bc2, trail: 0x00f0ff, pulse: 1.03, pattern: 'circuit' },
]);

export const ARENA_THEMES = Object.freeze({
  default: { id: 'NEON_GRID', label: 'NEON GRID', background: 0x05020b, floor: 0x0c0920, primary: 0x2cefff, secondary: 0xa84dff, danger: 0xff2c88, ambient: 0x7257a8, pattern: 'grid' },
  cyberpunk: { id: 'CYBER_CITY', label: 'CYBER CITY', background: 0x060711, floor: 0x10101b, primary: 0x00f0ff, secondary: 0xff2bc2, danger: 0xff375f, ambient: 0x152b52, pattern: 'city' },
  space: { id: 'SPACE_VOID', label: 'SPACE VOID', background: 0x01030c, floor: 0x080b18, primary: 0x6f68ff, secondary: 0x2cefff, danger: 0xbd42ff, ambient: 0xb7d5ff, pattern: 'space' },
  retro: { id: 'LAVA_CORE', label: 'LAVA CORE', background: 0x120302, floor: 0x1b0906, primary: 0xff8a2b, secondary: 0xffd24d, danger: 0xff315f, ambient: 0x5a170d, pattern: 'lava' },
});

const QUALITY_PRESETS = Object.freeze({
  EMERGENCY: Object.freeze({ id: 'EMERGENCY', ambientCount: 4, trailInterval: 280, decorationAlpha: 0.22, bloom: 0.18, secondaryVfx: false }),
  LOW: Object.freeze({ id: 'LOW', ambientCount: 9, trailInterval: 200, decorationAlpha: 0.4, bloom: 0.42, secondaryVfx: false }),
  REDUCED: Object.freeze({ id: 'REDUCED', ambientCount: 14, trailInterval: 150, decorationAlpha: 0.55, bloom: 0.65, secondaryVfx: true }),
  NORMAL: Object.freeze({ id: 'NORMAL', ambientCount: 26, trailInterval: 100, decorationAlpha: 0.8, bloom: 0.85, secondaryVfx: true }),
  HIGH: Object.freeze({ id: 'HIGH', ambientCount: 38, trailInterval: 72, decorationAlpha: 1, bloom: 1.1, secondaryVfx: true }),
});

const hashString = (value = '') => {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
};

export function combatantPresetFor(player = {}) {
  const stable = player.platformUserId || player.id || player.username || 'fighter';
  return COMBATANT_MATERIALS[hashString(stable) % COMBATANT_MATERIALS.length];
}

export function arenaPresetFor(name = 'default') { return ARENA_THEMES[name] || ARENA_THEMES.default; }

export function requestedVisualMode(scene) {
  const runtime = String(scene?.effectiveEffectIntensity || '').toUpperCase();
  if (['EMERGENCY', 'LOW', 'NORMAL', 'HIGH'].includes(runtime)) return runtime;
  const stored = typeof localStorage !== 'undefined' ? String(localStorage.getItem('neon-effect-mode') || '').toUpperCase() : '';
  if (stored === 'AUTO') return String(scene?.performanceDiagnostics?.level || 'NORMAL').toUpperCase();
  if (['BAIXA', 'LOW', 'NORMAL', 'ALTA', 'HIGH'].includes(stored)) return stored;
  return String(scene?.state?.settings?.effectIntensity || 'NORMAL').toUpperCase();
}

export function visualQualityFor(setting = 'NORMAL') {
  const value = String(setting || 'NORMAL').toUpperCase();
  if (value === 'EMERGENCY') return QUALITY_PRESETS.EMERGENCY;
  if (value === 'LOW') return QUALITY_PRESETS.LOW;
  if (['BAIXA', 'REDUCED'].includes(value)) return QUALITY_PRESETS.REDUCED;
  if (['ALTA', 'HIGH'].includes(value)) return QUALITY_PRESETS.HIGH;
  return QUALITY_PRESETS.NORMAL;
}
