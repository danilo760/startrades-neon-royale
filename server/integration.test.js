import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(url, child) {
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try { const response = await fetch(url); if (response.ok) return response.json(); } catch {}
    await sleep(100);
  }
  throw new Error('server did not become ready');
}

async function request(base, path, token, body = {}) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}
async function get(base, path, token = '') {
  const response = await fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

test('HTTP/WebSocket simulation covers auth, hot gift mapping, lifecycle, boss, narrator fallback and full round', { skip: !integrationEnabled, timeout: 20_000 }, async () => {
  const port = 4300 + Math.floor(Math.random() * 300);
  const token = 'integration-admin-token';
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), MOCK_MODE: 'true', ADMIN_TOKEN: token, BATTLE_COUNTDOWN_MS: '0', BATTLE_INTERMISSION_MS: '100', OLLAMA_URL: 'http://127.0.0.1:9', SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', OTEL_EXPORTER_OTLP_ENDPOINT: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; }); child.stderr.on('data', (chunk) => { logs += chunk; });
  let socket;
  try {
    const config = await waitForServer(`${base}/api/config`, child);
    assert.equal(config.mock, true); assert.equal(config.adminConfigured, true); assert.ok(Array.isArray(config.giftCatalog)); assert.ok(config.powerCatalog.some((power) => power.id === 'supernova'));

    const { WebSocket } = await import('ws');
    const events = [];
    socket = new WebSocket(`ws://127.0.0.1:${port}/events`);
    socket.on('message', (data) => { try { events.push(JSON.parse(String(data))); } catch {} });
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });

    let result = await request(base, '/api/admin/gift', '', { targetPlayerId: 'x', giftId: '5655' });
    assert.equal(result.response.status, 401);
    let mappingRead = await get(base, '/api/admin/gift-mappings', '');
    assert.equal(mappingRead.response.status, 401);

    result = await request(base, '/api/battle/pause', token);
    assert.equal(result.response.status, 409); assert.equal(result.data.error, 'battle-not-pausable');

    result = await request(base, '/api/test/players', token, { names: ['Nebula', 'CyberFox', 'Nova'] });
    assert.equal(result.response.status, 200); assert.equal(result.data.state.players.length, 3);
    const targetPlayerId = result.data.state.players[0].id;

    result = await request(base, '/api/battle/start', token);
    assert.equal(result.response.status, 200); assert.equal(result.data.state.phase, 'running');
    const spawnGraceUntil = Math.max(...result.data.state.players.map((player) => Number(player.spawnInvulnerableUntil) || 0));
    await sleep(300);
    result = await request(base, '/api/battle/start', token);
    assert.equal(result.response.status, 409); assert.equal(result.data.error, 'battle-not-in-lobby');

    mappingRead = await get(base, '/api/admin/gift-mappings', token);
    assert.equal(mappingRead.response.status, 200); assert.ok(mappingRead.data.mappings.some((mapping) => mapping.giftId === '5655'));

    result = await request(base, '/api/admin/gift-mappings', token, { giftId: '5655', giftName: 'Rose', enabled: true, powerId: 'tactical-shield', targetMode: 'SELF', magnitude: 999999, durationMs: 999999, cooldownMs: 0, visualPreset: 'shield-burst', soundPreset: 'shield', narrationPreset: 'hype' });
    assert.equal(result.response.status, 200); assert.equal(result.data.mapping.powerId, 'tactical-shield'); assert.ok(result.data.mapping.magnitude <= 20); assert.ok(result.data.mapping.durationMs <= 5000);
    result = await request(base, '/api/admin/gift', token, { targetPlayerId, giftId: '5655' });
    assert.equal(result.response.status, 200); assert.equal(result.data.result.powerId, 'tactical-shield');

    await sleep(300); // Preserve the production admin rate limit instead of bypassing it in integration.
    result = await request(base, '/api/admin/gift-mappings', token, { ...mappingRead.data.mappings.find((mapping) => mapping.giftId === '5655'), giftId: '5655', giftName: 'Rose', enabled: true, powerId: 'chain-lightning', targetMode: 'ENEMY', magnitude: 12, durationMs: 700, cooldownMs: 0, visualPreset: 'chain-lightning', soundPreset: 'lightning', narrationPreset: 'hype' });
    assert.equal(result.response.status, 200); assert.equal(result.data.mapping.powerId, 'chain-lightning');
    await sleep(Math.max(300, spawnGraceUntil - Date.now() + 50));
    result = await request(base, '/api/admin/gift', token, { targetPlayerId, giftId: '5655' });
    assert.equal(result.response.status, 200); assert.equal(result.data.result.powerId, 'chain-lightning');

    result = await request(base, '/api/admin/boss', token);
    assert.equal(result.response.status, 200); assert.equal(result.data.state.boss.active, true);

    result = await request(base, '/api/game/combat', '', { attackerId: targetPlayerId, targetId: 'fake', damage: 9999, targetHp: 0, eliminated: true });
    assert.equal(result.response.status, 404);
    result = await request(base, '/api/game/positions', '', { players: [{ id: targetPlayerId, x: 9999, y: 9999 }] });
    assert.equal(result.response.status, 404);

    result = await request(base, '/api/battle/end', token);
    assert.equal(result.response.status, 200); assert.equal(result.data.state.phase, 'ended'); assert.equal(result.data.state.boss.active, false);

    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && (
      !events.some((e) => e.type === 'gift:applied') ||
      !events.some((e) => e.type === 'power:executed' && e.payload?.powerId === 'chain-lightning') ||
      !events.some((e) => e.type === 'boss:spawned') ||
      !events.some((e) => e.type === 'battle-end') ||
      !events.some((e) => e.type === 'round:lobby' && e.state?.phase === 'lobby') ||
      !events.some((e) => e.type === 'agent' && e.payload?.fallback)
    )) await sleep(50);
    assert.ok(events.some((e) => e.type === 'gift:applied'));
    assert.ok(events.some((e) => e.type === 'power:executed' && e.payload?.powerId === 'chain-lightning'));
    assert.ok(events.some((e) => e.type === 'boss:spawned'));
    assert.ok(events.some((e) => e.type === 'battle-end'));
    assert.ok(events.some((e) => e.type === 'round:lobby' && e.state?.phase === 'lobby'));
    const fallback = events.find((e) => e.type === 'agent' && e.payload?.fallback);
    assert.ok(fallback, `expected narrator fallback; logs=${logs.slice(-800)}`);
    assert.ok(String(fallback.payload.text).trim().split(/\s+/).length <= 16);
  } finally {
    socket?.close(); child.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(1500)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});
