/**
 * Client 列表页面 — Server Component 读模型入口
 *
 * 职责分工：
 * - 本组件为 Server Component，服务端直取数据同步渲染
 * - ClientsTable 为 Client Component，承载浏览器交互（搜索/复制/操作菜单）
 * - 写操作通过 Server Actions (actions.ts) 执行
 */
import { headers } from 'next/headers';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { checkPermission } from '@/lib/auth';
import { getClients } from './data';
import ClientsTable from './components/ClientsTable';
import Link from 'next/link';

interface PageProps {
  searchParams: Promise<{
    keyword?: string;
  }>;
}

export default async function ClientsPage({ searchParams }: PageProps) {
  // 权限校验
  const auth = await checkPermission(await headers(), { permissions: ['client:list'] });
  if (!auth.authorized || !auth.userId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-red-500">未授权访问或权限不足</p>
      </div>
    );
  }

  const params = await searchParams;
  const keyword = params.keyword || '';

  const { data: clients } = await getClients({
    page: 1,
    pageSize: 100,
    keyword,
    status: '',
  });

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-1">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">应用管理</h1>
          <p className="text-muted-foreground text-sm">注册 OAuth 2.1 客户端，配置重定向策略与安全密钥。</p>
        </div>
        <Button asChild className="rounded-xl h-11 px-6 shadow-lg shadow-primary/20">
          <Link href="/clients/new">
            <Plus className="mr-2 h-4 w-4" /> 注册新应用
          </Link>
        </Button>
      </div>

      <ClientsTable clients={clients} initialKeyword={keyword} />
    </div>
  );
}
