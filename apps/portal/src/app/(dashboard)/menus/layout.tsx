import { Forbidden } from '@/components/shared/forbidden';
import { requirePermission } from '@/lib/auth/check-permission';
import { PORTAL_MENU_PERMISSIONS } from '@auth-sso/contracts';

export default async function MenusLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePermission({ permissions: [PORTAL_MENU_PERMISSIONS.LIST] });
  if (!auth) return <Forbidden />;
  return children;
}
