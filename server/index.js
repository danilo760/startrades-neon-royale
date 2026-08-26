import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { TikTokLive } from 'tiktok-live-api';
import { addBots, applyCombatResult, applyComment, applyGift, applyStormDamage, finish, likes, pause, positions, reset, setStorm, start, state, tickStorm, updateSettings } from './engine.js';
import { initializeLeaderboard } from './leaderboard.js';

const cfg = { username: process.env.TIKTOK_USERNAME || 'startrades01', apiKey: process.env.TIKTOOL_API_KEY || '', ollama: process.env.OLLAMA_URL || 'http://127.0.0.1:11434', model: process.env.OLLAMA_MODEL || 'llama3.2:3b', mock: process.env.MOCK_MODE !== 'false', port: Number(process.env.PORT || 4173), cooldown: Number(process.env.AGENT_COOLDOWN_MS || 4500) };
const app = express(); app.use(express.json({ limit: '200kb' })); app.use(express.static('dist'));
const server = app.listen(cfg.port, () => console.log(`StarTrades LIVE http://127.0.0.1:${cfg.port} (${cfg.mock ? 'SIMULAÇÃO' : '@' + cfg.username})`));
const wss = new WebSocketServer({ server, path: '/events' });
const emit = (type, payload = {}) => { const data = JSON.stringify({ type, payload, state }); wss.clients.forEach((c) => c.readyState === 1 && c.send(data)); };
wss.on('connection', (s) => s.send(JSON.stringify({ type: 'state', state })));
void initializeLeaderboard();

