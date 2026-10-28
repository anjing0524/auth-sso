/**
 * 角色管理页面 — Server Component 读模型入口
 * 写操作通过 Server Actions (actions.ts) 执行
 */
import { redirect } from 'next/navigation';
import { getRoles, getRoleBoundUserCounts, getRolePermissionCounts } from './data';
import { ENTITY_STATUS_VALUES, ROLE_PERMISSIONS, can } from '@auth-sso/contracts';
import { db } from '@/infrastructure/db';
import { getDepartmentOptions } from '@/app/(dashboard)/users/data';
import { resolveIdentity } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { getUserPermissionContext, toPermissionContextOrNull } from '@/lib/permissions';
import { clampPage } from '@/lib/pagination';
import { isUuid } from '@/lib/uuid';
import RolesTable from './components/RolesTable';


/**
 * 该路由读取会话/动态数据，**保留服务端阻塞**（Cache Components 的 instant 导航校验）。
 * 依据 Next 16 文档：启用 cacheComponents 后，读 session 的路由需显式声明；
 * 否则 Turbopack 运行时会报 "encountered uncached data during prerendering or a navigation"。
 */
export const instant = false;
export const metadata = { title: '角色管理 | Auth-SSO' };
interface PageProps {
  searchParams: Promise<{
    page?: string;
    keyword?: string;
    sort?: string;
    status?: string;
    deptId?: string;
    pageSize?: string;
    create?: string;
  }>;
}

export default async function RolesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = clampPage(params.page);
  const pageSize = [20, 50, 100].includes(Number(params.pageSize)) ? Number(params.pageSize) : 20;
  const keyword = params.keyword || '';
  const sort = params.sort === 'permissions-asc' || params.sort === 'permissions-desc' ? params.sort : undefined;
  const status = (ENTITY_STATUS_VALUES as readonly string[]).includes(params.status ?? '') ? params.status! : '';
  const deptId = params.deptId && isUuid(params.deptId) ? params.deptId : '';

  // 鉴权由 roles/layout.tsx 负责（requirePermission(['role:list'])），此处只取身份信息。
  const identity = await resolveIdentity();
  const scope = identity ? await resolveScope(db, identity.userId) : { deptIds: [] };
  const permCtx = identity ? toPermissionContextOrNull(await getUserPermissionContext(identity.userId)) : null;
  const canCreateRole = can(
    { roleCodes: permCtx?.roles.map((r) => r.code) ?? [], permissionCodes: permCtx?.permissions ?? [] },
    ROLE_PERMISSIONS.CREATE,
  );

  const [{ data: roles, pagination }, departments] = await Promise.all([
    getRoles({ page, pageSize, keyword, status, scope, ...(sort ? { sort } : {}), ...(deptId ? { deptId } : {}) }),
    getDepartmentOptions(scope),
  ]);
  if (pagination.totalPages > 0 && page > pagination.totalPages) {
    const q = new URLSearchParams();
    if (keyword) q.set('keyword', keyword);
    if (status) q.set('status', status);
    if (sort) q.set('sort', sort);
    if (deptId) q.set('deptId', deptId);
    if (pageSize !== 20) q.set('pageSize', String(pageSize));
    q.set('page', String(pagination.totalPages));
    redirect(`/roles?${q.toString()}`);
  }
  // 删除确认的影响面（U-ROLES03）：只统计当前页角色，避免全表聚合
  const boundUserCounts = await getRoleBoundUserCounts(roles.map((r) => r.id));
  const permissionCounts = await getRolePermissionCounts(roles.map((r) => r.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <RolesTable
        roles={roles}
        pagination={pagination}
        initialKeyword={keyword}
        initialSort={sort ?? 'default'}
        initialStatus={status}
        initialDeptId={deptId}
        autoOpenCreate={canCreateRole && params.create === '1'}
        departments={departments}
        boundUserCounts={boundUserCounts}
        permissionCounts={permissionCounts}
      />
    </div>
  );
}
