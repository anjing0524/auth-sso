/**
 * 权限管理页面 — Server Component 读模型入口
 * 写操作通过 Server Actions (actions.ts) 执行
 */
import { ShieldCheck } from 'lucide-react';
import { getPermissions } from './data';
import PermissionsTable from './components/PermissionsTable';

interface PageProps {
  searchParams: Promise<{
    type?: string;
  }>;
}

export default async function PermissionsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const activeTab = params.type || 'ALL';

  const permissions = await getPermissions(activeTab !== 'ALL' ? activeTab : undefined);

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-1">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <ShieldCheck className="h-8 w-8 text-primary" /> 权限管理
          </h1>
          <p className="text-muted-foreground text-sm">管理系统的功能权限点，支持 DIRECTORY/PAGE/API/DATA 四种类型。</p>
        </div>
      </div>

      <PermissionsTable permissions={permissions} activeTab={activeTab} />
    </div>
  );
}
