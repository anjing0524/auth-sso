import { requirePermission } from '@/lib/auth/check-permission';
import { Forbidden } from '@/components/ui/forbidden';

export default async function AuditLogsLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePermission({ permissions: ['audit:read'] });
  if (!auth) return <Forbidden />;
  return children;
}
