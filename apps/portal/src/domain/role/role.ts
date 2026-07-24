import type { CreateRoleInput, Role } from './types';
import { ENTITY_ACTIVE } from '@auth-sso/contracts';
import { BusinessRuleViolationError } from '../shared/errors';
import { dateFromInstant, instantFromDate } from '@/domain/shared/time';

export type { Role };

export function createRole(
  input: CreateRoleInput,
  idGenerator: () => string,
): Role {
  return {
    id: idGenerator(),
    name: input.name,
    code: input.code,
    description: input.description ?? null,
    deptId: input.deptId,
    isSystem: false,
    status: ENTITY_ACTIVE,
    sort: input.sort,
    createdAt: Temporal.Now.instant(),
  };
}

export function applyRoleUpdate(
  role: Role,
  patch: Partial<Pick<Role, 'name' | 'description' | 'deptId' | 'sort' | 'status'>>,
): Role {
  return {
    ...role,
    name: patch.name ?? role.name,
    description: patch.description !== undefined ? patch.description : role.description,
    deptId: patch.deptId ?? role.deptId,
    sort: patch.sort ?? role.sort,
    status: patch.status ?? role.status,
  };
}

export function guardNotSystemRole(role: Role): void {
  if (role.isSystem) {
    throw new BusinessRuleViolationError('系统内置角色禁止修改或删除');
  }
}

export function hasRolePermissionImpact(
  original: Pick<Role, 'deptId' | 'status'>,
  updated: Pick<Role, 'deptId' | 'status'>,
  permissionChanged: boolean = false,
): boolean {
  return original.deptId !== updated.deptId
    || original.status !== updated.status
    || permissionChanged;
}

export function roleToInsertRow(r: Role) {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    description: r.description,
    deptId: r.deptId,
    isSystem: r.isSystem,
    sort: r.sort,
    status: r.status,
    createdAt: dateFromInstant(r.createdAt),
  };
}

export function roleFromPersistence(role: Omit<Role, 'createdAt'> & { createdAt: Date }): Role {
  return { ...role, createdAt: instantFromDate(role.createdAt) };
}

export function roleToUpdateRow(r: Role) {
  return {
    name: r.name,
    description: r.description,
    deptId: r.deptId,
    sort: r.sort,
    status: r.status,
  };
}
