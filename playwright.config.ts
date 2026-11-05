import { defineConfig } from '@playwright/test';

/**
 * E2E tests run against the production build served by Fastify (in-memory store).
 * Set PLAYWRIGHT_CHROMIUM_PATH to use a system Chromium instead of `npx playwright install chromium`.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3210',
    viewport: { width: 1440, height: 900 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: 'npm run build && PORT=3210 node apps/server/src/index.ts',
    url: 'http://localhost:3210/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
