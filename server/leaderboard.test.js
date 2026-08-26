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

test('Reis da Arena mantém Top 3 acumulado por pontuação e vitórias', () => {
  clearLeaderboard();
  recordRound([
    { platformUserId: 'rei-a', username: 'ReiA', score: 50, roundWinner: true },
    { platformUserId: 'rei-b', username: 'ReiB', score: 70, roundWinner: false },
    { platformUserId: 'rei-c', username: 'ReiC', score: 30, roundWinner: true },
    { platformUserId: 'rei-d', username: 'ReiD', score: 10, roundWinner: false },
  ], 'round-a');
  recordRound([
    { platformUserId: 'rei-a', username: 'ReiA', score: 35, roundWinner: false },
    { platformUserId: 'rei-b', username: 'ReiB', score: 10, roundWinner: true },
    { platformUserId: 'rei-c', username: 'ReiC', score: 40, roundWinner: false },
    { platformUserId: 'rei-d', username: 'ReiD', score: 55, roundWinner: true },
  ], 'round-b');
  assert.deepEqual(getLeaderboard().slice(0, 3).map(({ platformUserId, score, wins, roundsPlayed }) => ({ platformUserId, score, wins, roundsPlayed })), [
    { platformUserId: 'rei-a', score: 85, wins: 1, roundsPlayed: 2 },
    { platformUserId: 'rei-b', score: 80, wins: 1, roundsPlayed: 2 },
    { platformUserId: 'rei-c', score: 70, wins: 1, roundsPlayed: 2 },
  ]);
});
