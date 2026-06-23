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
import { eq, inArray, and } from 'drizzle-orm';

export interface SidebarMenuItem {
  id: string;
  title: string;
  url: string;
  icon: string | null;
  children?: SidebarMenuItem[];
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
  // 查询所有 ACTIVE 状态的 DIRECTORY 和 PAGE 类型权限（即菜单项）
  const allMenuItems = await db
    .select()
    .from(schema.permissions)
    .where(
      and(
        inArray(schema.permissions.type, ['DIRECTORY', 'PAGE']),
        eq(schema.permissions.status, 'ACTIVE'),
      ),
    )
    .orderBy(schema.permissions.sort);

  const buildTree = (parentId: string | null = null): SidebarMenuItem[] => {
    return allMenuItems
      .filter((m) => m.parentId === parentId && m.visible !== false)
      .map((m): SidebarMenuItem | null => {
        const hasPermission = !m.code || isAdmin || userPermissions.includes(m.code);
        const children = buildTree(m.id);
        if (!hasPermission && children.length === 0) return null;
        return {
          id: m.id,
          title: m.name,
          url: m.path || '#',
          icon: m.icon || 'LayoutGrid',
          children: children.length > 0 ? children : undefined,
        };
      })
      .filter((m): m is SidebarMenuItem => m !== null);
  };
  return buildTree();
}
