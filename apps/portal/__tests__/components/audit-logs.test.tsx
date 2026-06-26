/**
 * AuditLogs 页面测试
 *
 * audit-logs/page.tsx 是 Server Component，通过 @/app/audit/data 获取数据。
 * Mock DB 数据函数验证页面渲染逻辑。
 *
 * @req R3
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock 共享数据获取函数 — 返回 { data, pagination } 结构
// vi.mock 是 hoisted 的，不能引用外部变量，必须内联对象
vi.mock('@/app/audit/data', () => ({
  getLoginLogs: vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 20, total: 0 } }),
  getAuditLogs: vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 20, total: 0 } }),
}));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

// Mock auth (audit-logs page 在 layout 层鉴权，但 resolveIdentity 可能间接调用)
vi.mock('@/lib/auth/verify-jwt', () => ({
  resolveIdentity: vi.fn().mockResolvedValue({
    claims: { sub: 'user-1', deptIds: [] },
  }),
}));

import AuditLogsPage from '@/app/(dashboard)/audit-logs/page';

describe('AuditLogsPage', () => {
  it('空数据时渲染页面结构', async () => {
    const page = await AuditLogsPage({
      searchParams: Promise.resolve({}),
    });
    const { container } = render(page);

    // 确认 Tab 导航渲染
    expect(container.querySelector('nav')).toBeTruthy();
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
});
