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
import { getDynamicMenuTree } from '@/lib/menu-tree';
import { ADMIN_ROLE_CODES } from '@auth-sso/contracts';
import DashboardLayout from '@/components/layout/DashboardLayout';

export default async function DashboardGroupLayout({ children }: { children: React.ReactNode }) {
  const identity = await resolveIdentity();
  if (!identity) {
    redirect(`/login?callbackUrl=${encodeURIComponent('/dashboard')}`);
  }

  // 从 claims 中直接获取角色和权限（Gateway 已验证，零 DB 查询）
  const { claims } = identity;
  const isAdmin = claims.roles.some((r) => (ADMIN_ROLE_CODES as readonly string[]).includes(r));
  const menus = await getDynamicMenuTree(claims.permissions, isAdmin);

  // 并行获取用户数据（仅用于 UI 展示）
  const user = await getUser(identity.userId);

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
