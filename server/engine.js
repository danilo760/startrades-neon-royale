import { randomUUID } from 'node:crypto';
import { getLeaderboardTop, recordRound } from './leaderboard.js';

const players = new Map();
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const clean = (v = 'fighter') => String(v).replace(/^@/, '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 24) || 'fighter';

export const POWER_PRESETS = Object.fromEntries([
  ['shot', { label: 'RAJADA ESTELAR', damage: 12, radius: 0, color: 0x75ff5b, sound: 'laser' }],
  ['shield', { label: 'ESCUDO DE ENERGIA', shield: 32, color: 0x35eaff, sound: 'shield' }],
  ['supply', { label: 'CAIXA DE SUPRIMENTOS', heal: 24, shield: 30, color: 0x5dff70, sound: 'heal' }],
  ['grenade', { label: 'GRANADA DE PLASMA', damage: 22, radius: 120, color: 0xa14dff, sound: 'explosion' }],
  ['airstrike', { label: 'ATAQUE AÉREO', damage: 28, radius: 180, color: 0xff334e, sound: 'airstrike' }],
  ['drone', { label: 'DRONE CAÇADOR', damage: 34, radius: 0, color: 0xff4dff, sound: 'laser' }],
  ['meteor', { label: 'METEORO LENDÁRIO', damage: 55, radius: 250, color: 0xffa12b, sound: 'explosion' }],
]);
const DEFAULT_GIFT_MAPPING = { rosa: { kind: 'shot' }, 'dedo em pistola': { kind: 'shot' }, gg: { kind: 'shield' }, boneca: { kind: 'supply' }, foguete: { kind: 'grenade' }, leão: { kind: 'airstrike' }, drone: { kind: 'drone' }, universo: { kind: 'meteor' } };
export const ARENA_BACKGROUNDS = ['default', 'cyberpunk', 'space', 'retro'];

export const POWER_CATALOG = [
  { id: 'blast', min: 1, max: 4, sample: 1, giftExample: 'Rosa', kind: 'shot', icon: '✦', label: 'RAJADA ESTELAR', summary: 'Disparo de energia no adversário mais próximo', damage: 12, color: 0x75ff5b },
  { id: 'shield', min: 5, max: 9, sample: 5, giftExample: 'Presente de 5 moedas', kind: 'shield', icon: '⬡', label: 'ESCUDO DE ENERGIA', summary: 'Adiciona 32 pontos de proteção', shield: 32, color: 0x35eaff },
  { id: 'supply', min: 10, max: 29, sample: 10, giftExample: 'Presente de 10 moedas', kind: 'supply', icon: '✚', label: 'CAIXA DE SUPRIMENTOS', summary: 'Recupera vida e reforça o escudo', heal: 24, shield: 30, color: 0x5dff70 },
  { id: 'grenade', min: 30, max: 99, sample: 30, giftExample: 'Presente de 30 moedas', kind: 'grenade', icon: '◉', label: 'GRANADA DE PLASMA', summary: 'Explosão concentrada de alto impacto', damage: 22, radius: 120, color: 0xa14dff },
  { id: 'airstrike', min: 100, max: 299, sample: 100, giftExample: 'Presente de 100 moedas', kind: 'airstrike', icon: '⌖', label: 'ATAQUE AÉREO', summary: 'Marca e atinge até cinco combatentes', damage: 28, radius: 180, color: 0xff334e },
  { id: 'drone', min: 300, max: 999, sample: 300, giftExample: 'Presente de 300 moedas', kind: 'drone', icon: '◆', label: 'DRONE CAÇADOR', summary: 'Persegue o alvo e dispara um laser pesado', damage: 34, color: 0xff4dff },
  { id: 'meteor', min: 1000, max: null, sample: 1000, giftExample: 'Universo ou 1.000+ moedas', kind: 'meteor', icon: '☄', label: 'METEORO LENDÁRIO', summary: 'Evento cinematográfico com dano devastador', damage: 55, radius: 250, color: 0xffa12b },
];

export const state = {
  phase: 'lobby', round: 1, storm: 0, likes: 0, players: [], feed: [], winner: null,
  bountyTargetId: null, bountyTargetPlatformId: null, bountyClaimedBy: null, roundId: randomUUID(), teamScores: { blue: { score: 0, survivors: 0, eliminations: 0 }, red: { score: 0, survivors: 0, eliminations: 0 } },
  powerCatalog: POWER_CATALOG,
  settings: { agentEnabled: true, teamMode: false, arenaBackground: 'default', voiceMode: 'male', voiceIntensity: 3, narratorStyle: 'explosive', music: true, sound: true, giftMapping: { ...DEFAULT_GIFT_MAPPING } },
};

let roundRecorded = false;

const feed = (text, tone = 'info') => {
  state.feed.unshift({ id: `${Date.now()}-${Math.random()}`, text, tone, at: Date.now() });
  state.feed = state.feed.slice(0, 14);
};
const teamStats = (team) => [...players.values()].filter((p) => p.team === team).reduce((total, p) => ({ score: total.score + p.score, survivors: total.survivors + Number(p.alive), eliminations: total.eliminations + p.eliminations }), { score: 0, survivors: 0, eliminations: 0 });
const sync = () => {
  state.players = [...players.values()].sort((a, b) => Number(b.alive) - Number(a.alive) || b.score - a.score);
  state.teamScores = { blue: teamStats('blue'), red: teamStats('red') };
};
const spawnPoint = () => ({ x: 130 + Math.random() * 1020, y: 115 + Math.random() * 480 });
const normalizeTeam = (choice) => ['azul', 'blue'].includes(String(choice || '').toLowerCase()) ? 'blue' : ['vermelho', 'red'].includes(String(choice || '').toLowerCase()) ? 'red' : null;
const balancedTeam = () => teamStats('blue').survivors <= teamStats('red').survivors ? 'blue' : 'red';

export function join(username, teamChoice = null, bot = false, identity = {}) {
  const id = clean(username);
  if (!players.has(id)) {
    const pos = spawnPoint();
    players.set(id, { id, username: id, platformUserId: String(identity.platformUserId || id).slice(0, 64), avatarUrl: /^https:\/\//i.test(identity.avatarUrl || '') ? String(identity.avatarUrl).slice(0, 500) : '', ...pos, targetX: pos.x, targetY: pos.y, hp: 100, shield: 0, energy: 0, score: 0, eliminations: 0, alive: true, skin: players.size % 4, team: normalizeTeam(teamChoice) || balancedTeam(), bot });
    feed(`@${id} aterrissou na arena`, 'join');
  }
  const player = players.get(id);
  if (identity.avatarUrl && /^https:\/\//i.test(identity.avatarUrl)) player.avatarUrl = String(identity.avatarUrl).slice(0, 500);
  if (state.bountyTargetPlatformId && player.platformUserId === state.bountyTargetPlatformId) state.bountyTargetId = player.id;
  sync(); return players.get(id);
}

export function addBots(names = []) { names.slice(0, 30).forEach((n) => join(n, null, true)); return state; }
export function start() {
  const leader = getLeaderboardTop();
  state.phase = 'running'; state.winner = null; state.roundId = randomUUID(); state.bountyTargetPlatformId = leader?.platformUserId || leader?.id || null; state.bountyTargetId = [...players.values()].find((p) => p.platformUserId === state.bountyTargetPlatformId)?.id || null; state.bountyClaimedBy = null; roundRecorded = false;
  feed(`RODADA ${state.round} INICIADA`, 'system');
  if (state.bountyTargetId) feed(`CAÇADA ATIVA: @${state.bountyTargetId} vale pontuação tripla`, 'bounty');
  sync(); return state;
}
export function pause() { state.phase = state.phase === 'paused' ? 'running' : 'paused'; feed(state.phase === 'paused' ? 'Batalha pausada' : 'Batalha retomada', 'system'); return state; }
export function setStorm(value) { state.storm = clamp(Number(value) || 0, 0, 100); feed(`Tempestade em ${state.storm}%`, 'storm'); return state; }
export function updateSettings(next = {}) {
  const { giftMapping, removeGift, ...rest } = next;
  Object.assign(state.settings, Object.fromEntries(Object.entries(rest).filter(([k]) => k in state.settings)));
  state.settings.arenaBackground = ARENA_BACKGROUNDS.includes(state.settings.arenaBackground) ? state.settings.arenaBackground : 'default';
  if (giftMapping && typeof giftMapping === 'object') for (const [rawName, cfg] of Object.entries(giftMapping)) {
    const key = String(rawName).trim().toLowerCase();
    if (key && cfg && POWER_PRESETS[cfg.kind]) state.settings.giftMapping[key] = { kind: cfg.kind, ...(cfg.sound ? { sound: cfg.sound } : {}) };
  }
  if (removeGift) delete state.settings.giftMapping[String(removeGift).trim().toLowerCase()];
  return state;
}

export function giftPower(diamonds = 1, name = '', mapping = state.settings.giftMapping) {
  const d = Math.max(1, Number(diamonds) || 1);
  const mapped = mapping?.[String(name || '').trim().toLowerCase()];
  const kind = mapped?.kind || (/universe|universo/i.test(name) || d >= 1000 ? 'meteor' : d >= 300 ? 'drone' : d >= 100 ? 'airstrike' : d >= 30 ? 'grenade' : d >= 10 ? 'supply' : d >= 5 ? 'shield' : 'shot');
  const preset = POWER_PRESETS[kind] || POWER_PRESETS.shot;
  const tier = POWER_CATALOG.find((power) => power.kind === kind) || POWER_CATALOG[0];
  return { ...tier, ...preset, kind, ...(mapped?.sound ? { sound: mapped.sound } : {}) };
}

export function applyGift({ username, platformUserId, avatarUrl, giftName = 'Presente', diamondCount = 1, repeatCount = 1 }) {
  const player = join(username, null, false, { platformUserId, avatarUrl });
  if (state.phase !== 'running' || !player.alive) return { ignored: true };
  const total = Math.max(1, Number(diamondCount) * Math.max(1, Number(repeatCount)));
  const power = giftPower(total, giftName, state.settings.giftMapping);
  player.score += total; player.energy = clamp(player.energy + Math.min(total, 40), 0, 100);
  if (power.heal) player.hp = clamp(player.hp + power.heal, 0, 100);
  if (power.shield) player.shield = clamp(player.shield + power.shield, 0, 100);
  feed(`@${player.id} ativou ${power.label}`, 'gift'); sync();
  return { playerId: player.id, power, total, giftName };
}

export function applyComment({ username, platformUserId, avatarUrl, comment = '' }) {
  const cmd = String(comment).trim().toLowerCase();
  const joinCommand = cmd.match(/^!(?:entrar|join)(?:\s+(azul|blue|vermelho|red))?$/);
  if (joinCommand) return { kind: 'join', player: join(username, joinCommand[1] || null, false, { platformUserId, avatarUrl }) };
  const p = players.get(clean(username));
  if (!p || !p.alive || state.phase !== 'running') return { kind: 'chat' };
  if (cmd === '!esquerda') p.targetX = clamp(p.x - 180, 70, 1210);
  if (cmd === '!direita') p.targetX = clamp(p.x + 180, 70, 1210);
  if (cmd === '!cima') p.targetY = clamp(p.y - 140, 80, 630);
  if (cmd === '!baixo') p.targetY = clamp(p.y + 140, 80, 630);
  if (cmd === '!poder' && p.energy >= 100) { p.energy = 0; return { kind: 'power', playerId: p.id, power: giftPower(30, 'energia') }; }
  return { kind: cmd.startsWith('!') ? 'command' : 'chat', player: p };
}

export function applyCombatResult({ attackerId, targetId, damage, targetHp, targetShield, eliminated }) {
  const attacker = players.get(attackerId); const target = players.get(targetId);
  if (!attacker || !target || !attacker.alive || !target.alive || attacker.id === target.id) return { applied: false, reason: 'invalid-combatants' };
  if (state.settings.teamMode && attacker.team === target.team) return { applied: false, reason: 'friendly-fire' };
  target.hp = clamp(targetHp, 0, 100); target.shield = clamp(targetShield, 0, 100);
  const basePoints = Math.max(1, Math.round(Number(damage) || 0));
  const bountyClaimed = Boolean(eliminated && target.id === state.bountyTargetId);
  attacker.score += basePoints * (bountyClaimed ? 3 : 1);
  if (eliminated) {
    target.alive = false; attacker.eliminations++;
    feed(`@${attacker.id} eliminou @${target.id}`, 'elimination');
    if (bountyClaimed) { state.bountyClaimedBy = attacker.id; state.bountyTargetId = null; state.bountyTargetPlatformId = null; feed(`@${attacker.id} conquistou a CAÇADA TRIPLA`, 'bounty'); }
  }
  sync();
  return { applied: true, eliminated: Boolean(eliminated), bountyClaimed, attackerId: attacker.id, targetId: target.id, pointsAwarded: basePoints * (bountyClaimed ? 3 : 1) };
}

export function applyStormDamage(targetId, damage = 4) {
  const target = players.get(targetId); if (!target || !target.alive || state.phase !== 'running') return;
  target.hp = clamp(target.hp - Math.max(1, damage), 0, 100);
  if (target.hp === 0) { target.alive = false; feed(`@${target.id} foi engolido pela tempestade`, 'storm'); }
  sync();
}

export function positions(next = []) { next.forEach(({ id, x, y, targetX, targetY }) => { const p = players.get(id); if (p) Object.assign(p, { x, y, targetX, targetY }); }); sync(); }
export function likes(count = 1) { state.likes += Number(count) || 1; if (state.likes >= 500) { state.likes -= 500; state.storm = clamp(state.storm - 12, 0, 100); feed('500 curtidas repeliram a tempestade!', 'like'); return true; } return false; }
export function tickStorm() { if (state.phase === 'running') state.storm = clamp(state.storm + 1, 0, 100); }
export function finish() {
  state.phase = 'ended'; sync();
  if (state.settings.teamMode && players.size > 0) {
    const blue = { type: 'team', team: 'blue', label: 'TIME AZUL', ...state.teamScores.blue };
    const red = { type: 'team', team: 'red', label: 'TIME VERMELHO', ...state.teamScores.red };
    const comparison = blue.survivors - red.survivors || blue.score - red.score || blue.eliminations - red.eliminations;
    state.winner = comparison === 0 ? { type: 'team', team: 'draw', label: 'EMPATE', score: blue.score, survivors: blue.survivors, eliminations: blue.eliminations } : comparison > 0 ? blue : red;
    feed(`${state.winner.label} VENCEU A RODADA!`, 'winner');
  } else if (!state.settings.teamMode) {
    const winner = [...players.values()].filter((p) => p.alive).sort((a, b) => b.hp - a.hp || b.score - a.score)[0] || [...players.values()].sort((a, b) => b.score - a.score)[0] || null;
    state.winner = winner ? { ...winner, type: 'player' } : null;
    feed(winner ? `@${winner.id} É O CAMPEÃO!` : 'Rodada sem vencedor', 'winner');
  } else {
    state.winner = null; feed('Rodada sem vencedor', 'winner');
  }
  if (!roundRecorded) {
    recordRound([...players.values()].map((p) => ({ ...p, roundWinner: state.winner?.type === 'player' ? state.winner.id === p.id : state.winner?.team === p.team })), state.roundId);
    roundRecorded = true;
  }
  return state.winner;
}
export function reset() { players.clear(); roundRecorded = false; Object.assign(state, { phase: 'lobby', round: state.round + 1, roundId: randomUUID(), storm: 0, likes: 0, players: [], feed: [], winner: null, bountyTargetId: null, bountyTargetPlatformId: null, bountyClaimedBy: null, teamScores: { blue: { score: 0, survivors: 0, eliminations: 0 }, red: { score: 0, survivors: 0, eliminations: 0 } } }); return state; }
