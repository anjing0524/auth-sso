import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // 全局 setup 文件：mock server-only
    setupFiles: ['./vitest.setup.ts'],
    // IdP 无 React 组件测试，默认 node 环境
    environment: 'node',
    globals: true,
    include: [
      'src/**/*.test.ts',
      '__tests__/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.test.ts',
        'src/db/**',
      ],
    },
    testTimeout: 10_000,
  },
});
