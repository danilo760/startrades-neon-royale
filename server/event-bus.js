import { EventEmitter } from 'node:events';

export const ENGINE_EVENT_CHANNEL = 'engine:event';
export const eventBus = new EventEmitter();
eventBus.setMaxListeners(50);

export function publishEngineEvent(type, payload = {}, at = Date.now()) {
  const event = { type, payload, at };
  eventBus.emit(ENGINE_EVENT_CHANNEL, event);
  eventBus.emit(type, payload, event);
  return event;
}
