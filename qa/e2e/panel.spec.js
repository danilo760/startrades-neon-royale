import { expect, test } from '@playwright/test';
import { WebSocket } from 'ws';

test('PanelBot operates control panel, HTTP and WebSocket without browser errors', async ({ page, request }) => {
  const browserErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  const wsEvents = [];
  const ws = new WebSocket('ws://127.0.0.1:4173/events');
  ws.on('message', (data) => wsEvents.push(JSON.parse(String(data))));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });

  await page.goto('/control');
  await expect(page.getByText('STARTRADES COMMAND')).toBeVisible();
  await page.getByLabel('Token administrativo').fill('playwright-admin-token');
  const clickAdmin = async (button, path) => {
    const [response] = await Promise.all([page.waitForResponse((candidate) => candidate.url().endsWith(path) && candidate.request().method() === 'POST'), button.click()]);
    expect(response.ok(), `${path} returned ${response.status()}: ${await response.text()}`).toBeTruthy();
    await page.waitForTimeout(320);
    return response;
  };
  await clickAdmin(page.getByRole('button', { name: /ADICIONAR COMBATENTES/ }), '/api/test/players');
  await expect(page.getByText(/6 \/ 6/)).toBeVisible();
  await clickAdmin(page.getByRole('button', { name: /INICIAR/ }), '/api/battle/start');
  await expect(page.locator('.stats').getByText('running')).toBeVisible();
  await clickAdmin(page.getByRole('button', { name: /PAUSAR/ }), '/api/battle/pause'); await expect(page.locator('.stats').getByText('paused')).toBeVisible();
  await clickAdmin(page.getByRole('button', { name: /PAUSAR/ }), '/api/battle/pause'); await expect(page.locator('.stats').getByText('running')).toBeVisible();
  const storm = page.locator('input.stormRange');
  const [stormResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/storm') && response.request().method() === 'POST'),
    storm.evaluate((element) => {
      element.value = '80';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }),
  ]);
  expect(stormResponse.ok()).toBeTruthy();
  const stormPayload = await stormResponse.json();
  expect(stormPayload.state?.storm).toBe(80);
  await expect.poll(async () => Number((await page.locator('.stormValue').textContent())?.replace(/\D/g, '') || 0), { timeout: 2000 }).toBeGreaterThanOrEqual(79);
  await clickAdmin(page.getByRole('button', { name: 'TESTAR' }), '/api/admin/gift');
  await clickAdmin(page.getByRole('button', { name: /INVOCAR COLOSSUS/ }), '/api/admin/boss'); await expect(page.getByText('ATIVO').first()).toBeVisible();

  const power = page.getByLabel('Poder'); await power.selectOption('chain-lightning');
  await clickAdmin(page.getByRole('button', { name: 'SALVAR' }), '/api/admin/gift-mappings'); await expect(page.locator('.notice')).toContainText(/salvo|sincronizados|fallback em memória/i);
  await clickAdmin(page.getByRole('button', { name: /ENCERRAR/ }), '/api/battle/end'); await expect(page.locator('.stats').getByText('ended')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept()); await clickAdmin(page.getByRole('button', { name: /ZERAR RODADA/ }), '/api/battle/reset'); await expect(page.locator('.stats').getByText('lobby')).toBeVisible();

  const health = await request.get('/api/health'); expect(health.ok()).toBeTruthy();
  await expect.poll(() => wsEvents.some((event) => event.type === 'battle-end')).toBeTruthy();
  ws.close();
  const reconnected = new WebSocket('ws://127.0.0.1:4173/events');
  await new Promise((resolve, reject) => { reconnected.once('message', resolve); reconnected.once('error', reject); });
  reconnected.close();
  expect(browserErrors).toEqual([]);
});
