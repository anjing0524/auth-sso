/**
 * 路由级权限要求的**唯一出处**。
 *
 * 背景（权限设计审计 2026-10-21）：
 * - `(dashboard)/<route>/layout.tsx` 各自硬编码需要的功能权限；
 * - 侧边栏菜单只按菜单节点自身的权限码过滤；
 * 两者互不知情 ⇒ 只授了 PAGE 菜单、没有功能权限的角色会看到菜单，点进去却是"未授权"。
 *
 * 这里把「路径 → 功能权限」集中定义：layout 用它做守卫、菜单树用它过滤，
 * 保证 **看得见的菜单一定打得开**（dashboard 是所有已登录用户的工作台，不要求功能权限）。
 */
import {
  AUDIT_PERMISSIONS,
  CLIENT_PERMISSIONS,
  DEPARTMENT_PERMISSIONS,
  PERMISSION_PERMISSIONS,
  ROLE_PERMISSIONS,
  USER_PERMISSIONS,
  canAny,
  type AuthorizationSubject,
} from '@auth-sso/contracts';

import type { PermissionCheckOptions } from '@/lib/auth/check-permission';

export const ROUTE_ACCESS = {
  /** 工作台是登录后的统一落地页：只要求已登录，数据再按范围裁剪。 */
  '/dashboard': { permissions: [] },
  '/users': { permissions: [USER_PERMISSIONS.LIST] },
  '/roles': { permissions: [ROLE_PERMISSIONS.LIST] },
  '/permissions': { permissions: [PERMISSION_PERMISSIONS.LIST] },
  '/departments': { permissions: [DEPARTMENT_PERMISSIONS.LIST] },
  '/clients': { permissions: [CLIENT_PERMISSIONS.LIST] },
  '/audit-logs': { permissions: [AUDIT_PERMISSIONS.READ] },
} as const satisfies Record<string, PermissionCheckOptions>;

/** 取路径的守卫要求（支持子路径，如 /users/:id）；未登记的路径返回 undefined。 */
export function accessForPath(path: string): PermissionCheckOptions | undefined {
  const normalized = path.split('?')[0]?.replace(/\/+$/, '') || '/';
  if (normalized in ROUTE_ACCESS) return ROUTE_ACCESS[normalized as keyof typeof ROUTE_ACCESS];
  const prefix = Object.keys(ROUTE_ACCESS)
    .filter((route) => route !== '/dashboard' && normalized.startsWith(`${route}/`))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? ROUTE_ACCESS[prefix as keyof typeof ROUTE_ACCESS] : undefined;
}

/** 菜单路径是否可见：未登记路径维持"由菜单权限码决定"；登记路径要求功能权限。 */
export function canAccessPath(subject: AuthorizationSubject, path: string): boolean {
  const guard = accessForPath(path);
  if (!guard) return true;
  return canAny(subject, guard.permissions ?? []);
}
