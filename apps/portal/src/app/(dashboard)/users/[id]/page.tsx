/**
 * 用户详情页 — Server Component 读模型
 *
 * 鉴权由 layout.tsx 统一处理（layout 中的 Suspense 边界已覆盖动态 API 的
 * Partial Prerendering），本组件零鉴权样板，直接 await params 即可。
 */
import { getUser } from '../data';
import { notFound } from 'next/navigation';
import { resolveIdentity, canAccessDept, getUserRoleDeptIds } from '@/lib/auth';
import { getUserPermissionContext } from '@/lib/permissions';
import { Forbidden } from '@/components/shared/forbidden';
import { ADMIN_ROLE_CODES, USER_PERMISSIONS } from '@auth-sso/contracts';
import UserDetailForm from './UserDetailForm';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function UserDetailPage({ params }: PageProps) {
  const { id } = await params;
  const identity = await resolveIdentity();
  if (!identity) notFound();
  const [user, permissionContext, deptIds] = await Promise.all([
    getUser(id),
    getUserPermissionContext(identity.userId),
    getUserRoleDeptIds(identity.userId),
  ]);
  if (!user || !canAccessDept(deptIds, user.deptId)) notFound();

  const permissions = permissionContext?.permissions ?? [];
  const isAdmin = permissionContext?.roles.some(
    (role) => (ADMIN_ROLE_CODES as readonly string[]).includes(role.code),
  ) ?? false;
  const hasPermission = (permission: string) => isAdmin || permissions.includes(permission);
  if (!hasPermission(USER_PERMISSIONS.READ)) return <Forbidden />;

  return (
    <UserDetailForm
      id={id}
      initialUser={user}
      canDelete={identity.userId !== id && hasPermission(USER_PERMISSIONS.DELETE)}
      canUpdate={hasPermission(USER_PERMISSIONS.UPDATE)}
      canAssignRole={hasPermission(USER_PERMISSIONS.ASSIGN_ROLE)}
      canResetPassword={hasPermission(USER_PERMISSIONS.RESET_PASSWORD)}
    />
  );
}
