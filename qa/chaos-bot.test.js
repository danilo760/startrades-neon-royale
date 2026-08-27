import test from 'node:test';
import { runChaosScenarios } from './chaos-bot.js';

test('ChaosBot exercises hostile local-only scenarios', async () => {
  await runChaosScenarios();
});
