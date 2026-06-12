/**
 * LoginContent 登录页组件测试
 *
 * 注意：LoginContent 并非表单组件，它是一个 SSO 重定向引导页，
 * 展示品牌标识、IdP 跳转提示、错误信息以及统一的"使用身份登录"按钮。
 * 用户点击按钮后跳转到 /api/auth/login 进行 OAuth 流程。
 *
 * 覆盖场景：
 * - 正常：渲染品牌 Logo、标题、IdP 跳转说明
 * - 正常：默认显示"使用统一身份登录"按钮文案
 * - 错误：已知 error code 显示本地化错误提示
 * - 错误：未知 error code 显示 fallback 消息
 * - 错误：error + status 同时展示
 * - 边界：无 error 时不渲染错误 Alert
 * - 边界：有 error 时按钮文案变为"重新尝试登录"
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import LoginContent from '@/app/login/login-content';

// ── Mock next/navigation ────────────────────────────────────
const mockSearchParamsGet = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => ({ get: mockSearchParamsGet })),
}));

// next/link 使用真实实现（在 jsdom 中正常工作，无需 mock）

// ── Tests ────────────────────────────────────────────────────
describe('LoginContent', () => {
  beforeEach(() => {
    mockSearchParamsGet.mockReset();
    // 默认无 error
    mockSearchParamsGet.mockImplementation((_key: string) => null);
  });

  // ── Happy path ────────────────────────────────────────────
  it('renders brand logo and title', () => {
    render(<LoginContent />);
    expect(screen.getByText('Auth-SSO Portal')).toBeInTheDocument();
    expect(screen.getByText('欢迎登录')).toBeInTheDocument();
  });

  it('renders the IdP redirect info message', () => {
    render(<LoginContent />);
    expect(
      screen.getByText(/即将跳转到统一身份认证中心/),
    ).toBeInTheDocument();
  });

  it('shows default button text "使用统一身份登录" when no error', () => {
    render(<LoginContent />);
    expect(screen.getByText('使用统一身份登录')).toBeInTheDocument();
  });

  it('renders help center and privacy policy links', () => {
    render(<LoginContent />);
    expect(screen.getByText('帮助中心')).toBeInTheDocument();
    expect(screen.getByText('隐私政策')).toBeInTheDocument();
  });

  it('renders enterprise description in footer', () => {
    render(<LoginContent />);
    expect(
      screen.getByText(/OpenID Connect 2.1 Compliant/),
    ).toBeInTheDocument();
  });

  // ── Error: known error codes ──────────────────────────────
  it.each([
    ['token_exchange_failed', '登录令牌交换失败，请联系管理员。'],
    ['invalid_state', '登录状态校验失败，请刷新重试。'],
    ['session_expired', '会话已过期，请重新登录。'],
    ['access_denied', '访问被拒绝，权限不足。'],
  ])('shows localized error message for error code "%s"', (errorCode, expectedMsg) => {
    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'error') return errorCode;
      return null;
    });
    render(<LoginContent />);
    expect(screen.getByText(expectedMsg)).toBeInTheDocument();
  });

  // ── Error: unknown error ──────────────────────────────────
  it('shows fallback message for unknown error code', () => {
    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'error') return 'some_unknown_error';
      return null;
    });
    render(<LoginContent />);
    expect(screen.getByText('认证失败: some_unknown_error')).toBeInTheDocument();
  });

  // ── Error: button text change ─────────────────────────────
  it('shows "重新尝试登录" button text when error is present', () => {
    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'error') return 'session_expired';
      return null;
    });
    render(<LoginContent />);
    expect(screen.getByText('重新尝试登录')).toBeInTheDocument();
    expect(screen.queryByText('使用统一身份登录')).not.toBeInTheDocument();
  });

  // ── Error: status code display ────────────────────────────
  it('displays status code in error alert when present', () => {
    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'error') return 'token_exchange_failed';
      if (key === 'status') return '401';
      return null;
    });
    render(<LoginContent />);
    expect(screen.getByText(/(401)/)).toBeInTheDocument();
  });

  // ── Edge: no error ────────────────────────────────────────
  it('does not render error alert when no error param', () => {
    render(<LoginContent />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // ── Edge: login button points to /api/auth/login ──────────
  it('login button links to /api/auth/login', () => {
    render(<LoginContent />);
    const loginLink = screen.getByRole('link', {
      name: /使用统一身份登录/,
    });
    expect(loginLink).toHaveAttribute('href', '/api/auth/login');
  });
});
