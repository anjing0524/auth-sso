/**
 * 用户管理页面 - 纯 API / 前后端分离友好重构版
 * 
 * 职责分工：
 * - 本组件为 Server Component，在服务端通过普通查库函数（或未来改后台语言后的 fetch API）获取数据。
 * - 服务端就绪数据后直出渲染，子组件全量采用标准客户端 API (fetch) 进行状态交互，完全移除 Server Actions 绑定。
 */

import React from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
  // 1. 异步读取 URL 查询参数以驱动过滤
  const params = await searchParams;
  const keyword = params.keyword || '';
  const status = params.status || 'ALL';
  const page = parseInt(params.page || '1', 10);
  const pageSize = 15; // 固定单页 15 条

  // 2. 阻塞拉取首屏数据（如果将来改成 Go/Java 后台，只需将此处改为 `fetch('https://api/users')`）
  const { data: users, pagination } = await getUsers({
    page,
    pageSize,
    keyword,
    status,
  });

  // 3. 并行拉取部门列表，供表单下拉选择
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
        
        {/* 新建用户 Drawer：支持传统客户端 API 提交 */}
        <CreateUserDrawer departments={departments} />
      </div>

      {/* 核心卡片容器 */}
      <Card className="flex-1 border-none shadow-sm ring-1 ring-border/50 overflow-hidden rounded-[1.5rem] flex flex-col bg-white">
        <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 py-4 px-6 border-b">
          {/* 筛选过滤组件 */}
          <UserFilters initialKeyword={keyword} initialStatus={status} />
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-auto flex flex-col">
          {/* 同步直出表格，数据流透明易维护 */}
          <UserTable users={users} pagination={pagination} />
        </CardContent>
      </Card>
    </div>
  );
}
