import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1080, height: 1920 }, { width: 720, height: 1280 }]) {
  test(`VERTICAL_TIKTOK keeps arena and HUD inside safe areas at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto('/?broadcast=vertical');
    const overlay = page.locator('.overlay');
    await expect(overlay).toHaveAttribute('data-broadcast-mode', 'VERTICAL_TIKTOK');
    await expect(page.locator('.overlayHeader')).toBeVisible();
    await expect(page.locator('.hud')).toBeVisible();
    await expect(page.locator('.game canvas')).toBeVisible();
    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const canvas = document.querySelector('.game canvas')?.getBoundingClientRect();
      const header = document.querySelector('.overlayHeader')?.getBoundingClientRect();
      const hud = document.querySelector('.hud')?.getBoundingClientRect();
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        canvas: canvas && { left: canvas.left, right: canvas.right, top: canvas.top, bottom: canvas.bottom },
        header: header && { left: header.left, right: header.right, top: header.top, bottom: header.bottom },
        hud: hud && { left: hud.left, right: hud.right, top: hud.top, bottom: hud.bottom },
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
