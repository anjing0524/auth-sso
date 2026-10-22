/**
 * 「幂等 migration 错误」判据（`scripts/migrate.ts` 与 `vitest.globalSetup.ts` 共用）
 *
 * ## 为什么单独成模块（代码评审判定）
 *
 * 两个脚本**语义不同**——`migrate.ts` 遇到幂等错误**跳过并继续**（否则本地重跑必失败），
 * `globalSetup` 只**告警**——但**判据是同一个**。判据写两份，将来收紧其中一份
 * （例如区分 `duplicate key` 与 `duplicate column`）就会出现"CI 通过、本地失败"这类
 * 取决于入口的分歧。
 *
 * @module scripts/idempotent-migration-error
 */

/** 该错误是否属于「重跑 migration 时无害」的一类 */
export function isIdempotentMigrationError(message: string): boolean {
  return message.includes('already exists') || message.includes('duplicate');
}
