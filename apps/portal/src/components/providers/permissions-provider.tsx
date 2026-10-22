'use client';

/**
 * 权限快照 Provider —— 服务端 → 客户端边界的**一次**传递。
 *
 * Next.js/React 19 边界决策：权限上下文本来就是服务端布局已经取到的数据
 * （`(dashboard)/layout.tsx` 读 Redis/DB 并用于菜单过滤）。此前客户端 `PermissionGuard`
 * 又通过 `usePermissions()` 发一次 `GET /api/me/permissions`，造成：
 * 1. 每个会话一次多余请求（布局/页面/守卫共享同一份数据却重复取）；
 * 2. 首帧 `loading=true` ⇒ 所有受保护按钮渲染为 null，数据到达后才出现（布局抖动）。
 *
 * 现在由服务端布局把可序列化的 `roleCodes/permissionCodes` 传给本 Provider，
 * 客户端同步判定、首帧即可渲染正确入口；判定仍委托 contracts 的 can/hasRole（单一实现）。
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { can, hasRole as hasRoleShared, isAdminRole } from '@auth-sso/contracts';

export interface PermissionsSnapshot {
  roleCodes: string[];
  permissionCodes: string[];
}

export interface PermissionsContextValue extends PermissionsSnapshot {
  hasPermission: (code: string) => boolean;
  hasRole: (code: string) => boolean;
  isAdmin: () => boolean;
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

export function PermissionsProvider({
  roleCodes,
  permissionCodes,
  children,
}: PermissionsSnapshot & { children: ReactNode }) {
  const value = useMemo<PermissionsContextValue>(() => {
    const subject = { roleCodes, permissionCodes };
    return {
      roleCodes,
      permissionCodes,
      isAdmin: () => isAdminRole(roleCodes),
      hasPermission: (code: string) => can(subject, code),
      hasRole: (code: string) => hasRoleShared(subject, code),
    };
  }, [roleCodes, permissionCodes]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

/** 读取服务端注入的权限快照；不在 Provider 内返回 null（供降级路径使用）。 */
export function usePermissionSnapshot(): PermissionsContextValue | null {
  return useContext(PermissionsContext);
}
