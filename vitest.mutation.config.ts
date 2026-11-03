import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * 仅用于 Stryker mutation 的窄配置：纯 domain/auth 测试，不连 DB/Redis。
 * 不参与 `pnpm test`，避免把 mutation 成本带进每次 CI。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'apps/portal/src'),
      'server-only': path.resolve(__dirname, 'apps/portal/vitest.server-only.mock.ts'),
    },
  },
  test: {
    name: 'mutation-auth',
    environment: 'node',
    globals: true,
    setupFiles: ['./apps/portal/vitest.setup.ts'],
    include: [
      'apps/portal/__tests__/domain/auth.test.ts',
      'apps/portal/__tests__/domain/password-change.test.ts',
      'apps/portal/__tests__/domain/password.test.ts',
      'apps/portal/__tests__/domain/oauth-authorize.test.ts',
      'apps/portal/__tests__/domain/oauth-client.test.ts',
      'apps/portal/__tests__/domain/oauth-code.test.ts',
    ],
    fileParallelism: false,
    testTimeout: 10_000,
  },
});
