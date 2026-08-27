import assert from 'node:assert/strict';

export function assertValidState(state, { requireEnded = false } = {}) {
  assert.ok(state && typeof state === 'object');
  const ids = new Set();
  for (const player of state.players || []) {
    assert.ok(!ids.has(player.id), `duplicate player ${player.id}`);
    ids.add(player.id);
    assert.ok(Number.isFinite(player.hp) && player.hp >= 0 && player.hp <= player.maxHp, `invalid HP for ${player.id}`);
    assert.ok(Number.isFinite(player.maxHp) && player.maxHp > 0, `invalid maxHP for ${player.id}`);
    assert.ok(Number.isFinite(player.shield) && player.shield >= 0, `invalid shield for ${player.id}`);
    assert.ok(Number.isFinite(player.score) && player.score >= 0, `invalid score for ${player.id}`);
    assert.ok(Number.isInteger(player.eliminations) && player.eliminations >= 0, `invalid eliminations for ${player.id}`);
  }
  if (state.boss?.active) {
    assert.ok(state.boss.id, 'active boss needs an id');
    assert.ok(state.boss.hp >= 0 && state.boss.hp <= state.boss.maxHp, 'invalid boss HP');
  }
  if (requireEnded) {
    assert.equal(state.phase, 'ended', 'round must end');
    if (!state.settings.teamMode) assert.ok(!state.winner || state.winner.type === 'player', 'individual round has one player winner');
  }
}

export function assertValidLeaderboard(rows) {
  for (const row of rows) {
    assert.ok(row.platformUserId);
    assert.ok(Number.isFinite(row.score) && row.score >= 0);
    assert.ok(Number.isInteger(row.wins) && row.wins >= 0);
    assert.ok(Number.isInteger(row.roundsPlayed) && row.roundsPlayed >= 0);
  }
}
