import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { GiftEventLedger } from '../server/gifts.js';
import { __test, applyCombatResult, applyGiftEffect, applyStormDamage, finish, join, pause, reset, setStorm, spawnBoss, start, state, tickGame } from '../server/engine.js';
import { getLeaderboard } from '../server/leaderboard.js';
import { createReplayRecorder, saveReplayFile, seedToUint32, withDeterministicRuntime } from '../server/replay.js';
import { assertValidLeaderboard, assertValidState } from './invariants.js';

const playerId = (round, index) => `qa:${round}:${index}`;
const outcome = (result = {}) => ({ applied: Boolean(result?.applied), status: result?.status || null, reason: result?.reason || null, eliminated: Boolean(result?.eliminated) });

export function runGameplayRounds(rounds = 1, { playersPerRound = 6, seed = 'neon-gameplay-qa-v2', replayDir = '.qa-replays' } = {}) {
  const count = Math.max(1, Math.min(1000, Math.trunc(Number(rounds) || 1)));
  const summaries = [];
  reset();
  for (let round = 1; round <= count; round += 1) {
    const roundSeed = seedToUint32(`${seed}:${round}:${state.round}`);
    const startedAt = round * 100_000;
    const replayRoundId = `qa-replay-${round}-${roundSeed.toString(16)}`;
    const recorder = createReplayRecorder({ roundId: replayRoundId, seed: roundSeed, round: state.round, startedAt, context: { source: 'GameplayBot', playersPerRound } });
    try {
      const completed = withDeterministicRuntime(roundSeed, startedAt, (runtime) => {
        for (let index = 0; index < playersPerRound; index += 1) {
          const username = `QA-${round}-${index}`;
          const platformUserId = playerId(round, index);
          recorder.record('JOIN', { username, platformUserId, bot: true }, runtime.now());
          join(username, null, true, { platformUserId });
          runtime.advance(1);
        }

        runtime.advance(20);
        start({ countdownMs: 0, now: runtime.now() });
        state.roundId = replayRoundId;
        recorder.record('START', {
          countdownMs: 0, expireSpawnProtection: true,
          bountyTargetId: state.bountyTargetId || null,
          bountyTargetPlatformId: state.bountyTargetPlatformId || null,
        }, runtime.now());
        state.players.forEach((player) => __test.expireSpawnProtection(player.id));
        assertValidState(state);

        const [attacker, target] = state.players;
        runtime.advance(10);
        const firstAttack = applyCombatResult({ attackerId: attacker.id, targetId: target.id });
        recorder.record('SHOT', { attackerId: attacker.id, targetId: target.id, expected: outcome(firstAttack) }, runtime.now());
        assert.equal(firstAttack.applied, true);

        runtime.advance(10);
        const cooldownAttack = applyCombatResult({ attackerId: attacker.id, targetId: target.id });
        recorder.record('SHOT', { attackerId: attacker.id, targetId: target.id, expected: outcome(cooldownAttack) }, runtime.now());
        assert.equal(cooldownAttack.reason, 'attack-cooldown');

        runtime.advance(10);
        const giftInput = { eventId: `qa-gift:${round}`, senderUserId: attacker.id, senderUsername: attacker.username, targetUserId: attacker.id, giftId: '5655', giftName: 'Rose', repeatCount: 1 };
        const giftApplied = applyGiftEffect({ ...giftInput, now: runtime.now() });
        recorder.record('GIFT', { input: giftInput, expected: outcome(giftApplied) }, runtime.now());
        assert.equal(giftApplied.status, 'applied');

        runtime.advance(10);
        const duplicateGift = applyGiftEffect({ ...giftInput, now: runtime.now() });
        recorder.record('GIFT', { input: giftInput, expected: outcome(duplicateGift) }, runtime.now());
        assert.equal(duplicateGift.reason, 'duplicate-event');

        runtime.advance(10);
        const boss = spawnBoss({ source: 'qa-bot', now: runtime.now() });
        recorder.record('BOSS', { source: 'qa-bot', bossId: boss.boss?.id || null, expected: outcome(boss) }, runtime.now());
        assert.equal(boss.applied, true);

        runtime.advance(1);
        const duplicateBoss = spawnBoss({ source: 'qa-bot', now: runtime.now() });
        recorder.record('BOSS', { source: 'qa-bot', bossId: boss.boss?.id || null, expected: outcome(duplicateBoss) }, runtime.now());
        assert.notEqual(duplicateBoss.boss.id, null);
        assert.equal(duplicateBoss.boss.id, boss.boss.id, 'boss must not duplicate');

        runtime.advance(10);
        pause(); recorder.record('PAUSE', { expectedPhase: 'paused' }, runtime.now()); assert.equal(state.phase, 'paused');
        runtime.advance(10);
        pause(); recorder.record('PAUSE', { expectedPhase: 'running' }, runtime.now());

        runtime.advance(10);
        setStorm(100); recorder.record('STORM', { value: 100 }, runtime.now());
        for (const player of state.players.slice(1)) {
          __test.expireSpawnProtection(player.id);
          while (player.alive) {
            runtime.advance(1);
            const damage = applyStormDamage(player.id);
            recorder.record('DAMAGE', { source: 'storm', targetId: player.id, expected: outcome(damage) }, runtime.now());
          }
        }

        runtime.setNow(startedAt + 50_000);
        tickGame(runtime.now()); recorder.record('TICK', {}, runtime.now());
        runtime.advance(1);
        const winner = finish({ now: runtime.now(), intermissionMs: 0 });
        recorder.record('ROUND_END', { intermissionMs: 0, expectedWinnerId: attacker.id }, runtime.now());
        assert.equal(winner?.id, attacker.id);
        assert.equal(state.boss.active, false, 'boss must end with round');
        assertValidState(state, { requireEnded: true });
        const replay = recorder.finalize(state, { winnerId: winner?.id || null });
        return { winner, replay };
      });

      summaries.push({ round, roundId: replayRoundId, seed: roundSeed, winner: completed.winner?.id, players: state.players.length, replayEvents: completed.replay.events.length });
    } catch (error) {
      const replay = recorder.snapshot({ failure: { message: String(error?.message || error).slice(0, 240) } });
      let replayPath = '';
      try { replayPath = saveReplayFile(replay, { directory: replayDir, prefix: 'gameplay-failure' }); } catch {}
      if (replayPath) error.message = `${error.message} (replay: ${replayPath})`;
      throw error;
    }

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
  const seed = process.argv.find((arg) => arg.startsWith('--seed='))?.split('=')[1] || 'neon-gameplay-qa-v2';
  validateComboIdempotency();
  const result = runGameplayRounds(rounds, { seed });
  console.log(JSON.stringify({ ok: true, ...result }));
}
