import test from 'node:test';
import assert from 'node:assert/strict';
import { BossPhaseDirector, bossPhaseDefinitions } from './powers/BossPhaseDirector.js';

const makeState = () => ({
  phase: 'running', roundId: 'boss2-round', settings: { teamMode: false },
  players: [
    { id: 'p1', alive: true, hp: 100, maxHp: 100, shield: 0, x: 640, y: 500, targetX: 640, targetY: 500 },
    { id: 'p2', alive: true, hp: 100, maxHp: 100, shield: 0, x: 400, y: 360, targetX: 400, targetY: 360 },
  ],
  boss: { id: 'boss-2', active: true, hp: 1000, maxHp: 1000, x: 640, y: 360, lastAttackAt: 0 },
});

const makeDirector = (state, events, scheduled, clock) => new BossPhaseDirector({
  state,
  now: () => clock.now,
  publish: (type, payload) => events.push({ type, payload }),
  schedule: (fn, delay) => { scheduled.push({ fn, delay }); return scheduled.length; },
});

test('Colossus 2.0 initializes two weak points and protects boss HP behind armor', () => {
  const state = makeState(), events = [], scheduled = [], clock = { now: 10_000 };
  const director = makeDirector(state, events, scheduled, clock);
  director.tick(clock.now);
  assert.equal(state.boss.weakPoints.length, 2);
  assert.equal(state.boss.armorActive, true);
  assert.equal(state.boss.coreOpen, false);
  const firstHp = state.boss.weakPoints[0].hp;
  state.boss.hp -= 30;
  clock.now += 250;
  director.tick(clock.now);
  assert.equal(state.boss.hp, 1000, 'armor diverts damage before it reaches boss HP');
  assert.equal(state.boss.weakPoints[0].hp, firstHp - 30);
});

test('destroying both weak points opens a timed core damage window', () => {
  const state = makeState(), events = [], scheduled = [], clock = { now: 20_000 };
  const director = makeDirector(state, events, scheduled, clock);
  director.tick(clock.now);
  for (let i = 0; i < 2; i++) {
    const point = state.boss.weakPoints.find((item) => item.active);
    state.boss.hp -= point.hp;
    clock.now += 250;
    director.tick(clock.now);
  }
  assert.equal(state.boss.armorActive, false);
  assert.equal(state.boss.coreOpen, true);
  assert.ok(events.filter((event) => event.type === 'boss:weakpoint-broken').length >= 2);
  assert.ok(events.some((event) => event.type === 'boss:core-opened'));
  const hpBefore = state.boss.hp;
  state.boss.hp -= 25;
  clock.now += 250;
  director.tick(clock.now);
  assert.equal(state.boss.hp, hpBefore - 25, 'damage reaches HP while core is open');
});

test('all three phases have distinct cinematic attack rotations and telegraphs', () => {
  const state = makeState(), events = [], scheduled = [], clock = { now: 30_000 };
  const director = makeDirector(state, events, scheduled, clock);
  director.tick(clock.now);
  const expected = new Map([
    [1, ['GROUND_SLAM', 'TARGET_MISSILE', 'LASER_SWEEP']],
    [2, ['DOUBLE_LASER', 'METEOR_RAIN', 'SHIELD_CORE']],
    [3, ['ROTATING_BEAMS', 'GRAVITY_PULSE', 'MINI_NOVA']],
  ]);
  for (const [phaseId, patterns] of expected) {
    state.boss.hp = phaseId === 1 ? 900 : phaseId === 2 ? 550 : 250;
    director.lastObservedBossHp = state.boss.hp;
    clock.now += 1;
    director.tick(clock.now); // establish authoritative phase before measuring its attack interval
    assert.equal(state.boss.phase, phaseId);
    for (const pattern of patterns) {
      clock.now += bossPhaseDefinitions[phaseId].attackIntervalMs + 1;
      director.tick(clock.now);
      const warning = events.filter((event) => event.type === 'boss:phase-attack-warning').at(-1);
      assert.equal(warning.payload.pattern, pattern);
      assert.ok(warning.payload.warningMs >= 900);
      assert.ok(scheduled.at(-1).delay >= 900);
    }
  }
});

test('dangerous boss attacks and overload remain non-lethal', () => {
  const state = makeState(), events = [], scheduled = [], clock = { now: 40_000 };
  state.players[0].hp = 11;
  const director = makeDirector(state, events, scheduled, clock);
  director.tick(clock.now);
  clock.now += bossPhaseDefinitions[1].attackIntervalMs + 1;
  director.tick(clock.now);
  const scheduledAttack = scheduled.at(-1);
  assert.ok(scheduledAttack);
  scheduledAttack.fn();
  assert.ok(state.players.every((player) => player.hp >= 10));

  state.boss.armorActive = false;
  state.boss.coreOpen = true;
  state.boss.coreOpenUntil = 0;
  state.boss.hp = 100;
  director.lastObservedBossHp = 100;
  clock.now += 100;
  director.tick(clock.now);
  assert.ok(director.overload);
  clock.now = director.overload.dueAt;
  director.tick(clock.now);
  assert.ok(state.players.every((player) => player.hp >= 10));
  assert.ok(events.some((event) => event.type === 'boss:overload'));
});
