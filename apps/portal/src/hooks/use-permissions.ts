'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ADMIN_ROLE_CODES } from '@auth-sso/contracts';

export interface PermissionContext {
  roles: Array<{ id: string; code: string; name: string }>;
  permissions: string[];
  loading: boolean;
}

// 模块级缓存，同一页面生命周期内只请求一次
let _cache: PermissionContext | null = null;
let _promise: Promise<void> | null = null;

async function fetchPermissions() {
  if (_promise) return _promise;
  _promise = fetch('/api/me/permissions')
    .then(r => r.json())
    .then(data => {
      _cache = {
        roles: data.data?.roles ?? [],
        permissions: data.data?.permissions ?? [],
        loading: false,
      };
    })
    .catch(() => {
      _cache = { roles: [], permissions: [], loading: false };
    })
    .finally(() => {
      _promise = null; // 清空 promise 以支持重试
    });
  return _promise;
}

export function usePermissions() {
  const [ctx, setCtx] = useState<PermissionContext>(
    _cache ?? { roles: [], permissions: [], loading: true }
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (_cache && !_cache.loading) {
      setCtx(_cache);
      return;
    }
    fetchPermissions().then(() => {
      if (_cache && mountedRef.current) setCtx({ ..._cache });
    });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isAdmin = useCallback(
    () => ctx.roles.some(r => (ADMIN_ROLE_CODES as readonly string[]).includes(r.code)),
    [ctx.roles],
  );

  const hasPermission = useCallback(
    (code: string) => isAdmin() || ctx.permissions.includes(code),
    [isAdmin, ctx.permissions],
  );

  const hasRole = useCallback(
    (code: string) => ctx.roles.some(r => r.code === code),
    [ctx.roles],
  );

  return { ...ctx, hasPermission, hasRole, isAdmin };
}
