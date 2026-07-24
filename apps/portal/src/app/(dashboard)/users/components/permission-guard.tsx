'use client';

import type { ReactNode } from 'react';
import { usePermissions } from '@/hooks/use-permissions';

interface PermissionGuardProps {
  permission?: string;
  role?: string;
  adminOnly?: boolean;
  children: ReactNode;
  fallback?: ReactNode;
  userId?: string;
}

/** 用户管理操作入口的权限守卫。 */
export function PermissionGuard({
  permission,
  role,
  adminOnly,
  children,
  fallback = null,
  userId,
}: PermissionGuardProps) {
  const { hasPermission, hasRole, isAdmin, loading } = usePermissions(userId ?? 'anonymous');

  if (loading) return null;
  if (adminOnly && !isAdmin()) return <>{fallback}</>;
  if (permission && !hasPermission(permission)) return <>{fallback}</>;
  if (role && !hasRole(role)) return <>{fallback}</>;

  return <>{children}</>;
}
