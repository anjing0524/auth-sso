import { requirePermission } from '@/lib/auth/check-permission';
import { Forbidden } from '@/components/ui/forbidden';

export default async function PermissionsLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePermission({ permissions: ['permission:list'] });
  if (!auth) return <Forbidden />;
  return children;
}
