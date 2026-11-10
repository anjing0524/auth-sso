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
import { PAGE_TITLES } from '@/lib/route-titles';
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
    // 表单自带居中卡片（CreateUserForm 内渲染 Card），这里不再重复包一层
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <PageHeader title={PAGE_TITLES.NEW_USER} description="创建后请把登录邮箱告知用户；新用户默认无角色。" backHref={returnHref} />
      <CreateUserForm
        departments={departments}
        canAssignRole={can(subject, USER_PERMISSIONS.ASSIGN_ROLE)}
        initialDeptId={initialDeptId}
        successHref={returnHref}
        cancelHref={returnHref}
      />
    </div>
  );
}