let lastSpeech = 0;
const styleDirection = () => ({
  cinematic: 'Fale como narrador de trailer, com suspense e frases marcantes.',
  esports: 'Fale como caster profissional de e-sports, claro, rápido e empolgante.',
  explosive: 'Fale como apresentador de arena, com energia máxima, impacto e emoção.',
}[state.settings.narratorStyle] || 'Fale como apresentador de arena com muita energia.');
const sanitizeNarration = (value) => String(value || '').replace(/["'*#`\r\n]/g, ' ').replace(/^(narrador|nova|resposta)\s*:\s*/i, '').replace(/[^\p{L}\p{N}@!?.,À-ÿ\s-]/gu, '').trim().split(/\s+/).slice(0, 16).join(' ').slice(0, 180);

async function agent(context, { force = false, emotion = 'hype' } = {}) {
  if (!state.settings.agentEnabled || (!force && Date.now() - lastSpeech < cfg.cooldown)) return;
  lastSpeech = Date.now();
  try {
    const prompt = `Você é NOVA, o narrador ÉPICO e HIPER-EMPOLGADO de eSports em uma arena neon. ${styleDirection()} Emoção atual: ${emotion}. Narre como final de campeonato: use EXCLAMAÇÕES, MAIÚSCULAS para impacto e gírias de games como INSANO, GG e CLUTCH. Responda em português brasileiro com no máximo 16 palavras. Não use emojis, não prometa prêmios, não peça dinheiro ou diamantes, não repita insultos nem dados pessoais. Evento: ${context}`;
    const r = await fetch(`${cfg.ollama}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: cfg.model, stream: false, prompt }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json(); const text = sanitizeNarration(data.response);
    if (text) emit('agent', { text, emotion, priority: force });
  } catch (e) {
    console.error('Ollama:', e.message);
    const fallback = sanitizeNarration(`Atenção, arena! ${context}`);
    if (fallback) emit('agent', { text: fallback, emotion, priority: force });
  }
}

function chat(e) {
  const username = e.user?.uniqueId || e.username || 'fighter', platformUserId = e.user?.userId || username, avatarUrl = e.user?.profilePictureUrl || ''; const comment = e.comment || ''; const result = applyComment({ username, platformUserId, avatarUrl, comment });
  emit('comment', { username, comment, result });
  if (result.kind === 'join') agent(`${result.player.id} acaba de aterrissar. Receba o novo combatente!`, { emotion: 'welcome' });
  else if (/^(oi|olá|ola|como joga|!ajuda)$/i.test(comment.trim())) agent(`Explique: digite entrar com exclamação para participar; presentes ativam poderes.`, { emotion: 'friendly' });
}
function gift(e) {
  if (e.repeatEnd === false) return;
  const username = e.user?.uniqueId || e.username || 'fighter', platformUserId = e.user?.userId || username, avatarUrl = e.user?.profilePictureUrl || '';
  const result = applyGift({ username, platformUserId, avatarUrl, giftName: e.giftName, diamondCount: e.diamondCount, repeatCount: e.repeatCount });
  if (!result.ignored) { emit('power', result); agent(`${result.playerId} liberou ${result.power.label}! A arena sentiu o impacto!`, { emotion: result.power.kind === 'meteor' ? 'legendary' : 'power' }); }
}

if (!cfg.mock) {
  if (!cfg.apiKey) throw new Error('TIKTOOL_API_KEY ausente');
  const live = new TikTokLive(cfg.username, { apiKey: cfg.apiKey, autoReconnect: true, maxReconnectAttempts: 30 });
  live.on('chat', chat); live.on('gift', gift);
  live.on('like', (e) => { const bonus = likes(e.likeCount); emit('like', { count: e.likeCount, bonus }); if (bonus) agent('Quinhentas curtidas repeliram a tempestade! A torcida mudou a partida!', { emotion: 'triumph' }); });
  live.on('connected', () => { emit('connection', { online: true }); agent('Conexão com a live confirmada. A arena está online!', { force: true, emotion: 'welcome' }); });
  live.on('disconnected', () => emit('connection', { online: false })); live.on('error', console.error); live.connect().catch(console.error);
}

const ok = (res) => res.json({ ok: true, state });
app.post('/api/battle/start', (_q, r) => { start(); emit('battle-start'); agent('A batalha começou! Convide todos para entrar agora!', { force: true, emotion: 'battle' }); ok(r); });
app.post('/api/battle/pause', (_q, r) => { pause(); emit('battle-pause'); agent(state.phase === 'paused' ? 'Tempo congelado! A batalha está pausada.' : 'Voltamos! A batalha está valendo novamente!', { force: true, emotion: state.phase === 'paused' ? 'calm' : 'battle' }); ok(r); });
const winnerName = (winner) => winner?.type === 'team' ? winner.label : winner?.id ? `@${winner.id}` : null;
app.post('/api/battle/end', (_q, r) => { const winner = finish(); emit('battle-end', { winner }); const name = winnerName(winner); if (state.settings.agentEnabled) emit('agent', { text: name ? `${name} domina a arena e conquista a vitória!` : 'A rodada terminou sem campeão.', emotion: 'victory', priority: true }); ok(r); });
app.post('/api/battle/reset', (_q, r) => { reset(); emit('reset'); ok(r); });
app.post('/api/test/players', (q, r) => { addBots(q.body.names || []); emit('players'); ok(r); });
app.post('/api/mock/comment', (q, r) => { chat(q.body); ok(r); });
app.post('/api/mock/gift', (q, r) => { gift(q.body); ok(r); });
app.post('/api/storm', (q, r) => { setStorm(q.body.value); emit('storm', { value: state.storm }); if (state.storm >= 60) agent(`A tempestade avançou para ${state.storm} por cento! Corram para o centro!`, { emotion: 'urgent' }); ok(r); });
app.post('/api/settings', (q, r) => { updateSettings(q.body); emit('settings'); ok(r); });
app.post('/api/game/positions', (q, r) => { positions(q.body.players || []); ok(r); });
function autoFinish() {
  const alive = state.players.filter((p) => p.alive);
  const joinedTeams = new Set(state.players.map((p) => p.team));
  const aliveTeams = new Set(alive.map((p) => p.team));
  const battleOver = state.settings.teamMode ? joinedTeams.size >= 2 && aliveTeams.size <= 1 : alive.length <= 1;
  if (state.phase === 'running' && state.players.length >= 2 && battleOver) {
    const winner = finish(); emit('battle-end', { winner });
    const name = winnerName(winner);
    if (state.settings.agentEnabled) emit('agent', { text: name ? `${name} sobreviveu ao caos e conquista a arena!` : 'A tempestade eliminou todos os combatentes!', emotion: 'victory', priority: true });
  }
}
app.post('/api/game/combat', (q, r) => {
  const result = applyCombatResult(q.body);
  emit('combat-result', { ...q.body, result });
  if (result?.bountyClaimed) agent(`@${result.attackerId} DERRUBOU O LÍDER DA ARENA E GANHOU PONTUAÇÃO TRIPLA!`, { force: true, emotion: 'legendary' });
  else if (result?.eliminated) agent(`${result.attackerId} acaba de eliminar ${result.targetId}!`, { emotion: 'elimination' });
  autoFinish(); ok(r);
});
app.post('/api/game/storm-damage', (q, r) => { applyStormDamage(q.body.targetId, q.body.damage); emit('storm-damage', q.body); autoFinish(); ok(r); });
app.get('/api/config', (_q, r) => r.json({ username: cfg.username, mock: cfg.mock, model: cfg.model }));
setInterval(() => { tickStorm(); if (state.phase === 'running') emit('tick'); }, 7000);
app.get('*', (_q, r) => r.sendFile(new URL('../dist/index.html', import.meta.url).pathname));
