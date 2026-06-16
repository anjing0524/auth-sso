/**
 * 用户管理页面 - BFF CQRS 架构落地版
 * 
 * 职责分工：
 * - 本组件为 Server Component 读模型入口，直接在服务端调用普通获取函数拉取数据，同步直传渲染。
 * - 客户端子组件通过 Server Actions (actions.ts) 薄 Controller 执行状态改变，实现高内聚开发。
 */

import { headers } from 'next/headers';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { checkPermission } from '@/lib/auth';
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

export default async function UsersPage({ searchParams }: PageProps) {
  // 0. 鉴权：缓存作用域外完成身份校验与权限检查（R10 / §3.6）
  const auth = await checkPermission(await headers(), { permissions: ['user:list'] });
  if (!auth.authorized || !auth.userId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-red-500">未授权访问或权限不足</p>
      </div>
    );
  }

  // 1. 异步读取 URL 查询参数（Next.js App Router 最佳实践）
  const params = await searchParams;
  const keyword = params.keyword || '';
  const status = params.status || 'ALL';
  const page = parseInt(params.page || '1', 10);
  const pageSize = 15; // 固定单页 15 条

  // 2. 读模型：服务端直接拉取扁平的数据对象 (不做冗余的领域实体转换，保证首屏性能)
  const { data: users, pagination } = await getUsers(auth.userId, {
    page,
    pageSize,
    keyword,
    status,
  });

  // 3. 服务端并行预获取部门数据，供新增表单使用
  const departments = await getDepartments();

  return (
    <div className="h-full flex flex-col gap-6 pb-10">
      {/* 头部区块 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">用户管理</h1>
          <p className="text-muted-foreground text-sm font-medium text-slate-500 mt-1">
            查看和管理系统内的所有用户账户及权限。
          </p>
        </div>
        
        {/* 新建用户 Drawer：支持 React 19 表单 Action 网关 */}
        <CreateUserDrawer departments={departments} />
      </div>

      {/* 核心卡片容器 */}
      <Card className="flex-1 border-none shadow-sm ring-1 ring-border/50 overflow-hidden rounded-[1.5rem] flex flex-col bg-white">
        <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 py-4 px-6 border-b">
          {/* 筛选过滤组件 */}
          <UserFilters initialKeyword={keyword} initialStatus={status} />
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-auto flex flex-col">
          {/* 同步直出表格，数据流清晰透明 */}
          <UserTable users={users} pagination={pagination} />
        </CardContent>
      </Card>
    </div>
  );
}
