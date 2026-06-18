import type { EntityStatus, PermissionType } from '@auth-sso/contracts';
import { ENTITY_ACTIVE, PERMISSION_API } from '@auth-sso/contracts';
import type { CreatePermissionInput, Permission } from './types';

export type { Permission };

/**
 * 将 Drizzle 数据库行转换为领域 Permission 实体
 */
export function toDomainPermission(row: {
  id: string;
  publicId: string;
  name: string;
  code: string;
  type: string;
  resource: string | null;
  action: string | null;
  parentId: string | null;
  status: string;
  sort: number | null;
  createdAt: Date;
}): Permission {
  return {
    id: row.id,
    publicId: row.publicId,
    name: row.name,
    code: row.code,
    type: row.type as PermissionType,
    resource: row.resource,
    action: row.action,
    parentId: row.parentId,
    status: row.status as EntityStatus,
    sort: row.sort ?? 0,
    createdAt: Temporal.Instant.fromEpochMilliseconds(row.createdAt.getTime()),
  };
}

/**
 * 工厂函数：构建新权限实体 (无副作用)
 */
export function createPermission(
  input: CreatePermissionInput,
  idGenerator: (len: number) => string,
): Permission {
  return {
    id: idGenerator(20),
    publicId: `perm_${idGenerator(16)}`,
    name: input.name,
    code: input.code,
    type: input.type ?? PERMISSION_API,
    resource: input.resource ?? null,
    action: input.action ?? null,
    parentId: input.parentId ?? null,
    status: ENTITY_ACTIVE,
    sort: input.sort,
    createdAt: Temporal.Now.instant(),
  };
}

/**
 * 纯函数：构建更新后的权限对象 (无副作用)
 */
export function applyPermissionUpdate(
  perm: Permission,
  patch: Partial<Pick<Permission, 'name' | 'code' | 'type' | 'resource' | 'action' | 'parentId' | 'sort' | 'status'>>,
): Permission {
  return {
    ...perm,
    name: patch.name ?? perm.name,
    code: patch.code ?? perm.code,
    type: patch.type ?? perm.type,
    resource: patch.resource !== undefined ? patch.resource : perm.resource,
    action: patch.action !== undefined ? patch.action : perm.action,
    parentId: patch.parentId !== undefined ? patch.parentId : perm.parentId,
    sort: patch.sort ?? perm.sort,
    status: patch.status ?? perm.status,
  };
}

// ────────────────────────────────────────────
// DB 行转换（统一 Controller 层的列映射，消除重复）
// ────────────────────────────────────────────

/** 将领域实体转为 Drizzle insert 行 */
export function permissionToInsertRow(p: Permission) {
  return {
    id: p.id,
    publicId: p.publicId,
    name: p.name,
    code: p.code,
    type: p.type,
    resource: p.resource,
    action: p.action,
    parentId: p.parentId,
    sort: p.sort,
    status: p.status,
    createdAt: new Date(p.createdAt.epochMilliseconds),
  };
}

/** 将领域实体转为 Drizzle update 行 */
export function permissionToUpdateRow(p: Permission) {
  return {
    name: p.name,
    code: p.code,
    type: p.type,
    resource: p.resource,
    action: p.action,
    parentId: p.parentId,
    sort: p.sort,
    status: p.status,
  };
}
