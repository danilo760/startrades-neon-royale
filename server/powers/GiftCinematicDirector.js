const PRESETS = Object.freeze({
  support: { level: 'SUPPORT', durationMs: 1500, camera: 'none', particles: 'small', audio: 'short' },
  boost: { level: 'BOOST', durationMs: 2200, camera: 'light', particles: 'medium', audio: 'impact' },
  event: { level: 'EVENT', durationMs: 3000, camera: 'medium', particles: 'large', audio: 'cinematic' },
  premium: { level: 'PREMIUM', durationMs: 3800, camera: 'legendary', particles: 'ultimate', audio: 'ultimate' },
});
const clean = (value, max = 80) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f<>`]/g, '').trim().slice(0, max);

export class GiftCinematicDirector {
  constructor({ bus, publish = () => {} } = {}) {
    this.bus = bus;
    this.publish = publish;
    this.handler = null;
  }

  start() {
    if (!this.bus || this.handler) return this;
    this.handler = (payload = {}) => {
      const tier = PRESETS[payload.tier] ? payload.tier : 'support';
      const preset = PRESETS[tier];
      this.publish('gift:cinematic', {
        eventId: payload.eventId || null,
        tier,
        ...preset,
        senderUsername: clean(payload.senderUsername, 32),
        giftName: clean(payload.giftName || payload.giftId || 'Gift', 64),
        powerId: clean(payload.powerId || payload.effect || '', 64),
        visualPreset: clean(payload.visualPreset || payload.visualEffect || 'default', 64),
        soundPreset: clean(payload.soundPreset || 'default', 64),
        narrationPreset: clean(payload.narrationPreset || 'fast', 64),
      });
    };
    this.bus.on('gift:applied', this.handler);
    return this;
  }

  dispose() {
    if (this.handler) this.bus?.off?.('gift:applied', this.handler);
    this.handler = null;
  }
}

export const giftCinematicPresets = PRESETS;
