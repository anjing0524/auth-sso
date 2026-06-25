import { requirePermission } from '@/lib/auth/check-permission';
import { Forbidden } from '@/components/ui/forbidden';

export default async function DepartmentsLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePermission({ permissions: ['department:list'] });
  if (!auth) return <Forbidden />;
  return children;
}
