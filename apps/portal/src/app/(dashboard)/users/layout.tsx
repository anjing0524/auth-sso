import { requirePermission } from '@/lib/auth/require-permission';
import { Forbidden } from '@/components/ui/forbidden';

export default async function UsersLayout({ children }: { children: React.ReactNode }) {
  const userId = await requirePermission({ permissions: ['user:list'] });
  if (!userId) return <Forbidden />;
  return children;
}
