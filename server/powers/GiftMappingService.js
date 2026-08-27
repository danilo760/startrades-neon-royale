import { normalizeGiftMapping } from './PowerLimits.js';
import { powerRegistry as defaultRegistry } from './PowerRegistry.js';

export const DEFAULT_GIFT_POWER_MAPPINGS = Object.freeze([
  { giftId: '5655', giftName: 'Rose', enabled: true, powerId: 'entry-boost', targetMode: 'SELF', magnitude: 1.2, durationMs: 5000, cooldownMs: 5000, visualPreset: 'entry-spark', soundPreset: 'boost', narrationPreset: 'fast' },
  { giftId: 'neon-shield', giftName: 'Neon Shield', enabled: true, powerId: 'tactical-shield', targetMode: 'SELF', magnitude: 10, durationMs: 3000, cooldownMs: 12000, visualPreset: 'shield-burst', soundPreset: 'shield', narrationPreset: 'hype' },
  { giftId: 'neon-speed', giftName: 'Neon Speed', enabled: true, powerId: 'speed', targetMode: 'SELF', magnitude: 1.35, durationMs: 5000, cooldownMs: 7000, visualPreset: 'speed-trail', soundPreset: 'boost', narrationPreset: 'fast' },
  { giftId: 'neon-extra-shot', giftName: 'Finger Gun', enabled: true, powerId: 'extra-projectile', targetMode: 'SELF', magnitude: 7, durationMs: 0, cooldownMs: 7000, visualPreset: 'neon-projectile', soundPreset: 'laser', narrationPreset: 'fast' },
  { giftId: 'neon-meteor', giftName: 'Meteor', enabled: true, powerId: 'meteor', targetMode: 'RANDOM_PLAYER', magnitude: 22, durationMs: 2000, cooldownMs: 12000, visualPreset: 'meteor-warning', soundPreset: 'meteor', narrationPreset: 'hype' },
  { giftId: 'neon-star-power', giftName: 'Lion', enabled: true, powerId: 'star-power', targetMode: 'SELF', magnitude: 100, durationMs: 60000, cooldownMs: 30000, visualPreset: 'golden-aura', soundPreset: 'legendary', narrationPreset: 'legendary' },
  { giftId: 'neon-colossus', giftName: 'Universe', enabled: true, powerId: 'colossus', targetMode: 'GLOBAL', magnitude: 1, durationMs: 45000, cooldownMs: 60000, visualPreset: 'colossus-neon', soundPreset: 'boss', narrationPreset: 'legendary' },
]);

const normalizeRow = (row, registry) => normalizeGiftMapping({
  id: row.id,
  giftId: row.gift_id ?? row.giftId,
  giftName: row.gift_name ?? row.giftName,
  enabled: row.enabled,
  powerId: row.power_id ?? row.powerId,
  targetMode: row.target_mode ?? row.targetMode,
  magnitude: row.magnitude,
  durationMs: row.duration_ms ?? row.durationMs,
  cooldownMs: row.cooldown_ms ?? row.cooldownMs,
  visualPreset: row.vfx_preset ?? row.visualPreset,
  soundPreset: row.sound_preset ?? row.soundPreset,
  narrationPreset: row.narration_preset ?? row.narrationPreset,
}, registry);

const dbRow = (mapping) => ({
  gift_id: mapping.giftId,
  gift_name: mapping.giftName,
  enabled: mapping.enabled,
  power_id: mapping.powerId,
  target_mode: mapping.targetMode,
  magnitude: mapping.magnitude,
  duration_ms: mapping.durationMs,
  cooldown_ms: mapping.cooldownMs,
  vfx_preset: mapping.visualPreset,
  sound_preset: mapping.soundPreset,
  narration_preset: mapping.narrationPreset,
  updated_at: new Date().toISOString(),
});

export class GiftMappingService {
  constructor({ registry = defaultRegistry, client = null, logger = console, env = process.env } = {}) {
    this.registry = registry;
    this.client = client;
    this.logger = logger;
    this.env = env;
    this.ready = false;
    this.persistenceAvailable = Boolean(client);
    this.mappings = new Map();
    for (const mapping of DEFAULT_GIFT_POWER_MAPPINGS) this.mappings.set(mapping.giftId, normalizeGiftMapping(mapping, registry));
  }

