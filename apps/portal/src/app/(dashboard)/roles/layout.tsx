import { requirePermission } from '@/lib/auth/check-permission';
import { Forbidden } from '@/components/ui/forbidden';
import { ROLE_PERMISSIONS } from '@auth-sso/contracts';

export default async function RolesLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePermission({ permissions: [ROLE_PERMISSIONS.LIST] });
  if (!auth) return <Forbidden />;
  return children;
}
