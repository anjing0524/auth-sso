/**
 * 动态菜单树构建工具 (Shared Menu Tree Builder)
 *
 * 基于用户权限过滤 permissions 表中 type IN ('DIRECTORY', 'PAGE') 的记录，
 * 构建侧边栏树结构。
 *
 * v2 变更：数据源从 menus 表迁移至 permissions 表（统一权限树）。
 *
 * @module lib/menu-tree
 */
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';

export interface SidebarMenuItem {
  id: string;
  title: string;
  url: string;
  icon: string | null;
  children?: SidebarMenuItem[];
}

export interface MenuPermissionRow {
  id: string;
  name: string;
  code: string;
  type: string;
  path: string | null;
  icon: string | null;
  visible: boolean | null;
  parentId: string | null;
  requiredPermissionId: string | null;
}

export function buildVisibleMenuTree(
  activePermissions: readonly MenuPermissionRow[],
  userPermissions: readonly string[],
  isAdmin: boolean,
): SidebarMenuItem[] {
  const allMenuItems = activePermissions.filter(
    (permission) => permission.type === 'DIRECTORY' || permission.type === 'PAGE',
  );
  const permissionCodeById = new Map(
    activePermissions
      .filter((permission) => permission.type === 'API')
      .map((permission) => [permission.id, permission.code]),
  );

  const buildTree = (parentId: string | null = null): SidebarMenuItem[] =>
    allMenuItems
      .filter((menu) => menu.parentId === parentId && menu.visible !== false)
      .map((menu): SidebarMenuItem | null => {
        const requiredCode = menu.requiredPermissionId
          ? permissionCodeById.get(menu.requiredPermissionId)
          : null;
        const hasPermission = isAdmin
          || menu.requiredPermissionId === null
          || (typeof requiredCode === 'string' && userPermissions.includes(requiredCode));
        const children = buildTree(menu.id);
        if (!hasPermission && children.length === 0) return null;
        return {
          id: menu.id,
          title: menu.name,
          url: menu.path || '#',
          icon: menu.icon || 'LayoutGrid',
          children: children.length > 0 ? children : undefined,
        };
      })
      .filter((menu): menu is SidebarMenuItem => menu !== null);

  return buildTree();
}

/**
 * 获取当前用户可见的动态菜单树
 *
 * 查询 permissions 表中 type = 'DIRECTORY' 或 'PAGE' 且 status = 'ACTIVE' 的记录，
 * 按用户权限过滤：有 permission_code → 用户必须拥有该 code（或为 admin）才能看到。
 *
 * @param userPermissions  用户拥有的权限编码列表
 * @param isAdmin          是否为管理员（绕过权限检查）
 * @returns 过滤并构建好的菜单树
 */
export async function getDynamicMenuTree(
  userPermissions: string[],
  isAdmin: boolean,
): Promise<SidebarMenuItem[]> {
  // 一次查询同时取得菜单节点及其显式绑定的 ACTIVE API 权限。
  const activePermissions = await db
    .select()
    .from(schema.permissions)
    .where(eq(schema.permissions.status, 'ACTIVE'))
    .orderBy(schema.permissions.sort);
  return buildVisibleMenuTree(activePermissions, userPermissions, isAdmin);
}
