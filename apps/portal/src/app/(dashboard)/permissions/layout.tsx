/**
 * 权限管理路由布局 —— 只声明本路由需要的权限码，守卫装载统一在 PermissionGate。
 *
 * 说明：此前每个 layout 自己写 `await requirePermission(...) + Forbidden`，
 * 在 Turbopack + Cache Components 下会被判为"预渲染路径里读会话/不稳定值"而报错；
 * 现在守卫内部统一 `await connection()` + `<Suspense>`（见 components/layout/permission-gate.tsx）。
 */
import { PermissionGate } from '@/components/layout/permission-gate';
import { ROUTE_ACCESS } from '@/lib/route-access';

/**
 * 该路由读取会话/动态数据，**保留服务端阻塞**（Cache Components 的 instant 导航校验）。
 * 依据 Next 16 文档：启用 cacheComponents 后，读 session 的路由需显式声明；
 * 否则 Turbopack 运行时会报 "encountered uncached data during prerendering or a navigation"。
 */
export const instant = false;

export default function PermissionsLayout({ children }: { children: React.ReactNode }) {
  return (
    <PermissionGate options={ROUTE_ACCESS['/permissions']}>
      {children}
    </PermissionGate>
  );
}
