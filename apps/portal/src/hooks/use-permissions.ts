'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ADMIN_ROLE_CODES } from '@auth-sso/contracts';

export interface PermissionContext {
  roles: Array<{ id: string; code: string; name: string }>;
  permissions: string[];
  loading: boolean;
}

/**
 * 按用户身份键控的权限缓存（解决跨用户缓存泄漏 B9）
 *
 * 使用 userId 作为缓存键，用户切换时自动失效旧缓存。
 * 单用户内同页面生命周期复用，避免重复请求。
 */
const _cacheByUser = new Map<string, PermissionContext>();
const _pendingByUser = new Map<string, Promise<void>>();

async function fetchPermissions(userId: string): Promise<void> {
  const pending = _pendingByUser.get(userId);
  if (pending) return pending;

  const promise = fetch('/api/me/permissions')
    .then((r) => r.json())
    .then((data) => {
      _cacheByUser.set(userId, {
        roles: data.data?.roles ?? [],
        permissions: data.data?.permissions ?? [],
        loading: false,
      });
    })
    .catch(() => {
      _cacheByUser.set(userId, { roles: [], permissions: [], loading: false });
    })
    .finally(() => {
      _pendingByUser.delete(userId);
    });

  _pendingByUser.set(userId, promise);
  return promise;
}

export function usePermissions(userId: string = 'default') {
  const cached = _cacheByUser.get(userId);
  const [ctx, setCtx] = useState<PermissionContext>(
    cached ?? { roles: [], permissions: [], loading: true },
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (cached && !cached.loading) {
      setCtx(cached);
      return;
    }
    fetchPermissions(userId).then(() => {
      const fresh = _cacheByUser.get(userId);
      if (fresh && mountedRef.current) setCtx({ ...fresh });
    });
    return () => {
      mountedRef.current = false;
    };
  }, [userId]);

  const isAdmin = useCallback(
    () => ctx.roles.some((r) => (ADMIN_ROLE_CODES as readonly string[]).includes(r.code)),
    [ctx.roles],
  );

  const hasPermission = useCallback(
    (code: string) => isAdmin() || ctx.permissions.includes(code),
    [isAdmin, ctx.permissions],
  );

  const hasRole = useCallback(
    (code: string) => ctx.roles.some((r) => r.code === code),
    [ctx.roles],
  );

  return { ...ctx, hasPermission, hasRole, isAdmin };
}
