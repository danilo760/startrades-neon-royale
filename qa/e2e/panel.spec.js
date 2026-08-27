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
  await page.getByRole('button', { name: /ADICIONAR COMBATENTES/ }).click();
  await expect(page.getByText(/6 \/ 6/)).toBeVisible();
  await page.getByRole('button', { name: /INICIAR/ }).click();
  await expect(page.locator('.stats').getByText('running')).toBeVisible();
  await page.getByRole('button', { name: /PAUSAR/ }).click(); await expect(page.locator('.stats').getByText('paused')).toBeVisible();
  await page.getByRole('button', { name: /PAUSAR/ }).click(); await expect(page.locator('.stats').getByText('running')).toBeVisible();
  const storm = page.locator('input.stormRange'); await storm.fill('80'); await storm.dispatchEvent('mouseup');
  await expect(page.locator('.stormValue')).toContainText('80');
  await page.getByRole('button', { name: 'TESTAR' }).click();
  await page.getByRole('button', { name: /INVOCAR COLOSSUS/ }).click(); await expect(page.getByText('ATIVO').first()).toBeVisible();

  const power = page.getByLabel('Poder'); await power.selectOption('chain-lightning');
  await page.getByRole('button', { name: 'SALVAR' }).click(); await expect(page.locator('.notice')).toContainText(/salvo|sincronizados|fallback em memória/i);
  await page.getByRole('button', { name: /ENCERRAR/ }).click(); await expect(page.locator('.stats').getByText('ended')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: /ZERAR RODADA/ }).click(); await expect(page.locator('.stats').getByText('lobby')).toBeVisible();

  const health = await request.get('/api/health'); expect(health.ok()).toBeTruthy();
  await expect.poll(() => wsEvents.some((event) => event.type === 'battle-end')).toBeTruthy();
  ws.close();
  const reconnected = new WebSocket('ws://127.0.0.1:4173/events');
  await new Promise((resolve, reject) => { reconnected.once('message', resolve); reconnected.once('error', reject); });
  reconnected.close();
  expect(browserErrors).toEqual([]);
});
