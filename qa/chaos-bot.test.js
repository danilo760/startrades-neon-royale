import assert from 'node:assert/strict';
import test from 'node:test';
import { assertChaosSafety } from './chaos-bot.js';

const ENV_KEYS = ['NODE_ENV', 'MOCK_MODE', 'QA_CHAOS_ACK', 'RENDER'];

test('ChaosBot safety gate requires explicit local-only acknowledgement', () => {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) delete process.env[key];
    assert.throws(() => assertChaosSafety(['node', 'qa/chaos-bot.js']), /NODE_ENV=test/);

    process.env.NODE_ENV = 'test';
    process.env.MOCK_MODE = 'true';
    process.env.QA_CHAOS_ACK = 'I_UNDERSTAND_LOCAL_ONLY';
    assert.doesNotThrow(() => assertChaosSafety(['node', 'qa/chaos-bot.js', '--i-understand-chaos']));

    process.env.RENDER = 'true';
    assert.throws(() => assertChaosSafety(['node', 'qa/chaos-bot.js', '--i-understand-chaos']), /blocked on Render/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
