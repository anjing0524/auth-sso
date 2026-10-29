import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 只跑 **Docker 验收栈**（与 CI/生产同形态）。
 *
 * - 栈由 `docker compose -f docker/compose/test.yml up -d --wait --wait-timeout 600` / `pnpm test:e2e` 提供，入口默认 `https://127.0.0.1:19443`（自签证书）；
 * - 不再有 host `next dev` 的 webServer：验收必须打到已构建镜像（原因见 docker/README.md §7.5）；
 * - 可用 `E2E_BASE_URL` 覆盖入口（CI 显式设置为同一地址）。
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // e2e 共享同一验收栈与 admin 会话/限流状态：文件级并行会让登录/登出/建号互相干扰
  // （实测：并行 7 passed + 1 failed，workers=1 全量 8 passed）。
  workers: 1,
  timeout: 30_000,
  reporter: 'html',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://127.0.0.1:19443',
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      // 本机/受限环境可显式复用系统 Chrome；CI 仍默认下载 Chromium。
      ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL as 'chrome' } : {}),
    },
  }],
});
