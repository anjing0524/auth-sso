/**
 * 部门管理页面 — Server Component 读模型入口
 *
 * 鉴权由 layout.tsx 统一处理。
 */
import { resolveIdentity } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { getDepartments } from './data';

import { db } from '@/infrastructure/db';
import DepartmentTree from './components/DepartmentTree';

import { PageHeader } from '@/components/shared/page-header';

/**
 * 该路由读取会话/动态数据，**保留服务端阻塞**（Cache Components 的 instant 导航校验）。
 * 依据 Next 16 文档：启用 cacheComponents 后，读 session 的路由需显式声明；
 * 否则 Turbopack 运行时会报 "encountered uncached data during prerendering or a navigation"。
 */
export const instant = false;
export default async function DepartmentsPage() {
  // 鉴权由 departments/layout.tsx 负责（requirePermission(['department:list'])），此处只取身份信息。
  const identity = await resolveIdentity();
  const scope = identity ? await resolveScope(db, identity.userId) : { deptIds: [] };
  const userId = identity?.userId ?? '';
  const departments = await getDepartments(scope, userId);

  return (
    <div className="space-y-6">
      <PageHeader
        icon="Building2"
        title="部门管理"
        description="管理组织架构，支持树形层级与无限子部门嵌套。"
      />

      <DepartmentTree departments={departments} />
    </div>
  );
}
