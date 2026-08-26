import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { TikTokLive } from 'tiktok-live-api';
import { addBots, applyCombatResult, applyComment, applyGift, applyStormDamage, finish, likes, pause, positions, reset, setStorm, start, state, tickStorm, updateSettings } from './engine.js';

const cfg = { username: process.env.TIKTOK_USERNAME || 'startrades01', apiKey: process.env.TIKTOOL_API_KEY || '', ollama: process.env.OLLAMA_URL || 'http://127.0.0.1:11434', model: process.env.OLLAMA_MODEL || 'llama3.2:3b', mock: process.env.MOCK_MODE !== 'false', port: Number(process.env.PORT || 4173), cooldown: Number(process.env.AGENT_COOLDOWN_MS || 6000) };
const app = express(); app.use(express.json({ limit: '200kb' })); app.use(express.static('dist'));
const server = app.listen(cfg.port, () => console.log(`StarTrades LIVE http://127.0.0.1:${cfg.port} (${cfg.mock ? 'SIMULAÇÃO' : '@' + cfg.username})`));
const wss = new WebSocketServer({ server, path: '/events' });
const emit = (type, payload = {}) => { const data = JSON.stringify({ type, payload, state }); wss.clients.forEach((c) => c.readyState === 1 && c.send(data)); };
wss.on('connection', (s) => s.send(JSON.stringify({ type: 'state', state })));

let lastSpeech = 0;
async function agent(context, force = false) {
  if (!state.settings.agentEnabled || (!force && Date.now() - lastSpeech < cfg.cooldown)) return;
  lastSpeech = Date.now();
  try {
    const r = await fetch(`${cfg.ollama}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: cfg.model, stream: false, prompt: `Você é NOVA, narrador masculino do Battle Royale StarTrades. Responda em português brasileiro com muita energia e no máximo 16 palavras. Não prometa prêmio, não peça dinheiro, não repita insultos ou dados pessoais. Evento: ${context}` }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`); const data = await r.json(); const text = String(data.response || '').replace(/[*#]/g, '').trim().slice(0, 180); if (text) emit('agent', { text });
  } catch (e) {
    console.error('Ollama:', e.message);
    const fallback = String(context).replace(/[\r\n]+/g, ' ').trim().slice(0, 140);
    if (fallback) emit('agent', { text: `Atenção, arena! ${fallback}` });
  }
}

function chat(e) { const username = e.user?.uniqueId || e.username || 'fighter'; const comment = e.comment || ''; const result = applyComment({ username, comment }); emit('comment', { username, comment, result }); if (result.kind === 'join') agent(`${username} entrou na arena.`); else if (/^(oi|olá|ola|como joga|!ajuda)$/i.test(comment.trim())) agent(`${username} perguntou: ${comment}. Diga que !entrar participa e presentes ativam poderes.`); }
function gift(e) { if (e.repeatEnd === false) return; const username = e.user?.uniqueId || e.username || 'fighter'; const result = applyGift({ username, giftName: e.giftName, diamondCount: e.diamondCount, repeatCount: e.repeatCount }); if (!result.ignored) { emit('power', result); agent(`${username} ativou ${result.power.label}.`); } }

if (!cfg.mock) {
  if (!cfg.apiKey) throw new Error('TIKTOOL_API_KEY ausente');
  const live = new TikTokLive(cfg.username, { apiKey: cfg.apiKey, autoReconnect: true, maxReconnectAttempts: 30 });
  live.on('chat', chat); live.on('gift', gift); live.on('like', (e) => { const bonus = likes(e.likeCount); emit('like', { count: e.likeCount, bonus }); }); live.on('connected', () => emit('connection', { online: true })); live.on('disconnected', () => emit('connection', { online: false })); live.on('error', console.error); live.connect().catch(console.error);
}

const ok = (res) => res.json({ ok: true, state });
app.post('/api/battle/start', (_q, r) => { start(); emit('battle-start'); agent('A batalha começou. Chame todos para a arena.', true); ok(r); });
app.post('/api/battle/pause', (_q, r) => { pause(); emit('battle-pause'); ok(r); });
app.post('/api/battle/end', (_q, r) => { const winner = finish(); emit('battle-end', { winner }); if (state.settings.agentEnabled) emit('agent', { text: winner ? `${winner.id} é o grande campeão da rodada!` : 'A rodada terminou sem campeão.' }); ok(r); });
app.post('/api/battle/reset', (_q, r) => { reset(); emit('reset'); ok(r); });
app.post('/api/test/players', (q, r) => { addBots(q.body.names || []); emit('players'); ok(r); });
app.post('/api/mock/comment', (q, r) => { chat(q.body); ok(r); });
app.post('/api/mock/gift', (q, r) => { gift(q.body); ok(r); });
app.post('/api/storm', (q, r) => { setStorm(q.body.value); emit('storm'); ok(r); });
app.post('/api/settings', (q, r) => { updateSettings(q.body); emit('settings'); ok(r); });
app.post('/api/game/positions', (q, r) => { positions(q.body.players || []); ok(r); });
function autoFinish() {
  const alive = state.players.filter((p) => p.alive);
  if (state.phase === 'running' && state.players.length >= 2 && alive.length <= 1) {
    const winner = finish(); emit('battle-end', { winner });
    if (state.settings.agentEnabled) emit('agent', { text: winner ? `${winner.id} sobreviveu à arena e é o campeão!` : 'A tempestade eliminou todos os combatentes!' });
  }
}
app.post('/api/game/combat', (q, r) => { applyCombatResult(q.body); emit('combat-result', q.body); autoFinish(); ok(r); });
app.post('/api/game/storm-damage', (q, r) => { applyStormDamage(q.body.targetId, q.body.damage); emit('storm-damage', q.body); autoFinish(); ok(r); });
app.get('/api/config', (_q, r) => r.json({ username: cfg.username, mock: cfg.mock, model: cfg.model }));
setInterval(() => { tickStorm(); if (state.phase === 'running') emit('tick'); }, 7000);
app.get('*', (_q, r) => r.sendFile(new URL('../dist/index.html', import.meta.url).pathname));
