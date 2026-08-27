import test from 'node:test';
import { runGameplayRounds, validateComboIdempotency } from './gameplay-bot.js';

test('GameplayBot completes rounds and validates invariants', () => {
  validateComboIdempotency();
  runGameplayRounds(Number(process.env.QA_GAMEPLAY_ROUNDS || 1));
});
