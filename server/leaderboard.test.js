import assert from 'node:assert/strict';
import test from 'node:test';
import { clearLeaderboard, getLeaderboard, getLeaderboardTop, initializeLeaderboard, recordRound } from './leaderboard.js';

test('ranking vazio e boot sem Supabase não derrubam o servidor', async () => {
  clearLeaderboard(); assert.equal(getLeaderboardTop(), null); assert.equal(await initializeLeaderboard(), false);
});

test('resultado é idempotente e mudança de nome preserva o ID', () => {
  clearLeaderboard();
  recordRound([{ id: 'nome-antigo', username: 'nome-antigo', platformUserId: 'tiktok-42', score: 10, roundWinner: true }], 'rodada-1');
  recordRound([{ id: 'nome-antigo', username: 'nome-antigo', platformUserId: 'tiktok-42', score: 10, roundWinner: true }], 'rodada-1');
  recordRound([{ id: 'nome-novo', username: 'nome-novo', platformUserId: 'tiktok-42', score: 5, roundWinner: false }], 'rodada-2');
  assert.deepEqual(getLeaderboard().map(({ platformUserId, username, score, wins, roundsPlayed }) => ({ platformUserId, username, score, wins, roundsPlayed })), [{ platformUserId: 'tiktok-42', username: 'nome-novo', score: 15, wins: 1, roundsPlayed: 2 }]);
});
