import type { UserStatus } from '@auth-sso/contracts';
import { USER_ACTIVE, USER_DELETED } from '@auth-sso/contracts';
import { type CreateUserInput, type User } from './types';
import { BusinessRuleViolationError } from '../shared/errors';

// Re-export 领域实体接口，便于外部统一导入
export type { User };

/**
 * 将 Drizzle 数据库行转换为领域 User 实体
 * 处理 Drizzle $inferSelect 中 string 类型到 UserStatus 联合类型的安全转换
 */
export function toDomainUser(row: {
  id: string;
  publicId: string;
  username: string;
  email: string | null;
  name: string;
  avatarUrl: string | null;
  status: string;
  deptId: string | null;
  createdAt: Date;
}): User {
  return {
    id: row.id,
    publicId: row.publicId,
    username: row.username,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    status: row.status as UserStatus,
    deptId: row.deptId,
    deptName: null,
    createdAt: Temporal.Instant.fromEpochMilliseconds(row.createdAt.getTime()),
  };
}

/**
 * 工厂函数：构建新用户实体 (无副作用)
 *
 * @param input 经 Zod 校验的创建参数
 * @param idGenerator ID 生成器（通过参数注入，保持纯函数可测试性）
 * @returns 新用户实体
 */
export function createUser(
  input: CreateUserInput,
  idGenerator: (len: number) => string
): User {
  return {
    id: idGenerator(20),
    publicId: `user_${idGenerator(8)}`,
    username: input.username,
    email: input.email,
    name: input.name,
    status: USER_ACTIVE,
    deptId: input.deptId || null,
    deptName: null,
    avatarUrl: null,
    createdAt: Temporal.Now.instant(),
  };
}

/**
 * 核心领域纯函数：状态机切换规则 (无副作用)
 *
 * @param user 原始用户对象
 * @returns 状态更新后的新用户副本
 * @throws BusinessRuleViolationError 当用户已被逻辑删除时
 */
export function toggleUserStatus(user: User): User {
  if (user.status === USER_DELETED) {
    throw new BusinessRuleViolationError('已逻辑删除的用户无法操作状态');
  }
  const newStatus: User['status'] = user.status === USER_ACTIVE ? 'DISABLED' : USER_ACTIVE;
  return { ...user, status: newStatus };
}

/**
 * 核心领域纯函数：逻辑删除用户 (无副作用)
 *
 * @param user 原始用户对象
 * @returns 逻辑删除后的新用户副本
 * @throws BusinessRuleViolationError 当用户已被删除时
 */
export function deleteUser(user: User): User {
  if (user.status === USER_DELETED) {
    throw new BusinessRuleViolationError('用户已被删除，不可重复操作');
  }
  return { ...user, status: USER_DELETED };
}

/**
 * 核心领域纯函数：构建更新后的用户对象 (无副作用)
 * 消除 Controller 中的 ?? 链，收敛修改规则
 *
 * @param user 原始用户对象
 * @param patch 用户属性的修改片段
 * @returns 修改合并后的新用户副本
 * @throws BusinessRuleViolationError 当用户已被逻辑删除时
 */
export function applyUserUpdate(
  user: User,
  patch: Partial<Pick<User, 'name' | 'email' | 'status' | 'deptId' | 'avatarUrl'>>
): User {
  if (user.status === USER_DELETED) {
    throw new BusinessRuleViolationError('无法更新已逻辑删除的用户');
  }
  return {
    ...user,
    name: patch.name ?? user.name,
    email: patch.email ?? user.email,
    status: patch.status ?? user.status,
    deptId: patch.deptId !== undefined ? patch.deptId : user.deptId,
    avatarUrl: patch.avatarUrl ?? user.avatarUrl,
  };
}

// ────────────────────────────────────────────
// DB 行转换（统一 Controller 层的列映射，消除重复）
// ────────────────────────────────────────────

/**
 * 将领域 User 实体转为 Drizzle insert 行
 * 仅在创建路径使用，Controller 禁止手写列名映射
 *
 * 注意：passwordHash 不在此转换中（需额外传入，涉及 bcrypt 哈希）
 */
export function userToInsertRow(u: User) {
  return {
    id: u.id,
    publicId: u.publicId,
    username: u.username,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    status: u.status,
    deptId: u.deptId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * 将领域 User 实体转为 Drizzle update 行
 * 仅在更新路径使用，Controller 禁止手写列名映射
 */
export function userToUpdateRow(u: User) {
  return {
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    status: u.status,
    deptId: u.deptId,
    updatedAt: new Date(),
  };
}
