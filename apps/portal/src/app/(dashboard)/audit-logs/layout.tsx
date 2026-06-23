import { requirePermission } from '@/lib/auth/check-permission';
import { Forbidden } from '@/components/ui/forbidden';

export default async function AuditLogsLayout({ children }: { children: React.ReactNode }) {
  const userId = await requirePermission({ permissions: ['audit:read'] });
  if (!userId) return <Forbidden />;
  return children;
}
