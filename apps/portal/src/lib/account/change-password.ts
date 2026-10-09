import 'server-only';

/**
 * 自助改密编排 (Self-service Password Change)
 *
 * 承载「验证旧密码 → 领域判定 → 哈希 → 持久化 → 撤销全部会话」这条步骤序列，
 * 使 Server Action 退化为「校验入参 → 调用本模块 → 映射响应」。
 *
 * 分层（与 `domain/auth/login.ts` 同构）：纯判定在
 * `domain/auth/password-change.ts`，bcrypt 与 DB 在本模块。
 *
 * @module lib/account/change-password
 */
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { hashPassword, isPasswordReused, verifyPassword } from '@/domain/auth/password';
import {
  assertPasswordChangeAllowed,
  nextPasswordHistory,
  type PasswordChangeState,
} from '@/domain/auth/password-change';
import { revokeUserAccessByUserId } from '@/lib/session/revoke';
import { revokeUserRefreshTokens } from '@/lib/auth/token/revocation';
import { createLogger } from '@/lib/logger';

const log = createLogger('ChangePassword');

/** 改密结果：失败原因可判别，Controller 据此映射提示语（ADR-018 的同一纪律） */
export type ChangePasswordResult =
  | { readonly ok: true }
  /** 旧密码不正确 */
  | { readonly ok: false; readonly reason: 'invalid_current_password' }
  /** 账号不存在（会话有效但用户行已消失）—— 调用方据此返回 404 而非"密码错误" */
  | { readonly ok: false; readonly reason: 'user_not_found' };

/** 供调用方复用的"当前密码错误"提示语（单一真相源） */
export const INVALID_CURRENT_PASSWORD_MESSAGE = '当前密码错误';

/**
 * 为当前登录用户修改密码，成功后撤销其全部会话（含当前会话）。
 *
 * 目标由 `userId` 锁定（调用方传 `ctx.userId`，防 IDOR）。
 *
 * **会话撤销失败不阻断改密**：改密本身已持久化，撤销是尽力而为——用户已知道
 * 新密码，补一次撤销的运维价值低于让改密失败。与管理员重置密码不同：后者
 * 撤销是操作目的本身，故那边必须 await 并在失败时记录。
 *
 * @throws BusinessRuleViolationError 未设置密码 / 新密码与近期历史重复（经 mapDomainError → 422）
 */
export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const row = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: { id: true, passwordHash: true, passwordHistory: true },
  });
  if (!row) {
    // 保留既有契约：会话有效但用户行已消失 → 调用方抛 EntityNotFoundError（404），
    // 不与"旧密码错误"混为一谈。
    return { ok: false, reason: 'user_not_found' };
  }

  const state: PasswordChangeState = {
    currentHash: row.passwordHash ?? null,
    history: row.passwordHistory ?? null,
  };

  const isValid = await verifyPassword(currentPassword, state.currentHash ?? '');
  if (!isValid) {
    return { ok: false, reason: 'invalid_current_password' };
  }

  assertPasswordChangeAllowed(state, {
    newPassword,
    reusesRecentPassword: await isPasswordReused(newPassword, state.history ? [...state.history] : null),
  });

  const newHash = await hashPassword(newPassword);
  const newHistory = nextPasswordHistory(state);

  await db
    .update(schema.users)
    .set({ passwordHash: newHash, passwordHistory: newHistory, passwordChangedAt: new Date() })
    .where(eq(schema.users.id, userId));

  // 会话终止必须覆盖**两层**，与 logout / revokeAllRefreshTokens 一致：
  // - Refresh Token（否决性）：它是"续期能力"的载体。只撤 AT 时，窃取的 RT 仍能
  //   换取新 AT —— 旧会话实际上从未终止，改密"踢出会话"的承诺不成立。
  // - Access Token jti（尽力而为）：AT 会在 ≤1h 内自然过期，且撤销依赖 Redis。
  try {
    await revokeUserRefreshTokens(db, userId);
  } catch (e) {
    log.error('改密后撤销 Refresh Token 失败', { error: (e as Error).message });
  }
  try {
    await revokeUserAccessByUserId(userId);
  } catch (e) {
    log.error('改密后撤销会话失败', { error: (e as Error).message });
  }

  return { ok: true };
}
