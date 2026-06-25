import { requirePermission } from '@/lib/auth/check-permission';
import { Forbidden } from '@/components/ui/forbidden';

export default async function DashboardPageLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePermission({ permissions: ['dashboard:view'] });
  if (!auth) return <Forbidden />;
  return children;
}
