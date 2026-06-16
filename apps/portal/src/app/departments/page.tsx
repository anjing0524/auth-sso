/**
 * 部门管理页面 — Server Component 读模型入口
 * 写操作通过 Server Actions (actions.ts) 执行
 */
import { headers } from 'next/headers';
import { Building2 } from 'lucide-react';
import { checkPermission } from '@/lib/auth';
import { getDepartments } from './data';
import DepartmentTree from './components/DepartmentTree';

export default async function DepartmentsPage() {
  const auth = await checkPermission(await headers(), { permissions: ['department:list'] });
  if (!auth.authorized || !auth.userId) {
    return <div className="flex items-center justify-center h-64"><p className="text-red-500">未授权访问或权限不足</p></div>;
  }

  const departments = await getDepartments(auth.userId);

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
