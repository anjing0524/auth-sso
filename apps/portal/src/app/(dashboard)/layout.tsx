/**
 * (dashboard) Route Group 共享布局
 *
 * 服务端获取用户数据 + 动态菜单 → 通过 props 传入 DashboardLayout。
 * 不再依赖客户端 /api/me fetch，消灭数据瀑布。
 *
 * Gateway 已注入 X-User-Id → resolveIdentity 走信任路径（零验签）。
 */
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { resolveIdentity } from '@/lib/auth';
import { getOwnUser } from '@/app/(dashboard)/users/data';
import { getDynamicMenuTree } from '@/lib/menu-tree';
import { getUserPermissionContext, toPermissionContextOrNull } from '@/lib/permissions';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { toDashboardUser } from '@/lib/dashboard-user';

/**
 * 实际进行身份鉴权与菜单数据拉取的异步内容组件。
 */
async function DashboardContent({ children }: { children: React.ReactNode }) {
  const identity = await resolveIdentity();
  if (!identity) {
    redirect(`/login?callbackUrl=${encodeURIComponent('/dashboard')}`);
  }

  // 从 Redis 获取用户角色和权限上下文
  const permCtx = toPermissionContextOrNull(await getUserPermissionContext(identity.userId));
  const roles = permCtx?.roles.map(r => r.code) ?? [];
  const permissions = permCtx?.permissions ?? [];
  const subject = { roleCodes: roles, permissionCodes: permissions };
  const menus = await getDynamicMenuTree(subject);

  // 并行获取用户数据（仅用于 UI 展示）——读的是自己，用身份读口，不受数据范围约束
  const user = await getOwnUser(identity.userId);

  return (
    <DashboardLayout
      user={toDashboardUser(user, identity.userId)}
      menus={menus}
    >
      {children}
    </DashboardLayout>
  );
}

/**
 * (dashboard) 共享布局入口。
 * 提供 Suspense 边界，防止静态生成时由于访问 cookies/headers 触发动态 API 报错。
 */
export default function DashboardGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
          <div className="animate-pulse text-gray-400">控制台安全加载中...</div>
        </div>
      }
    >
      <DashboardContent>{children}</DashboardContent>
    </Suspense>
  );
}
