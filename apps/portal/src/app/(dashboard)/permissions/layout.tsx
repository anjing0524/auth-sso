import { requirePermission } from '@/lib/auth/check-permission';
import { Forbidden } from '@/components/shared/forbidden';
import { PERMISSION_PERMISSIONS } from '@auth-sso/contracts';

export default async function PermissionsLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePermission({ permissions: [PERMISSION_PERMISSIONS.LIST] });
  if (!auth) return <Forbidden />;
  return children;
}
