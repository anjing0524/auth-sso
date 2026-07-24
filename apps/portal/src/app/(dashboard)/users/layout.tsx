import { requirePermission } from '@/lib/auth/check-permission';
import { Forbidden } from '@/components/shared/forbidden';
import { USER_PERMISSIONS } from '@auth-sso/contracts';

export default async function UsersLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePermission({ permissions: [USER_PERMISSIONS.LIST] });
  if (!auth) return <Forbidden />;
  return children;
}
