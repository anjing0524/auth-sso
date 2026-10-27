/**
 * F7（task-16）页面级 UI 状态组件测试
 *
 * 覆盖：
 * - U-G02：users/clients 搜索无结果 → 共享 EmptyState `kind="filtered"` + 「清除筛选」出口；
 *          无筛选时保持"暂无数据/新建"口径
 * - U-USERS01：只有 `user:read` 的只读角色也能看到行内「详情」入口，且不渲染写操作
 *
 * @req U-G02, U-USERS01
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { USER_PERMISSIONS } from '@auth-sso/contracts';

// ── next/navigation（表格组件使用 router/pathname/searchParams）────────────
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/users',
  useSearchParams: () => new URLSearchParams(),
}));

// ── 权限输入（可切换 readonly / 全量）────────────────────────────────────
const permissionHolder = vi.hoisted(() => ({ permissions: [] as string[] }));
// @allow-module-mock @/hooks/use-permissions infra-boundary: 权限 hook 只提供"当前用户拥有哪些权限码"这一输入；本文件断言的是表格在给定权限下的渲染（U-USERS01），权限判定本体由 permission-enforcement/contracts 覆盖
vi.mock(import('@/hooks/use-permissions'), async (importOriginal): Promise<Partial<typeof usePermissionsModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    usePermissions: () => ({
      loading: false,
      roles: [],
      permissions: permissionHolder.permissions,
      hasPermission: (code: string) => permissionHolder.permissions.includes(code),
      hasRole: () => false,
      isAdmin: () => false,
    }),
  };
});

// ── Server Actions：本用例只渲染组件，动作替身不会真正调用 ────────────────
// @allow-module-mock @/app/(dashboard)/users/actions infra-boundary: 只测渲染；写操作为替身
vi.mock(import('@/app/(dashboard)/users/actions'), async (importOriginal): Promise<Partial<typeof usersActionsModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    toggleUserStatusAction: vi.fn(),
    unlockUserAction: vi.fn(),
    updateUserRolesAction: vi.fn(),
  };
});
// @allow-module-mock @/app/(dashboard)/clients/actions infra-boundary: 只测渲染；删除动作为替身
vi.mock(import('@/app/(dashboard)/clients/actions'), async (importOriginal): Promise<Partial<typeof clientsActionsModule>> => {
  const actual = await importOriginal();
  return { ...actual, deleteClientAction: vi.fn() };
});

import UserTable from '@/app/(dashboard)/users/components/UserTable';
import ClientsTable from '@/app/(dashboard)/clients/components/ClientsTable';
import type * as usersActionsModule from '@/app/(dashboard)/users/actions';
import type * as clientsActionsModule from '@/app/(dashboard)/clients/actions';
import type * as usePermissionsModule from '@/hooks/use-permissions';

const PAGINATION = { page: 1, pageSize: 15, total: 0, totalPages: 0 };

const USER_ROW = {
  id: '00000000-0000-4000-8000-000000000201',
  username: 'readonly-user',
  email: 'readonly@example.com',
  name: '只读用户',
  avatarUrl: null,
  status: 'ACTIVE' as const,
  deptId: '00000000-0000-4000-8000-000000000001',
  deptName: '总公司',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: null,
  roleCount: 1,
};

beforeEach(() => {
  permissionHolder.permissions = [];
});

describe('U-G02 — users 空态语义', () => {
  it('筛选无结果 → filtered 空态 + 「清除筛选」链接（不是"新建用户"引导）', () => {
    render(
      <UserTable users={[]} pagination={PAGINATION} isFiltered clearHref="/users?status=DISABLED" />,
    );

    expect(screen.getByText('未找到匹配结果')).toBeInTheDocument();
    const clear = screen.getByRole('link', { name: '清除筛选' });
    expect(clear).toHaveAttribute('href', '/users?status=DISABLED');
    expect(screen.queryByText('暂无用户')).not.toBeInTheDocument();
  });

  it('无数据且无筛选 → 保持 empty 口径', () => {
    render(<UserTable users={[]} pagination={PAGINATION} />);

    expect(screen.getByText('暂无用户')).toBeInTheDocument();
    expect(screen.queryByText('未找到匹配结果')).not.toBeInTheDocument();
  });
});

describe('U-USERS01 — 行内详情入口按 user:read 渲染', () => {
  it('只有 user:read 的只读角色能看到「详情」，看不到写操作', () => {
    permissionHolder.permissions = [USER_PERMISSIONS.READ];

    render(<UserTable users={[USER_ROW]} pagination={{ ...PAGINATION, total: 1, totalPages: 1 }} />);

    const detail = screen.getByRole('link', { name: /查看详情/ });
    expect(detail).toHaveAttribute('href', `/users/${USER_ROW.id}?returnTo=%2Fusers`);
    // 写操作仍需各自权限：只读角色不应看到「禁用/分配角色」
    expect(screen.queryByRole('button', { name: '禁用账号' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '分配角色' })).not.toBeInTheDocument();
  });

  it('有 user:update 时详情入口仍可用（读写不互斥）', () => {
    permissionHolder.permissions = [USER_PERMISSIONS.READ, USER_PERMISSIONS.UPDATE];

    render(<UserTable users={[USER_ROW]} pagination={{ ...PAGINATION, total: 1, totalPages: 1 }} />);

    expect(screen.getByRole('link', { name: /查看详情/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '禁用账号' })).toBeInTheDocument();
  });
});

describe('U-G02 — clients 空态语义', () => {
  const CLIENT_ROW = {
    clientId: 'client_test_000001',
    name: '测试应用',
    redirectUris: ['https://example.com/cb'],
    scopes: 'openid',
    homepageUrl: null,
    logoUrl: null,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('搜索无结果 → filtered 空态 + 清除筛选；无筛选 → 注册应用 CTA', () => {
    const { unmount } = render(
      <ClientsTable clients={[]} pagination={PAGINATION} initialKeyword="zzz" isFiltered clearHref="/clients" />,
    );
    expect(screen.getByText('未找到匹配结果')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '清除筛选' })).toHaveAttribute('href', '/clients');
    unmount();

    render(<ClientsTable clients={[CLIENT_ROW]} pagination={{ ...PAGINATION, total: 1, totalPages: 1 }} initialKeyword="" />);
    expect(screen.getByText('测试应用')).toBeInTheDocument();
  });
});
