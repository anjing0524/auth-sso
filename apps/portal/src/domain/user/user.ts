import { USER_ACTIVE, USER_DISABLED, USER_LOCKED, USER_DELETED } from '@auth-sso/contracts';
import { type CreateUserInput, type User } from './types';
import { BusinessRuleViolationError } from '../shared/errors';
import { dateFromInstant, instantFromDate } from '../shared/time';

export type { User };

export function createUser(
  input: CreateUserInput,
  idGenerator: () => string
): Omit<User, 'deletedAt' | 'passwordChangedAt'> & { deletedAt: null; passwordChangedAt: null } {
  return {
    id: idGenerator(),
    username: input.username,
    email: input.email,
    name: input.name,
    status: USER_ACTIVE,
    deptId: input.deptId || null,
    avatarUrl: null,
    deletedAt: null,
    passwordChangedAt: null,
    createdAt: Temporal.Now.instant(),
  };
}

export function toggleUserStatus(user: User): User {
  if (user.status === USER_DELETED) {
    throw new BusinessRuleViolationError('已逻辑删除的用户无法操作状态');
  }
  if (user.status === USER_LOCKED) {
    throw new BusinessRuleViolationError('已锁定的用户无法直接切换状态，请使用解锁功能');
  }
  const newStatus: User['status'] = user.status === USER_ACTIVE ? USER_DISABLED : USER_ACTIVE;
  return { ...user, status: newStatus };
}

export function unlockUser(user: User): User {
  if (user.status === USER_DELETED) {
    throw new BusinessRuleViolationError('已逻辑删除的用户无法解锁');
  }
  if (user.status !== USER_LOCKED) {
    throw new BusinessRuleViolationError('仅被锁定的用户需要解锁');
  }
  return { ...user, status: USER_ACTIVE };
}

export function deleteUser(user: User): User {
  if (user.status === USER_DELETED) {
    throw new BusinessRuleViolationError('用户已被删除，不可重复操作');
  }
  return { ...user, status: USER_DELETED, deletedAt: Temporal.Now.instant() };
}

/**
 * 用户资料更新（含状态转换规则，H-17）。
 *
 * 状态机约束（DC-USR-ST）：
 * - 请求 `DELETED` 必须走 {@link deleteUser}（写入 `deletedAt`，释放部分唯一索引）。
 *   此前只写 `status`、丢弃 `deletedAt` ⇒ 邮箱/手机号永久不可复用。
 * - 当前为 `LOCKED` 时**禁止**经本函数切到任何其它状态（含 ACTIVE）：解锁必须走
 *   `unlockUserAction`。此前详情表单可直写 LOCKED→ACTIVE，绕过解锁流程。
 * - 其余转换（ACTIVE↔DISABLED、→LOCKED）属管理员正常操作，允许。
 */
export function applyUserUpdate(
  user: User,
  patch: Partial<Pick<User, 'name' | 'email' | 'status' | 'deptId' | 'avatarUrl'>>
): User {
  if (user.status === USER_DELETED) {
    throw new BusinessRuleViolationError('无法更新已逻辑删除的用户');
  }
  const requestedStatus = patch.status;
  const nextStatus = requestedStatus ?? user.status;

  if (nextStatus === USER_DELETED && nextStatus !== user.status) {
    return deleteUser(user);
  }
  if (nextStatus !== user.status && user.status === USER_LOCKED) {
    throw new BusinessRuleViolationError('已锁定的用户无法直接切换状态，请使用解锁功能');
  }

  return {
    ...user,
    name: patch.name ?? user.name,
    email: patch.email ?? user.email,
    status: nextStatus,
    deptId: patch.deptId !== undefined ? patch.deptId : user.deptId,
    avatarUrl: patch.avatarUrl === undefined ? user.avatarUrl : patch.avatarUrl,
  };
}

export function hasDeptChanged(oldDeptId: string | null, newDeptId: string | undefined | null): boolean {
  return newDeptId !== undefined && (oldDeptId ?? '') !== (newDeptId ?? '');
}

export function userToInsertRow(u: User) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    status: u.status,
    deptId: u.deptId,
    deletedAt: u.deletedAt && dateFromInstant(u.deletedAt),
    passwordChangedAt: u.passwordChangedAt && dateFromInstant(u.passwordChangedAt),
    createdAt: dateFromInstant(u.createdAt),
  };
}

export function userToUpdateRow(u: User) {
  return {
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    status: u.status,
    deptId: u.deptId,
    deletedAt: u.deletedAt && dateFromInstant(u.deletedAt),
    passwordChangedAt: u.passwordChangedAt && dateFromInstant(u.passwordChangedAt),
  };
}

export function userFromPersistence(user: Omit<User, 'deletedAt' | 'passwordChangedAt' | 'createdAt'> & {
  deletedAt: Date | null;
  passwordChangedAt: Date | null;
  createdAt: Date;
}): User {
  return {
    ...user,
    deletedAt: user.deletedAt && instantFromDate(user.deletedAt),
    passwordChangedAt: user.passwordChangedAt && instantFromDate(user.passwordChangedAt),
    createdAt: instantFromDate(user.createdAt),
  };
}
