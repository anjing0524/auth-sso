/**
 * 角色管理页面 — Server Component 读模型入口
 * 写操作通过 Server Actions (actions.ts) 执行
 */
import { headers } from 'next/headers';
import { ShieldCheck } from 'lucide-react';
import { checkPermission } from '@/lib/auth';
import { getRoles } from './data';
import RolesTable from './components/RolesTable';

interface PageProps {
  searchParams: Promise<{
    page?: string;
    keyword?: string;
  }>;
}

export default async function RolesPage({ searchParams }: PageProps) {
  const auth = await checkPermission(await headers(), { permissions: ['role:list'] });
  if (!auth.authorized || !auth.userId) {
    return <div className="flex items-center justify-center h-64"><p className="text-red-500">未授权访问或权限不足</p></div>;
  }

  const params = await searchParams;
  const page = parseInt(params.page || '1', 10);
  const keyword = params.keyword || '';

  const { data: roles, pagination } = await getRoles({ page, pageSize: 10, keyword, status: '' });

  return (
    <div className="space-y-8 pb-10">
      <div className="flex items-center justify-between px-1">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <ShieldCheck className="h-8 w-8 text-primary" /> 角色管理
          </h1>
          <p className="text-muted-foreground text-sm">定义系统角色，绑定菜单权限与数据范围策略。</p>
        </div>
      </div>

      <RolesTable roles={roles} pagination={pagination} initialKeyword={keyword} />
    </div>
  );
}
