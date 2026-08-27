export const TARGET_MODES = Object.freeze([
  'SELF', 'TARGET_PLAYER', 'RANDOM_PLAYER', 'ALLY_LOWEST_HP', 'ENEMY', 'LEADER',
  'RANDOM_ENEMY', 'ALL_PLAYERS', 'GLOBAL', 'BOSS',
]);

const rawDefinitions = [
  { id: 'entry-boost', name: 'Boost de Entrada', category: 'support', targetModes: ['SELF', 'TARGET_PLAYER'], defaultMagnitude: 1.2, maxMagnitude: 1.2, defaultDurationMs: 5000, maxDurationMs: 5000, cooldownMs: 5000, globalCooldownMs: 250, visualPreset: 'entry-spark', audioPreset: 'boost', narrationPreset: 'fast', enabled: true },
  { id: 'tactical-shield', name: 'Escudo Neon', category: 'boost', targetModes: ['SELF', 'TARGET_PLAYER', 'ALLY_LOWEST_HP'], defaultMagnitude: 10, maxMagnitude: 20, defaultDurationMs: 3000, maxDurationMs: 5000, cooldownMs: 12000, globalCooldownMs: 300, visualPreset: 'shield-burst', audioPreset: 'shield', narrationPreset: 'hype', enabled: true },
  { id: 'speed', name: 'Impulso Neon', category: 'boost', targetModes: ['SELF', 'TARGET_PLAYER', 'ALLY_LOWEST_HP'], defaultMagnitude: 1.35, maxMagnitude: 1.5, defaultDurationMs: 5000, maxDurationMs: 5000, cooldownMs: 7000, globalCooldownMs: 250, visualPreset: 'speed-trail', audioPreset: 'boost', narrationPreset: 'fast', enabled: true },
  { id: 'extra-projectile', name: 'Rajada Extra', category: 'boost', targetModes: ['SELF', 'TARGET_PLAYER'], defaultMagnitude: 7, maxMagnitude: 10, defaultDurationMs: 0, maxDurationMs: 0, cooldownMs: 7000, globalCooldownMs: 300, visualPreset: 'neon-projectile', audioPreset: 'laser', narrationPreset: 'fast', enabled: true },
  { id: 'meteor', name: 'Meteor Storm', category: 'event', targetModes: ['RANDOM_PLAYER', 'ENEMY', 'LEADER', 'RANDOM_ENEMY', 'GLOBAL'], defaultMagnitude: 22, maxMagnitude: 24, defaultDurationMs: 2000, maxDurationMs: 2400, cooldownMs: 12000, globalCooldownMs: 1200, visualPreset: 'meteor-warning', audioPreset: 'meteor', narrationPreset: 'hype', enabled: true },
  { id: 'star-power', name: 'Star Power', category: 'premium', targetModes: ['SELF', 'TARGET_PLAYER'], defaultMagnitude: 100, maxMagnitude: 250, defaultDurationMs: 60000, maxDurationMs: 60000, cooldownMs: 30000, globalCooldownMs: 1500, visualPreset: 'golden-aura', audioPreset: 'legendary', narrationPreset: 'legendary', enabled: true },
  { id: 'colossus', name: 'Colossus Neon', category: 'premium', targetModes: ['GLOBAL', 'BOSS'], defaultMagnitude: 1, maxMagnitude: 1, defaultDurationMs: 45000, maxDurationMs: 55000, cooldownMs: 60000, globalCooldownMs: 5000, visualPreset: 'colossus-neon', audioPreset: 'boss', narrationPreset: 'legendary', enabled: true },
  { id: 'black-hole', name: 'Black Hole', category: 'event', targetModes: ['GLOBAL', 'LEADER', 'TARGET_PLAYER'], defaultMagnitude: 0.32, maxMagnitude: 0.55, defaultDurationMs: 3200, maxDurationMs: 5000, cooldownMs: 16000, globalCooldownMs: 2200, visualPreset: 'black-hole', audioPreset: 'gravity', narrationPreset: 'cinematic', enabled: true },
  { id: 'chain-lightning', name: 'Chain Lightning', category: 'event', targetModes: ['TARGET_PLAYER', 'ENEMY', 'LEADER', 'RANDOM_ENEMY'], defaultMagnitude: 12, maxMagnitude: 18, defaultDurationMs: 700, maxDurationMs: 1200, cooldownMs: 11000, globalCooldownMs: 900, visualPreset: 'chain-lightning', audioPreset: 'lightning', narrationPreset: 'hype', enabled: true, maxTargets: 4 },
  { id: 'neon-tornado', name: 'Neon Tornado', category: 'event', targetModes: ['GLOBAL', 'TARGET_PLAYER', 'LEADER'], defaultMagnitude: 120, maxMagnitude: 180, defaultDurationMs: 2600, maxDurationMs: 4500, cooldownMs: 15000, globalCooldownMs: 1800, visualPreset: 'neon-tornado', audioPreset: 'tornado', narrationPreset: 'cinematic', enabled: true },
  { id: 'orbital-laser', name: 'Orbital Laser', category: 'event', targetModes: ['TARGET_PLAYER', 'ENEMY', 'LEADER', 'RANDOM_ENEMY'], defaultMagnitude: 18, maxMagnitude: 24, defaultDurationMs: 1300, maxDurationMs: 2400, cooldownMs: 14000, globalCooldownMs: 1600, visualPreset: 'orbital-laser', audioPreset: 'laser', narrationPreset: 'cinematic', enabled: true },
  { id: 'time-freeze', name: 'Time Freeze', category: 'event', targetModes: ['ALL_PLAYERS', 'GLOBAL', 'ENEMY', 'RANDOM_ENEMY'], defaultMagnitude: 0.35, maxMagnitude: 0.55, defaultDurationMs: 2200, maxDurationMs: 3500, cooldownMs: 18000, globalCooldownMs: 2400, visualPreset: 'time-freeze', audioPreset: 'time-freeze', narrationPreset: 'cinematic', enabled: true },
  { id: 'shockwave', name: 'Shockwave', category: 'boost', targetModes: ['SELF', 'TARGET_PLAYER'], defaultMagnitude: 130, maxMagnitude: 200, defaultDurationMs: 600, maxDurationMs: 1000, cooldownMs: 9000, globalCooldownMs: 600, visualPreset: 'shockwave', audioPreset: 'explosion', narrationPreset: 'hype', enabled: true },
  { id: 'gravity-bomb', name: 'Gravity Bomb', category: 'event', targetModes: ['TARGET_PLAYER', 'LEADER', 'RANDOM_PLAYER', 'GLOBAL'], defaultMagnitude: 16, maxMagnitude: 22, defaultDurationMs: 2400, maxDurationMs: 4000, cooldownMs: 17000, globalCooldownMs: 2200, visualPreset: 'gravity-bomb', audioPreset: 'gravity', narrationPreset: 'cinematic', enabled: true },
  { id: 'supernova', name: 'Supernova', category: 'premium', targetModes: ['GLOBAL', 'ALL_PLAYERS'], defaultMagnitude: 24, maxMagnitude: 30, defaultDurationMs: 2800, maxDurationMs: 4200, cooldownMs: 45000, globalCooldownMs: 8000, visualPreset: 'supernova', audioPreset: 'legendary', narrationPreset: 'legendary', enabled: true },
];

