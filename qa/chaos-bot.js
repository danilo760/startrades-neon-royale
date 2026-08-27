import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { GiftEventLedger, normalizeGiftEvent } from '../server/gifts.js';
import { __test, applyGiftEffect, finish, join, pause, reset, setStorm, spawnBoss, start, state, tickGame } from '../server/engine.js';
import { initializeLeaderboard } from '../server/leaderboard.js';
import { assertValidState } from './invariants.js';

export function assertChaosSafety(argv = process.argv) {
  assert.equal(process.env.NODE_ENV, 'test', 'ChaosBot requires NODE_ENV=test');
  assert.equal(process.env.MOCK_MODE, 'true', 'ChaosBot requires MOCK_MODE=true');
  assert.equal(process.env.QA_CHAOS_ACK, 'I_UNDERSTAND_LOCAL_ONLY', 'ChaosBot requires explicit QA_CHAOS_ACK');
  assert.ok(argv.includes('--i-understand-chaos'), 'ChaosBot requires --i-understand-chaos');
  assert.notEqual(process.env.RENDER, 'true', 'ChaosBot is blocked on Render');
}

export async function runChaosScenarios() {
  reset();
  for (let i = 0; i < 100; i += 1) join(`\u0000<QA-${i}>${'x'.repeat(300)}`, null, true, { platformUserId: `chaos:${i}` });
  start({ countdownMs: 0, now: 1_000 }); state.players.forEach((p) => __test.expireSpawnProtection(p.id));
  const target = state.players[0];
  const gifts = Array.from({ length: 200 }, (_, i) => applyGiftEffect({ eventId: `rapid:${i}`, senderUserId: target.id, senderUsername: target.username, targetUserId: target.id, giftId: '5655', now: 2_000 + i }));
  assert.ok(gifts.some((gift) => gift.reason === 'cooldown' || gift.reason === 'round-limit'));
  const duplicate = { eventId: 'same-gift', senderUserId: target.id, senderUsername: target.username, targetUserId: target.id, giftId: 'neon-shield', now: 30_000 };
  applyGiftEffect(duplicate); assert.equal(applyGiftEffect(duplicate).reason, 'duplicate-event');
  spawnBoss({ now: 40_000 }); setStorm(100); pause(); tickGame(50_000); assert.equal(state.phase, 'paused'); pause();
  applyGiftEffect({ ...duplicate, eventId: 'reset-race', now: 50_001 }); reset(); tickGame(90_000);
  assertValidState(state); assert.equal(state.hazards.length, 0); assert.equal(state.boss.active, false);

  const ledger = new GiftEventLedger();
  const outOfOrder = ledger.ingest({ user: { userId: 'chaos' }, eventId: 'final-first', transactionId: 'combo-chaos', giftId: '5655', giftType: 1, repeatCount: 10, repeatEnd: true });
  assert.equal(outOfOrder.status, 'ready');
  assert.equal(ledger.ingest({ user: { userId: 'chaos' }, eventId: 'late-update', transactionId: 'combo-chaos', giftId: '5655', giftType: 1, repeatCount: 2 }).status, 'duplicate');
  const normalized = normalizeGiftEvent({ user: { userId: 'id', uniqueId: '\u0000<script>' }, eventId: 'huge', giftId: '5655', giftName: 'x'.repeat(500_000) });
  assert.ok(normalized.giftName.length <= 48); assert.ok(normalized.senderUsername.length <= 32);
  assert.equal(await initializeLeaderboard(), false, 'missing Supabase must fail open');
  return { players: 100, gifts: gifts.length };
}

export async function verifyWebSocketReconnect(url) {
  for (let attempt = 0; attempt < 2; attempt += 1) await new Promise((resolve, reject) => {
    const ws = new WebSocket(url); const timer = setTimeout(() => reject(new Error('websocket timeout')), 3000);
    ws.once('message', () => { clearTimeout(timer); ws.close(); resolve(); }); ws.once('error', reject);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertChaosSafety();
  console.log(JSON.stringify({ ok: true, ...(await runChaosScenarios()) }));
}
