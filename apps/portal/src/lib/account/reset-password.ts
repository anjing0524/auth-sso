import 'server-only';

/**
 * 管理员重置他人密码编排 (Admin Password Reset)
 *
 * 与 `lib/account/change-password.ts`（自助改密）**刻意分开**：
 * - 自助改密：无数据范围守卫（目标是本人），需**验证旧密码**
 * - 管理员重置：**有**数据范围守卫与 404（目标是他人），无需旧密码
 *
 * 两者的授权模型不同，这些差异是业务语义而非意外重复。共享的是更深一层的
 * **领域判定**（`domain/auth/password-change.ts`），不是编排流程。
 *
 * ## 会话撤销的失败语义（H-13，2026-10-23）
 *
 * 重置密码踢出会话是账号疑似失陷时的**处置手段**——与 force-logout 相同，
 * 撤销失败不能返回"已成功"。故：
 * - `revokeRefreshTokensForReset` **必须在调用方事务内**执行（失败 → 事务回滚，
 *   密码不会被写入，不存在"密码已改但 RT 仍可续期"的部分成功）；
 * - `revokeAccessTokensAfterReset` 只撤 jti（Redis，ADR-011 缓存性数据 fail-open），
 *   失败由 `lib/session/revoke` 记日志，不阻断已提交的重置。
 *
 * @module lib/account/reset-password
 */
import { isPasswordReused } from '@/domain/auth/password';
import {
  assertPasswordNotReused,
  type PasswordChangeState,
} from '@/domain/auth/password-change';
import { revokeUserAccessByUserId } from '@/lib/session/revoke';
import type { DbExecutor } from '@/infrastructure/db';
import { revokeUserRefreshTokens } from '@/lib/auth/token/revocation';

/**
 * 管理员重置他人密码的**领域操作**：判定 → 哈希 → 取旧状态。
 *
 * 刻意**不接触数据库**：写入必须发生在调用方的事务内（`withScopedRow` 的 handler
 * 只提供 `tx`，且数据范围快照需与写入同事务以消除 TOCTOU）。
 *
 * **bcrypt 哈希刻意留在事务外**：bcrypt 约 50–200ms，放进事务会长时间占用 DB
 * 连接。故哈希在作用域外完成，本函数只做"事务内必须做的"复用判定与历史计算。
 *
 * @param state 事务内加载的目标用户密码状态（`currentHash` / `history`）
 * @throws BusinessRuleViolationError 新密码命中近期历史（含**当前密码**，H-C-06）
 */
export async function assertResetAllowed(
  newPassword: string,
  state: PasswordChangeState,
): Promise<void> {
  // NFR-SEC-15: 禁止重用最近 5 次密码。与自助改密**共用同一条规则**。
  //
  // 同时比较**当前密码**（H-C-06）：`history` 只在改密时把旧 hash 推入，
  // 不含"正在使用的密码"；不补这一项时 `newPassword === currentPassword` 会被接受，
  // 与"不能与最近使用过的密码相同"的承诺不符。
  const candidates = [
    ...(state.currentHash ? [state.currentHash] : []),
    ...(state.history ?? []),
  ];
  const reusesRecentPassword = candidates.length > 0
    ? await isPasswordReused(newPassword, candidates)
    : false;
  assertPasswordNotReused(reusesRecentPassword);
}

/**
 * 撤销目标用户全部 Refresh Token —— **fail-close**（H-13）。
 *
 * 必须在调用方事务内以 `tx` 作为 executor 调用：撤销失败即抛出 → 事务回滚
 * （密码写入一并回滚），响应是失败信封而不是"部分成功"。
 * 这与 force-logout 的 `revokeAllRefreshTokens(tx, ...)` 同语义。
 */
export async function revokeRefreshTokensForReset(
  executor: DbExecutor,
  userId: string,
): Promise<void> {
  await revokeUserRefreshTokens(executor, userId);
}

/**
 * 撤销目标用户 Access Token 的 jti —— 尽力而为（ADR-011 缓存性数据 fail-open）。
 *
 * jti 层依赖 Redis，失败不抛出、由 `lib/session/revoke` 记日志（含 userId）；
 * 旧 AT 在 ≤1h TTL 内自然过期作为兜底。在事务提交后调用。
 */
export async function revokeAccessTokensAfterReset(userId: string): Promise<void> {
  await revokeUserAccessByUserId(userId);
}
