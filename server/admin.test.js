import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeAdminRequest, resetAdminRateLimits } from './admin.js';

test('admin simulator rejects missing configuration and bad token', () => {
  resetAdminRateLimits();
  assert.equal(authorizeAdminRequest({ token: '', headers: {} }).status, 503);
  assert.equal(authorizeAdminRequest({ token: 'secret', headers: { authorization: 'Bearer wrong' } }).status, 401);
  assert.equal(authorizeAdminRequest({ token: 'secret', headers: { authorization: 'Bearer secret' }, now: 1000 }).ok, true);
});

test('admin simulator is rate limited', () => {
  resetAdminRateLimits();
  const headers = { 'x-admin-token': 'secret' };
  assert.equal(authorizeAdminRequest({ token: 'secret', headers, ip: '1.2.3.4', action: 'gift', now: 1000 }).ok, true);
  assert.equal(authorizeAdminRequest({ token: 'secret', headers, ip: '1.2.3.4', action: 'gift', now: 1100 }).status, 429);
});
