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
import { isPasswordReused } from '@/domain/auth/password';
import {
  assertPasswordNotReused,
  type PasswordChangeState,
} from '@/domain/auth/password-change';
import { revokeUserAccessByUserId } from '@/lib/session/revoke';
import { db } from '@/infrastructure/db';
import { revokeUserRefreshTokens } from '@/lib/auth/token/revocation';
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
  // NFR-SEC-15: 禁止重用最近 5 次密码。与自助改密**共用同一条规则**。
  //
  // 刻意**不**调用 `assertHasPassword`：管理员重置的用途之一正是"为从未设置密码的账号
  // 设初始密码"。此前复用自助路径的合成判定，会把「无密码不能**自助**改密」这条
  // 否决判据套到管理员头上，直接挡住该场景（错误信息还写成"无法自助改密"）。
  assertPasswordNotReused(
    await isPasswordReused(newPassword, state.history ? [...state.history] : null),
  );
}

/**
 * 重置完成后的副作用：撤销目标用户全部会话（B-USR-PW）。
 *
 * **必须覆盖两层**，与 `logout` / `revokeAllRefreshTokens` 一致：
 * - **Refresh Token（否决性）**：它是续期能力的载体。只撤 AT 时，窃取的 RT 仍能
 *   换取新 AT——而"重置密码踢出会话"恰恰是账号疑似失陷时的处置手段。
 * - **Access Token jti（尽力而为）**：AT 会在 ≤1h 内自然过期，且撤销依赖 Redis。
 *
 * **失败不阻断**（与自助改密一致，见 ADR-020 的分档思路）：密码已持久化，撤销
 * 是尽力而为；让一次 Redis 抖动把已成功的重置报成失败，会诱使管理员重试——
 * 而密码其实已经变了。失败仅记日志。
 */
export async function revokeAfterPasswordReset(userId: string): Promise<void> {
  try {
    await revokeUserRefreshTokens(db, userId);
  } catch (e) {
    log.error('重置密码后撤销 Refresh Token 失败', { error: (e as Error).message });
  }
  // jti 层（尽力而为）：同上，失败由 lib/session/revoke 记日志；此处不写 catch
  // ——此前保留的那个「防御未来改动」的 catch 不可达，已删除。
  await revokeUserAccessByUserId(userId);
}
