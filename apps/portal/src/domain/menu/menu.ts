import type { EntityStatus, MenuType } from '@auth-sso/contracts';
import { ENTITY_ACTIVE, MENU_TYPE_MENU } from '@auth-sso/contracts';
import type { CreateMenuInput, Menu, MenuTreeNode } from './types';
import { buildTree } from '@/domain/shared/tree-utils';

export type { Menu, MenuTreeNode };

/**
 * 将 Drizzle 数据库行转换为领域 Menu 实体
 */
export function toDomainMenu(row: {
  id: string;
  publicId: string;
  parentId: string | null;
  name: string;
  path: string | null;
  permissionCode: string | null;
  icon: string | null;
  visible: boolean | null;
  sort: number | null;
  menuType: string;
  status: string;
  createdAt: Date;
}): Menu {
  return {
    id: row.id,
    publicId: row.publicId,
    parentId: row.parentId,
    name: row.name,
    path: row.path,
    permissionCode: row.permissionCode,
    icon: row.icon,
    visible: row.visible ?? true,
    sort: row.sort ?? 0,
    menuType: row.menuType as MenuType,
    status: row.status as EntityStatus,
    createdAt: Temporal.Instant.fromEpochMilliseconds(row.createdAt.getTime()),
  };
}

/**
 * 工厂函数：构建新菜单实体 (无副作用)
 */
export function createMenu(
  input: CreateMenuInput,
  idGenerator: (len: number) => string,
): Menu {
  return {
    id: idGenerator(20),
    publicId: `menu_${idGenerator(8)}`,
    parentId: input.parentId ?? null,
    name: input.name,
    path: input.path ?? null,
    permissionCode: input.permissionCode ?? null,
    icon: input.icon ?? null,
    visible: input.visible ?? true,
    sort: input.sort,
    menuType: input.menuType ?? MENU_TYPE_MENU,
    status: ENTITY_ACTIVE,
    createdAt: Temporal.Now.instant(),
  };
}

/**
 * 纯函数：构建更新后的菜单对象 (无副作用)
 */
export function applyMenuUpdate(
  menu: Menu,
  patch: Partial<Pick<Menu, 'name' | 'path' | 'permissionCode' | 'parentId' | 'icon' | 'sort' | 'visible' | 'menuType' | 'status'>>,
): Menu {
  return {
    ...menu,
    name: patch.name ?? menu.name,
    path: patch.path !== undefined ? patch.path : menu.path,
    permissionCode: patch.permissionCode !== undefined ? patch.permissionCode : menu.permissionCode,
    parentId: patch.parentId !== undefined ? patch.parentId : menu.parentId,
    icon: patch.icon !== undefined ? patch.icon : menu.icon,
    sort: patch.sort ?? menu.sort,
    visible: patch.visible ?? menu.visible,
    menuType: patch.menuType ?? menu.menuType,
    status: patch.status ?? menu.status,
  };
}

// ────────────────────────────────────────────
// DB 行转换（统一 Controller 层的列映射，消除重复）
// ────────────────────────────────────────────

/** 将领域实体转为 Drizzle insert 行 */
export function menuToInsertRow(m: Menu) {
  return {
    id: m.id,
    publicId: m.publicId,
    parentId: m.parentId,
    name: m.name,
    path: m.path,
    permissionCode: m.permissionCode,
    icon: m.icon,
    visible: m.visible,
    sort: m.sort,
    menuType: m.menuType,
    status: m.status,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** 将领域实体转为 Drizzle update 行 */
export function menuToUpdateRow(m: Menu) {
  return {
    name: m.name,
    path: m.path,
    permissionCode: m.permissionCode,
    parentId: m.parentId,
    icon: m.icon,
    sort: m.sort,
    visible: m.visible,
    menuType: m.menuType,
    status: m.status,
    updatedAt: new Date(),
  };
}

/**
 * 纯函数：将扁平菜单列表构建为树形结构（按 sort 字段排序）
 * 委托至泛型 buildTree 工具函数
 */
export function buildMenuTree(flatList: Menu[]): MenuTreeNode[] {
  return buildTree(flatList, 'id', 'parentId', 'sort');
}
