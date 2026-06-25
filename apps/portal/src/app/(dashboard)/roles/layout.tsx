import { requirePermission } from '@/lib/auth/check-permission';
import { Forbidden } from '@/components/ui/forbidden';

export default async function RolesLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePermission({ permissions: ['role:list'] });
  if (!auth) return <Forbidden />;
  return children;
}
