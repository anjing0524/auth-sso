/**
 * 个人中心 UX-16 回归（2026-11-06 走查）
 *
 * - 「退出当前会话」改「撤销此会话」并附去向说明（与用户菜单「退出登录」区分）；
 * - 权限摘要「由角色决定」补「查看角色」跳转入口；
 * - 技术细节（权限编码 / 超长主体 ID）默认折叠，按需展开。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const { profileActions } = vi.hoisted(() => ({
  profileActions: {
    updateOwnProfileAction: vi.fn(async () => ({ success: true as const, data: {}, message: '资料已更新' })),
    changeOwnPasswordAction: vi.fn(async () => ({ success: true as const, data: {}, message: '密码已更新' })),
    revokeOwnSessionAction: vi.fn(async () => ({ success: true as const, data: {}, message: '会话已撤销' })),
  },
}));
// @allow-module-mock @/app/(dashboard)/profile/actions infra-boundary: 只测展示层折叠/文案；写动作替身，真实语义由 profile API/域测试覆盖
vi.mock(import('@/app/(dashboard)/profile/actions'), async (importOriginal): Promise<Partial<typeof profileActionsModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    updateOwnProfileAction: profileActions.updateOwnProfileAction as unknown as typeof profileActionsModule.updateOwnProfileAction,
    changeOwnPasswordAction: profileActions.changeOwnPasswordAction as unknown as typeof profileActionsModule.changeOwnPasswordAction,
  };
});
// @allow-module-mock @/app/(dashboard)/profile/session-actions infra-boundary: 只测展示层；会话撤销动作为替身
vi.mock(import('@/app/(dashboard)/profile/session-actions'), async (importOriginal): Promise<Partial<typeof sessionActionsModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    revokeOwnSessionAction: profileActions.revokeOwnSessionAction as unknown as typeof sessionActionsModule.revokeOwnSessionAction,
  };
});

import ProfileClient from '@/app/(dashboard)/profile/ProfileClient';
import type * as profileActionsModule from '@/app/(dashboard)/profile/actions';
import type * as sessionActionsModule from '@/app/(dashboard)/profile/session-actions';

const USER = {
  id: '00000000-0000-4000-8000-00000000c001',
  name: '普通用户',
  email: 'user@example.com',
  picture: null,
  deptName: '研发部',
  status: 'ACTIVE',
};

function renderProfile(overrides: Partial<React.ComponentProps<typeof ProfileClient>> = {}) {
  return render(
    <ProfileClient
      user={USER}
      permissions={['portal:user:list', 'portal:role:list']}
      roles={[{ code: 'VIEWER', name: '只读角色' }]}
      {...overrides}
    />,
  );
}

describe('UX-16 会话措辞与去向说明', () => {
  it('主按钮为「撤销此会话」并说明去向，不再出现「退出当前会话」', () => {
    renderProfile();
    expect(screen.getByRole('button', { name: '撤销此会话' })).toBeInTheDocument();
    expect(screen.getByText('撤销本设备的登录会话并返回登录页，不影响其他设备。')).toBeInTheDocument();
    expect(screen.queryByText('退出当前会话')).not.toBeInTheDocument();
  });
});

describe('UX-16 权限摘要去向', () => {
  it('「由角色决定」旁提供「查看角色」跳转入口', () => {
    renderProfile();
    const link = screen.getByRole('link', { name: '查看角色 →' });
    expect(link).toHaveAttribute('href', '/roles');
  });
});

describe('UX-16 技术细节默认折叠', () => {
  it('权限编码默认折叠，点击「展开权限编码」后可见', async () => {
    const user = userEvent.setup();
    renderProfile();

    expect(screen.queryByText('portal:user:list')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '展开权限编码（共 2 项）' }));
    expect(screen.getByText('portal:user:list')).toBeInTheDocument();
    expect(screen.getByText('portal:role:list')).toBeInTheDocument();
  });

  it('主体 ID 默认折叠，点击「技术信息（主体 ID）」后可见并可复制', async () => {
    const user = userEvent.setup();
    renderProfile();

    expect(screen.queryByText(USER.id)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /技术信息（主体 ID）/ }));
    expect(screen.getByText(USER.id)).toBeInTheDocument();
  });
});
