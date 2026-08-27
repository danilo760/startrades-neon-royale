import { TARGET_MODES } from './PowerRegistry.js';

export const clampNumber = (value, min, max, fallback = min) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const cleanPreset = (value, fallback = '') => String(value ?? fallback)
  .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
  .replace(/[^a-zA-Z0-9:_-]/g, '')
  .slice(0, 64) || fallback;

const cleanText = (value, fallback = '', max = 80) => String(value ?? fallback)
  .replace(/[\u0000-\u001f\u007f-\u009f<>`]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max) || fallback;

export function normalizeTargetMode(value, power) {
  const requested = String(value || '').trim().toUpperCase();
  const allowed = power?.targetModes || [];
  if (TARGET_MODES.includes(requested) && allowed.includes(requested)) return requested;
  return allowed[0] || 'GLOBAL';
}

export function enforcePowerLimits(power, input = {}) {
  if (!power) throw new Error('unknown-power');
  const defaultMagnitude = Number(power.defaultMagnitude) || 0;
  const maxMagnitude = Math.max(defaultMagnitude, Number(power.maxMagnitude) || defaultMagnitude);
  const defaultDuration = Math.max(0, Number(power.defaultDurationMs) || 0);
  const maxDuration = Math.max(defaultDuration, Number(power.maxDurationMs) || defaultDuration);
  const baseCooldown = Math.max(0, Number(power.cooldownMs) || 0);
  const maxCooldown = Math.max(baseCooldown, 120_000);
  return Object.freeze({
    powerId: power.id,
    targetMode: normalizeTargetMode(input.targetMode, power),
    magnitude: clampNumber(input.magnitude, 0, maxMagnitude, defaultMagnitude),
    durationMs: Math.round(clampNumber(input.durationMs, 0, maxDuration, defaultDuration)),
    cooldownMs: Math.round(clampNumber(input.cooldownMs, 0, maxCooldown, baseCooldown)),
    globalCooldownMs: Math.round(clampNumber(input.globalCooldownMs, 0, Math.max(15_000, Number(power.globalCooldownMs) || 0), Number(power.globalCooldownMs) || 0)),
    visualPreset: cleanPreset(input.visualPreset, power.visualPreset || 'default'),
    soundPreset: cleanPreset(input.soundPreset, power.audioPreset || 'default'),
    narrationPreset: cleanPreset(input.narrationPreset, power.narrationPreset || 'fast'),
  });
}

export function normalizeGiftMapping(input = {}, registry) {
  const giftId = cleanText(input.giftId ?? input.gift_id, '', 80);
  if (!giftId) throw new Error('gift-id-required');
  const powerId = cleanPreset(input.powerId ?? input.power_id, '');
  const power = registry?.get(powerId);
  if (!power || power.enabled === false) throw new Error('invalid-power-id');
  const limited = enforcePowerLimits(power, {
    targetMode: input.targetMode ?? input.target_mode,
    magnitude: input.magnitude,
    durationMs: input.durationMs ?? input.duration_ms,
    cooldownMs: input.cooldownMs ?? input.cooldown_ms,
    visualPreset: input.visualPreset ?? input.vfx_preset,
    soundPreset: input.soundPreset ?? input.sound_preset,
    narrationPreset: input.narrationPreset ?? input.narration_preset,
  });
  return Object.freeze({
    id: cleanText(input.id, '', 80) || null,
    giftId,
    giftName: cleanText(input.giftName ?? input.gift_name, giftId, 80),
    enabled: input.enabled !== false,
    ...limited,
  });
}

export const powerLimitInternals = Object.freeze({ cleanPreset, cleanText });
