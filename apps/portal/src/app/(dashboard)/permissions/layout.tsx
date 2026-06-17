import { requirePermission } from '@/lib/auth/require-permission';
import { Forbidden } from '@/components/ui/forbidden';

export default async function PermissionsLayout({ children }: { children: React.ReactNode }) {
  const userId = await requirePermission({ permissions: ['permission:list'] });
  if (!userId) return <Forbidden />;
  return children;
}
