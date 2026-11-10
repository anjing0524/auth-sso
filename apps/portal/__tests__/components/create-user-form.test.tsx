/**
 * CreateUserForm — 校验失败后**不得清空用户输入**（回归测试）
 *
 * 真实缺陷（2026-10-20 闭环验收）：
 * 表单用 React 19 `<form action={serverAction}>` 但字段是非受控的。React 在 action 结束后会
 * `reset()` 表单 ⇒ 一次"重复邮箱"校验失败就把姓名/账号/邮箱/密码全部清空；用户改好邮箱再点
 * "创建"，只会被 HTML5 `required` 静默拦住（没有请求、没有提示），现场表现就是"功能坏了"。
 *
 * 修复：四个字段改为受控；失败保留输入。本用例钉住"失败后值仍在，且能再次提交"。
 * F7 追加：重复邮箱的服务端文案是英文模板（"User 的 email 已存在"），页面层必须按
 * 错误码映射为中文（U-G07）。
 *
 * @req F-USR-C, U-G07
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// next/navigation：创建成功后 toast 的「分配角色」行动使用 useRouter
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

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
        // 真实错误码 = USER_ERRORS.EMAIL_ALREADY_EXISTS（AUTH_SSO_3004）；mock 里用字面量避免 hoisted TDZ
        error: 'AUTH_SSO_3004',
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

import { CreateUserForm } from '@/app/(dashboard)/users/components/CreateUserForm';
import type * as usersActionsModule from '@/app/(dashboard)/users/actions';
import type * as usePermissionsModule from '@/hooks/use-permissions';

const DEPARTMENTS = [{ id: '00000000-0000-4000-8000-000000000001', name: '总公司' }];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CreateUserForm · 校验失败保留输入', () => {
  it('重复邮箱报错后，四个字段仍保留，改邮箱可再次提交', async () => {
    const user = userEvent.setup();
    render(<CreateUserForm departments={DEPARTMENTS} />);

    await user.type(screen.getByLabelText('显示名称'), '张三');
    await user.type(screen.getByLabelText('用户名（唯一标识）'), 'zhangsan');
    await user.type(screen.getByLabelText('电子邮箱'), 'admin@example.com');
    await user.type(screen.getByLabelText('初始密码'), 'Init@123456');

    await user.click(screen.getByRole('button', { name: '创建' }));
    // 第一次提交走失败分支
    await waitFor(() => expect(createUserAction).toHaveBeenCalledTimes(1), { timeout: 5_000 });

    // U-G07：英文领域模板不得直出；按错误码映射为中文并落到邮箱输入框下方
    expect(await screen.findByText('该邮箱已被使用，请换一个')).toBeInTheDocument();
    expect(screen.queryByText(/User 的 email 已存在/)).not.toBeInTheDocument();

    // 回归点：失败后输入不得被清空（非受控表单会被 React reset）
    expect((screen.getByLabelText('显示名称') as HTMLInputElement).value).toBe('张三');
    expect((screen.getByLabelText('用户名（唯一标识）') as HTMLInputElement).value).toBe('zhangsan');
    expect((screen.getByLabelText('初始密码') as HTMLInputElement).value).toBe('Init@123456');

    const emailInput = screen.getByLabelText('电子邮箱') as HTMLInputElement;
    await user.clear(emailInput);
    await user.type(emailInput, 'zhangsan@example.com');
    await user.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(createUserAction).toHaveBeenCalledTimes(2), { timeout: 5_000 });
    const secondForm = createUserAction.mock.calls[1]?.[1] as FormData;
    expect(secondForm.get('email')).toBe('zhangsan@example.com');
  });
});

describe('CreateUserForm · 默认部门', () => {
  it('未选择部门时提交第一个部门，而不是空值', async () => {
    const user = userEvent.setup();
    render(<CreateUserForm departments={DEPARTMENTS} />);

    await user.type(screen.getByLabelText('显示名称'), '王五');
    await user.type(screen.getByLabelText('用户名（唯一标识）'), 'wangwu');
    await user.type(screen.getByLabelText('电子邮箱'), 'wangwu@example.com');
    expect(screen.getByText(/至少 10 位/)).toBeInTheDocument();
    expect(screen.getByText(/至少三类/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('初始密码'), 'Init@123456');
    await user.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(createUserAction).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    const form = createUserAction.mock.calls[0]?.[1] as FormData;
    expect(form.get('deptId')).toBe(DEPARTMENTS[0]!.id);
  });
});

/** PM-05 / UX-24：初始密码交互（可见性切换 + 生成强密码 + 首登改密说明 + 控件语义） */
describe('CreateUserForm · 初始密码交互', () => {
  it('密码默认掩码，切换后可见，再点切回掩码', async () => {
    const user = userEvent.setup();
    render(<CreateUserForm departments={DEPARTMENTS} />);

    const input = screen.getByLabelText('初始密码') as HTMLInputElement;
    await user.type(input, 'Init@123456');
    expect(input.type).toBe('password');

    await user.click(screen.getByRole('button', { name: '显示密码' }));
    expect(input.type).toBe('text');

    await user.click(screen.getByRole('button', { name: '隐藏密码' }));
    expect(input.type).toBe('password');
  });

  it('「生成强密码」写入满足策略的 16 位密码并自动显示明文', async () => {
    const user = userEvent.setup();
    render(<CreateUserForm departments={DEPARTMENTS} />);

    await user.click(screen.getByRole('button', { name: '生成强密码' }));
    const input = screen.getByLabelText('初始密码') as HTMLInputElement;

    expect(input.value).toHaveLength(16);
    // 领域密码策略：大写/小写/数字/特殊字符至少三类（生成器实际四类俱全）
    expect(input.value).toMatch(/[a-z]/);
    expect(input.value).toMatch(/[A-Z]/);
    expect(input.value).toMatch(/[0-9]/);
    expect(input.value).toMatch(/[^A-Za-z0-9]/);
    // 生成后自动切为可见，便于管理员直接线下告知
    expect(input.type).toBe('text');
  });

  it('帮助文案说明首登强制改密，且密码框不引导自动填充登录密码', () => {
    render(<CreateUserForm departments={DEPARTMENTS} />);
    expect(screen.getByText(/首次登录会被强制修改密码/)).toBeInTheDocument();

    const password = screen.getByLabelText('初始密码') as HTMLInputElement;
    expect(password.getAttribute('autocomplete')).toBe('new-password');
    expect(password.getAttribute('name')).toBe('password');

    const email = screen.getByLabelText('电子邮箱') as HTMLInputElement;
    expect(email.getAttribute('autocomplete')).toBe('email');
    expect(email.getAttribute('name')).toBe('email');
  });
});
