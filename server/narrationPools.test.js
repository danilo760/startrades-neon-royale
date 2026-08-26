import assert from 'node:assert/strict';
import test from 'node:test';
import { narrationPoolCounts, pickNarration, resetNarrationHistory } from './narrationPools.js';

test('all fast path pools keep five to ten variants', () => {
  for (const [category, count] of Object.entries(narrationPoolCounts)) {
    assert.ok(count >= 5 && count <= 10, `${category} has ${count} variants`);
  }
});

test('anti repetition excludes the last three templates from the next draw', () => {
  resetNarrationHistory();
  const category = 'player:healed';
  const phrases = Array.from({ length: 4 }, () => pickNarration(category, { player: '@Alpha', heal: 10 }, () => 0));
  assert.equal(new Set(phrases).size, 4);
});
