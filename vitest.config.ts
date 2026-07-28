import { defineConfig } from 'vitest/config';

/**
 * Vitest 根配置（Monorepo Projects 模式）
 *
 * Vitest 4.x 使用 test.projects 替代已废弃的 vitest.workspace.ts
 * 每个 app/测试层维护独立 project config，根配置聚合执行
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'apps/portal/src/**/*.{ts,tsx}',
        'packages/contracts/src/**/*.ts',
      ],
    },
    projects: [
      './apps/portal/vitest.api.config.ts',
      './apps/portal/vitest.ui.config.ts',
      './packages/contracts/vitest.config.ts',
    ],
  },
});
