/**
 * Workspace 通用 Vitest 预设
 *
 * 导出通用测试配置（coverage provider、reporter、timeout）。
 * 各 app 的 vitest.config.ts 通过 mergeConfig 合并使用。
 *
 * @module vitest.base
 */

export const sharedVitestConfig = {
  // 测试超时（毫秒）
  testTimeout: 10_000,
  // Node 26 的 Temporal 仍需 --harmony-temporal 显式开启（与 Dockerfile.vercel
  // 的运行时 CMD 一致）；domain 层的 Temporal.Now/Instant 依赖此 flag
  poolOptions: {
    forks: {
      execArgv: ['--harmony-temporal'],
    },
  },
};
