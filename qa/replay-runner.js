import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import {
  __test, applyComment, applyCombatResult, applyGiftEffect, applyStormDamage, finish, join, pause, reset, setStorm, spawnBoss, start, state, tickGame,
} from '../server/engine.js';
import { logicalStateDigest, loadReplayFile, validateReplay, withDeterministicRuntime } from '../server/replay.js';
import { PowerExecutor } from '../server/powers/PowerExecutor.js';
import { normalizeGiftMapping } from '../server/powers/PowerLimits.js';
import { powerRegistry } from '../server/powers/PowerRegistry.js';

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
    const powerExecutor = new PowerExecutor({ state, registry: powerRegistry, spawnBoss, publish: () => {}, now: () => runtime.now() });
    try {
      for (const event of replay.events) {
        runtime.setNow(replay.startedAt + event.atMs);
        const payload = event.payload || {};
        let result = null;
        switch (event.type) {
          case 'JOIN':
            result = join(payload.username, payload.team || null, payload.bot !== false, { platformUserId: payload.platformUserId, avatarUrl: payload.avatarUrl || '' });
            break;
          case 'START':
            start({ now: runtime.now(), countdownMs: payload.countdownMs ?? 0 });
            if (payload.expireSpawnProtection) state.players.forEach((player) => __test.expireSpawnProtection(player.id));
            state.roundId = replay.roundId;
            if ('bountyTargetId' in payload) state.bountyTargetId = payload.bountyTargetId || null;
            if ('bountyTargetPlatformId' in payload) state.bountyTargetPlatformId = payload.bountyTargetPlatformId || null;
            result = state;
            break;
          case 'COMMENT':
            result = applyComment(payload);
            break;
          case 'SHOT':
            result = applyCombatResult({ attackerId: payload.attackerId, targetId: payload.targetId, attackKind: payload.attackKind || 'shot' });
            assertExpected(pickOutcome(result), payload.expected, `SHOT#${event.seq}`);
            break;
          case 'DAMAGE':
            if (payload.source !== 'storm') throw new Error(`unsupported-replay-damage:${payload.source}`);
            result = applyStormDamage(payload.targetId);
            assertExpected(pickOutcome(result), payload.expected, `DAMAGE#${event.seq}`);
            break;
          case 'GIFT':
            if (payload.mapping) {
              const mapping = normalizeGiftMapping(payload.mapping, powerRegistry);
              result = powerExecutor.execute({ ...(payload.input || {}), mapping });
            } else result = applyGiftEffect({ ...(payload.input || payload), now: runtime.now() });
            assertExpected(pickOutcome(result), payload.expected, `GIFT#${event.seq}`);
            break;
          case 'BOSS':
            result = spawnBoss({ source: payload.source || 'replay', now: runtime.now() });
            assertExpected(pickOutcome(result), payload.expected, `BOSS#${event.seq}`);
            if (payload.bossId && result?.boss) result.boss.id = payload.bossId;
            break;
          case 'PAUSE':
            result = pause();
            if (payload.expectedPhase) assert.equal(state.phase, payload.expectedPhase, `replay event ${event.seq} phase mismatch`);
            break;
          case 'STORM':
            result = setStorm(payload.value);
            break;
          case 'TICK':
            result = tickGame(runtime.now());
            break;
          case 'ROUND_END': {
            powerExecutor.cancelPending();
            const winner = finish({ now: runtime.now(), intermissionMs: payload.intermissionMs ?? 0 });
            if (payload.expectedWinnerId !== undefined) assert.equal(winner?.id || null, payload.expectedWinnerId || null, `replay event ${event.seq} winner mismatch`);
            result = winner;
            break;
          }
          case 'ELIMINATION':
          case 'POWER':
          case 'BOSS_ATTACK':
            // Derived domain events are represented by their authoritative input event and are not applied twice.
            break;
          default:
            throw new Error(`unsupported-replay-event:${event.type}`);
        }
      }
      const digest = logicalStateDigest(state);
      if (replay.expectedFinal) assert.deepEqual(digest, replay.expectedFinal, 'replay final state diverged');
      return { replayVersion: replay.replayVersion, roundId: replay.roundId, digest, state, pendingPowerTimers: powerExecutor.timers.size };
    } finally {
      powerExecutor.dispose();
    }
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
