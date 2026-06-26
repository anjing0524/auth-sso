/**
 * 用户管理页面 - Server Component 读模型入口
 *
 * 鉴权由 layout.tsx 统一处理，本组件零鉴权样板，专注数据获取与渲染。
 */
import { resolveIdentity } from '@/lib/auth';
import { getUsers, getDepartments } from './data';
import UserFilters from './components/UserFilters';
import CreateUserDialog from './components/CreateUserDialog';
import UserTable from './components/UserTable';

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
  const status = params.status || 'ALL';
  const page = parseInt(params.page || '1', 10);
  const pageSize = 15;

  // 鉴权由 users/layout.tsx 负责（requirePermission(['user:list'])），此处只取身份信息。
  // deptIds 来自 JWT claims（已含子树展开），无需额外 DB 查询。
  const identity = await resolveIdentity();
  const deptIds = identity?.claims.deptIds ?? [];
  const userId = identity?.userId ?? '';
  const [{ data: users, pagination }, departments] = await Promise.all([
    getUsers(deptIds, userId, { page, pageSize, keyword, status }),
    getDepartments(),
  ]);

  return (
    <div className="h-full flex flex-col gap-6 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">用户管理</h1>
          <p className="text-muted-foreground text-sm font-medium mt-1">
            查看和管理系统内的所有用户账户及权限。
          </p>
        </div>
        <CreateUserDialog departments={departments} />
      </div>

      <UserTable
        users={users}
        pagination={pagination}
        filters={<UserFilters key={keyword} initialKeyword={keyword} initialStatus={status} />}
      />
    </div>
  );
}
