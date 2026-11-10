/**
 * LoginForm — 登录域 UI 修复的回归测试
 *
 * 覆盖审计项：
 * - UX-05：空提交不再触发浏览器原生气泡（noValidate），改自定义内联校验
 *   （字段级错误 + aria-invalid + aria-describedby，与密码错误红色提示同一视觉语言）
 * - UX-02：预期业务失败（4xx）用 console.warn + 结构化 code/message，不再出现
 *   error 级 [object Object]
 * - UX-24：输入框具备 id/name 与 autocomplete 语义
 *
 * @req FR-AUTH
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import LoginForm from '@/app/login/login-form';

const fetchMock = vi.fn();

function mockFetchOnce(status: number, body: Record<string, unknown>) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LoginForm 空提交内联校验（UX-05）', () => {
  it('两个字段均为空时提交：显示两条字段级错误，aria-invalid/aria-describedby 就位，不发请求', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole('button', { name: /安全登录/ }));

    // 两条字段级错误（role=alert 的 <p>）；顶部错误框（Alert）此时不应出现
    const alerts = screen.getAllByRole('alert');
    expect(alerts.some((a) => a.textContent === '请输入登录邮箱')).toBe(true);
    expect(alerts.some((a) => a.textContent === '请输入密码')).toBe(true);

    const emailInput = screen.getByLabelText('登录邮箱');
    expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    expect(emailInput).toHaveAttribute('aria-describedby', 'login-email-error');

    const passwordInput = screen.getByLabelText('密码');
    expect(passwordInput).toHaveAttribute('aria-invalid', 'true');
    expect(passwordInput).toHaveAttribute('aria-describedby', 'login-password-error');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('空提交聚焦第一个出错字段（邮箱）', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole('button', { name: /安全登录/ }));

    expect(screen.getByLabelText('登录邮箱')).toHaveFocus();
  });

  it('修正输入后对应字段错误即时清除', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole('button', { name: /安全登录/ }));
    expect(screen.getByText('请输入登录邮箱')).toBeInTheDocument();

    await user.type(screen.getByLabelText('登录邮箱'), 'admin@example.com');

    expect(screen.queryByText('请输入登录邮箱')).not.toBeInTheDocument();
    expect(screen.getByText('请输入密码')).toBeInTheDocument();
  });

  it('表单带 noValidate，不依赖浏览器原生校验气泡', () => {
    render(<LoginForm />);
    expect(screen.getByRole('form', { name: '登录表单' })).toHaveAttribute('novalidate');
  });
});

describe('LoginForm 表单语义（UX-24）', () => {
  it('邮箱/密码输入框具备 id、name 与 autocomplete', () => {
    render(<LoginForm />);

    const email = screen.getByLabelText('登录邮箱');
    expect(email).toHaveAttribute('id', 'login-email');
    expect(email).toHaveAttribute('name', 'email');
    expect(email).toHaveAttribute('autocomplete', 'username');

    const password = screen.getByLabelText('密码');
    expect(password).toHaveAttribute('id', 'login-password');
    expect(password).toHaveAttribute('name', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
  });
});

describe('LoginForm 登录失败日志（UX-02）', () => {
  it('4xx 业务失败：warn 级 + 结构化 code/message，不触发 error 级', async () => {
    mockFetchOnce(401, { error: 'AUTH_SSO_2002', message: '邮箱或密码错误' });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText('登录邮箱'), 'admin@example.com');
    await user.type(screen.getByLabelText('密码'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /安全登录/ }));

    await waitFor(() => expect(screen.getByText('邮箱或密码错误')).toBeInTheDocument());

    expect(console.warn).toHaveBeenCalledWith(
      '[LoginForm]',
      '登录失败',
      { code: 'AUTH_SSO_2002', message: '邮箱或密码错误' },
    );
    expect(console.error).not.toHaveBeenCalled();
    // 失败后密码被清空、邮箱保留（FR-AUTH-14 既有行为不回归）
    expect(screen.getByLabelText('登录邮箱')).toHaveValue('admin@example.com');
    expect(screen.getByLabelText('密码')).toHaveValue('');
  });
});
