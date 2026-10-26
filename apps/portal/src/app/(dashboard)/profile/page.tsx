/**
 * 个人中心 — Server Component 入口
 *
 * 数据通过 resolveIdentity + data 层直接获取，消除客户端 useEffect + fetch 瀑布。
 * UI 渲染委托 ProfileClient（Client Component，含 Radix UI Tabs/Avatar 交互组件）。
 */
import { Suspense } from 'react';
import { cookies, headers } from 'next/headers';
import { resolveIdentity } from '@/lib/auth';
import { verifyAccessToken } from '@/lib/auth/token';
import { COOKIE_NAMES, PORTAL_CLIENT_ID } from '@auth-sso/contracts';
import { getOwnUser } from '@/app/(dashboard)/users/data';
import { getUserPermissionContext, toPermissionContextOrNull } from '@/lib/permissions';
import ProfileClient from './ProfileClient';
import { getOwnSessions } from './sessions';


/**
 * 该路由读取会话/动态数据，**保留服务端阻塞**（Cache Components 的 instant 导航校验）。
 * 依据 Next 16 文档：启用 cacheComponents 后，读 session 的路由需显式声明；
 * 否则 Turbopack 运行时会报 "encountered uncached data during prerendering or a navigation"。
 */
export const instant = false;
export const metadata = { title: '个人中心 | Auth-SSO' };
/**
 * 实际进行个人身份解析与相关权限数据异步拉取的内容组件。
 */
async function ProfileContent() {
  const identity = await resolveIdentity();
  if (!identity) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">请先登录</p>
      </div>
    );
  }

  const cookieStore = await cookies();
  const jwt = cookieStore.get(COOKIE_NAMES.JWT)?.value;
  const claims = jwt ? await verifyAccessToken(jwt, PORTAL_CLIENT_ID) : null;
  const [user, permCtx, headerStore, sessions] = await Promise.all([
    getOwnUser(identity.userId),
    getUserPermissionContext(identity.userId).then(toPermissionContextOrNull),
    headers(),
    getOwnSessions(identity.userId, typeof claims?.sid === 'string' ? claims.sid : undefined),
  ]);
  const session = claims
    ? {
        iat: claims.iat ?? null,
        exp: claims.exp ?? null,
        jti: claims.jti,
        clientId: claims.client_id ?? PORTAL_CLIENT_ID,
        userAgent: headerStore.get('user-agent'),
        ip: headerStore.get('x-forwarded-for')?.split(',')[0]?.trim()
          ?? headerStore.get('x-real-ip')
          ?? null,
      }
    : null;

  return (
    <ProfileClient
      user={user ? {
        id: user.id,
        name: user.name,
        email: user.email ?? '',
        picture: user.avatarUrl,
        deptName: user.deptName,
        status: user.status,
      } : null}
      permissions={permCtx?.permissions ?? []}
      roles={permCtx?.roles.map(r => ({ code: r.code, name: r.name })) ?? []}
      session={session}
      sessions={sessions}
    />
  );
}

/**
 * 个人中心页面入口。
 * 提供 Suspense 边界，防止静态生成时访问 cookies/headers 抛出动态 API 访问异常。
 */
export default function ProfilePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="animate-pulse text-muted-foreground">加载个人信息中...</div>
        </div>
      }
    >
      <ProfileContent />
    </Suspense>
  );
}
