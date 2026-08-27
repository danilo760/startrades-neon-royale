const PERSONALITIES = Object.freeze({
  ESPORTS: { intensity: 0.72, frequency: 0.68, prefix: '' },
  HYPE: { intensity: 0.88, frequency: 0.78, prefix: '' },
  CINEMATIC: { intensity: 0.82, frequency: 0.58, prefix: '' },
  CHAOTIC: { intensity: 0.92, frequency: 0.72, prefix: '' },
  SARCASTIC: { intensity: 0.62, frequency: 0.48, prefix: '' },
});
const CATEGORY_COOLDOWN_MS = Object.freeze({ kill: 2500, streak: 4500, combo: 5000, rivalry: 7000, boss: 5000, leader: 6000, power: 4000 });
const clean = (value, max = 32) => String(value ?? '').replace(/[^\p{L}\p{N}_.-]/gu, '').slice(0, max) || 'combatente';

export class NarratorDirector {
  constructor({ bus, narrator, state, now = () => Date.now() } = {}) {
    this.bus = bus;
    this.narrator = narrator;
    this.state = state;
    this.now = now;
    this.listeners = [];
    this.cooldowns = new Map();
    this.streaks = new Map();
    this.lastLeaderId = null;
    this.config = { personality: 'HYPE', intensity: 80, frequency: 60, volume: 100, enabled: true };
  }

  setConfig(input = {}) {
    const personality = String(input.personality || input.narratorPersonality || this.config.personality).toUpperCase();
    this.config = {
      personality: PERSONALITIES[personality] ? personality : this.config.personality,
      intensity: Math.max(0, Math.min(100, Number(input.intensity ?? input.narratorIntensity ?? this.config.intensity) || 0)),
      frequency: Math.max(0, Math.min(100, Number(input.frequency ?? input.narratorFrequency ?? this.config.frequency) || 0)),
      volume: Math.max(0, Math.min(100, Number(input.volume ?? input.narratorVolume ?? this.config.volume) || 0)),
      enabled: input.enabled ?? input.narratorEnabled ?? this.config.enabled,
    };
    if (this.state?.settings) Object.assign(this.state.settings, {
      narratorPersonality: this.config.personality,
      narratorIntensity: this.config.intensity,
      narratorFrequency: this.config.frequency,
      narratorVolume: this.config.volume,
      narratorEnabled: Boolean(this.config.enabled),
    });
    return { ...this.config };
  }

  canSpeak(category) {
    if (!this.config.enabled || this.state?.settings?.agentEnabled === false) return false;
    const now = this.now();
    const until = this.cooldowns.get(category) || 0;
    if (until > now) return false;
    const preset = PERSONALITIES[this.config.personality] || PERSONALITIES.HYPE;
    const frequency = Math.max(0.1, Math.min(1, (this.config.frequency / 100) * preset.frequency + 0.25));
    if (Math.random() > frequency) return false;
    this.cooldowns.set(category, now + (CATEGORY_COOLDOWN_MS[category] || 4000));
    return true;
  }

  say(category, text, options = {}) {
    if (!this.canSpeak(category)) return '';
    return this.narrator?.local?.(text, { priority: options.priority || 2, emotion: options.emotion || 'hype', eventType: options.eventType || `director:${category}` }) || '';
  }

  on(type, handler) {
    this.bus?.on?.(type, handler);
    this.listeners.push([type, handler]);
  }

  start() {
    if (!this.bus || !this.narrator || this.listeners.length) return this;
    this.on('player:eliminated', (payload = {}) => {
      const id = payload.attackerId;
      if (!id) return;
      const streak = (this.streaks.get(id) || 0) + 1;
      this.streaks.set(id, streak);
      if (streak === 2) this.say('streak', `@${clean(payload.attackerUsername)} está perigoso! Segunda eliminação seguida!`, { priority: 3, emotion: 'battle', eventType: 'doubleKill' });
      else if (streak === 3) this.say('streak', `Triple kill de @${clean(payload.attackerUsername)}! A Arena virou território dele!`, { priority: 4, emotion: 'battle', eventType: 'tripleKill' });
      else if (streak >= 5) this.say('streak', `@${clean(payload.attackerUsername)} chegou a ${streak} eliminações. Alguém precisa parar essa sequência!`, { priority: 4, emotion: 'urgent', eventType: 'killStreak' });
      this.detectLeader();
    });
    this.on('combo:milestone', (payload = {}) => {
      const special = payload.special ? String(payload.special).replace(/_/g, ' ') : `COMBO X${payload.combo || 2}`;
      this.say('combo', `${special}! A LIVE está carregando a Arena!`, { priority: payload.combo >= 10 ? 4 : 3, emotion: 'power', eventType: 'giftCombo' });
    });
    this.on('rivalry:started', (payload = {}) => this.say('rivalry', `Rivalidade declarada: @${clean(payload.playerAName)} contra @${clean(payload.playerBName)}!`, { priority: 4, emotion: 'battle', eventType: 'rivalryStarted' }));
    this.on('boss:phase', (payload = {}) => this.say('boss', `Colossus entrou na fase ${payload.phase}. ${payload.name || 'O perigo aumentou'}!`, { priority: 5, emotion: 'legendary', eventType: `bossPhase${payload.phase}` }));
    this.on('boss:overload-warning', (payload = {}) => this.say('boss', `Overload do Colossus em ${payload.countdown || 5}. Derrubem o núcleo agora!`, { priority: 5, emotion: 'urgent', eventType: 'bossNearDeath' }));
    this.on('round:started', () => { this.streaks.clear(); this.lastLeaderId = null; });
    this.on('round:ended', () => { this.streaks.clear(); });
    return this;
  }

  detectLeader() {
    const alive = (this.state?.players || []).filter((player) => player.alive);
    const leader = [...alive].sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
    if (!leader || leader.id === this.lastLeaderId) return;
    const hadLeader = Boolean(this.lastLeaderId);
    this.lastLeaderId = leader.id;
    if (hadLeader) this.say('leader', `Olha quem tomou o trono! @${clean(leader.username)} agora lidera a Arena!`, { priority: 4, emotion: 'battle', eventType: 'leaderChanged' });
  }

  dispose() {
    for (const [type, handler] of this.listeners) this.bus?.off?.(type, handler);
    this.listeners = [];
    this.cooldowns.clear();
    this.streaks.clear();
  }
}

export const narratorDirectorPresets = PERSONALITIES;
