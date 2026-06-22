/**
 * 部门管理页面 — Server Component 读模型入口
 *
 * 鉴权由 layout.tsx 统一处理。
 */
import { Building2 } from 'lucide-react';
import { requirePermission } from '@/lib/auth/check-permission';
import { getDataScopeFilter } from '@/lib/auth';
import { getDepartments } from './data';
import DepartmentTree from './components/DepartmentTree';

export default async function DepartmentsPage() {
  const userId = (await requirePermission({ permissions: ['department:list'] }))!;
  const scopeFilter = await getDataScopeFilter(userId);
  const departments = await getDepartments(scopeFilter, userId);

  return (
    <div className="space-y-8 pb-10">
      <div className="flex items-center justify-between px-1">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Building2 className="h-8 w-8 text-primary" /> 部门管理
          </h1>
          <p className="text-muted-foreground text-sm">管理组织架构，支持树形层级与无限子部门嵌套。</p>
        </div>
      </div>

      <DepartmentTree departments={departments} />
    </div>
  );
}
