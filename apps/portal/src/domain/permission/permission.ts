import { ENTITY_ACTIVE } from '@auth-sso/contracts';
import type { CreatePermissionInput, Permission } from './types';
import { dateFromInstant, instantFromDate } from '@/domain/shared/time';
import { BusinessRuleViolationError } from '../shared/errors';

export type { Permission };

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

/**
 * 按类型归一只属于该类型的字段（H-B-04）。
 *
 * `type` 是权限表的**鉴别列**，DB 有 CHECK 约束保证组合合法
 * （`permissions_type_fields_chk`：DIRECTORY/PAGE 不得有 client_id）。
 * 若只改 type 而保留旧字段，API→菜单类型会撞 CHECK（此前表现为通用 422「输入内容格式不合法」），
 * 菜单→API 则留下 path/icon/visible 这类对 API 无意义的残留。
 *
 * 归一规则（两个方向都做，避免下一次类型转换再撞约束）：
 * - API：清空菜单专属字段 path / icon / visible
 * - DIRECTORY / PAGE：清空 clientId
 *
 * @param perm 合并后的权限实体（纯函数，零 I/O）
 */
export function normalizePermissionTypeFields(perm: Permission): Permission {
  if (perm.type === 'API') {
    return { ...perm, path: null, icon: null, visible: null };
  }
  return { ...perm, clientId: null };
}

/**
 * 校验归一后的类型专属字段完整性（领域约束，非 DB 兜底）。
 *
 * - PAGE 必须有路由路径（与 `CreatePermissionInputSchema` 的 PAGE 分支同口径；
 *   UPdate 时 path 可能来自入参或原值，故必须在合并后校验）。
 *
 * @throws BusinessRuleViolationError 字段组合不满足类型约束
 */
export function assertPermissionTypeFields(perm: Permission): void {
  if (perm.type === 'PAGE' && !perm.path) {
    throw new BusinessRuleViolationError('PAGE 类型必须指定路由路径（path）');
  }
}

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
    createdAt: dateFromInstant(p.createdAt),
  };
}

export function permissionFromPersistence(permission: Omit<Permission, 'createdAt'> & { createdAt: Date }): Permission {
  return { ...permission, createdAt: instantFromDate(permission.createdAt) };
}

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
