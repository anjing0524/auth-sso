/**
 * 用户管理页面 - Server Component 读模型入口
 *
 * 鉴权由 layout.tsx 统一处理，本组件零鉴权样板，专注数据获取与渲染。
 */
import { resolveIdentity } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { clampPage } from '@/lib/pagination';
import { getUsers, getDepartmentOptions } from './data';
import { db } from '@/infrastructure/db';
import UserFilters from './components/UserFilters';
import CreateUserDialog from './components/CreateUserDialog';
import UserTable from './components/UserTable';

import { PageHeader } from '@/components/shared/page-header';
import { TableToolbar } from '@/components/shared/table-toolbar';

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
  const page = clampPage(params.page);
  const pageSize = 15;

  // 鉴权由 users/layout.tsx 负责（requirePermission(['user:list'])），此处只取身份信息。
  const identity = await resolveIdentity();
  const scope = identity ? await resolveScope(db, identity.userId) : { deptIds: [] };
  const userId = identity?.userId ?? '';
  const [{ data: users, pagination }, departments] = await Promise.all([
    getUsers(scope, userId, { page, pageSize, keyword, status }),
    getDepartmentOptions(scope),
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeader
        icon="Users"
        title="用户管理"
        description="查看和管理系统内的所有用户账户及权限。"
      />

      <UserTable
        users={users}
        pagination={pagination}
        filters={
          <TableToolbar
            left={<UserFilters key={keyword} initialKeyword={keyword} initialStatus={status} />}
            right={<CreateUserDialog departments={departments} />}
          />
        }
      />
    </div>
  );
}
