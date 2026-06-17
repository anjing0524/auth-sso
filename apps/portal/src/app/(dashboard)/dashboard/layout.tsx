import { requirePermission } from '@/lib/auth/require-permission';
import { Forbidden } from '@/components/ui/forbidden';

export default async function DashboardPageLayout({ children }: { children: React.ReactNode }) {
  const userId = await requirePermission({ permissions: ['dashboard:view'] });
  if (!userId) return <Forbidden />;
  return children;
}
