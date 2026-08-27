import { expect, test } from '@playwright/test';

const auth = { authorization: 'Bearer playwright-admin-token' };

for (const viewport of [{ width: 1080, height: 1920 }, { width: 720, height: 1280 }]) {
  test(`VERTICAL_TIKTOK keeps arena and HUD inside safe areas at ${viewport.width}x${viewport.height}`, async ({ page, request }) => {
    test.setTimeout(45_000);
    const reset = await request.post('/api/battle/reset', { headers: auth, data: {} });
    expect(reset.ok()).toBeTruthy();
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto('/?broadcast=vertical&renderer=canvas', { waitUntil: 'domcontentloaded' });
    const overlay = page.locator('.overlay');
    await expect(overlay).toHaveAttribute('data-broadcast-mode', 'VERTICAL_TIKTOK');
    await expect(page.locator('.overlayHeader')).toBeVisible();
    await expect(page.locator('.hud')).toBeVisible();
    await expect(page.locator('.game canvas')).toBeVisible();
    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const plain = (element) => {
        const box = element?.getBoundingClientRect();
        return box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null;
      };
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        canvas: plain(document.querySelector('.game canvas')),
        header: plain(document.querySelector('.overlayHeader')),
        hud: plain(document.querySelector('.hud')),
      };
    });
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    for (const box of [metrics.canvas, metrics.header, metrics.hud]) {
      expect(box).toBeTruthy();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(viewport.width - 70); // TikTok side controls safe area
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(viewport.height);
    }
    expect(errors).toEqual([]);
  });
}

test('control exposes both broadcast presets without changing gameplay state', async ({ page }) => {
  await page.goto('/control');
  const toolbar = page.getByRole('navigation', { name: 'Broadcast Mode' });
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('link', { name: /LANDSCAPE/ })).toHaveAttribute('href', '/?broadcast=landscape');
  await expect(toolbar.getByRole('link', { name: /VERTICAL_TIKTOK/ })).toHaveAttribute('href', '/?broadcast=vertical');
});
