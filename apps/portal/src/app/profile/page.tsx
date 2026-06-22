/**
 * 个人中心 — Server Component 入口
 *
 * 数据通过 resolveIdentity + data 层直接获取，消除客户端 useEffect + fetch 瀑布。
 * UI 渲染委托 ProfileClient（Client Component，含 Radix UI Tabs/Avatar 交互组件）。
 */
import { resolveIdentity } from '@/lib/auth';
import { getUser } from '@/app/(dashboard)/users/data';
import { getUserPermissionContext } from '@/lib/permissions';
import ProfileClient from './ProfileClient';

export default async function ProfilePage() {
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
        id: user.publicId,
        name: user.name,
        email: user.email ?? '',
        picture: user.avatarUrl,
        deptName: user.deptName,
        status: user.status,
      } : null}
      permissions={permCtx?.permissions ?? []}
      roles={permCtx?.roles.map(r => ({ code: r.code, name: r.name })) ?? []}
      dataScopeType={permCtx?.dataScopeType ?? 'SELF'}
    />
  );
}
