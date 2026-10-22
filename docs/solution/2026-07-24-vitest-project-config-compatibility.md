# Vitest 4 项目配置兼容性

## 背景

将 lint 与 typecheck 从非阻断检查改为 CI 门禁时，Portal 的 TypeScript 检查暴露了 Vitest 4 项目配置不兼容：已移除的 `minWorkers`、项目配置中的 `coverage`，以及将共享对象与项目配置混用 `mergeConfig()` 的类型交叉冲突。

## 根因

Vitest 4 将项目配置与根配置的允许项分离。覆盖率是整个测试进程的职责，不能定义在单个项目中；`minWorkers` 已移除。旧配置在运行时未形成可靠约束，也使 `tsc --noEmit` 无法成为门禁。

## 纠正措施

- Portal 和 contracts 测试配置改用 `defineProject()`。
- 共享测试超时以对象展开到各项目；不再将项目配置传给 `mergeConfig()`。
- 覆盖率 provider、reporter 和源码范围迁移到根 `vitest.config.ts`。
- 删除 `minWorkers`，保留 `fileParallelism: false` 与 `maxWorkers: 1`，继续保证共享数据库 fixture 的串行隔离。
- 为 Vitest mock 的原模块导入补充 type-only 泛型，修复严格 TypeScript 下的扩展类型错误。

## 预防与验证

- 更新 Vitest 大版本时，先核对官方迁移文档中项目配置允许项，特别检查 worker 与 coverage 选项。
- 项目配置只承载 runner 相关选项；全局报告、coverage 等进程级配置只放根配置。
- 回归命令：`pnpm typecheck`、`pnpm test` 与 `git diff --check`。
- 本次验证：Portal、contracts、demo TypeScript 检查通过；根 Vitest 通过 37 个测试文件、339 个测试。
