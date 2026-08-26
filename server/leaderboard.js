const totals = new Map();

const normalizeId = (value = '') => String(value).trim().replace(/^@/, '').slice(0, 24);

export function recordRound(players = []) {
  for (const player of players) {
    const id = normalizeId(player?.id);
    if (!id) continue;
    const previous = totals.get(id) || { id, score: 0, eliminations: 0, wins: 0 };
    totals.set(id, {
      id,
      score: previous.score + Math.max(0, Number(player.score) || 0),
      eliminations: previous.eliminations + Math.max(0, Number(player.eliminations) || 0),
      wins: previous.wins + Number(Boolean(player.roundWinner)),
    });
  }
}

export function getLeaderboard() {
  return [...totals.values()].sort((a, b) => b.score - a.score || b.eliminations - a.eliminations || a.id.localeCompare(b.id));
}

export function getLeaderboardTop() {
  return getLeaderboard()[0] || null;
}

export function clearLeaderboard() {
  totals.clear();
}
