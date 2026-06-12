/**
 * 用户管理页面 - React 19 & Next.js App Router 重构版
 * 
 * 职责分工：
 * - 本组件为 Server Component，负责提取 URL Query 并触发服务端数据拉取 Promise。
 * - 用 Suspense + 骨架屏提升页面初次加载体验。
 * - 将子交互与过滤状态分别解耦到 components/ 下的局部组件中。
 */

import React, { Suspense } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { getUsers, getDepartments } from './actions';
import UserFilters from './components/UserFilters';
import CreateUserDrawer from './components/CreateUserDrawer';
import UserTable, { UserTableSkeleton } from './components/UserTable';

interface PageProps {
  searchParams: Promise<{
    page?: string;
    keyword?: string;
    status?: string;
  }>;
}

export default async function UsersPage({ searchParams }: PageProps) {
  // 1. 异步读取 URL 查询参数（Next.js App Router 最佳实践）
  const params = await searchParams;
  const keyword = params.keyword || '';
  const status = params.status || 'ALL';
  const page = parseInt(params.page || '1', 10);
  const pageSize = 15; // 固定单页 15 条数据

  // 2. 发起数据获取的 Promise (不加 await，允许并行拉取并传递给 Client 挂起渲染)
  const usersPromise = getUsers({
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
        
        {/* 新建用户 Drawer：支持 React 19 表单 Action */}
        <CreateUserDrawer departments={departments} />
      </div>

      {/* 核心卡片容器：上层过滤，下层数据 */}
      <Card className="flex-1 border-none shadow-sm ring-1 ring-border/50 overflow-hidden rounded-[1.5rem] flex flex-col bg-white">
        <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 py-4 px-6 border-b">
          {/* 筛选过滤组件 */}
          <UserFilters initialKeyword={keyword} initialStatus={status} />
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-auto flex flex-col">
          {/* 异步边界：在数据 Promise 尚未 resolve 时渲染骨架屏 */}
          <Suspense fallback={<UserTableSkeleton />}>
            <UserTable dataPromise={usersPromise} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
