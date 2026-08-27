import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import {
  __test, applyComment, applyCombatResult, applyGiftEffect, applyStormDamage, finish, join, pause, reset, setStorm, spawnBoss, start, state, tickGame,
} from '../server/engine.js';
import { loadReplayFile, logicalStateDigest, validateReplay, withDeterministicRuntime } from '../server/replay.js';
import { assertValidState } from './invariants.js';

const pickOutcome = (result = {}) => ({
  applied: Boolean(result?.applied),
  status: result?.status || null,
  reason: result?.reason || null,
  eliminated: Boolean(result?.eliminated),
});

function assertExpected(actual, expected = {}, label = 'event') {
  for (const [key, value] of Object.entries(expected || {})) assert.deepEqual(actual?.[key] ?? null, value, `${label}:${key}`);
}

export function runReplay(input) {
  const replay = validateReplay(input);
  reset();
  state.round = replay.round;
  state.roundId = replay.roundId;

  return withDeterministicRuntime(replay.roundSeed, replay.startedAt, (runtime) => {
    for (const event of replay.events) {
      runtime.setNow(replay.startedAt + event.atMs);
      const payload = event.payload || {};
      let result = null;
      switch (event.type) {
        case 'JOIN':
          result = join(payload.username, payload.teamChoice || null, payload.bot !== false, { platformUserId: payload.platformUserId });
          break;
        case 'START':
          result = start({ now: runtime.now(), countdownMs: Number(payload.countdownMs || 0) });
          state.roundId = replay.roundId;
          state.bountyTargetId = payload.bountyTargetId || null;
          state.bountyTargetPlatformId = payload.bountyTargetPlatformId || null;
          if (payload.expireSpawnProtection) state.players.forEach((player) => __test.expireSpawnProtection(player.id));
          break;
        case 'COMMENT':
          result = applyComment({ username: payload.username || 'Replay', platformUserId: payload.platformUserId, comment: payload.comment || '' });
          break;
        case 'SHOT':
          result = applyCombatResult({ attackerId: payload.attackerId, targetId: payload.targetId, attackKind: payload.attackKind || 'shot' });
          assertExpected(pickOutcome(result), payload.expected, `SHOT#${event.seq}`);
          break;
        case 'GIFT':
          result = applyGiftEffect({ ...payload.input, now: runtime.now() });
          assertExpected(pickOutcome(result), payload.expected, `GIFT#${event.seq}`);
          break;
        case 'BOSS':
          result = spawnBoss({ source: payload.source || 'replay', now: runtime.now() });
          if (payload.bossId && state.boss?.active) state.boss.id = payload.bossId;
          assertExpected(pickOutcome(result), payload.expected, `BOSS#${event.seq}`);
          break;
        case 'PAUSE':
          result = pause();
          if (payload.expectedPhase) assert.equal(state.phase, payload.expectedPhase, `PAUSE#${event.seq}`);
          break;
        case 'STORM':
          result = setStorm(payload.value);
          assert.equal(state.storm, Number(payload.value), `STORM#${event.seq}`);
          break;
        case 'DAMAGE':
          if (payload.source !== 'storm') break;
          result = applyStormDamage(payload.targetId);
          assertExpected(pickOutcome(result), payload.expected, `DAMAGE#${event.seq}`);
          break;
        case 'TICK':
          result = tickGame(runtime.now());
          break;
        case 'ROUND_END': {
          const winner = finish({ now: runtime.now(), intermissionMs: Number(payload.intermissionMs || 0) });
          if (payload.expectedWinnerId) assert.equal(winner?.id || null, payload.expectedWinnerId, `ROUND_END#${event.seq}`);
          result = winner;
          break;
        }
        case 'ELIMINATION':
        case 'POWER':
        case 'BOSS_ATTACK':
          break;
        default:
          throw new Error(`unsupported-replay-event:${event.type}`);
      }
      assertValidState(state, { requireEnded: event.type === 'ROUND_END' });
    }
    const digest = logicalStateDigest(state);
    if (replay.expectedFinal) assert.deepEqual(digest, replay.expectedFinal, 'replay-final-state');
    return { replayVersion: replay.replayVersion, roundId: replay.roundId, roundSeed: replay.roundSeed, events: replay.events.length, digest };
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] || process.argv.find((arg) => arg.startsWith('--file='))?.slice(7);
  if (!file) {
    console.error('Uso: npm run replay -- <arquivo.json>');
    process.exit(2);
  }
  const replay = loadReplayFile(file);
  const result = runReplay(replay);
  console.log(JSON.stringify({ ok: true, ...result }));
}
