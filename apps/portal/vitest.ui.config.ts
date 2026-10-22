import { defineProject } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { sharedVitestConfig } from '../../vitest.base';

export default defineProject({
  plugins: [react()],
  resolve: {
    // Vite 8 原生支持 tsconfig 路径解析，无需 vite-tsconfig-paths 插件
    tsconfigPaths: true,
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './vitest.server-only.mock.ts'),
    },
  },
  test: {
    ...sharedVitestConfig,
    name: '@auth-sso/portal-ui',
    setupFiles: ['./vitest.setup.ts'],
    environment: 'jsdom',
    globals: true,
    include: [
      '__tests__/components/**/*.test.{ts,tsx}',
      '__tests__/domain/**/*.test.ts',
      '__tests__/helpers/**/*.test.ts',
      '__tests__/smoke.test.ts',
      'src/**/*.test.{ts,tsx}',
    ],
  },
});
