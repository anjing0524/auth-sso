/**
 * 部门管理页面 — Server Component 读模型入口
 *
 * 鉴权由 layout.tsx 统一处理。
 */
import { resolveIdentity } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { getDepartments, getDepartmentDeletionStats } from './data';

import { db } from '@/infrastructure/db';
import DepartmentTree from './components/DepartmentTree';


/**
 * 该路由读取会话/动态数据，**保留服务端阻塞**（Cache Components 的 instant 导航校验）。
 * 依据 Next 16 文档：启用 cacheComponents 后，读 session 的路由需显式声明；
 * 否则 Turbopack 运行时会报 "encountered uncached data during prerendering or a navigation"。
 */
export const instant = false;
export const metadata = { title: '部门管理 | Auth-SSO' };

interface PageProps {
  searchParams: Promise<{ create?: string }>;
}

export default async function DepartmentsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  // 鉴权由 departments/layout.tsx 负责（requirePermission(['department:list'])），此处只取身份信息。
  const identity = await resolveIdentity();
  const scope = identity ? await resolveScope(db, identity.userId) : { deptIds: [] };
  const userId = identity?.userId ?? '';
  const departments = await getDepartments(scope, userId);
  // 删除确认的影响面（U-DEP05）：统计当前可见部门（与服务端删除守卫同口径）
  const flattenIds: string[] = [];
  const collect = (nodes: typeof departments) => { for (const n of nodes) { flattenIds.push(n.id); collect(n.children); } };
  collect(departments);
  const deletionStats = await getDepartmentDeletionStats(flattenIds);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <DepartmentTree departments={departments} deletionStats={deletionStats} autoOpenCreate={params.create === '1'} />
    </div>
  );
}
