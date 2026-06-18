/**
 * 动态菜单树构建工具 (Shared Menu Tree Builder)
 *
 * 消除 layout.tsx 和 me/route.ts 之间的重复菜单过滤/树构建逻辑。
 * 基于用户权限过滤可见菜单，构建侧边栏树结构。
 *
 * @module lib/menu-tree
 */
import { getAllActiveMenus } from '@/app/(dashboard)/menus/data';

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
 * @param userPermissions  用户拥有的权限编码列表
 * @param isAdmin          是否为管理员（绕过权限检查）
 * @returns 过滤并构建好的菜单树
 */
export async function getDynamicMenuTree(
  userPermissions: string[],
  isAdmin: boolean,
): Promise<SidebarMenuItem[]> {
  const allMenus = await getAllActiveMenus();

  const buildTree = (parentId: string | null = null): SidebarMenuItem[] => {
    return allMenus
      .filter((m) => m.parentId === parentId && m.visible && m.menuType !== 'BUTTON')
      .map((m): SidebarMenuItem | null => {
        const hasPermission = !m.permissionCode || isAdmin || userPermissions.includes(m.permissionCode);
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
