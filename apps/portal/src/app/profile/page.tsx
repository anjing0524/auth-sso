/**
 * 个人中心 — Server Component 入口
 *
 * 数据通过 resolveIdentity + data 层直接获取，消除客户端 useEffect + fetch 瀑布。
 * UI 渲染委托 ProfileClient（Client Component，含 Radix UI Tabs/Avatar 交互组件）。
 */
import { Suspense } from 'react';
import { resolveIdentity } from '@/lib/auth';
import { getUser } from '@/app/(dashboard)/users/data';
import { getUserPermissionContext } from '@/lib/permissions';
import ProfileClient from './ProfileClient';

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

  const [user, permCtx] = await Promise.all([
    getUser(identity.userId),
    getUserPermissionContext(identity.userId),
  ]);

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
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
          <div className="animate-pulse text-gray-400">加载个人信息中...</div>
        </div>
      }
    >
      <ProfileContent />
    </Suspense>
  );
}
