import assert from 'node:assert/strict';
import test from 'node:test';

test('leaderboard retries transient JWT issued at future during boot', { concurrency: false }, async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  const previousFetch = globalThis.fetch;
  process.env.SUPABASE_URL = 'https://retry-test.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'retry-test-secret';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ message: 'JWT issued at future' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify([
      { platform_user_id: 'persistent-king', username: 'PersistentKing', total_score: 42, wins: 3, rounds_played: 5 },
    ]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const url = new URL('./leaderboard.js', import.meta.url);
    const leaderboard = await import(`${url.href}?transient-retry=${Date.now()}`);
    assert.equal(await leaderboard.initializeLeaderboard(), true);
    assert.equal(calls, 2);
    assert.deepEqual(leaderboard.getLeaderboard().map(({ platformUserId, score, wins, roundsPlayed }) => ({ platformUserId, score, wins, roundsPlayed })), [
      { platformUserId: 'persistent-king', score: 42, wins: 3, roundsPlayed: 5 },
    ]);
    assert.equal(leaderboard.getLeaderboardStatus().persistenceAvailable, true);
    assert.equal(leaderboard.getLeaderboardStatus().lastError, null);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});

test('leaderboard only retries errors classified as transient', async () => {
  const url = new URL('./leaderboard.js', import.meta.url);
  const leaderboard = await import(`${url.href}?classification=${Date.now()}`);
  assert.equal(leaderboard.leaderboardInternals.isTransientBootstrapError(new Error('JWT issued at future')), true);
  assert.equal(leaderboard.leaderboardInternals.isTransientBootstrapError(new Error('Supabase timeout')), true);
  assert.equal(leaderboard.leaderboardInternals.isTransientBootstrapError({ message: 'rate limited', status: 429 }), true);
  assert.equal(leaderboard.leaderboardInternals.isTransientBootstrapError({ message: 'bad credentials', status: 401 }), false);
});
