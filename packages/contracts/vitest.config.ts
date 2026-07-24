import { defineProject } from 'vitest/config';
import { sharedVitestConfig } from '../../vitest.base';

export default defineProject({
    test: {
      ...sharedVitestConfig,
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  });
