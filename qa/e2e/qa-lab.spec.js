import { expect, test } from '@playwright/test';

test('QA LAB stays mock-only and executes safe player and websocket scenarios', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/control');
  await page.getByLabel('Token administrativo').fill('playwright-admin-token');
  const lab = page.getByLabel('QA LAB');
  await expect(lab).toBeVisible();
  await expect(lab).toContainText('SAFE MOCK');

  await lab.getByRole('button', { name: 'TESTE 10 JOGADORES' }).click();
  await expect(lab.locator('[data-testid="qa-report"]')).toContainText('PASS', { timeout: 8000 });
  await expect(lab).toContainText(/10 combatentes carregados/i);

  await lab.getByRole('button', { name: 'WEBSOCKET RECONNECT' }).click();
  await expect(lab.locator('[data-testid="qa-report"]')).toContainText('PASS', { timeout: 8000 });
  await expect(lab).toContainText(/Reconexão recebeu state/i);
  expect(errors).toEqual([]);
});
