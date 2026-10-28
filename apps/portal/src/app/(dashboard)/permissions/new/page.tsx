/**
 * 新建权限页（由弹窗改为页面：弹窗不允许滚动，8 字段表单在 600px 视口放不下）
 */
import { connection } from 'next/server';
import { PERMISSION_PERMISSIONS } from '@auth-sso/contracts';

import { PermissionGate } from '@/components/layout/permission-gate';
import { getPermissions, getClientOptions } from '../data';
import PermissionForm from '../permission-form';

export const instant = false;
export const metadata = { title: '新建权限 | Auth-SSO' };

export default async function NewPermissionPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; type?: string; clientId?: string }> }) {
  await connection();
  const params = await searchParams;
  const raw = params.returnTo;
  const returnHref = raw && raw.startsWith('/permissions') && !raw.startsWith('//') ? raw : '/permissions';
  const [all, clients] = await Promise.all([getPermissions(), getClientOptions()]);
  const initialType = params.type === 'API' || params.type === 'DIRECTORY' || params.type === 'PAGE'
    ? params.type
    : undefined;
  const initialClientId = params.clientId && clients.some((c) => c.id === params.clientId)
    ? params.clientId
    : undefined;
  const menuOptions = all
    .filter((p) => p.type === 'DIRECTORY' || p.type === 'PAGE')
    .map((p) => ({ id: p.id, name: p.name, type: p.type, parentId: p.parentId ?? null }));

  return (
    <PermissionGate options={{ permissions: [PERMISSION_PERMISSIONS.CREATE] }}>
      <PermissionForm mode="create" menuOptions={menuOptions} clients={clients} returnHref={returnHref} initialType={initialType} initialClientId={initialClientId} />
    </PermissionGate>
  );
}
