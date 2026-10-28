/**
 * 编辑权限页（由弹窗改为页面；与新建共用 PermissionForm）
 */
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { PERMISSION_PERMISSIONS } from '@auth-sso/contracts';

import { PermissionGate } from '@/components/layout/permission-gate';
import { isUuid } from '@/lib/uuid';
import { safeReturnPath } from '@/lib/safe-return';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/infrastructure/db';
import { getPermissions, getClientOptions } from '../../data';
import PermissionForm from '../../permission-form';

export const instant = false;
export const metadata = { title: '编辑权限 | Auth-SSO' };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditPermissionPage({ params, searchParams }: PageProps & { searchParams: Promise<{ returnTo?: string }> }) {
  await connection();
  const raw = (await searchParams).returnTo;
  const returnHref = safeReturnPath(raw, '/permissions', '/permissions');
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [all, clients] = await Promise.all([getPermissions(), getClientOptions()]);
  const permission = await db.query.permissions.findFirst({
    where: eq(schema.permissions.id, id),
  });
  if (!permission) notFound();
  const menuOptions = all
    .filter((p) => p.type === 'DIRECTORY' || p.type === 'PAGE')
    .map((p) => ({ id: p.id, name: p.name, type: p.type, parentId: p.parentId ?? null }));

  return (
    <PermissionGate options={{ permissions: [PERMISSION_PERMISSIONS.UPDATE] }}>
      <PermissionForm
        mode="edit"
        menuOptions={menuOptions}
        permission={{
          id: permission.id,
          name: permission.name,
          code: permission.code,
          type: permission.type,
          description: permission.description,
          path: permission.path,
          icon: permission.icon,
          visible: permission.visible,
          parentId: permission.parentId,
          sort: permission.sort,
          status: permission.status,
          clientId: permission.clientId,
        }}
        clients={clients}
        returnHref={returnHref}
      />
    </PermissionGate>
  );
}
