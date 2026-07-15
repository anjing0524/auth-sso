import type { EntityStatus, PermissionType } from '@auth-sso/contracts';
import { ENTITY_ACTIVE, PERMISSION_API } from '@auth-sso/contracts';
import type { CreatePermissionInput, Permission } from './types';

export type { Permission };

/**
 * 将 Drizzle 数据库行转换为领域 Permission 实体
 */
export function toDomainPermission(row: {
  id: string;
  name: string;
  code: string;
  type: PermissionType;
  description: string | null;
  path: string | null;
  icon: string | null;
  visible: boolean | null;
  clientId: string | null;
  parentId: string | null;
  status: EntityStatus;
  sort: number | null;
  createdAt: Date;
}): Permission {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    type: row.type,
    description: row.description,
    path: row.path,
    icon: row.icon,
    visible: row.visible,
    clientId: row.clientId,
    parentId: row.parentId,
    status: row.status,
    sort: row.sort ?? 0,
    createdAt: Temporal.Instant.fromEpochMilliseconds(row.createdAt.getTime()),
  };
}

/**
 * 工厂函数：构建新权限实体 (无副作用)
 *
 * CreatePermissionInput 为 discriminated union，不同 type 分支有不同的可选字段。
 * 使用 in 操作符类型守卫安全访问各分支字段，避免 as Record<string, unknown> 断言。
 */
export function createPermission(
  input: CreatePermissionInput,
  idGenerator: () => string,
): Permission {
  return {
    id: idGenerator(),
    name: input.name,
    code: input.code,
    type: input.type,
    description: ('description' in input ? input.description : undefined) ?? null,
    path: ('path' in input ? input.path : undefined) ?? null,
    icon: ('icon' in input ? input.icon : undefined) ?? null,
    visible: ('visible' in input ? input.visible : undefined) ?? null,
    clientId: ('clientId' in input ? input.clientId : undefined) ?? null,
    parentId: ('parentId' in input ? input.parentId : undefined) ?? null,
    status: ENTITY_ACTIVE,
    sort: ('sort' in input ? input.sort : undefined) ?? 0,
    createdAt: Temporal.Now.instant(),
  };
}

/**
 * 纯函数：构建更新后的权限对象 (无副作用)
 */
export function applyPermissionUpdate(
  perm: Permission,
  patch: Partial<Pick<Permission, 'name' | 'code' | 'type' | 'description' | 'path' | 'icon' | 'visible' | 'clientId' | 'parentId' | 'sort' | 'status'>>,
): Permission {
  return {
    ...perm,
    name: patch.name ?? perm.name,
    code: patch.code ?? perm.code,
    type: patch.type ?? perm.type,
    description: patch.description !== undefined ? patch.description : perm.description,
    path: patch.path !== undefined ? patch.path : perm.path,
    icon: patch.icon !== undefined ? patch.icon : perm.icon,
    visible: patch.visible !== undefined ? patch.visible : perm.visible,
    clientId: patch.clientId !== undefined ? patch.clientId : perm.clientId,
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
    name: p.name,
    code: p.code,
    type: p.type,
    description: p.description,
    path: p.path,
    icon: p.icon,
    visible: p.visible,
    clientId: p.clientId,
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
    description: p.description,
    path: p.path,
    icon: p.icon,
    visible: p.visible,
    clientId: p.clientId,
    parentId: p.parentId,
    sort: p.sort,
    status: p.status,
  };
}
