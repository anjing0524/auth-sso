import { defineConfig, mergeConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { sharedVitestConfig } from '../../vitest.base';

export default mergeConfig(
  sharedVitestConfig,
  defineConfig({
    plugins: [react()],
    resolve: {
      // Vite 8 原生支持 tsconfig 路径解析，无需 vite-tsconfig-paths 插件
      tsconfigPaths: true,
      alias: {
        'server-only': path.resolve(__dirname, './vitest.server-only.mock.ts'),
      },
    },
    test: {
      // globalSetup：在所有测试前运行 migration
      globalSetup: ['./vitest.globalSetup.ts'],
      // 全局 setup 文件：mock server-only、next/headers、扩展 jest-dom 匹配器
      setupFiles: ['./vitest.setup.ts'],
      // 默认 jsdom 环境（组件测试需要），API 测试文件用 @vitest-environment node 覆盖
      environment: 'jsdom',
      globals: true,
      // 事务回滚模式需要串行执行（max: 1 连接共享同一个 session）
      fileParallelism: false,
      include: [
        'src/**/*.test.{ts,tsx}',
        '__tests__/**/*.test.{ts,tsx}',
      ],
      // Portal 特有覆盖率范围
      coverage: {
        include: ['src/**/*.{ts,tsx}'],
      },
    },
  })
);
