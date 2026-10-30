'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

import { can, hasRole as hasRoleShared, isAdminRole } from '@auth-sso/contracts';

import { usePermissionSnapshot, type PermissionsContextValue } from '@/components/providers/permissions-provider';

export interface PermissionContext {
  roles: Array<{ id: string; code: string; name: string }>;
  permissions: string[];
  loading: boolean;
}

/** Provider 缺失时的兜底（独立挂载的组件/测试）：仍走一次 API，保持旧行为。 */
async function fetchPermissions(): Promise<PermissionContext> {
  try {
    const res = await fetch('/api/me/permissions');
    const data = await res.json();
    return {
      roles: data?.roles ?? [],
      permissions: data?.permissions ?? [],
      loading: false,
    };
  } catch {
    return { roles: [], permissions: [], loading: false };
  }
}

/**
 * 当前用户权限判定。
 *
 * 正常路径：`(dashboard)/layout.tsx` 的 `<PermissionsProvider>` 已注入服务端快照 ⇒
 * **零网络请求、首帧同步可用**（React 19 服务端/客户端边界的最小传递）。
 * 兜底路径：组件不在 Provider 内（独立测试、被复用的共享组件）时退化为旧的
 * `/api/me/permissions` 拉取；这条路径在生产布局中不会触发。
 */
export function usePermissions() {
  const snapshot = usePermissionSnapshot();
  const [fallback, setFallback] = useState<PermissionContext>({ roles: [], permissions: [], loading: true });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (snapshot) return;
    void fetchPermissions().then((ctx) => {
      if (mountedRef.current) setFallback(ctx);
    });
    return () => {
      mountedRef.current = false;
    };
  }, [snapshot]);

  const fromSnapshot = useCallback(
    (value: PermissionsContextValue) => ({
      roles: value.roleCodes.map((code) => ({ id: code, code, name: code })),
      permissions: value.permissionCodes,
      loading: false,
      hasPermission: value.hasPermission,
      hasRole: value.hasRole,
      isAdmin: value.isAdmin,
    }),
    [],
  );

  if (snapshot) return fromSnapshot(snapshot);

  // 兜底路径同样委托 contracts 的单一判定实现，禁止手写角色/权限比较（避免与 can 漂移）。
  const subject = {
    roleCodes: fallback.roles.map((r) => r.code),
    permissionCodes: fallback.permissions,
  };
  return {
    ...fallback,
    hasPermission: (code: string) => can(subject, code),
    hasRole: (code: string) => hasRoleShared(subject, code),
    isAdmin: () => isAdminRole(subject.roleCodes),
  };
}
