import { defineConfig, devices } from '@playwright/test';

const port = 4102;

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  timeout: 30_000,
  reporter: 'html',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm --filter @auth-sso/portal exec next dev -p ${port}`,
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === 'true',
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/auth_sso',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
      PORTAL_REDIRECT_URL: `http://127.0.0.1:${port}/api/auth/callback`,
    },
  },
});
