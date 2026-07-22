import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedVitestConfig } from '../../vitest.base';

export default mergeConfig(
  sharedVitestConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }),
);
