import test from 'node:test';
import assert from 'node:assert/strict';
import { ArenaDirector, arenaPresentationPriority, classifyArenaIntensity, presentationProfile } from '../src/game/ArenaDirector.js';

const baseState = () => ({ phase: 'running', roundStartedAt: 1_000, storm: 0, players: [
  { id: 'a', alive: true, hp: 100, maxHp: 100 },
  { id: 'b', alive: true, hp: 100, maxHp: 100 },
  { id: 'c', alive: true, hp: 100, maxHp: 100 },
], boss: { active: false }, suddenDeath: { active: false } });

test('ArenaDirector classifies calm, active, hype/chaos and climax without changing gameplay state', () => {
  const lobby = { ...baseState(), phase: 'lobby' };
  assert.equal(classifyArenaIntensity(lobby, {}, 2_000).level, 'CALM');
  assert.equal(classifyArenaIntensity(baseState(), {}, 2_000).level, 'ACTIVE');
  const pressured = baseState(); pressured.storm = 85; pressured.boss = { active: true, hp: 700, maxHp: 1000 };
  assert.ok(['HYPE', 'CHAOS'].includes(classifyArenaIntensity(pressured, { kills: 3, gifts: 3 }, 50_000).level));
  const final = baseState(); final.suddenDeath.active = true;
  assert.equal(classifyArenaIntensity(final, {}, 2_000).level, 'CLIMAX');
});

test('presentation profiles scale intensity monotonically', () => {
  const calm = presentationProfile('CALM');
  const active = presentationProfile('ACTIVE');
  const hype = presentationProfile('HYPE');
  const climax = presentationProfile('CLIMAX');
  assert.ok(calm.visualScale < active.visualScale);
  assert.ok(active.visualScale < hype.visualScale);
  assert.ok(hype.visualScale <= climax.visualScale);
  assert.ok(calm.shakeScale < climax.shakeScale);
});

test('presentation queue favors critical cues and spaces executions', () => {
  let now = 10_000;
  const scheduled = [];
  const executed = [];
  const director = new ArenaDirector({ now: () => now, minCueGapMs: 260, schedule: (fn, delay) => { scheduled.push({ fn, delay }); return 1; } });
  director.lastCueAt = now;
  director.enqueue('gift-support', {}, () => executed.push('support'));
  director.enqueue('boss-critical', {}, () => executed.push('critical'));
  director.enqueue('victory', {}, () => executed.push('victory'));
  assert.equal(scheduled.length, 1);
  now += scheduled[0].delay;
  scheduled.shift().fn();
  assert.equal(executed[0], 'victory');
  assert.ok(arenaPresentationPriority.victory > arenaPresentationPriority['boss-critical']);
  assert.ok(arenaPresentationPriority['boss-critical'] > arenaPresentationPriority['gift-support']);
});

test('activity observation raises recent kill/gift counters in a bounded window', () => {
  let now = 1_000;
  const director = new ArenaDirector({ now: () => now });
  director.observe('player:eliminated');
  director.observe('gift:applied');
  assert.equal(director.activity.kills, 1);
  assert.equal(director.activity.gifts, 1);
  now += 11_000;
  director.observe('gift:applied');
  assert.equal(director.activity.kills, 0);
  assert.equal(director.activity.gifts, 1);
  director.clear();
});
