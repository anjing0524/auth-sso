import { defineConfig, devices } from '@playwright/test';

const port = 4102;
const externalBaseUrl = process.env.E2E_BASE_URL;
const useExternalServer = externalBaseUrl !== undefined;

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: process.env.E2E_TARGET === 'docker' ? undefined : '**/docker-release.spec.ts',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  timeout: 30_000,
  reporter: 'html',
  use: {
    baseURL: externalBaseUrl ?? `http://127.0.0.1:${port}`,
    // Docker release validation enters through the Gateway's self-signed HTTPS endpoint.
    ignoreHTTPSErrors: useExternalServer,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Release validation must exercise the already-built Docker image, never start a
  // second development server on the host.
  webServer: useExternalServer ? undefined : {
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
