/**
 * 角色权限配置页 — Server Component 入口
 *
 * 权限门禁：`role:assign_permission`（此前是行内弹窗，靠 Server Action 的服务端校验兜底；
 * 页面化后补路由级门禁，且不再有"弹窗内容 > 一屏"的问题）。ADR 依据：
 * ADR-019（Controller 只做编排）与「单控制器原则」——本页只读取角色身份，权限数据由
 * 既有 REST 读口提供（与写编排共用同一 Server Action）。
 */
import { notFound } from 'next/navigation';
import { ROLE_PERMISSIONS } from '@auth-sso/contracts';
import { eq } from 'drizzle-orm';

import { db, schema } from '@/infrastructure/db';
import { isUuid } from '@/lib/uuid';
import { PermissionGate } from '@/components/layout/permission-gate';

import RolePermissionsPage from './permissions-client';

export const instant = false;
export const metadata = { title: '配置角色权限 | Auth-SSO' };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function RolePermissionsRoute({ params }: PageProps) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const role = await db.query.roles.findFirst({
    where: eq(schema.roles.id, id),
    columns: { id: true, name: true, isSystem: true },
  });
  if (!role) notFound();

  return (
    <PermissionGate options={{ permissions: [ROLE_PERMISSIONS.ASSIGN_PERMISSION] }}>
      <RolePermissionsPage
        role={{ id: role.id, name: role.name, isSystem: role.isSystem ?? false }}
      />
    </PermissionGate>
  );
}
