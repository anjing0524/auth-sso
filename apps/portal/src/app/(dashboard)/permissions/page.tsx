/**
 * 权限管理页面 — Server Component 读模型入口
 * 写操作通过 Server Actions (actions.ts) 执行
 */
import { getPermissionPage, getPermissions } from './data';
import { clampPage } from '@/lib/pagination';
import PermissionsTable from './components/PermissionsTable';

import { PageHeader } from '@/components/shared/page-header';

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
  const page = clampPage(params.page);

  // 服务端分页/过滤：与 users/roles/audit 一致（此前全量下发、浏览器内过滤分页）
  const { data: permissions, pagination } = await getPermissionPage({
    type: activeTab === 'ALL' ? undefined : activeTab,
    keyword,
    page,
    pageSize: 15,
  });
  // 父级菜单候选需要全量目录/页面（getPermissions 是 "use cache" 读模型）
  const allPermissions = await getPermissions();
  const menuOptions = allPermissions.filter((p) => p.type === 'DIRECTORY' || p.type === 'PAGE');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        icon="Key"
        title="权限管理"
        description="管理功能权限与侧边栏菜单：支持目录、页面、接口三种类型。"
      />

      <PermissionsTable
        permissions={permissions}
        pagination={pagination}
        activeTab={activeTab}
        initialKeyword={keyword}
        menuOptions={menuOptions}
      />
    </div>
  );
}
