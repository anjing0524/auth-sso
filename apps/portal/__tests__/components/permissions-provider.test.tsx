/**
 * PermissionsProvider —— 服务端权限快照 → 客户端同步判定
 *
 * 背景（Next.js 16 / React 19 边界优化）：客户端 PermissionGuard 此前靠
 * usePermissions() 再发一次 /api/me/permissions，首帧 loading=true 会把所有受保护
 * 入口渲染为 null（布局抖动）。服务端布局已持有同一份权限数据，经 Provider 一次传递后
 * 客户端同步判定、零请求、首帧正确。
 *
 * @req H-ACL-001
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PermissionsProvider } from '@/components/providers/permissions-provider';
import { usePermissions } from '@/hooks/use-permissions';
import { PermissionGuard } from '@/components/shared/permission-guard';

function Probe({ code }: { code: string }) {
  const { loading, hasPermission, isAdmin } = usePermissions();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="allowed">{String(hasPermission(code))}</span>
      <span data-testid="admin">{String(isAdmin())}</span>
    </div>
  );
}

describe('PermissionsProvider', () => {
  it('服务端快照注入后同步可用：loading=false、判定正确、零请求', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(
      <PermissionsProvider roleCodes={['QA_ROLE']} permissionCodes={['portal:user:list']}>
        <Probe code="portal:user:list" />
        <PermissionGuard permission="portal:user:list"><button>受保护按钮</button></PermissionGuard>
        <PermissionGuard permission="portal:user:delete"><button>无权限按钮</button></PermissionGuard>
      </PermissionsProvider>,
    );
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('allowed').textContent).toBe('true');
    expect(screen.getByText('受保护按钮')).toBeInTheDocument();
    expect(screen.queryByText('无权限按钮')).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('管理员角色绕过权限码（与 can 同一语义）', () => {
    render(
      <PermissionsProvider roleCodes={['SUPER_ADMIN']} permissionCodes={[]}>
        <Probe code="portal:user:delete" />
        <PermissionGuard permission="portal:user:delete"><button>管理员按钮</button></PermissionGuard>
      </PermissionsProvider>,
    );
    expect(screen.getByTestId('allowed').textContent).toBe('true');
    expect(screen.getByTestId('admin').textContent).toBe('true');
    expect(screen.getByText('管理员按钮')).toBeInTheDocument();
  });
});
