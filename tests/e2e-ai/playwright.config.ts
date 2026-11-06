import { defineConfig, devices } from '@playwright/test';

/**
 * Midscene 探索性 AI 视觉测试（独立于阻断 E2E）。
 *
 * - 不进入 `tests/e2e`，不影响 `pnpm test:e2e` 的发布判据；
 * - 需要 MIDSCENE_MODEL_API_KEY；没有密钥时用例 skip；
 * - 只针对 Docker 验收栈，桌面 1440×900。
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['@midscene/web/playwright-reporter', { outputFormat: 'single-html' }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://127.0.0.1:19443',
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{
    name: 'chromium-ai',
    use: {
      ...devices['Desktop Chrome'],
      ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL as 'chrome' } : {}),
    },
  }],
});
