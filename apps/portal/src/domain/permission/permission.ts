import { ENTITY_ACTIVE } from '@auth-sso/contracts';
import type { CreatePermissionInput, Permission } from './types';
import { dateFromInstant, instantFromDate } from '@/domain/shared/time';
import { BusinessRuleViolationError } from '@/domain/shared/errors';

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
    requiredPermissionId: ('requiredPermissionId' in input ? input.requiredPermissionId : undefined) ?? null,
    status: ENTITY_ACTIVE,
    sort: ('sort' in input ? input.sort : undefined) ?? 0,
    createdAt: Temporal.Now.instant(),
  };
}

export function applyPermissionUpdate(
  perm: Permission,
  patch: Partial<Pick<Permission, 'name' | 'code' | 'type' | 'description' | 'path' | 'icon' | 'visible' | 'clientId' | 'parentId' | 'requiredPermissionId' | 'sort' | 'status'>>,
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
    requiredPermissionId: patch.requiredPermissionId !== undefined
      ? patch.requiredPermissionId
      : perm.requiredPermissionId,
    sort: patch.sort ?? perm.sort,
    status: patch.status ?? perm.status,
  };
}

/** 菜单路径必须是站内绝对路径，禁止协议相对地址、反斜杠和 URL 注入。 */
export function validateMenuPath(type: 'DIRECTORY' | 'PAGE', path: string | null): void {
  if (type === 'DIRECTORY' && !path) return;
  if (!path) throw new BusinessRuleViolationError('页面菜单必须填写路径');
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) {
    throw new BusinessRuleViolationError('菜单路径必须是站内绝对路径');
  }
  const parsed = new URL(path, 'http://portal.local');
  if (parsed.origin !== 'http://portal.local' || parsed.search || parsed.hash) {
    throw new BusinessRuleViolationError('菜单路径不能包含域名、查询参数或片段');
  }
}

/** 防止菜单父级指向自身或任意后代节点。 */
export function validateMenuParent(
  menuId: string | null,
  parentId: string | null,
  menus: ReadonlyArray<{ id: string; parentId: string | null }>,
): void {
  if (!menuId || !parentId) return;
  if (menuId === parentId) {
    throw new BusinessRuleViolationError('菜单不能以自身作为父级');
  }
  let currentId: string | null = parentId;
  const visited = new Set<string>();
  while (currentId) {
    if (currentId === menuId) {
      throw new BusinessRuleViolationError('菜单不能移动到自己的子节点下');
    }
    if (visited.has(currentId)) {
      throw new BusinessRuleViolationError('菜单树存在循环引用');
    }
    visited.add(currentId);
    currentId = menus.find((menu) => menu.id === currentId)?.parentId ?? null;
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
    requiredPermissionId: p.requiredPermissionId,
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
    requiredPermissionId: p.requiredPermissionId,
    sort: p.sort,
    status: p.status,
  };
}
