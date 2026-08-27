import assert from 'node:assert/strict';
import test from 'node:test';
import { ENGINE_EVENT_CHANNEL, eventBus, publishEngineEvent } from './event-bus.js';

test('event bus publishes generic and typed engine events', () => {
  const seen = [];
  const generic = (event) => seen.push(['generic', event.type, event.payload.reason]);
  const typed = (payload, event) => seen.push(['typed', event.type, payload.reason]);
  eventBus.once(ENGINE_EVENT_CHANNEL, generic);
  eventBus.once('boss:updated', typed);
  publishEngineEvent('boss:updated', { reason: 'meteor-impact' }, 123);
  assert.deepEqual(seen, [
    ['generic', 'boss:updated', 'meteor-impact'],
    ['typed', 'boss:updated', 'meteor-impact'],
  ]);
});
