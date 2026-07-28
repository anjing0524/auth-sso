import { defineProject } from 'vitest/config';
import path from 'path';
import { sharedVitestConfig } from '../../vitest.base';

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
    setupFiles: ['./vitest.setup.ts'],
    environment: 'node',
    globals: true,
    fileParallelism: false,
    maxWorkers: 1,
    include: [
      '__tests__/api/**/*.test.ts',
    ],
  },
});
