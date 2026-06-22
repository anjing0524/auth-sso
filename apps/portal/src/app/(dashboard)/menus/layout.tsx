import { requirePermission } from '@/lib/auth/check-permission';
import { Forbidden } from '@/components/ui/forbidden';

export default async function MenusLayout({ children }: { children: React.ReactNode }) {
  const userId = await requirePermission({ permissions: ['menu:list'] });
  if (!userId) return <Forbidden />;
  return children;
}
