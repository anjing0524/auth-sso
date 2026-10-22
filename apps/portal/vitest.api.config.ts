import { defineProject } from 'vitest/config';
import path from 'path';
import { sharedVitestConfig } from '../../vitest.base';
import { resolveTestRedisUrl } from './vitest.redis';

export default defineProject({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './vitest.server-only.mock.ts'),
    },
  },
  test: {
    ...sharedVitestConfig,
    name: '@auth-sso/portal-api',
    globalSetup: ['./vitest.globalSetup.ts'],
    setupFiles: ['./vitest.setup.ts', './vitest.api.setup.ts'],
    env: {
      // 决定性覆盖：探针、每用例清库钩子与被测生产代码必须指向同一逻辑库
      REDIS_URL: resolveTestRedisUrl(),
    },
    environment: 'node',
    globals: true,
    fileParallelism: false,
    maxWorkers: 1,
    include: [
      '__tests__/api/**/*.test.ts',
    ],
  },
});
