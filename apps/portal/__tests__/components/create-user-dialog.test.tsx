/**
 * CreateUserDialog — 校验失败后**不得清空用户输入**（回归测试）
 *
 * 真实缺陷（2026-10-20 闭环验收）：
 * 表单用 React 19 `<form action={serverAction}>` 但字段是非受控的。React 在 action 结束后会
 * `reset()` 表单 ⇒ 一次"重复邮箱"校验失败就把姓名/账号/邮箱/密码全部清空；用户改好邮箱再点
 * "创建"，只会被 HTML5 `required` 静默拦住（没有请求、没有提示），现场表现就是"功能坏了"。
 *
 * 修复：四个字段改为受控；失败保留输入。本用例钉住"失败后值仍在，且能再次提交"。
 *
 * @req F-USR-C
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// @allow-module-mock @/hooks/use-permissions infra-boundary: 本用例只测表单输入保持，权限 hook 恒为已授权
vi.mock(import('@/hooks/use-permissions'), async (importOriginal): Promise<Partial<typeof usePermissionsModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    usePermissions: () => ({
      loading: false,
      hasPermission: () => true,
      hasRole: () => true,
      isAdmin: () => true,
      roles: [],
      permissions: [],
    }),
  };
});

// vi.mock 会被提升到 import 之前：用 vi.hoisted 创建替身，避免 TDZ
const { createUserAction } = vi.hoisted(() => ({
  createUserAction: vi.fn(async (_prev: unknown, formData: FormData) => {
    if (formData.get('email') === 'admin@example.com') {
      return {
        success: false as const,
        error: { code: 'USER_EMAIL_EXISTS', message: 'User 的 email 已存在' },
        message: 'User 的 email 已存在',
      };
    }
    return { success: true as const, data: { id: 'new-user-id' }, message: '用户创建成功' };
  }),
}));

// @allow-module-mock @/app/(dashboard)/users/actions infra-boundary: Server Action 由本用例替身为可控返回，断言点在表单状态
vi.mock(import('@/app/(dashboard)/users/actions'), async (importOriginal): Promise<Partial<typeof usersActionsModule>> => {
  const actual = await importOriginal();
  return { ...actual, createUserAction: createUserAction as unknown as typeof usersActionsModule.createUserAction };
});

import CreateUserDialog from '@/app/(dashboard)/users/components/CreateUserDialog';
import type * as usersActionsModule from '@/app/(dashboard)/users/actions';
import type * as usePermissionsModule from '@/hooks/use-permissions';

const DEPARTMENTS = [{ id: '00000000-0000-4000-8000-000000000001', name: '总公司' }];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CreateUserDialog · 校验失败保留输入', () => {
  it('重复邮箱报错后，四个字段仍保留，改邮箱可再次提交', async () => {
    const user = userEvent.setup();
    render(<CreateUserDialog departments={DEPARTMENTS} />);

    await user.click(screen.getByRole('button', { name: '新建用户' }));
    await user.type(screen.getByLabelText('显示名称'), '张三');
    await user.type(screen.getByLabelText('登录账号'), 'zhangsan');
    await user.type(screen.getByLabelText('电子邮箱'), 'admin@example.com');
    await user.type(screen.getByLabelText('初始密码'), 'Init@123456');

    await user.click(screen.getByRole('button', { name: '创建' }));
    // 第一次提交走失败分支（表单不应被关闭）
    await waitFor(() => expect(createUserAction).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // 回归点：失败后输入不得被清空（非受控表单会被 React reset）
    expect((screen.getByLabelText('显示名称') as HTMLInputElement).value).toBe('张三');
    expect((screen.getByLabelText('登录账号') as HTMLInputElement).value).toBe('zhangsan');
    expect((screen.getByLabelText('初始密码') as HTMLInputElement).value).toBe('Init@123456');

    const emailInput = screen.getByLabelText('电子邮箱') as HTMLInputElement;
    await user.clear(emailInput);
    await user.type(emailInput, 'zhangsan@example.com');
    await user.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(createUserAction).toHaveBeenCalledTimes(2));
    const secondForm = createUserAction.mock.calls[1]?.[1] as FormData;
    expect(secondForm.get('email')).toBe('zhangsan@example.com');
  });
});
