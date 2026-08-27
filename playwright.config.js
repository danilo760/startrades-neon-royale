import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './qa/e2e', timeout: 30_000, fullyParallel: false, retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run build && npm start', url: 'http://127.0.0.1:4173/api/health', reuseExistingServer: !process.env.CI,
    env: { ...process.env, NODE_ENV: 'test', MOCK_MODE: 'true', ADMIN_TOKEN: 'playwright-admin-token', BATTLE_COUNTDOWN_MS: '0', BATTLE_INTERMISSION_MS: '5000', SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', OTEL_EXPORTER_OTLP_ENDPOINT: '' },
  },
});
