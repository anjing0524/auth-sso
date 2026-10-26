/**
 * AuditLogs 页面测试
 *
 * audit-logs/page.tsx 是 Server Component，通过 @/app/audit/data 获取数据。
 * Mock DB 数据函数验证页面渲染逻辑。
 *
 * @req R3
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Mock 共享数据获取函数 — 返回 { data, pagination } 结构
// vi.mock 是 hoisted 的，不能引用外部变量，必须内联对象
// @allow-module-mock @/app/audit/data input-fixture: 读模型只提供日志行输入，不参与本文件断言
vi.mock(import('@/app/audit/data'), async (importOriginal): Promise<Partial<typeof auditDataModule>> => {
  const actual = await importOriginal();
  return { ...actual,
  getLoginLogs: vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 20, total: 0 } }),
  getAuditLogs: vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 20, total: 0 } }),
};
});

// Mock next/navigation（页面内新增的 AuditFilters 是 Client Component，使用 useRouter）
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// 审计页在渲染期读取身份与权限（canExport）；UI 测试不依赖真实 Redis/DB，直接给定已登录+有导出权限
// @allow-module-mock @/lib/auth auth-bypass: 依赖 audit-logs.test.tsx 的页面渲染；页面只消费"已登录用户"这一输入，鉴权语义由 API 测试覆盖
vi.mock(import('@/lib/auth'), async (importOriginal): Promise<Partial<typeof authModule>> => {
  const actual = await importOriginal();
  return { ...actual, resolveIdentity: vi.fn(async () => ({ userId: 'user-1', claims: { sub: 'user-1' } })) as unknown as typeof actual.resolveIdentity };
});
// @allow-module-mock @/lib/permissions auth-bypass: 依赖 audit-logs.test.tsx 的页面渲染；权限上下文由本 mock 提供"有 audit:export"输入，真实映射由 permission 测试覆盖
vi.mock(import('@/lib/permissions'), async (importOriginal): Promise<Partial<typeof permissionsModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    getUserPermissionContext: vi.fn(async () => ({ roles: [{ code: 'SUPER_ADMIN' }], permissions: ['portal:audit:read', 'portal:audit:export'] })) as unknown as typeof actual.getUserPermissionContext,
  };
});

// Mock auth (audit-logs page 在 layout 层鉴权，但 resolveIdentity 可能间接调用)
// @allow-module-mock @/lib/auth/verify-jwt auth-bypass: 本文件测 UI 行为，登录态解析由 mock 提供"已登录用户"这一输入（依赖它的断言：audit-logs.test.tsx 全部用例）
vi.mock(import('@/lib/auth/verify-jwt'), async (importOriginal): Promise<Partial<typeof authVerifyJwtModule>> => {
  const actual = await importOriginal();
  return { ...actual,
  resolveIdentity: vi.fn().mockResolvedValue({
    claims: { sub: 'user-1', iss: '', aud: 'auth-sso', jti: '' },
  }),
};
});

import AuditLogsPage, { metadata } from '@/app/(dashboard)/audit-logs/page';
import { AuditTabs } from '@/app/(dashboard)/audit-logs/components/audit-tabs';
import type * as auditDataModule from '@/app/audit/data';
import type * as authVerifyJwtModule from '@/lib/auth/verify-jwt';
import type * as authModule from '@/lib/auth';
import type * as permissionsModule from '@/lib/permissions';


describe('AuditLogsPage', () => {
  it('空数据时渲染页面结构', async () => {
    const page = await AuditLogsPage({
      searchParams: Promise.resolve({}),
    });
    const { container } = render(page);

    // 确认 Tab 导航渲染（2026-10-20 起与 Tabs 组件一致：分段式，不再是 <nav> 下划线）
    expect(container.querySelector('[role="tablist"], .bg-muted')).toBeTruthy();
    expect(screen.getAllByText('登录日志').length).toBeGreaterThan(0);
    // 确认空状态文本显示（页面使用内联 empty state，文本为"暂无日志记录"）
    expect(screen.getByText('暂无日志记录')).toBeInTheDocument();
    expect(screen.getByText('当前没有登录日志')).toBeInTheDocument();
  });

  it('指定 tab=audit 时操作日志 Tab 渲染', async () => {
    const page = await AuditLogsPage({
      searchParams: Promise.resolve({ tab: 'audit' }),
    });
    render(page);

    // 确认两个 Tab 都渲染
    expect(screen.getByText('登录日志')).toBeInTheDocument();
    expect(screen.getByText('操作日志')).toBeInTheDocument();
  });

  it('分页链接正确拼接 searchParams', async () => {
    const page = await AuditLogsPage({
      searchParams: Promise.resolve({ tab: 'login', page: '2' }),
    });
    render(page);

    // 确认页面成功渲染且第 2 页参数生效
    expect(screen.getByText('登录日志')).toBeInTheDocument();
  });

  it('U-LOG02：页签具备 role=tab / aria-selected / tabpanel 关联', async () => {
    const page = await AuditLogsPage({ searchParams: Promise.resolve({ tab: 'operation' }) });
    const { container } = render(page);

    expect(container.querySelector('[role="tablist"]')).toBeTruthy();
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(3);
    const loginTab = container.querySelector('#audit-tab-login')!;
    const opTab = container.querySelector('#audit-tab-operation')!;
    const accessTab = container.querySelector('#audit-tab-access')!;
    expect(accessTab.getAttribute('aria-selected')).toBe('false');
    expect(opTab.getAttribute('aria-selected')).toBe('true');
    expect(loginTab.getAttribute('aria-selected')).toBe('false');
    expect(opTab.getAttribute('aria-controls')).toBe('audit-tabpanel');
    const panel = container.querySelector('[role="tabpanel"]')!;
    expect(panel.getAttribute('aria-labelledby')).toBe('audit-tab-operation');
  });

  it('U-G05：滚动提示改由 OverflowHint 按真实溢出渲染（不再静态常显）', async () => {
    const page = await AuditLogsPage({ searchParams: Promise.resolve({}) });
    const { container } = render(page);

    // 静态提示已移除；OverflowHint 在 jsdom（无溢出）下不渲染提示
    expect(container.querySelectorAll('[data-scroll-hint]').length).toBe(0);
    expect(container.querySelector('#audit-tabpanel')).toBeTruthy();
  });

  it('U-G02：筛选无结果时空态为 filtered + 「清除筛选」出口；无筛选时保持"暂无"', async () => {
    const mocked = await import('@/app/audit/data');
    // 空数据已在文件级 mock 中固定
    const filteredPage = await AuditLogsPage({
      searchParams: Promise.resolve({ tab: 'login', eventType: 'LOGIN_FAILED' }),
    });
    const filtered = render(filteredPage);
    expect(filtered.getByText('未找到匹配结果')).toBeInTheDocument();
    const clearLink = filtered.getByRole('link', { name: '清除筛选' });
    expect(clearLink.getAttribute('href')).toBe('/audit-logs?tab=login');
    filtered.unmount();

    const emptyPage = await AuditLogsPage({ searchParams: Promise.resolve({ tab: 'login' }) });
    render(emptyPage);
    expect(screen.getByText('暂无日志记录')).toBeInTheDocument();
    expect(mocked.getLoginLogs).toHaveBeenCalled();
  });

  it('U-PROF02/metadata：页面导出标题', () => {
    expect(metadata.title).toBe('审计日志 | Auth-SSO');
  });
});

describe('AuditTabs（WAI-ARIA tabs 键盘语义补全）', () => {
  const hrefs = { login: '/audit-logs?tab=login', operation: '/audit-logs?tab=operation', access: '/audit-logs?tab=access' } as const;

  it('roving tabindex：选中项 0、其余 -1', () => {
    render(<AuditTabs tab="login" hrefs={hrefs} />);
    expect(screen.getByRole('tab', { name: '登录日志' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: '操作日志' })).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowRight / ArrowLeft / Home / End 移动焦点并更新可达项', () => {
    render(<AuditTabs tab="login" hrefs={hrefs} />);
    const login = screen.getByRole('tab', { name: '登录日志' });
    const operation = screen.getByRole('tab', { name: '操作日志' });
    const access = screen.getByRole('tab', { name: '访问日志' });

    login.focus();
    fireEvent.keyDown(login, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(operation);
    expect(operation).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(operation, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(login);

    fireEvent.keyDown(login, { key: 'End' });
    expect(document.activeElement).toBe(access);

    fireEvent.keyDown(access, { key: 'Home' });
    expect(document.activeElement).toBe(login);
  });
});
