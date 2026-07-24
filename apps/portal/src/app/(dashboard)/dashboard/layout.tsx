import { requirePermission } from '@/lib/auth/check-permission';
import { Forbidden } from '@/components/shared/forbidden';
import { PORTAL_MENU_PERMISSIONS } from '@auth-sso/contracts';

export default async function DashboardPageLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePermission({ permissions: [PORTAL_MENU_PERMISSIONS.DASHBOARD] });
  if (!auth) return <Forbidden />;
  return children;
}
