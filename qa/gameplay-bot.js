import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { GiftEventLedger } from '../server/gifts.js';
import { __test, applyCombatResult, applyGiftEffect, applyStormDamage, finish, join, pause, reset, setStorm, spawnBoss, start, state, tickGame } from '../server/engine.js';
import { getLeaderboard } from '../server/leaderboard.js';
import { assertValidLeaderboard, assertValidState } from './invariants.js';

const playerId = (round, index) => `qa:${round}:${index}`;

export function runGameplayRounds(rounds = 1, { playersPerRound = 6 } = {}) {
  const count = Math.max(1, Math.min(1000, Math.trunc(Number(rounds) || 1)));
  const summaries = [];
  reset();
  for (let round = 1; round <= count; round += 1) {
    for (let index = 0; index < playersPerRound; index += 1) join(`QA-${round}-${index}`, null, true, { platformUserId: playerId(round, index) });
    start({ countdownMs: 0, now: round * 100_000 });
    state.players.forEach((player) => __test.expireSpawnProtection(player.id));
    assertValidState(state);

    const [attacker, target] = state.players;
    const firstAttack = applyCombatResult({ attackerId: attacker.id, targetId: target.id });
    assert.equal(firstAttack.applied, true);
    const cooldownAttack = applyCombatResult({ attackerId: attacker.id, targetId: target.id });
    assert.equal(cooldownAttack.reason, 'attack-cooldown');

    const giftInput = { eventId: `qa-gift:${round}`, senderUserId: attacker.id, senderUsername: attacker.username, targetUserId: attacker.id, giftId: '5655', giftName: 'Rose', repeatCount: 1, now: round * 100_000 + 10 };
    assert.equal(applyGiftEffect(giftInput).status, 'applied');
    assert.equal(applyGiftEffect(giftInput).reason, 'duplicate-event');
    const boss = spawnBoss({ source: 'qa-bot', now: round * 100_000 + 20 });
    assert.equal(boss.applied, true);
    const duplicateBoss = spawnBoss({ source: 'qa-bot', now: round * 100_000 + 21 });
    assert.notEqual(duplicateBoss.boss.id, null);
    assert.equal(duplicateBoss.boss.id, boss.boss.id, 'boss must not duplicate');

    pause(); assert.equal(state.phase, 'paused'); pause();
    setStorm(100);
    for (const player of state.players.slice(1)) {
      __test.expireSpawnProtection(player.id);
      while (player.alive) applyStormDamage(player.id);
    }
    tickGame(round * 100_000 + 50_000);
    const winner = finish({ now: round * 100_000 + 50_001, intermissionMs: 0 });
    assert.equal(winner?.id, attacker.id);
    assert.equal(state.boss.active, false, 'boss must end with round');
    assertValidState(state, { requireEnded: true });
    summaries.push({ round, winner: winner?.id, players: state.players.length });
    reset();
    assert.equal(state.phase, 'lobby'); assert.equal(state.players.length, 0); assert.equal(state.boss.active, false); assert.equal(state.storm, 0);
    assertValidState(state);
  }
  assertValidLeaderboard(getLeaderboard());
  return { rounds: count, first: summaries[0], last: summaries.at(-1), leaderboardSize: getLeaderboard().length };
}

export function validateComboIdempotency() {
  const ledger = new GiftEventLedger();
  const base = { user: { userId: 'qa-combo', uniqueId: 'ComboQA' }, giftId: '5655', giftName: 'Rose', giftType: 1, transactionId: 'qa-combo-tx' };
  assert.equal(ledger.ingest({ ...base, eventId: 'combo-1', repeatCount: 2, repeatEnd: false }).status, 'pending');
  const final = ledger.ingest({ ...base, eventId: 'combo-2', repeatCount: 3, repeatEnd: true });
  assert.equal(final.status, 'ready'); assert.equal(final.event.repeatCount, 3);
  assert.equal(ledger.ingest({ ...base, eventId: 'combo-3', repeatCount: 3, repeatEnd: true }).status, 'duplicate');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rounds = Number(process.argv.find((arg) => arg.startsWith('--rounds='))?.split('=')[1] || 1);
  validateComboIdempotency();
  const result = runGameplayRounds(rounds);
  console.log(JSON.stringify({ ok: true, ...result }));
}
