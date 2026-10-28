/**
 * Client 列表页面 — Server Component 读模型入口
 *
 * 职责分工：
 * - 本组件为 Server Component，服务端直取数据同步渲染
 * - ClientsTable 为 Client Component，承载浏览器交互（搜索/复制/操作菜单）
 * - 写操作通过 Server Actions (actions.ts) 执行
 */
import { redirect } from 'next/navigation';
import { getClients, getClientStatusCounts } from './data';
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
    status?: string;
    sort?: string;
    page?: string;
    pageSize?: string;
  }>;
}

export default async function ClientsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const keyword = params.keyword || '';
  // 状态白名单：非法值不得下沉到 PG enum（22P02 → 500）
  const status = params.status === 'ACTIVE' || params.status === 'DISABLED' ? params.status : '';
  const sort = (['recent', 'updated', 'name'] as const).includes(params.sort as never) ? (params.sort as string) : 'recent';
  const page = clampPage(params.page);
  const pageSize = [20, 50, 100].includes(Number(params.pageSize)) ? Number(params.pageSize) : 20;

  const [{ data: clients, pagination }, statusCounts] = await Promise.all([
    getClients({ page, pageSize, keyword, status, sort }),
    getClientStatusCounts(),
  ]);

  if (pagination.totalPages > 0 && page > pagination.totalPages) {
    const q = new URLSearchParams();
    if (keyword) q.set('keyword', keyword);
    if (status) q.set('status', status);
    if (sort) q.set('sort', sort);
    if (pageSize !== 20) q.set('pageSize', String(pageSize));
    q.set('page', String(pagination.totalPages));
    redirect(`/clients?${q.toString()}`);
  }
  // U-G02：搜索无结果与"系统还没有应用"是两种语义（空态文案/出口不同）。
  const isFiltered = keyword.length > 0 || status !== '';
  // 清除筛选保留排序偏好（视图状态，不是筛选条件）
  const clearHref = `/clients?${[sort !== 'recent' ? `sort=${sort}` : '', pageSize !== 20 ? `pageSize=${pageSize}` : ''].filter(Boolean).join('&')}`.replace(/\?$/, '');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ClientsTable clients={clients} pagination={pagination} initialKeyword={keyword} initialStatus={status} initialSort={sort} isFiltered={isFiltered} clearHref={clearHref} statusCounts={statusCounts} />
    </div>
  );
}
