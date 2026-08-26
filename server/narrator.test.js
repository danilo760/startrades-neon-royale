import assert from 'node:assert/strict';
import test from 'node:test';
import { eventBus } from './event-bus.js';
import { createNarrator, narratorConstants } from './narrator.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const makeState = () => ({
  round: 3,
  players: [{ id: 'a', username: 'Alpha', eliminations: 4 }],
  settings: { agentEnabled: true },
});

test('fast path never calls Ollama and aggro-changed stays silent', async () => {
  const emitted = []; let fetchCalls = 0;
  const narrator = createNarrator({
    emit: (type, payload) => emitted.push({ type, payload }),
    state: makeState(), ollamaUrl: 'http://ollama.invalid', model: 'test',
    fetchImpl: async () => { fetchCalls++; throw new Error('should-not-run'); },
  });
  try {
    eventBus.emit('boss:attacked', { reason: 'aggro-changed' });
    eventBus.emit('player:healed', { username: 'Alpha', heal: 12 });
    await sleep(5);
    assert.equal(fetchCalls, 0);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].type, 'agent');
    assert.equal(emitted[0].payload.path, 'fast');
    assert.ok(emitted[0].payload.text.split(/\s+/).length <= 16);
  } finally { narrator.dispose(); }
});

test('epic gift uses slow path, sanitizes context and clamps Ollama output to sixteen words', async () => {
  const emitted = []; let capturedPrompt = '';
  const narrator = createNarrator({
    emit: (type, payload) => emitted.push({ type, payload }),
    state: makeState(), ollamaUrl: 'http://ollama.invalid', model: 'test',
    fetchImpl: async (_url, options) => {
      capturedPrompt = JSON.parse(options.body).prompt;
      return {
        ok: true,
        json: async () => ({ response: 'um dois três quatro cinco seis sete oito nove dez onze doze treze quatorze quinze dezesseis dez