import { requirePermission } from '@/lib/auth/check-permission';
import { Forbidden } from '@/components/ui/forbidden';
import { DEPARTMENT_PERMISSIONS } from '@auth-sso/contracts';

export default async function DepartmentsLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePermission({ permissions: [DEPARTMENT_PERMISSIONS.LIST] });
  if (!auth) return <Forbidden />;
  return children;
}
