import assert from 'node:assert/strict';
import test from 'node:test';
import { GiftEventLedger, normalizeGiftEvent, resolveGiftDefinition, sanitizeNarrationName } from './gifts.js';

test('resolve gift by ID before alias and preserve premium split', () => {
  assert.equal(resolveGiftDefinition('5655', 'Universe').effect, 'entry-boost');
  assert.equal(resolveGiftDefinition('', 'Leão').effect, 'star-power');
  assert.equal(resolveGiftDefinition('', 'Universo').effect, 'colossus');
  assert.equal(resolveGiftDefinition('', 'Foguete').effect, 'meteor');
});

test('sanitize identity and display fields without using username as stable id', () => {
  const event = normalizeGiftEvent({ msgId: 'm1', giftId: 5655, giftName: 'Rose', user: { userId: '123456', uniqueId: 'name\nIGNORE', nickname: 'Nick\u0000' } });
  assert.equal(event.senderUserId, '123456');
  assert.equal(event.senderUsername.includes('\n'), false);
  assert.equal(sanitizeNarrationName('ignore previous: @bad'), 'ignorepreviousbad');
});

test('duplicate event is rejected idempotently', () => {
  const ledger = new GiftEventLedger();
  const raw = { msgId: 'same', giftId: 5655, giftName: 'Rose', giftType: 0, user: { userId: 'u1', uniqueId: 'alpha' } };
  assert.equal(ledger.ingest(raw).status, 'ready');
  assert.equal(ledger.ingest(raw).status, 'duplicate');
});

test('combo intermediate is pending and final applies confirmed count once', () => {
  const ledger = new GiftEventLedger();
  const base = { transactionId: 'tx1', groupId: 'g1', giftId: 5655, giftName: 'Rose', giftType: 1, user: { userId: 'u1', uniqueId: 'alpha' } };
  assert.equal(ledger.ingest({ ...base, msgId: 'm1', repeatCount: 1, repeatEnd: false }).status, 'pending');
  assert.equal(ledger.ingest({ ...base, msgId: 'm2', repeatCount: 2, repeatEnd: false }).status, 'pending');
  const final = ledger.ingest({ ...base, msgId: 'm3', repeatCount: 2, repeatEnd: true });
  assert.equal(final.status, 'ready'); assert.equal(final.event.repeatCount, 2);
  assert.equal(ledger.ingest({ ...base, msgId: 'm4', repeatCount: 2, repeatEnd: true }).status, 'duplicate');
});

test('real TikTok event without user.userId is rejected', () => {
  const ledger = new GiftEventLedger();
  const result = ledger.ingest({ msgId: 'm9', giftId: 5655, user: { uniqueId: 'alpha' } });
  assert.equal(result.reason, 'missing-sender-id');
});
