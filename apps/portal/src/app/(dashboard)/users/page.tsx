/**
 * 用户管理页面 - Server Component 读模型入口
 *
 * 鉴权由 layout.tsx 统一处理，本组件零鉴权样板，专注数据获取与渲染。
 */
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { requirePermission } from '@/lib/auth/check-permission';
import { getUserRoleDeptIds } from '@/lib/auth';
import { getUsers, getDepartments } from './data';
import UserFilters from './components/UserFilters';
import CreateUserDrawer from './components/CreateUserDrawer';
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

  // requirePermission 由 React.cache 去重，layout 已调用过，此处零额外开销
  const userId = (await requirePermission({ permissions: ['user:list'] }))!;
  const deptIds = await getUserRoleDeptIds(userId);
  const [{ data: users, pagination }, departments] = await Promise.all([
    getUsers(deptIds, userId, { page, pageSize, keyword, status }),
    getDepartments(),
  ]);

  return (
    <div className="h-full flex flex-col gap-6 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">用户管理</h1>
          <p className="text-muted-foreground text-sm font-medium text-slate-500 mt-1">
            查看和管理系统内的所有用户账户及权限。
          </p>
        </div>
        <CreateUserDrawer departments={departments} />
      </div>

      <Card className="flex-1 border-none shadow-sm ring-1 ring-border/50 overflow-hidden rounded-[1.5rem] flex flex-col bg-white">
        <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 py-4 px-6 border-b">
          <UserFilters key={keyword} initialKeyword={keyword} initialStatus={status} />
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-auto flex flex-col">
          <UserTable users={users} pagination={pagination} />
        </CardContent>
      </Card>
    </div>
  );
}
