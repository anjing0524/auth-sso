import { requirePermission } from '@/lib/auth/check-permission';
import { Forbidden } from '@/components/ui/forbidden';

export default async function UsersLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePermission({ permissions: ['user:list'] });
  if (!auth) return <Forbidden />;
  return children;
}
