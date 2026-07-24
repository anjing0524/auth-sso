/**
 * Playwright E2E 测试配置
 *
 * 默认走 Gateway HTTPS 全链路（最接近生产环境）：
 *   pnpm test:e2e
 *
 * Gateway 本地运行（默认）：https://localhost:19443（gateway.toml ssl_port）
 * Gateway Docker：         https://localhost:18443（docker-compose 映射 18443:443）
 * Portal 直连（开发用）：   E2E_BASE_URL=http://localhost:4100 pnpm test:e2e
 */
import { defineConfig } from '@playwright/test';

const BASE_URL = process.env['E2E_BASE_URL'] || 'https://localhost:19443';
const USE_GATEWAY = BASE_URL.startsWith('https://');
const SKIP_WEB_SERVER = process.env['E2E_SKIP_WEB_SERVER'] === 'true';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 1,
  forbidOnly: !!process.env['CI'],
  workers: 1,
  reporter: [['html', { outputFolder: 'playwright-report' }], ['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: USE_GATEWAY,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
      },
    },
  ],

  webServer: SKIP_WEB_SERVER
    ? undefined
    : USE_GATEWAY
      ? [
          {
            command: 'cd apps/gateway && ./target/debug/gateway --config gateway.toml',
            url: 'https://localhost:19443/login',
            reuseExistingServer: true,
            timeout: 30_000,
          },
        ]
      : [
          {
            command: 'pnpm --filter @auth-sso/portal dev',
            url: 'http://localhost:4100/api/health',
            reuseExistingServer: true,
            timeout: 60_000,
          },
        ],
});
