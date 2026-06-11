import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Vite 8 原生支持 tsconfig 路径解析，无需 vite-tsconfig-paths 插件
    tsconfigPaths: true,
  },
  test: {
    // 全局 setup 文件：mock server-only、扩展 jest-dom 匹配器
    setupFiles: ['./vitest.setup.ts'],
    // 默认 jsdom 环境（组件测试需要），API 测试文件用 @vitest-environment node 覆盖
    environment: 'jsdom',
    globals: true,
    include: [
      'src/**/*.test.{ts,tsx}',
      '__tests__/**/*.test.{ts,tsx}',
    ],
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.test.{ts,tsx}',
        'src/db/**',
      ],
    },
    // 测试超时（毫秒）
    testTimeout: 10_000,
  },
});
