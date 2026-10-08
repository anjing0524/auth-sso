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
 * @module lib/account/reset-password
 */
import { hashPassword, isPasswordReused } from '@/domain/auth/password';
import {
  assertPasswordChangeAllowed,
  nextPasswordHistory,
  type PasswordChangeState,
} from '@/domain/auth/password-change';
import { revokeUserAccessByUserId } from '@/lib/session/revoke';
import { createLogger } from '@/lib/logger';

const log = createLogger('ResetPassword');

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
 * @throws BusinessRuleViolationError 目标账号未设置密码，或新密码命中近期历史
 */
export async function assertResetAllowed(
  newPassword: string,
  state: PasswordChangeState,
): Promise<void> {
  // NFR-SEC-15: 禁止重用最近 5 次密码。与自助改密共用同一领域判定。
  assertPasswordChangeAllowed(state, {
    newPassword,
    reusesRecentPassword: await isPasswordReused(
      newPassword,
      state.history ? [...state.history] : null,
    ),
  });
}

/**
 * 事务外预计算新密码哈希。
 *
 * 与 [`assertResetAllowed`] 分开的理由见其文档：bcrypt 不应在事务内执行。
 * 调用顺序应为：`hashPassword`（事务外）→ `withScopedRow`（事务内加载 + 判定 + 落库）。
 */
export async function hashNewPassword(newPassword: string): Promise<string> {
  return hashPassword(newPassword);
}

/**
 * 计算应写入的新密码历史（旧哈希入列，按上限截断）。
 * 必须在事务内、`assertResetAllowed` 通过后调用。
 */
export function buildPasswordHistory(state: PasswordChangeState): string[] {
  return nextPasswordHistory(state);
}

/**
 * 重置完成后的副作用：撤销目标用户全部会话（B-USR-PW）。
 *
 * **失败不阻断**（与自助改密一致，见 ADR-020 的分档思路）：密码已持久化，撤销
 * 是尽力而为；让一次 Redis 抖动把已成功的重置报成失败，会诱使管理员重试——
 * 而密码其实已经变了。失败仅记日志。
 */
export async function revokeAfterPasswordReset(userId: string): Promise<void> {
  try {
    await revokeUserAccessByUserId(userId);
  } catch (e) {
    log.error('重置密码后撤销 JWT 失败', { error: (e as Error).message });
  }
}
