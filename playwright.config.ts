import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 测试配置
 *
 * Monorepo 双 webServer 模式：同时启动 Portal + Demo App
 * IDP 已合并进 Portal，Portal 自身即是 OIDC Provider
 * 支持 headed（开发调试）和 headless（CI）两种模式
 */
export default defineConfig({
  // E2E 测试目录
  testDir: './tests/e2e',
  // 测试超时（E2E 测试需要较长超时）
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  // 并行执行（CI 环境减少并行度降低 flaky 风险）
  fullyParallel: !process.env.CI,
  // 失败不重试（CI 环境重试 2 次）
  retries: process.env.CI ? 2 : 0,
  // 并行 worker 数
  workers: process.env.CI ? 2 : undefined,
  // 测试报告
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'tests/e2e-report' }],
    ['json', { outputFile: 'tests/e2e-report/results.json' }],
  ],
  // 全局配置
  use: {
    // 默认测试入口：Portal
    baseURL: 'http://127.0.0.1:4100',
    // 截图策略：仅失败时
    screenshot: 'only-on-failure',
    // 录制策略：仅失败时
    video: 'retain-on-failure',
    // trace 策略：首次重试时
    trace: 'on-first-retry',
  },
  // 浏览器配置：仅 Chromium（降低维护成本）
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // webServer 配置：启动 Portal (含 OIDC Provider) + Demo App
  webServer: [
    {
      command: 'pnpm db:seed && pnpm --filter @auth-sso/portal dev',
      url: 'http://127.0.0.1:4100',
      name: 'Portal (含 OIDC Provider)',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --filter @auth-sso/demo-app dev',
      url: 'http://127.0.0.1:4102',
      name: 'Demo App',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
