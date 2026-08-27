import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeAdminRequest, resetAdminRateLimits } from './admin.js';

test('admin simulator rejects missing configuration and bad token', () => {
  resetAdminRateLimits();
  assert.equal(authorizeAdminRequest({ token: '', headers: {} }).status, 503);
  assert.equal(authorizeAdminRequest({ token: 'secret', headers: { authorization: 'Bearer wrong' } }).status, 401);
  assert.equal(authorizeAdminRequest({ token: 'secret', headers: { authorization: 'Bearer secret' }, now: 1000 }).ok, true);
});

test('QA Lab requests are blocked server-side outside MOCK_MODE', () => {
  resetAdminRateLimits();
  const headers = { authorization: 'Bearer secret', 'x-neon-qa-lab': '1' };
  const blocked = authorizeAdminRequest({ token: 'secret', headers, mockMode: false, now: 1000 });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.reason, 'qa-lab-disabled');
  assert.equal(authorizeAdminRequest({ token: 'secret', headers, mockMode: true, now: 2000 }).ok, true);
});

test('admin simulator is rate limited', () => {
  resetAdminRateLimits();
  const headers = { 'x-admin-token': 'secret' };
  assert.equal(authorizeAdminRequest({ token: 'secret', headers, ip: '1.2.3.4', action: 'gift', now: 1000 }).ok, true);
  assert.equal(authorizeAdminRequest({ token: 'secret', headers, ip: '1.2.3.4', action: 'gift', now: 1100 }).status, 429);
});
