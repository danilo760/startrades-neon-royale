import { expect, test } from '@playwright/test';

test('Performance AUTO is configurable from control and persisted locally for broadcast tabs', async ({ page }) => {
  await page.goto('/control');
  const selector = page.getByLabel('Effect Intensity', { exact: true });
  await expect(selector).toBeVisible();
  await expect(selector).toHaveValue('AUTO');
  await selector.selectOption('BAIXA');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('neon-effect-mode'))).toBe('BAIXA');
  await selector.selectOption('AUTO');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('neon-effect-mode'))).toBe('AUTO');
});

test('optional performance diagnostics exposes FPS and adaptive quality without appearing by default', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Performance Diagnostics')).toHaveCount(0);
  await page.goto('/?debug=performance');
  const panel = page.getByLabel('Performance Diagnostics');
  await expect(panel).toBeVisible();
  await expect.poll(async () => await page.evaluate(() => window.__NEON_PERF__?.fps || 0), { timeout: 10_000 }).toBeGreaterThan(0);
  const diagnostics = await page.evaluate(() => window.__NEON_PERF__);
  expect(['HIGH', 'NORMAL', 'LOW', 'EMERGENCY']).toContain(diagnostics.effectiveLevel);
  expect(diagnostics.requestedMode).toBe('AUTO');
  expect(diagnostics.frameTimeMs).toBeGreaterThan(0);
});
