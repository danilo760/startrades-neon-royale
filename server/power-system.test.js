import test from 'node:test';
import assert from 'node:assert/strict';
import { PowerRegistry, powerRegistry } from './powers/PowerRegistry.js';
import { enforcePowerLimits, normalizeGiftMapping } from './powers/PowerLimits.js';
import { GiftMappingService } from './powers/GiftMappingService.js';
import { PowerExecutor } from './powers/PowerExecutor.js';
import { ComboManager } from './powers/ComboManager.js';
import { RivalryManager } from './powers/RivalryManager.js';
import { BossPhaseDirector } from './powers/BossPhaseDirector.js';
import { NarratorDirector } from './powers/NarratorDirector.js';
import { LiveInteractionManager } from './powers/LiveInteractionManager.js';

const makeState = () => ({
  phase: 'running', roundId: 'round-test', settings: { teamMode: false, agentEnabled: true }, hazards: [],
  players: [
    { id: 'u1', platformUserId: 'u1', username: 'Blaze', alive: true, hp: 60, maxHp: 100, shield: 0, x: 300, y: 300, targetX: 300, targetY: 300, speedMultiplier: 1, score: 20, team: 'blue' },
    { id: 'u2', platformUserId: 'u2', username: 'Spectra', alive: true, hp: 100, maxHp: 100, shield: 0, x: 420, y: 300, targetX: 420, targetY: 300, speedMultiplier: 1, score: 10, team: 'red' },
    { id: 'u3', platformUserId: 'u3', username: 'Nova', alive: true, hp: 100, maxHp: 100, shield: 0, x: 500, y: 320, targetX: 500, targetY: 320, speedMultiplier: 1, score: 5, team: 'red' },
  ],
  boss: { active: false, hp: 0, maxHp: 0 },
});

test('PowerRegistry exposes the eight new powers and future-safe registration', () => {
  for (const id of ['black-hole', 'chain-lightning', 'neon-tornado', 'orbital-laser', 'time-freeze', 'shockwave', 'gravity-bomb', 'supernova']) assert.ok(powerRegistry.get(id), id);
  const registry = new PowerRegistry([]);
  registry.register({ id: 'future-test', name: 'Future', targetModes: ['GLOBAL'], defaultMagnitude: 1, maxMagnitude: 1, defaultDurationMs: 0, maxDurationMs: 0, cooldownMs: 0, globalCooldownMs: 0, enabled: true });
  assert.equal(registry.get('future-test').id, 'future-test');
});

test('PowerLimits clamps hostile admin values and rejects invalid power IDs', () => {
  const power = powerRegistry.get('chain-lightning');
  const limited = enforcePowerLimits(power, { magnitude: 999999, durationMs: 999999, cooldownMs: 999999, targetMode: 'NOT_REAL' });
  assert.equal(limited.magnitude, power.maxMagnitude);
  assert.equal(limited.durationMs, power.maxDurationMs);
  assert.equal(limited.cooldownMs, 120000);
  assert.equal(limited.targetMode, power.targetModes[0]);
  assert.throws(() => normalizeGiftMapping({ giftId: 'x', powerId: 'missing' }, powerRegistry), /invalid-power-id/);
});

test('GiftMappingService hot-swaps Rose without restart', async () => {
  const service = new GiftMappingService({ env: {} });
  await service.initialize();
  await service.save({ giftId: '5655', giftName: 'Rose', enabled: true, powerId: 'tactical-shield', targetMode: 'SELF', magnitude: 9999, durationMs: 99999, cooldownMs: 0 });
  assert.equal(service.resolve('5655').powerId, 'tactical-shield');
  assert.equal(service.resolve('5655').magnitude, powerRegistry.get('tactical-shield').maxMagnitude);
  await service.save({ ...service.resolve('5655'), powerId: 'chain-lightning', targetMode: 'ENEMY', magnitude: 12, durationMs: 700, cooldownMs: 0 });
  assert.equal(service.resolve('5655').powerId, 'chain-lightning');
  await service.disable('5655');
  assert.equal(service.resolve('5655').enabled, false);
});

test('PowerExecutor applies mapping, idempotency, cooldown and non-lethal chain lightning', () => {
  let now = 100_000;
  const events = [];
  const state = makeState();
  const executor = new PowerExecutor({ state, registry: powerRegistry, now: () => now, random: () => 0, publish: (type, payload) => events.push({ type, payload }) });
  const shield = normalizeGiftMapping({ giftId: '5655', giftName: 'Rose', enabled: true, powerId: 'tactical-shield', targetMode: 'SELF', magnitude: 20, durationMs: 5000, cooldownMs: 1000 }, powerRegistry);
  const first = executor.execute({ eventId: 'gift-1', senderUserId: 'u1', senderUsername: 'Blaze', giftId: '5655', giftName: 'Rose', mapping: shield });
  assert.equal(first.status, 'applied');
  assert.equal(state.players[0].hp, 80);
  assert.equal(state.players[0].shield, 20);
  const duplicate = executor.execute({ eventId: 'gift-1', senderUserId: 'u1', senderUsername: 'Blaze', giftId: '5655', mapping: shield });
  assert.equal(duplicate.reason, 'duplicate-event');
  now += 500;
  const cooldown = executor.execute({ eventId: 'gift-2', senderUserId: 'u1', senderUsername: 'Blaze', giftId: '5655', mapping: shield });
  assert.ok(['cooldown', 'global-cooldown'].includes(cooldown.reason));
  now += 20_000;
  const chain = normalizeGiftMapping({ giftId: '5655', giftName: 'Rose', enabled: true, powerId: 'chain-lightning', targetMode: 'ENEMY', magnitude: 18, durationMs: 700, cooldownMs: 0 }, powerRegistry);
  const result = executor.execute({ eventId: 'gift-3', senderUserId: 'u1', senderUsername: 'Blaze', giftId: '5655', mapping: chain });
  assert.equal(result.status, 'applied');
  assert.ok(state.players[1].hp < 100);
  assert.ok(state.players.every((player) => player.hp >= 10));
  assert.ok(events.some((event) => event.type === 'power:executed'));
  executor.dispose();
});

