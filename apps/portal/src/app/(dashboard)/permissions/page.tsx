/**
 * 权限管理页面 — Server Component 读模型入口
 * 写操作通过 Server Actions (actions.ts) 执行
 */
import { redirect } from 'next/navigation';
import { getPermissionPage, getPermissions, getClientOptions } from './data';
import { ENTITY_STATUS_VALUES } from '@auth-sso/contracts';
import { clampPage } from '@/lib/pagination';
import PermissionsTable from './components/PermissionsTable';


/**
 * 该路由读取会话/动态数据，**保留服务端阻塞**（Cache Components 的 instant 导航校验）。
 * 依据 Next 16 文档：启用 cacheComponents 后，读 session 的路由需显式声明；
 * 否则 Turbopack 运行时会报 "encountered uncached data during prerendering or a navigation"。
 */
export const instant = false;
export const metadata = { title: '权限管理 | Auth-SSO' };
interface PageProps {
  searchParams: Promise<{
    type?: string;
    keyword?: string;
    status?: string;
    clientId?: string;
    pageSize?: string;
    page?: string;
  }>;
}

export default async function PermissionsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  // 非法 type 不得进入查询（PERMISSION 类型是枚举，非法值会让 SQL 报错）
  const activeTab = (['ALL', 'DIRECTORY', 'PAGE', 'API'] as const).includes(params.type as never)
    ? (params.type as string)
    : 'ALL';
  const keyword = (params.keyword || '').slice(0, 100);
  const status = (ENTITY_STATUS_VALUES as readonly string[]).includes(params.status ?? '') ? params.status! : '';
  const page = clampPage(params.page);
  const pageSize = [20, 50, 100].includes(Number(params.pageSize)) ? Number(params.pageSize) : 20;
  // 归属应用只对接口权限有意义：其他 tab 即使 URL 带 clientId 也忽略，避免误空态
  const clientId = activeTab === 'API' ? (params.clientId || '').slice(0, 100) : '';

  // 服务端分页/过滤：与 users/roles/audit 一致（此前全量下发、浏览器内过滤分页）
  const [{ data: permissions, pagination }, clients] = await Promise.all([
    getPermissionPage({
      type: activeTab === 'ALL' ? undefined : activeTab,
      keyword,
      status: status || undefined,
      clientId: clientId || undefined,
      page,
      pageSize,
    }),
    getClientOptions(),
  ]);
  if (pagination.totalPages > 0 && page > pagination.totalPages) {
    const q = new URLSearchParams();
    if (activeTab !== 'ALL') q.set('type', activeTab);
    if (keyword) q.set('keyword', keyword);
    if (status) q.set('status', status);
    if (clientId) q.set('clientId', clientId);
    if (pageSize !== 20) q.set('pageSize', String(pageSize));
    q.set('page', String(pagination.totalPages));
    redirect(`/permissions?${q.toString()}`);
  }
  // 父级菜单候选需要全量目录/页面（getPermissions 是 "use cache" 读模型）
  const allPermissions = await getPermissions();
  const menuOptions = allPermissions.filter((p) => p.type === 'DIRECTORY' || p.type === 'PAGE');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PermissionsTable
        permissions={permissions}
        pagination={pagination}
        activeTab={activeTab}
        initialKeyword={keyword}
        initialStatus={status}
        initialClientId={clientId}
        clients={clients}
        pageSize={pageSize}
        menuOptions={menuOptions}
      />
    </div>
  );
}
