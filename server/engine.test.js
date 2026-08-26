import assert from 'node:assert/strict';
import test from 'node:test';
import { clearLeaderboard } from './leaderboard.js';
import { applyCombatResult, finish, join, reset, start, state, updateSettings } from './engine.js';

const prepare = () => {
  clearLeaderboard();
  reset();
  updateSettings({ teamMode: false });
};

test('primeira rodada inicia sem bounty e sem crash', () => {
  prepare();
  start();
  assert.equal(state.bountyTargetId, null);
});

test('fogo amigo só é bloqueado com modo de times ativo', () => {
  prepare();
  join('Alpha', 'azul'); join('Bravo', 'azul');
  start();
  const solo = applyCombatResult({ attackerId: 'Alpha', targetId: 'Bravo', damage: 5, targetHp: 95, targetShield: 0, eliminated: false });
  assert.equal(solo.applied, true);
  updateSettings({ teamMode: true });
  const team = applyCombatResult({ attackerId: 'Alpha', targetId: 'Bravo', damage: 5, targetHp: 90, targetShield: 0, eliminated: false });
  assert.equal(team.reason, 'friendly-fire');
});

test('bounty concede pontos triplos e retorna flag para o narrador', () => {
  prepare();
  join('Leader'); finish(); reset();
  join('Leader'); join('Hunter'); start();
  assert.equal(state.bountyTargetId, 'Leader');
  const result = applyCombatResult({ attackerId: 'Hunter', targetId: 'Leader', damage: 10, targetHp: 0, targetShield: 0, eliminated: true });
  assert.equal(result.bountyClaimed, true);
  assert.equal(result.pointsAwarded, 30);
  assert.equal(state.bountyTargetId, null);
});

test('mapa inválido volta ao default', () => {
  prepare(); updateSettings({ arenaBackground: 'javascript:alert(1)' });
  assert.equal(state.settings.arenaBackground, 'default');
  updateSettings({ arenaBackground: 'space' });
  assert.equal(state.settings.arenaBackground, 'space');
});