const freezeDefinition = (definition) => Object.freeze({
  ...definition,
  targetModes: Object.freeze([...definition.targetModes]),
});

export const DEFAULT_POWER_DEFINITIONS = Object.freeze(rawDefinitions.map(freezeDefinition));
export const FUTURE_POWER_IDS = Object.freeze([
  'inferno-ring', 'phantom-clone', 'guardian-dome', 'hyper-dash', 'neon-dragon',
  'galaxy-collapse', 'blade-storm', 'cluster-bomb', 'kings-rage', 'chaos-mode',
]);

export class PowerRegistry {
  constructor(definitions = DEFAULT_POWER_DEFINITIONS) {
    this.definitions = new Map();
    for (const definition of definitions) this.register(definition);
  }

  register(definition) {
    const id = String(definition?.id || '').trim().toLowerCase();
    if (!id) throw new Error('power-id-required');
    const targetModes = [...new Set((definition.targetModes || []).filter((mode) => TARGET_MODES.includes(mode)))];
    if (!targetModes.length) throw new Error(`power-target-mode-required:${id}`);
    const normalized = freezeDefinition({ ...definition, id, targetModes, enabled: definition.enabled !== false });
    this.definitions.set(id, normalized);
    return normalized;
  }

  get(id) {
    return this.definitions.get(String(id || '').trim().toLowerCase()) || null;
  }

  has(id) {
    return Boolean(this.get(id));
  }

  list({ enabledOnly = false } = {}) {
    return [...this.definitions.values()].filter((definition) => !enabledOnly || definition.enabled !== false);
  }

  publicCatalog() {
    return this.list().map((definition) => ({ ...definition, targetModes: [...definition.targetModes] }));
  }
}

export const powerRegistry = new PowerRegistry();
