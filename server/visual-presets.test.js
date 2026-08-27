import assert from 'node:assert/strict';
import test from 'node:test';
import { ARENA_THEMES, COMBATANT_MATERIALS, arenaPresetFor, combatantPresetFor, visualQualityFor } from '../src/game/visualPresets.js';

test('visual redesign exposes nine stable spherical combatant materials', () => {
  assert.equal(COMBATANT_MATERIALS.length, 9);
  assert.deepEqual(COMBATANT_MATERIALS.map((item) => item.id), ['NEON', 'PLASMA', 'FIRE', 'ICE', 'VOID', 'GOLD', 'GALAXY', 'TOXIC', 'CYBER']);
  const one = combatantPresetFor({ platformUserId: 'stable-user-42', username: 'OldName' });
  const two = combatantPresetFor({ platformUserId: 'stable-user-42', username: 'NewName' });
  assert.equal(one.id, two.id, 'material must remain stable when username changes');
});

test('four legacy map keys map to distinct arena identities', () => {
  assert.equal(Object.keys(ARENA_THEMES).length, 4);
  assert.deepEqual(Object.values(ARENA_THEMES).map((item) => item.id).sort(), ['CYBER_CITY', 'LAVA_CORE', 'NEON_GRID', 'SPACE_VOID']);
  assert.equal(arenaPresetFor('unknown').id, 'NEON_GRID');
});

test('reduced visual quality lowers ambient work and trail frequency', () => {
  const low = visualQualityFor('BAIXA');
  const normal = visualQualityFor('NORMAL');
  const high = visualQualityFor('ALTA');
  assert.ok(low.ambientCount < normal.ambientCount);
  assert.ok(normal.ambientCount < high.ambientCount);
  assert.ok(low.trailInterval > normal.trailInterval);
  assert.ok(normal.trailInterval > high.trailInterval);
});
