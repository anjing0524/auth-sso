/**
 * (dashboard) Route Group 共享布局
 *
 * 服务端获取用户数据 + 动态菜单 → 通过 props 传入 DashboardLayout。
 * 不再依赖客户端 /api/me fetch，消灭数据瀑布。
 *
 * Gateway 已注入 X-User-Id → resolveIdentity 走信任路径（零验签）。
 */
import { redirect } from 'next/navigation';
import { resolveIdentity } from '@/lib/auth';
import { getUser } from '@/app/(dashboard)/users/data';
import { getAllActiveMenus } from '@/app/(dashboard)/menus/data';
import { getUserPermissionContext } from '@/lib/permissions';
import DashboardLayout, { type SidebarMenuItem } from '@/components/layout/DashboardLayout';

/** 基于权限过滤构建侧边栏菜单树 */
function buildDynamicMenuTree(
  allMenus: Awaited<ReturnType<typeof getAllActiveMenus>>,
  userPermissions: string[],
  isAdmin: boolean,
): SidebarMenuItem[] {
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

export default async function DashboardGroupLayout({ children }: { children: React.ReactNode }) {
  const identity = await resolveIdentity();
  if (!identity) {
    redirect(`/login?callbackUrl=${encodeURIComponent('/dashboard')}`);
  }

  // 并行获取用户数据、权限上下文、菜单（getAllActiveMenus 有 'use cache'）
  const [user, permCtx, allMenus] = await Promise.all([
    getUser(identity.userId),
    getUserPermissionContext(identity.userId),
    getAllActiveMenus(),
  ]);

  const isAdmin = permCtx?.roles.some((r) => r.code === 'SUPER_ADMIN' || r.code === 'ADMIN') ?? false;
  const menus = buildDynamicMenuTree(allMenus, permCtx?.permissions ?? [], isAdmin);

  return (
    <DashboardLayout
      user={{
        id: user?.publicId ?? identity.userId,
        email: user?.email ?? null,
        name: user?.name ?? '未知',
        picture: user?.avatarUrl ?? null,
        emailVerified: user?.emailVerified ?? null,
      }}
      menus={menus}
    >
      {children}
    </DashboardLayout>
  );
}
