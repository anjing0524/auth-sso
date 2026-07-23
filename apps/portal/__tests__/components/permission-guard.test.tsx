/**
 * PermissionGuard 按钮/区块级权限守卫测试
 *
 * @req H-ACL-001
 *
 * 覆盖场景：
 * - 正常：有权限时渲染子元素
 * - 正常：无 permission/role/adminOnly 约束时始终渲染
 * - 边界：无权限时渲染 fallback / null
 * - 边界：加载中状态返回 null
 * - 边界：管理员绕过权限检查
 * - 边界：role/adminOnly 约束
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PermissionGuard } from '@/components/ui/permission-guard';

// ── Mock usePermissions ──────────────────────────────────────
const mockUsePermissions = vi.fn();
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => mockUsePermissions(),
}));

// ── Default permission context (all-access) ──────────────────
const allAccessCtx = {
  loading: false,
  hasPermission: vi.fn(() => true),
  hasRole: vi.fn(() => true),
  isAdmin: vi.fn(() => false),
};

// ── Tests ────────────────────────────────────────────────────
describe('PermissionGuard', () => {
  beforeEach(() => {
    mockUsePermissions.mockReset();
  });

  // ── Happy path ────────────────────────────────────────────
  it('renders children when user has the required permission', () => {
    mockUsePermissions.mockReturnValue(allAccessCtx);
    render(
      <PermissionGuard permission="user:list">
        <div>受保护内容</div>
      </PermissionGuard>,
    );
    expect(screen.getByText('受保护内容')).toBeInTheDocument();
  });

  it('renders children when no guard props are set (always pass)', () => {
    mockUsePermissions.mockReturnValue(allAccessCtx);
    render(
      <PermissionGuard>
        <div>公开内容</div>
      </PermissionGuard>,
    );
    expect(screen.getByText('公开内容')).toBeInTheDocument();
  });

  // ── Permission denial ─────────────────────────────────────
  it('returns null when user lacks permission (no fallback)', () => {
    mockUsePermissions.mockReturnValue({
      ...allAccessCtx,
      hasPermission: vi.fn(() => false),
    });
    render(
      <PermissionGuard permission="user:delete">
        <div>删除按钮</div>
      </PermissionGuard>,
    );
    expect(screen.queryByText('删除按钮')).not.toBeInTheDocument();
  });

  it('renders fallback instead of children when permission denied', () => {
    mockUsePermissions.mockReturnValue({
      ...allAccessCtx,
      hasPermission: vi.fn(() => false),
    });
    render(
      <PermissionGuard permission="user:delete" fallback={<span>无权限</span>}>
        <div>删除按钮</div>
      </PermissionGuard>,
    );
    expect(screen.queryByText('删除按钮')).not.toBeInTheDocument();
    expect(screen.getByText('无权限')).toBeInTheDocument();
  });

  // ── Loading state ─────────────────────────────────────────
  it('renders nothing during loading state (avoids flash)', () => {
    mockUsePermissions.mockReturnValue({
      ...allAccessCtx,
      loading: true,
    });
    render(
      <PermissionGuard permission="user:list">
        <div>闪烁内容</div>
      </PermissionGuard>,
    );
    expect(screen.queryByText('闪烁内容')).not.toBeInTheDocument();
  });

  // ── Admin bypass ──────────────────────────────────────────
  it('bypasses permission check when user is admin', () => {
    // 真实 usePermissions 的 hasPermission() 内部会检查 isAdmin():
    //   hasPermission = (code) => isAdmin() || permissions.includes(code)
    // 因此管理员用户的 hasPermission() 始终返回 true
    mockUsePermissions.mockReturnValue({
      ...allAccessCtx,
      hasPermission: vi.fn(() => true),
      isAdmin: vi.fn(() => true),
    });
    render(
      <PermissionGuard permission="some:restricted">
        <div>管理员可见</div>
      </PermissionGuard>,
    );
    expect(screen.getByText('管理员可见')).toBeInTheDocument();
  });

  // ── Role check ────────────────────────────────────────────
  it('renders children when user has the required role', () => {
    mockUsePermissions.mockReturnValue({
      ...allAccessCtx,
      hasRole: vi.fn((code: string) => code === 'EDITOR'),
    });
    render(
      <PermissionGuard role="EDITOR">
        <div>编辑者内容</div>
      </PermissionGuard>,
    );
    expect(screen.getByText('编辑者内容')).toBeInTheDocument();
  });

  it('returns null when user lacks the required role', () => {
    mockUsePermissions.mockReturnValue({
      ...allAccessCtx,
      hasRole: vi.fn(() => false),
    });
    render(
      <PermissionGuard role="ADMIN">
        <div>管理员内容</div>
      </PermissionGuard>,
    );
    expect(screen.queryByText('管理员内容')).not.toBeInTheDocument();
  });

  // ── adminOnly ─────────────────────────────────────────────
  it('renders children for admin when adminOnly is set', () => {
    mockUsePermissions.mockReturnValue({
      ...allAccessCtx,
      isAdmin: vi.fn(() => true),
    });
    render(
      <PermissionGuard adminOnly>
        <div>仅管理员</div>
      </PermissionGuard>,
    );
    expect(screen.getByText('仅管理员')).toBeInTheDocument();
  });

  it('blocks non-admin when adminOnly is set', () => {
    mockUsePermissions.mockReturnValue({
      ...allAccessCtx,
      isAdmin: vi.fn(() => false),
    });
    render(
      <PermissionGuard adminOnly>
        <div>仅管理员</div>
      </PermissionGuard>,
    );
    expect(screen.queryByText('仅管理员')).not.toBeInTheDocument();
  });
});
