/**
 * 新建用户页面（长表单页面化）
 *
 * 产品规则：需要滚动的长表单应页面化，不再塞进弹窗（UX-GUIDELINES §3.3）。
 */
import { redirect } from 'next/navigation';
import { USER_PERMISSIONS, can } from '@auth-sso/contracts';
import { db } from '@/infrastructure/db';
import { resolveIdentity } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { getUserPermissionContext, toPermissionContextOrNull } from '@/lib/permissions';
import { getDepartmentOptions } from '../data';
import { safeReturnPath } from '@/lib/safe-return';
import { PageHeader } from '@/components/shared/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { CreateUserForm } from '../components/CreateUserForm';

export const instant = false;
export const metadata = { title: '新建用户 | Auth-SSO' };

interface PageProps {
  searchParams: Promise<{ returnTo?: string; deptId?: string }>;
}

export default async function NewUserPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const identity = await resolveIdentity();
  if (!identity) redirect('/login');

  const scope = await resolveScope(db, identity.userId);
  const permCtx = toPermissionContextOrNull(await getUserPermissionContext(identity.userId));
  const subject = { roleCodes: permCtx?.roles.map((r) => r.code) ?? [], permissionCodes: permCtx?.permissions ?? [] };
  if (!can(subject, USER_PERMISSIONS.CREATE)) redirect('/users');

  const departments = await getDepartmentOptions(scope);
  const returnHref = safeReturnPath(params.returnTo, '/users', '/users');
  const initialDeptId = params.deptId && departments.some((d) => d.id === params.deptId) ? params.deptId : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
      <PageHeader title="新建用户" description="创建后请把登录邮箱告知用户；新用户默认无角色。" backHref={returnHref} />
      <Card className="mx-auto w-full max-w-2xl">
        <CardContent className="p-4 sm:p-6">
          <CreateUserForm
            departments={departments}
            canAssignRole={can(subject, USER_PERMISSIONS.ASSIGN_ROLE)}
            initialDeptId={initialDeptId}
            successHref={returnHref}
            cancelHref={returnHref}
          />
        </CardContent>
      </Card>
    </div>
  );
}
