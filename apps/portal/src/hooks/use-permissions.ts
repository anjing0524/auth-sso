'use client';

import { useState, useEffect } from 'react';

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
    });
  return _promise;
}

export function usePermissions() {
  const [ctx, setCtx] = useState<PermissionContext>(
    _cache ?? { roles: [], permissions: [], loading: true }
  );

  useEffect(() => {
    if (_cache && !_cache.loading) {
      setCtx(_cache);
      return;
    }
    fetchPermissions().then(() => {
      if (_cache) setCtx({ ..._cache });
    });
  }, []);

  const isAdmin = () =>
    ctx.roles.some(r => r.code === 'SUPER_ADMIN' || r.code === 'ADMIN');

  const hasPermission = (code: string) =>
    isAdmin() || ctx.permissions.includes(code);

  const hasRole = (code: string) =>
    ctx.roles.some(r => r.code === code);

  return { ...ctx, hasPermission, hasRole, isAdmin };
}
