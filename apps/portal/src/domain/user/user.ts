import { USER_ACTIVE, USER_DISABLED, USER_LOCKED, USER_DELETED } from '@auth-sso/contracts';
import { type CreateUserInput, type User } from './types';
import { BusinessRuleViolationError } from '../shared/errors';

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
    createdAt: new Date(),
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
  return { ...user, status: USER_DELETED, deletedAt: new Date() };
}

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
    deletedAt: u.deletedAt,
    passwordChangedAt: u.passwordChangedAt,
    createdAt: u.createdAt,
  };
}

export function userToUpdateRow(u: User) {
  return {
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    status: u.status,
    deptId: u.deptId,
    deletedAt: u.deletedAt,
    passwordChangedAt: u.passwordChangedAt,
  };
}
