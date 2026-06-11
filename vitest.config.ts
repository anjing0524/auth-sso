import { defineConfig } from 'vitest/config';

/**
 * Vitest 根配置（Monorepo Projects 模式）
 *
 * Vitest 4.x 使用 test.projects 替代已废弃的 vitest.workspace.ts
 * 每个 app 维护独立的 vitest.config.ts，根配置聚合执行
 */
export default defineConfig({
  test: {
    projects: [
      './apps/portal/vitest.config.ts',
      './apps/idp/vitest.config.ts',
    ],
  },
});
