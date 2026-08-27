import { expect, test } from '@playwright/test';

const auth = { authorization: 'Bearer playwright-admin-token' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(request, path, body = {}) {
  const response = await request.post(path, { headers: auth, data: body });
  expect(response.ok(), `${path} returned ${response.status()}: ${await response.text()}`).toBeTruthy();
  await sleep(320);
  return response.json();
}

async function capture(page, name) {
  await expect(page.locator('.overlay')).toBeVisible();
  await expect(page.locator('.game canvas')).toBeVisible();
  const geometry = await page.evaluate(() => {
    const plain = (element) => {
      const box = element?.getBoundingClientRect();
      return box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null;
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      overlay: plain(document.querySelector('.overlay')),
      canvas: plain(document.querySelector('.game canvas')),
      hud: plain(document.querySelector('.hud')),
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(geometry.overlay).toBeTruthy();
  expect(geometry.canvas).toBeTruthy();
  expect(geometry.hud).toBeTruthy();
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport.width + 1);
  for (const box of [geometry.overlay, geometry.canvas, geometry.hud]) {
    expect(box.left).toBeGreaterThanOrEqual(-1);
    expect(box.top).toBeGreaterThanOrEqual(-1);
    expect(box.right).toBeLessThanOrEqual(geometry.viewport.width + 1);
    expect(box.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1);
  }
  const screenshot = await page.screenshot({ fullPage: false, animations: 'disabled', timeout: 10_000 });
  await test.info().attach(`visual-${name}`, { body: screenshot, contentType: 'image/png' });
}

test('visual capture matrix preserves arena layout through core live states', async ({ page, request }) => {
  test.setTimeout(90_000);
  const browserErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await post(request, '/api/battle/reset');
  await page.goto('/');
  await capture(page, 'lobby');

  const players = Array.from({ length: 10 }, (_, index) => `Visual-${index + 1}`);
  await post(request, '/api/test/players', { names: players });
  const running = await post(request, '/api/battle/start');
  await page.reload();
  await capture(page, 'running');

  await post(request, '/api/storm', { value: 80 });
  await page.waitForTimeout(250);
  await capture(page, 'storm');

  const target = running.state.players.find((player) => player.alive);
  if (target) {
    const mappingsResponse = await request.get('/api/admin/gift-mappings', { headers: auth });
    expect(mappingsResponse.ok()).toBeTruthy();
    const mappings = (await mappingsResponse.json()).mappings || [];
    const support = mappings.find((mapping) => mapping.enabled && mapping.giftId === '5655') || mappings.find((mapping) => mapping.enabled);
    if (support) {
      const giftResponse = await request.post('/api/admin/gift', { headers: auth, data: { targetPlayerId: target.id, giftId: support.giftId } });
      if (giftResponse.ok()) {
        await page.waitForTimeout(280);
        await capture(page, 'gift');
      }
    }
  }

  await post(request, '/api/admin/boss');
  await page.waitForTimeout(300);
  await capture(page, 'boss-phase-1');

  await post(request, '/api/battle/end');
  await page.waitForTimeout(250);
  await capture(page, 'winner');

  await page.setViewportSize({ width: 1080, height: 1920 });
  await page.goto('/?broadcast=vertical');
  await expect(page.locator('.overlay')).toHaveAttribute('data-broadcast-mode', 'VERTICAL_TIKTOK');
  await capture(page, 'vertical');
  expect(browserErrors).toEqual([]);
});
