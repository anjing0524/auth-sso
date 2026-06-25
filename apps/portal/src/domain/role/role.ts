import type { EntityStatus } from '@auth-sso/contracts';
import { ENTITY_ACTIVE } from '@auth-sso/contracts';
import type { CreateRoleInput, Role } from './types';
import { BusinessRuleViolationError } from '../shared/errors';

export type { Role };

/**
 * 将 Drizzle 数据库行转换为领域 Role 实体
 */
export function toDomainRole(row: {
  id: string;
  name: string;
  code: string;
  description: string | null;
  deptId: string;
  isSystem: boolean | null;
  status: EntityStatus;
  sort: number | null;
  createdAt: Date;
}): Role {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    deptId: row.deptId,
    isSystem: row.isSystem ?? false,
    status: row.status,
    sort: row.sort ?? 0,
    createdAt: Temporal.Instant.fromEpochMilliseconds(row.createdAt.getTime()),
  };
}

/**
 * 工厂函数：构建新角色实体 (无副作用)
 */
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

/**
 * 纯函数：构建更新后的角色对象 (无副作用)
 */
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

/**
 * 领域守卫：禁止操作系统内置角色
 */
export function guardNotSystemRole(role: Role): void {
  if (role.isSystem) {
    throw new BusinessRuleViolationError('系统内置角色禁止修改或删除');
  }
}

/**
 * 纯函数：判断角色更新是否影响权限决策（需触发用户重登）
 */
export function hasRolePermissionImpact(
  original: Pick<Role, 'deptId' | 'status'>,
  updated: Pick<Role, 'deptId' | 'status'>,
): boolean {
  return original.deptId !== updated.deptId || original.status !== updated.status;
}

// ────────────────────────────────────────────
// DB 行转换（统一 Controller 层的列映射，消除重复）
// ────────────────────────────────────────────

/** 将领域实体转为 Drizzle insert 行 */
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
    createdAt: new Date(r.createdAt.epochMilliseconds),
  };
}

/** 将领域实体转为 Drizzle update 行 */
export function roleToUpdateRow(r: Role) {
  return {
    name: r.name,
    description: r.description,
    deptId: r.deptId,
    sort: r.sort,
    status: r.status,
  };
}
