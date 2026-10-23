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


/**
 * 该路由读取会话/动态数据，**保留服务端阻塞**（Cache Components 的 instant 导航校验）。
 * 依据 Next 16 文档：启用 cacheComponents 后，读 session 的路由需显式声明；
 * 否则 Turbopack 运行时会报 "encountered uncached data during prerendering or a navigation"。
 */
export const instant = false;
export const metadata = { title: '应用管理 | Auth-SSO' };
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
    pageSize: 20,
    keyword,
    status: '',
  });

  // U-G02：搜索无结果与"系统还没有应用"是两种语义（空态文案/出口不同）。
  const isFiltered = keyword.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ClientsTable clients={clients} pagination={pagination} initialKeyword={keyword} isFiltered={isFiltered} clearHref="/clients" />
    </div>
  );
}
