import { requirePermission } from '@/lib/auth/check-permission';
import { Forbidden } from '@/components/ui/forbidden';
import { CLIENT_PERMISSIONS } from '@auth-sso/contracts';

export default async function ClientsLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePermission({ permissions: [CLIENT_PERMISSIONS.LIST] });
  if (!auth) return <Forbidden />;
  return children;
}
