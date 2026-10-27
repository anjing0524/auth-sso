/**
 * 用户详情页 — Server Component 读模型
 *
 * 鉴权由 layout.tsx 统一处理（LIST 权限）；**数据范围由读口在 SQL 内施加**：
 * 范围外与不存在的用户同形，一律 notFound()，不用状态码区分存在性（ADR-014 第 3 步）。
 *
 * 此前这里直接调 `getUser(id)`——那个读口没有范围参数，于是改 URL 里的 id
 * 即可跨部门读取任意用户详情（H-ACL-002 / P0）。
 */
import { notFound } from 'next/navigation';
import { USER_PERMISSIONS, can } from '@auth-sso/contracts';

import { PermissionGate } from '@/components/layout/permission-gate';
import { resolveIdentity } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { db } from '@/infrastructure/db';
import { getUser, getDepartmentOptions } from '../data';
import { isUuid } from '@/lib/uuid';
import { getUserPermissionContext, toPermissionContextOrNull } from '@/lib/permissions';
import UserDetailForm from './UserDetailForm';


/**
 * 该路由读取会话/动态数据，**保留服务端阻塞**（Cache Components 的 instant 导航校验）。
 * 依据 Next 16 文档：启用 cacheComponents 后，读 session 的路由需显式声明；
 * 否则 Turbopack 运行时会报 "encountered uncached data during prerendering or a navigation"。
 */
export const instant = false;
export const metadata = { title: '用户详情 | Auth-SSO' };
interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function UserDetailPage({ params }: PageProps) {
  const { id } = await params;
  // 非 UUID 直接 404：否则会以 22P02 的形式炸在数据库层
  if (!isUuid(id)) notFound();

  const identity = await resolveIdentity();
  const scope = identity ? await resolveScope(db, identity.userId) : { deptIds: [] };

  const [user, departments] = await Promise.all([getUser(id, scope), getDepartmentOptions(scope)]);
  if (!user) notFound();

  const permCtx = identity ? toPermissionContextOrNull(await getUserPermissionContext(identity.userId)) : null;
  const canUpdate = can(
    { roleCodes: permCtx?.roles.map((r) => r.code) ?? [], permissionCodes: permCtx?.permissions ?? [] },
    USER_PERMISSIONS.UPDATE,
  );

  // 详情页要求 user:read（LIST 只允许看列表）：只有 list 的角色不能靠改 URL 读取他人详情。
  return (
    <PermissionGate options={{ permissions: [USER_PERMISSIONS.READ] }}>
      <UserDetailForm id={id} initialUser={user} canUpdate={canUpdate} isSelf={identity?.userId === id} departments={departments} />
    </PermissionGate>
  );
}
