import { requirePermission } from '@/lib/auth/check-permission';
import { Forbidden } from '@/components/shared/forbidden';
import { SYSTEM_PERMISSIONS } from '@auth-sso/contracts';

export default async function DashboardPageLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePermission({ permissions: [SYSTEM_PERMISSIONS.VIEW_DASHBOARD] });
  if (!auth) return <Forbidden />;
  return children;
}
