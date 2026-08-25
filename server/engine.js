const players = new Map();
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const clean = (v = 'fighter') => String(v).replace(/^@/, '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 24) || 'fighter';

export const state = {
  phase: 'lobby', round: 1, storm: 0, likes: 0, players: [], feed: [], winner: null,
  settings: { agentEnabled: true, voiceMode: 'male', music: true, sound: true },
};

const feed = (text, tone = 'info') => {
  state.feed.unshift({ id: `${Date.now()}-${Math.random()}`, text, tone, at: Date.now() });
  state.feed = state.feed.slice(0, 14);
};
const sync = () => { state.players = [...players.values()].sort((a, b) => Number(b.alive) - Number(a.alive) || b.score - a.score); };
const spawnPoint = () => ({ x: 130 + Math.random() * 1020, y: 115 + Math.random() * 480 });

export function join(username, bot = false) {
  const id = clean(username);
  if (!players.has(id)) {
    const pos = spawnPoint();
    players.set(id, { id, ...pos, targetX: pos.x, targetY: pos.y, hp: 100, shield: 0, energy: 0, score: 0, eliminations: 0, alive: true, skin: players.size % 4, bot });
    feed(`@${id} aterrissou na arena`, 'join');
  }
  sync(); return players.get(id);
}

export function addBots(names = []) { names.slice(0, 30).forEach((n) => join(n, true)); return state; }
export function start() { state.phase = 'running'; state.winner = null; feed(`RODADA ${state.round} INICIADA`, 'system'); return state; }
export function pause() { state.phase = state.phase === 'paused' ? 'running' : 'paused'; feed(state.phase === 'paused' ? 'Batalha pausada' : 'Batalha retomada', 'system'); return state; }
export function setStorm(value) { state.storm = clamp(Number(value) || 0, 0, 100); feed(`Tempestade em ${state.storm}%`, 'storm'); return state; }
export function updateSettings(next = {}) { Object.assign(state.settings, Object.fromEntries(Object.entries(next).filter(([k]) => k in state.settings))); return state; }

export function giftPower(diamonds = 1, name = '') {
  const d = Math.max(1, Number(diamonds) || 1);
  if (/universe/i.test(name) || d >= 1000) return { kind: 'meteor', label: 'METEORO LENDÁRIO', damage: 55, radius: 250, color: 0xffa12b };
  if (d >= 300) return { kind: 'drone', label: 'DRONE CAÇADOR', damage: 34, radius: 0, color: 0xff4dff };
  if (d >= 100) return { kind: 'airstrike', label: 'ATAQUE AÉREO', damage: 28, radius: 180, color: 0xff334e };
  if (d >= 30) return { kind: 'grenade', label: 'GRANADA DE PLASMA', damage: 22, radius: 120, color: 0xa14dff };
  if (d >= 10) return { kind: 'supply', label: 'CAIXA DE SUPRIMENTOS', heal: 24, shield: 30, color: 0x5dff70 };
  if (d >= 5) return { kind: 'shield', label: 'ESCUDO DE ENERGIA', shield: 32, color: 0x35eaff };
  return { kind: 'shot', label: 'RAJADA ESTELAR', damage: 12, radius: 0, color: 0x75ff5b };
}

export function applyGift({ username, giftName = 'Presente', diamondCount = 1, repeatCount = 1 }) {
  const player = join(username);
  if (state.phase !== 'running' || !player.alive) return { ignored: true };
  const total = Math.max(1, Number(diamondCount) * Math.max(1, Number(repeatCount)));
  const power = giftPower(total, giftName);
  player.score += total; player.energy = clamp(player.energy + Math.min(total, 40), 0, 100);
  if (power.heal) player.hp = clamp(player.hp + power.heal, 0, 100);
  if (power.shield) player.shield = clamp(player.shield + power.shield, 0, 100);
  feed(`@${player.id} ativou ${power.label}`, 'gift'); sync();
  return { playerId: player.id, power, total, giftName };
}

export function applyComment({ username, comment = '' }) {
  const cmd = String(comment).trim().toLowerCase();
  if (['!entrar', '!join'].includes(cmd)) return { kind: 'join', player: join(username) };
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
  if (!attacker || !target) return;
  target.hp = clamp(targetHp, 0, 100); target.shield = clamp(targetShield, 0, 100);
  attacker.score += Math.max(1, Math.round(damage));
  if (eliminated && target.alive) { target.alive = false; attacker.eliminations++; feed(`@${attacker.id} eliminou @${target.id}`, 'elimination'); }
  sync();
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
export function finish() { state.phase = 'ended'; const winner = [...players.values()].filter((p) => p.alive).sort((a, b) => b.hp - a.hp || b.score - a.score)[0] || [...players.values()].sort((a, b) => b.score - a.score)[0] || null; state.winner = winner ? { ...winner } : null; feed(winner ? `@${winner.id} É O CAMPEÃO!` : 'Rodada sem vencedor', 'winner'); return state.winner; }
export function reset() { players.clear(); Object.assign(state, { phase: 'lobby', round: state.round + 1, storm: 0, likes: 0, players: [], feed: [], winner: null }); return state; }
