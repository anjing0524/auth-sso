import { requirePermission } from '@/lib/auth/check-permission';
import { Forbidden } from '@/components/shared/forbidden';
import { AUDIT_PERMISSIONS } from '@auth-sso/contracts';

export default async function AuditLogsLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePermission({ permissions: [AUDIT_PERMISSIONS.READ] });
  if (!auth) return <Forbidden />;
  return children;
}
