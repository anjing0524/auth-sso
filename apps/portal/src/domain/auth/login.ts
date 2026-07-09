/**
 * 登录领域服务 (Login Domain Service)
 *
 * 纯业务规则验证：状态检查。
 * 不包含任何 DB 查询、bcrypt 异步调用或基础设施依赖。
 *
 * @module domain/auth/login
 */
import { BusinessRuleViolationError, AccountStatusError } from '@/domain/shared/errors';
import { AUTH_ERRORS, USER_LOCKED, USER_DISABLED, USER_DELETED } from '@auth-sso/contracts';
import type { UserStatus } from '@auth-sso/contracts';

/**
 * 领域行数据接口 — 用于 validateLoginCredentials
 */
export interface UserAuthRow {
  id: string;
  username: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  passwordHash: string | null;
  status: UserStatus;
}

/**
 * 纯函数：同步校验登录凭据的业务规则
 *
 * 检查用户状态（LOCKED/DISABLED/DELETED）和密码是否存在。
 * bcrypt 异步比对由 lib/auth/login-service 在调用前完成。
 *
 * @param row  DB 查询出的用户行
 * @throws AccountStatusError  账号禁用/锁定/删除（映射 403）
 * @throws BusinessRuleViolationError  未设置密码（映射 422）
 */
export function validateLoginCredentials(row: UserAuthRow): void {
  if (row.status === USER_LOCKED) throw new AccountStatusError(AUTH_ERRORS.ACCOUNT_LOCKED, '账号已被锁定');
  if (row.status === USER_DISABLED) throw new AccountStatusError(AUTH_ERRORS.ACCOUNT_DISABLED, '账号已被禁用');
  // 已注销账号映射到 ACCOUNT_LOCKED（非独立 ACCOUNT_DELETED），防止攻击者通过错误码枚举用户状态
  if (row.status === USER_DELETED) throw new AccountStatusError(AUTH_ERRORS.ACCOUNT_LOCKED, '账号已注销');
  if (!row.passwordHash) throw new BusinessRuleViolationError('账号未设置密码');
}
