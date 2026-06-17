/**
 * 登录领域服务 (Login Domain Service)
 *
 * 纯业务规则验证：状态检查。
 * 不包含任何 DB 查询、bcrypt 异步调用或基础设施依赖。
 *
 * @module domain/auth/login
 */
import { BusinessRuleViolationError } from '@/domain/shared/errors';

/** 登录成功返回的用户基本信息（不含敏感字段） */
export interface AuthResult {
  user: {
    id: string;
    publicId: string;
    username: string;
    name: string;
    email: string | null;
    avatarUrl: string | null;
  };
}

/**
 * 领域行数据接口 — 用于 validateLoginCredentials
 */
export interface UserAuthRow {
  id: string;
  publicId: string;
  username: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  passwordHash: string | null;
  status: string;
}

/**
 * 纯函数：同步校验登录凭据的业务规则
 *
 * 检查用户状态（LOCKED/DISABLED/DELETED）和密码是否存在。
 * bcrypt 异步比对由 lib/auth/login-service 在调用前完成。
 *
 * @param row  DB 查询出的用户行
 * @throws BusinessRuleViolationError  账号禁用/锁定/删除，或未设置密码
 */
export function validateLoginCredentials(row: UserAuthRow): void {
  if (row.status === 'LOCKED') throw new BusinessRuleViolationError('账号已被锁定');
  if (row.status === 'DISABLED') throw new BusinessRuleViolationError('账号已被禁用');
  if (row.status === 'DELETED') throw new BusinessRuleViolationError('账号已注销');
  if (!row.passwordHash) throw new BusinessRuleViolationError('账号未设置密码');
}
