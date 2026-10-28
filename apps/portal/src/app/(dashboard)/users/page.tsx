/**
 * 用户管理页面 - Server Component 读模型入口
 *
 * 鉴权由 layout.tsx 统一处理，本组件零鉴权样板，专注数据获取与渲染。
 */
import { redirect } from 'next/navigation';
import { USER_PERMISSIONS, can } from '@auth-sso/contracts';
import { resolveIdentity } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { clampPage } from '@/lib/pagination';
import { getUsers, getDepartmentOptions } from './data';
import { isUuid } from '@/lib/uuid';
import { db } from '@/infrastructure/db';
import UserFilters from './components/UserFilters';
import CreateUserDialog from './components/CreateUserDialog';
import UserTable from './components/UserTable';

import { TableToolbar } from '@/components/shared/table-toolbar';
import { getUserPermissionContext, toPermissionContextOrNull } from '@/lib/permissions';

/**
 * 该路由读取会话/动态数据，**保留服务端阻塞**（Cache Components 的 instant 导航校验）。
 * 依据 Next 16 文档：启用 cacheComponents 后，读 session 的路由需显式声明；
 * 否则 Turbopack 运行时会报 "encountered uncached data during prerendering or a navigation"。
 */
export const instant = false;
interface PageProps {
  searchParams: Promise<{
    page?: string;
    keyword?: string;
    status?: string;
    deptId?: string;
    noRole?: string;
    create?: string;
  }>;
}

export const metadata = { title: '用户管理 | Auth-SSO' };

export default async function UsersPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const keyword = params.keyword || '';
  // 非法 status 不能下沉到数据库：users.status 是 PG enum，非法值会触发 22P02（实测 500）
  const status = (['ALL', 'ACTIVE', 'DISABLED', 'LOCKED'] as const).includes(params.status as never)
    ? (params.status as string)
    : 'ALL';
  // 部门筛选：非 UUID 直接忽略（不得下沉到 PG uuid 比较）
  const deptId = params.deptId && isUuid(params.deptId) ? params.deptId : undefined;
  const noRole = params.noRole === '1';
  const page = clampPage(params.page);
  const pageSize = 20;

  // 鉴权由 users/layout.tsx 负责（requirePermission(['user:list'])），此处只取身份信息。
  const identity = await resolveIdentity();
  const scope = identity ? await resolveScope(db, identity.userId) : { deptIds: [] };
  const userId = identity?.userId ?? '';
  // 批量操作入口按 user:update 渲染；无权限时不显示多选列（服务端仍二次校验）
  const permCtx = identity ? toPermissionContextOrNull(await getUserPermissionContext(identity.userId)) : null;
  const subject = { roleCodes: permCtx?.roles.map((r) => r.code) ?? [], permissionCodes: permCtx?.permissions ?? [] };
  const canUpdate = can(subject, USER_PERMISSIONS.UPDATE);
  const canAssignRole = can(subject, USER_PERMISSIONS.ASSIGN_ROLE);
  const canCreateUser = can(subject, USER_PERMISSIONS.CREATE);
  const [{ data: users, pagination }, departments] = await Promise.all([
    getUsers(scope, userId, { page, pageSize, keyword, status, ...(deptId ? { deptId } : {}), ...(noRole ? { noRole } : {}) }),
    getDepartmentOptions(scope),
  ]);

  // U-U02/U-G02：越界直链（?page=999）此前渲染"暂无用户/系统中还没有用户账号"的误导空态。
  // 在服务端钳制到最后一个有效页（保留筛选），URL 与内容一致；总数为 0 时保持第 1 页空态。
  if (pagination.totalPages > 0 && page > pagination.totalPages) {
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    if (status !== 'ALL') params.set('status', status);
    if (deptId) params.set('deptId', deptId);
    if (noRole) params.set('noRole', '1');
    params.set('page', String(pagination.totalPages));
    redirect(`/users?${params.toString()}`);
  }

  // U-G02：区分"系统无数据"与"筛选/搜索无结果"，后者给"清除筛选"出口。
  const isFiltered = keyword.length > 0 || status !== 'ALL' || Boolean(deptId) || noRole;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <UserTable
              currentUserId={userId}
        users={users}
        pagination={pagination}
        canUpdate={canUpdate}
        isFiltered={isFiltered}
        clearHref="/users"
        filters={
          <TableToolbar
            className="md:items-start"
            left={
              <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-start md:gap-3">
                <h1 className="shrink-0 text-[15px] font-semibold tracking-tight text-foreground">用户管理</h1>
                <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:flex-wrap md:items-center md:gap-2">
                <UserFilters
                  key={`${keyword}-${status}-${deptId ?? 'ALL'}-${noRole}`}
                  initialKeyword={keyword}
                  initialStatus={status}
                  initialDeptId={deptId ?? 'ALL'}
                  initialNoRole={noRole ? 'NONE' : 'ALL'}
                  departments={departments}
                />
                </div>
              </div>
            }
            right={<CreateUserDialog departments={departments} canAssignRole={canAssignRole} autoOpen={canCreateUser && params.create === '1'} />}
          />
        }
      />
    </div>
  );
}
