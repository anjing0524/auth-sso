/**
 * 用户角色分配页 — Server Component 入口
 *
 * 权限门禁：`user:assign_role`。数据范围由读口（getUser + scope）施加：
 * 范围外与不存在同形 → notFound()（ADR-014 第 3 步）。
 */
import { notFound } from 'next/navigation';
import { USER_PERMISSIONS } from '@auth-sso/contracts';

import { db } from '@/infrastructure/db';
import { resolveIdentity } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { isUuid } from '@/lib/uuid';
import { getUser } from '../../data';
import { PermissionGate } from '@/components/layout/permission-gate';

import UserRolesPage from './roles-client';

export const instant = false;
export const metadata = { title: '分配角色 | Auth-SSO' };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function UserRolesRoute({ params }: PageProps) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const identity = await resolveIdentity();
  const scope = identity ? await resolveScope(db, identity.userId) : { deptIds: [] };
  const user = await getUser(id, scope);
  if (!user) notFound();

  return (
    <PermissionGate options={{ permissions: [USER_PERMISSIONS.ASSIGN_ROLE] }}>
      <UserRolesPage
        user={{
          id: user.id,
          name: user.name,
          deptId: (user.deptId as string | null) ?? null,
          deptName: (user.deptName as string | null) ?? null,
        }}
      />
    </PermissionGate>
  );
}
