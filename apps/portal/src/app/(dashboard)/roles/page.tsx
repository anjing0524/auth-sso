/**
 * 角色管理页面 — Server Component 读模型入口
 * 写操作通过 Server Actions (actions.ts) 执行
 */
import { ShieldCheck } from 'lucide-react';
import { getRoles } from './data';
import { getDepartments } from '@/app/(dashboard)/users/data';
import { resolveIdentity, getUserRoleDeptIds } from '@/lib/auth';
import RolesTable from './components/RolesTable';

interface PageProps {
  searchParams: Promise<{
    page?: string;
    keyword?: string;
  }>;
}

export default async function RolesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = parseInt(params.page || '1', 10);
  const keyword = params.keyword || '';

  // 鉴权由 roles/layout.tsx 负责（requirePermission(['role:list'])），此处只取身份信息。
  const identity = await resolveIdentity();
  const deptIds = identity ? await getUserRoleDeptIds(identity.userId) : [];

  const [{ data: roles, pagination }, departments] = await Promise.all([
    getRoles({ page, pageSize: 10, keyword, status: '', deptIds }),
    getDepartments(),
  ]);

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

      <RolesTable roles={roles} pagination={pagination} initialKeyword={keyword} departments={departments} />
    </div>
  );
}
