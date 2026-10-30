'use client';

import type { ReactNode } from 'react';
import { usePermissions } from '@/hooks/use-permissions';

interface PermissionGuardProps {
  permission?: string;
  role?: string;
  adminOnly?: boolean;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * 用户管理操作入口的**展示层**权限守卫。
 *
 * 注意：这只是隐藏入口的 UX 优化，**真正的门禁在 Server Action**（`createUserAction`
 * 等由 `withAuth` + 权限码强制）。权限在客户端异步拉取，因此首帧会短暂不渲染入口。
 */
export function PermissionGuard({
  permission,
  role,
  adminOnly,
  children,
  fallback = null,
}: PermissionGuardProps) {
  const { hasPermission, hasRole, isAdmin, loading } = usePermissions();

  if (loading) return null;
  if (adminOnly && !isAdmin()) return <>{fallback}</>;
  if (permission && !hasPermission(permission)) return <>{fallback}</>;
  if (role && !hasRole(role)) return <>{fallback}</>;

  return <>{children}</>;
}
