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
import { connection } from 'next/server';
import { resolveIdentity } from '@/lib/auth';
import { getOwnUser } from '@/app/(dashboard)/users/data';
import { getDynamicMenuTree } from '@/lib/menu-tree';
import { getUserPermissionContext, toPermissionContextOrNull } from '@/lib/permissions';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { PermissionsProvider } from '@/components/providers/permissions-provider';
import { toDashboardUser } from '@/lib/dashboard-user';


/**
 * 该路由读取会话/动态数据，**保留服务端阻塞**（Cache Components 的 instant 导航校验）。
 * 依据 Next 16 文档：启用 cacheComponents 后，读 session 的路由需显式声明；
 * 否则 Turbopack 运行时会报 "encountered uncached data during prerendering or a navigation"。
 */
export const instant = false;
/**
 * 实际进行身份鉴权与菜单数据拉取的异步内容组件。
 */
async function DashboardContent({ children }: { children: React.ReactNode }) {
  /**
   * 明确声明"本段在请求期渲染"。
   *
   * 不加这句时，Turbopack 下 Cache Components 会把本布局的认证链路当作可预渲染路径，
   * 进而对链路里的 `Date.now()`（签名密钥 TTL 缓存）报
   * "encountered the unstable value `Date.now()` while prerendering"；
   * 认证本质是请求期的，`connection()` 是文档给出的 [dynamic] 修法。
   */
  await connection();
  const identity = await resolveIdentity();
  if (!identity) {
    redirect(`/login?callbackUrl=${encodeURIComponent('/dashboard')}`);
  }

  // 从 Redis 获取用户角色和权限上下文
  const permCtx = toPermissionContextOrNull(await getUserPermissionContext(identity.userId));
  const roles = permCtx?.roles.map(r => r.code) ?? [];
  const permissions = permCtx?.permissions ?? [];
  const subject = { roleCodes: roles, permissionCodes: permissions };
  const dynamicMenus = await getDynamicMenuTree(subject);
  // 工作台对所有已登录用户开放，但菜单权限是可选的：没有 portal:menu:dashboard 的角色
  // 也需要一个回工作台的入口（否则只能靠 logo/浏览器回退）。首页固定置于最前。
  const menus = dynamicMenus.some((m) => m.url === '/dashboard')
    ? dynamicMenus
    : [{ id: 'home', title: '工作台', url: '/dashboard', icon: 'LayoutDashboard' }, ...dynamicMenus];

  // 并行获取用户数据（仅用于 UI 展示）——读的是自己，用身份读口，不受数据范围约束
  const user = await getOwnUser(identity.userId);

  return (
    <PermissionsProvider roleCodes={roles} permissionCodes={permissions}>
      <DashboardLayout
        user={toDashboardUser(user, identity.userId)}
        menus={menus}
      >
        {children}
      </DashboardLayout>
    </PermissionsProvider>
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
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="animate-pulse text-muted-foreground">控制台安全加载中...</div>
        </div>
      }
    >
      <DashboardContent>{children}</DashboardContent>
    </Suspense>
  );
}