test('PowerExecutor rejects disabled mappings and absurd Supernova stays non-lethal', () => {
  let now = 200_000;
  const state = makeState();
  const executor = new PowerExecutor({ state, registry: powerRegistry, now: () => now, publish: () => {} });
  const disabled = normalizeGiftMapping({ giftId: 'x', giftName: 'X', enabled: false, powerId: 'shockwave', targetMode: 'SELF', magnitude: 200, durationMs: 1000, cooldownMs: 0 }, powerRegistry);
  assert.equal(executor.execute({ eventId: 'disabled-1', senderUserId: 'u1', mapping: disabled }).reason, 'mapping-disabled');
  const supernova = normalizeGiftMapping({ giftId: 'premium-x', giftName: 'Premium', enabled: true, powerId: 'supernova', targetMode: 'GLOBAL', magnitude: 999999, durationMs: 1, cooldownMs: 0 }, powerRegistry);
  const result = executor.execute({ eventId: 'supernova-1', senderUserId: 'u1', mapping: supernova });
  assert.equal(result.status, 'applied');
  assert.equal(result.magnitude, powerRegistry.get('supernova').maxMagnitude);
  executor.dispose();
});

test('ComboManager emits milestones without damage multiplier', () => {
  const events = [];
  let now = 1_000;
  const combo = new ComboManager({ publish: (type, payload) => events.push({ type, payload }), now: () => now });
  for (let i = 0; i < 10; i++) { combo.ingest({ giftId: '5655', senderUserId: `u${i}`, repeatCount: 1 }); now += 100; }
  const roseStorm = events.find((event) => event.type === 'combo:milestone' && event.payload.special === 'ROSE_STORM');
  assert.ok(roseStorm);
  assert.equal(roseStorm.payload.damageMultiplier, 1);
});

test('RivalryManager starts after repeated eliminations', () => {
  const events = [];
  const rivalry = new RivalryManager({ publish: (type, payload) => events.push({ type, payload }) });
  rivalry.recordElimination({ attackerId: 'u1', attackerUsername: 'Blaze', targetId: 'u2', targetUsername: 'Spectra' });
  rivalry.recordElimination({ attackerId: 'u1', attackerUsername: 'Blaze', targetId: 'u2', targetUsername: 'Spectra' });
  assert.ok(events.some((event) => event.type === 'rivalry:started'));
});

test('BossPhaseDirector publishes authoritative phase and starts overload after core exposure', () => {
  const events = [];
  const state = makeState();
  state.boss = { id: 'boss-1', active: true, hp: 300, maxHp: 1000, x: 640, y: 360 };
  let now = 10_000;
  const director = new BossPhaseDirector({ state, publish: (type, payload) => events.push({ type, payload }), now: () => now });
  director.tick(now);
  assert.equal(state.boss.phase, 3);
  assert.ok(events.some((event) => event.type === 'boss:phase' && event.payload.phase === 3));
  state.boss.armorActive = false;
  state.boss.coreOpen = true;
  state.boss.coreOpenUntil = 0;
  state.boss.hp = 100;
  director.lastObservedBossHp = 100;
  now += 100;
  director.tick(now);
  assert.ok(director.overload);
});

test('NarratorDirector stores safe personality presets in state', () => {
  const state = makeState();
  const bus = { on() {}, off() {} };
  const narrator = { local() { return 'ok'; } };
  const director = new NarratorDirector({ bus, narrator, state });
  const config = director.setConfig({ personality: 'CHAOTIC', intensity: 999, frequency: -5, volume: 70, enabled: true });
  assert.equal(config.personality, 'CHAOTIC');
  assert.equal(config.intensity, 100);
  assert.equal(config.frequency, 0);
  assert.equal(state.settings.narratorPersonality, 'CHAOTIC');
});

test('LiveInteractionManager rate-limits votes and aggregates comment milestones', () => {
  let now = 1000;
  const events = [];
  const manager = new LiveInteractionManager({ publish: (type, payload) => events.push([type, payload]), now: () => now });
  const first = manager.ingestComment({ senderUserId: 'u1', comment: '!lava', roundId: 'r1' });
  assert.equal(first.kind, 'map-vote');
  assert.equal(manager.ingestComment({ senderUserId: 'u1', comment: '!space', roundId: 'r1' }).reason, 'vote-cooldown');
  now += 6000;
  assert.equal(manager.ingestComment({ senderUserId: 'u1', comment: '!space', roundId: 'r1' }).kind, 'map-vote');
  for (let i = 0; i < 100; i++) manager.ingestComment({ senderUserId: `c${i}`, comment: 'oi', roundId: 'r1' });
  assert.ok(events.some(([type]) => type === 'interaction:milestone'));
});