  async createClientIfConfigured() {
    if (this.client) return this.client;
    const url = this.env.SUPABASE_URL;
    const secret = this.env.SUPABASE_SECRET_KEY;
    if (!url || !secret) return null;
    try {
      const { createClient } = await import('@supabase/supabase-js');
      this.client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
      this.persistenceAvailable = true;
      return this.client;
    } catch (error) {
      this.logger.warn?.(`[gift-mapping] Supabase indisponível: ${String(error?.message || error).slice(0, 120)}`);
      this.persistenceAvailable = false;
      return null;
    }
  }

  async initialize() {
    const client = await this.createClientIfConfigured();
    if (!client) {
      this.ready = true;
      return { ok: true, source: 'fallback', count: this.mappings.size };
    }
    try {
      const { data, error } = await client.from('gift_power_mappings')
        .select('id,gift_id,gift_name,enabled,power_id,target_mode,magnitude,duration_ms,cooldown_ms,vfx_preset,sound_preset,narration_preset')
        .order('gift_name', { ascending: true });
      if (error) throw error;
      for (const row of data || []) {
        try {
          const mapping = normalizeRow(row, this.registry);
          this.mappings.set(mapping.giftId, mapping);
        } catch (error) {
          this.logger.warn?.(`[gift-mapping] linha ignorada (${row?.gift_id || 'sem-id'}): ${String(error?.message || error).slice(0, 80)}`);
        }
      }
      this.persistenceAvailable = true;
      this.ready = true;
      return { ok: true, source: 'supabase', count: this.mappings.size };
    } catch (error) {
      this.persistenceAvailable = false;
      this.ready = true;
      this.logger.warn?.(`[gift-mapping] fallback em memória: ${String(error?.message || error).slice(0, 120)}`);
      return { ok: true, source: 'fallback', count: this.mappings.size, warning: 'supabase-unavailable' };
    }
  }

  list() {
    return [...this.mappings.values()].sort((a, b) => a.giftName.localeCompare(b.giftName, 'pt-BR'));
  }

  resolve(giftId, giftName = '') {
    const id = String(giftId || '').trim();
    if (id && this.mappings.has(id)) return this.mappings.get(id);
    const wanted = String(giftName || '').trim().toLocaleLowerCase('pt-BR');
    if (!wanted) return null;
    return this.list().find((mapping) => mapping.giftName.toLocaleLowerCase('pt-BR') === wanted) || null;
  }

  async save(input) {
    const mapping = normalizeGiftMapping(input, this.registry);
    this.mappings.set(mapping.giftId, mapping);
    const client = await this.createClientIfConfigured();
    if (!client) return { ok: true, persisted: false, mapping, warning: 'supabase-unavailable' };
    try {
      const { data, error } = await client.from('gift_power_mappings')
        .upsert(dbRow(mapping), { onConflict: 'gift_id' })
        .select('id,gift_id,gift_name,enabled,power_id,target_mode,magnitude,duration_ms,cooldown_ms,vfx_preset,sound_preset,narration_preset')
        .single();
      if (error) throw error;
      const saved = normalizeRow(data, this.registry);
      this.mappings.set(saved.giftId, saved);
      this.persistenceAvailable = true;
      return { ok: true, persisted: true, mapping: saved };
    } catch (error) {
      this.persistenceAvailable = false;
      this.logger.warn?.(`[gift-mapping] alteração mantida em memória: ${String(error?.message || error).slice(0, 120)}`);
      return { ok: true, persisted: false, mapping, warning: 'supabase-write-failed' };
    }
  }

  async disable(giftId) {
    const current = this.resolve(giftId);
    if (!current) throw new Error('mapping-not-found');
    return this.save({ ...current, enabled: false });
  }

  isLegacyDefault(mapping) {
    const legacy = DEFAULT_GIFT_POWER_MAPPINGS.find((item) => item.giftId === mapping?.giftId);
    if (!legacy) return false;
    return legacy.powerId === mapping.powerId && legacy.targetMode === mapping.targetMode
      && Number(legacy.magnitude) === Number(mapping.magnitude)
      && Number(legacy.durationMs) === Number(mapping.durationMs)
      && Number(legacy.cooldownMs) === Number(mapping.cooldownMs)
      && legacy.visualPreset === mapping.visualPreset
      && legacy.soundPreset === mapping.soundPreset
      && legacy.narrationPreset === mapping.narrationPreset;
  }

  status() {
    return { ready: this.ready, persistenceAvailable: this.persistenceAvailable, count: this.mappings.size };
  }
}

export const mappingServiceInternals = Object.freeze({ normalizeRow, dbRow });
