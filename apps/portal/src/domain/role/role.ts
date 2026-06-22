import type { EntityStatus, DataScopeType } from '@auth-sso/contracts';
import { ENTITY_ACTIVE, DATA_SCOPE_SELF } from '@auth-sso/contracts';
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
  dataScopeType: DataScopeType;
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
    dataScopeType: row.dataScopeType,
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
    dataScopeType: input.dataScopeType ?? DATA_SCOPE_SELF,
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
  patch: Partial<Pick<Role, 'name' | 'description' | 'dataScopeType' | 'sort' | 'status'>>,
): Role {
  return {
    ...role,
    name: patch.name ?? role.name,
    description: patch.description !== undefined ? patch.description : role.description,
    dataScopeType: patch.dataScopeType ?? role.dataScopeType,
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
    dataScopeType: r.dataScopeType,
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
    dataScopeType: r.dataScopeType,
    sort: r.sort,
    status: r.status,
  };
}
