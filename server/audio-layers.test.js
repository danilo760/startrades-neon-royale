import test from 'node:test';
import assert from 'node:assert/strict';

// AudioLayers imports browser audio helpers but does not touch window until playback.
const { AUDIO_LAYERS, audioLayerPlan } = await import('../src/game/AudioLayers.js');

test('professional audio layering covers required high-impact event families', () => {
  for (const key of ['critical', 'shield-break', 'meteor', 'boss-spawn', 'boss-phase', 'boss-critical', 'boss-overload', 'boss-death', 'gift-support', 'gift-event', 'gift-premium', 'victory', 'storm']) {
    assert.ok(AUDIO_LAYERS[key], key);
    assert.ok(AUDIO_LAYERS[key].layers.length >= 1);
  }
  assert.ok(AUDIO_LAYERS.meteor.layers.length >= 3, 'meteor must combine warning, flight and impact layers');
  assert.ok(AUDIO_LAYERS['boss-overload'].layers.length >= 3);
});

test('audio layer plans keep narrator ducking for cinematic events', () => {
  for (const key of ['boss-spawn', 'boss-phase', 'boss-critical', 'boss-overload', 'boss-death', 'gift-premium', 'victory']) {
    const plan = audioLayerPlan(key);
    assert.ok(Array.isArray(plan.duck));
    assert.ok(plan.duck[0] >= 1000);
    assert.ok(plan.duck[1] < 0.5);
  }
});

test('unknown sound remains backward-compatible with single-layer fallback', () => {
  const plan = audioLayerPlan('future-sound');
  assert.equal(plan.layers[0].sound, 'future-sound');
  assert.equal(plan.channel, 'SFX');
});
