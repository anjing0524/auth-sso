/**
 * Workspace 通用 Vitest 预设
 *
 * 导出通用测试配置（coverage provider、reporter、timeout）。
 * 各 app 的 vitest.config.ts 通过 mergeConfig 合并使用。
 *
 * @module vitest.base
 */

export const sharedVitestConfig = {
  test: {
    // 覆盖率配置
    coverage: {
      provider: /** @type {'v8'} */ ('v8'),
      reporter: ['text', 'json', 'html'],
    },
    // 测试超时（毫秒）
    testTimeout: 10_000,
  },
};
