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
  // API 集成测试的 beforeEach 会 TRUNCATE 真实 PG；全量并行时 10s 不够。
  hookTimeout: 30_000,
};
