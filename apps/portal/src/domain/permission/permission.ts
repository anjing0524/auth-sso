import { ENTITY_ACTIVE } from '@auth-sso/contracts';
import type { CreatePermissionInput, Permission } from './types';
import { dateFromInstant, instantFromDate } from '@/domain/shared/time';

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
