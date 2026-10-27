/**
 * UserRolesPage —— 已有角色预勾选回归测试（真实缺陷：REST 信封解析错误；2026-10-23 由 207 行弹窗改为页面）
 *
 * 背景（2026-10-20 功能审计）：`GET /api/users/:id/roles` 是 `restSuccess(array)` ⇒ **裸数组**，
 * 而对话框此前只读 `userRolesData.data`（恒 undefined）。结果是打开"分配角色"时已有角色
 * **全部显示为未勾选**，直接保存会把用户原有角色清空——数据完整性级别的缺陷。
 *
 * 这个用例钉住"裸数组也要正确预勾选"。
 *
 * @req B-USR-ST
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

// @allow-module-mock @/app/(dashboard)/users/actions infra-boundary: 写操作不在本文件断言范围（只测预勾选读取）
vi.mock(import('@/app/(dashboard)/users/actions'), async (importOriginal): Promise<Partial<typeof usersActionsModule>> => {
  const actual = await importOriginal();
  return { ...actual, updateUserRolesAction: vi.fn(async () => ({ success: true as const, data: { assignedCount: 0 } })) };
});

import UserRolesPage from '@/app/(dashboard)/users/[id]/roles/roles-client';
import type * as usersActionsModule from '@/app/(dashboard)/users/actions';

const USER = { id: '00000000-0000-4000-8000-000000000201', name: '张三', deptId: '00000000-0000-4000-8000-000000000001', deptName: '总公司' };

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/roles')) {
      // 列表接口：{ data, pagination }
      return jsonResponse({
        data: [{ id: 'role-1', name: '管理员', code: 'ADMIN', deptId: USER.deptId }],
        pagination: { page: 1, pageSize: 500, total: 1, totalPages: 1 },
      });
    }
    if (url.startsWith(`/api/users/${USER.id}/roles`)) {
      // 已分配接口：restSuccess(array) ⇒ 裸数组（回归点）
      return jsonResponse([{ id: 'role-1', name: '管理员', code: 'ADMIN' }]);
    }
    return jsonResponse({});
  }));
});

describe('UserRolesPage · 已有角色预勾选', () => {
  it('裸数组信封下，已有角色默认勾选', async () => {
    render(<UserRolesPage user={USER} />);

    expect(await screen.findByText('管理员')).toBeInTheDocument();
    const checkbox = await screen.findByRole('checkbox');
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
  });
});
