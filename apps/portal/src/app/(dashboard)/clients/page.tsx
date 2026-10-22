/**
 * Client 列表页面 — Server Component 读模型入口
 *
 * 职责分工：
 * - 本组件为 Server Component，服务端直取数据同步渲染
 * - ClientsTable 为 Client Component，承载浏览器交互（搜索/复制/操作菜单）
 * - 写操作通过 Server Actions (actions.ts) 执行
 */
import { getClients } from './data';
import { clampPage } from '@/lib/pagination';
import ClientsTable from './components/ClientsTable';

import { PageHeader } from '@/components/shared/page-header';

/**
 * 该路由读取会话/动态数据，**保留服务端阻塞**（Cache Components 的 instant 导航校验）。
 * 依据 Next 16 文档：启用 cacheComponents 后，读 session 的路由需显式声明；
 * 否则 Turbopack 运行时会报 "encountered uncached data during prerendering or a navigation"。
 */
export const instant = false;
interface PageProps {
  searchParams: Promise<{
    keyword?: string;
    page?: string;
  }>;
}

export default async function ClientsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const keyword = params.keyword || '';
  const page = clampPage(params.page);

  const { data: clients, pagination } = await getClients({
    page,
    pageSize: 15,
    keyword,
    status: '',
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeader
        icon="AppWindow"
        title="应用管理"
        description="注册 OAuth 2.1 客户端，配置重定向策略与安全密钥。"
      />

      <ClientsTable clients={clients} pagination={pagination} initialKeyword={keyword} />
    </div>
  );
}
