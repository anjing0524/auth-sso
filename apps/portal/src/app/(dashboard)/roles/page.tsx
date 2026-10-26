/**
 * 角色管理页面 — Server Component 读模型入口
 * 写操作通过 Server Actions (actions.ts) 执行
 */
import { getRoles, getRoleBoundUserCounts, getRolePermissionCounts } from './data';
import { db } from '@/infrastructure/db';
import { getDepartmentOptions } from '@/app/(dashboard)/users/data';
import { resolveIdentity } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { clampPage } from '@/lib/pagination';
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
  }>;
}

export default async function RolesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = clampPage(params.page);
  const keyword = params.keyword || '';
  const sort = params.sort === 'permissions-asc' || params.sort === 'permissions-desc' ? params.sort : undefined;

  // 鉴权由 roles/layout.tsx 负责（requirePermission(['role:list'])），此处只取身份信息。
  const identity = await resolveIdentity();
  const scope = identity ? await resolveScope(db, identity.userId) : { deptIds: [] };

  const [{ data: roles, pagination }, departments] = await Promise.all([
    getRoles({ page, pageSize: 20, keyword, status: '', scope, ...(sort ? { sort } : {}) }),
    getDepartmentOptions(scope),
  ]);
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
        departments={departments}
        boundUserCounts={boundUserCounts}
        permissionCounts={permissionCounts}
      />
    </div>
  );
}
