'use client';

import React from 'react';
import { usePermissions } from '@/hooks/use-permissions';

interface PermissionGuardProps {
  /** 需要的权限码，管理员自动通过 */
  permission?: string;
  /** 需要的角色码 */
  role?: string;
  /** 仅管理员可见 */
  adminOnly?: boolean;
  children: React.ReactNode;
  /** 无权限时的备用渲染，默认不渲染 */
  fallback?: React.ReactNode;
}

/**
 * 按钮/区块级权限守卫
 *
 * @example
 * <PermissionGuard permission="user:delete">
 *   <Button>删除</Button>
 * </PermissionGuard>
 */
export function PermissionGuard({
  permission,
  role,
  adminOnly,
  children,
  fallback = null,
}: PermissionGuardProps) {
  const { hasPermission, hasRole, isAdmin, loading } = usePermissions();

  // 加载中不渲染（避免权限闪烁）
  if (loading) return null;

  if (adminOnly && !isAdmin()) return <>{fallback}</>;
  if (permission && !hasPermission(permission)) return <>{fallback}</>;
  if (role && !hasRole(role)) return <>{fallback}</>;

  return <>{children}</>;
}
