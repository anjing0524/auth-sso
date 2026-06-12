/**
 * Portal SSO 安全控制单元测试（JWT Cookie 无状态版）
 *
 * 覆盖范围：
 * - Login 端点生成 PKCE 授权 URL
 * - Login 端点设置 oauth_state / oauth_state_data Cookie
 * - State 指纹校验与防 CSRF
 * - 授权码重用检测（重放保护）
 * - Cookie HttpOnly/SameSite 属性验证
 *
 * @req AUTH-002, AUTH-003, AUTH-005, G-SEC-INT
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// =========================================
// Mock 基础设施（使用 vi.hoisted 避免提升时序问题）
// =========================================

const { mockSetJwtCookies, mockDecodeJwt } = vi.hoisted(() => ({
  mockSetJwtCookies: vi.fn(),
  mockDecodeJwt: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  oauthConfig: {
    idpUrl: 'http://localhost:4101',
    clientId: 'portal',
    redirectUri: 'http://localhost:4100/api/auth/callback',
    scopes: ['openid', 'profile', 'email', 'offline_access'],
  },
}));

vi.mock('@/lib/session', () => ({
  setJwtCookies: mockSetJwtCookies,
}));

vi.mock('@/lib/audit', () => ({
  logLoginEvent: vi.fn(async () => {}),
  getClientIP: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/lib/crypto', () => ({
  generateCodeVerifier: vi.fn(() => 'mock-verifier-abc123def456'),
  generateCodeChallenge: vi.fn((verifier: string) => `challenge-for-${verifier}`),
  generateState: vi.fn(() => 'mock-state-64chars-' + 'x'.repeat(45)),
  generateNonce: vi.fn(() => 'mock-nonce-32chars-' + 'x'.repeat(14)),
  generateRequestId: vi.fn(() => 'req-123'),
}));

vi.mock('jose', () => ({
  decodeJwt: mockDecodeJwt,
}));

// 被测模块（在 mock 之后导入）
import { GET as LoginGet } from '@/app/api/auth/login/route';
import { GET as CallbackGet } from '@/app/api/auth/callback/route';

describe('SSO Security Controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ======== PKCE 验证 ========

  describe('PKCE Verification', () => {
    it('Login 端点生成有效的授权 URL 包含全部 PKCE 参数', async () => {
      const response = await LoginGet(
        new NextRequest('http://localhost:4000/api/auth/login')
      );

      expect(response.status).toBe(307);

      const location = response.headers.get('location') || '';
      const url = new URL(location);

      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe('portal');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'http://localhost:4100/api/auth/callback'
      );
      expect(url.searchParams.get('scope')).toBe(
        'openid profile email offline_access'
      );
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('state')).toBeTruthy();
      expect(url.searchParams.get('nonce')).toBeTruthy();
    });

    it('PKCE code_challenge 使用 S256 method（拒绝 plain）', async () => {
      const response = await LoginGet(
        new NextRequest('http://localhost:4000/api/auth/login')
      );

      const location = response.headers.get('location') || '';
      const url = new URL(location);

      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
    });

    it('PKCE code_verifier 与 code_challenge 匹配失败时回调重定向到错误页', async () => {
      const url = new URL(
        'http://localhost:4100/api/auth/callback?code=abc&state=test-state'
      );
      const req = new NextRequest(url.toString());
      req.cookies.set('oauth_state', 'test-state');
      req.cookies.set(
        'oauth_state_data',
        JSON.stringify({
          verifier: 'stored-verifier',
          nonce: 'test-nonce',
          redirect: '/dashboard',
        })
      );

      // IdP 返回 PKCE 验证失败
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'pkce_verification_failed',
      } as Response);

      const result = await CallbackGet(req);
      expect(result.status).toBe(307);

      const location = result.headers.get('location') || '';
      expect(location).toContain('error=');
    });

    it('授权码重放保护：第一次成功，第二次 IdP 拒绝', async () => {
      // 第一次调用成功
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access-1',
          id_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.xxx',
          expires_in: 3600,
        }),
      } as Response);

      mockDecodeJwt.mockReturnValueOnce({ sub: 'user-1', nonce: 'n' });

      const req1 = new NextRequest(
        'http://localhost:4100/api/auth/callback?code=same-code&state=st'
      );
      req1.cookies.set('oauth_state', 'st');
      req1.cookies.set(
        'oauth_state_data',
        JSON.stringify({ verifier: 'v', nonce: 'n', redirect: '/' })
      );

      const firstResult = await CallbackGet(req1);
      expect(firstResult.status).toBe(307);
      const firstLocation = firstResult.headers.get('location') || '';
      expect(firstLocation).not.toContain('error=');

      // 第二次使用同一授权码（IdP 拒绝 – 授权码已使用）
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      } as Response);

      const req2 = new NextRequest(
        'http://localhost:4100/api/auth/callback?code=same-code&state=st'
      );
      req2.cookies.set('oauth_state', 'st');
      req2.cookies.set(
        'oauth_state_data',
        JSON.stringify({ verifier: 'v', nonce: 'n', redirect: '/' })
      );

      const secondResult = await CallbackGet(req2);
      expect(secondResult.status).toBe(307);
      const secondLocation = secondResult.headers.get('location') || '';
      expect(secondLocation).toContain('error=');
    });
  });

  // ======== State 验证 ========

  describe('State Parameter', () => {
    it('State 不匹配时重定向到 /login?error=invalid_state', async () => {
      const url = new URL(
        'http://localhost:4100/api/auth/callback?code=abc&state=wrong-state'
      );
      const req = new NextRequest(url.toString());
      req.cookies.set('oauth_state', 'correct-state');
      req.cookies.set(
        'oauth_state_data',
        JSON.stringify({ verifier: 'v', nonce: 'n' })
      );

      const result = await CallbackGet(req);
      expect(result.status).toBe(307);

      const location = result.headers.get('location') || '';
      expect(location).toContain('error=invalid_state');
    });

    it('缺少 oauth_state cookie 时视为 state 不匹配', async () => {
      const url = new URL(
        'http://localhost:4100/api/auth/callback?code=abc&state=test-state'
      );
      const req = new NextRequest(url.toString());
      // oauth_state cookie 缺失
      req.cookies.set(
        'oauth_state_data',
        JSON.stringify({ verifier: 'v', nonce: 'n' })
      );

      const result = await CallbackGet(req);
      expect(result.status).toBe(307);

      const location = result.headers.get('location') || '';
      expect(location).toContain('error=');
    });
  });

  // ======== Cookie 安全属性 ========

  describe('Cookie Security Attributes', () => {
    it('Login 端点设置 oauth_state cookie（HttpOnly, SameSite=lax, path=/）', async () => {
      const response = await LoginGet(
        new NextRequest('http://localhost:4000/api/auth/login')
      );

      const stateCookie = response.cookies.get('oauth_state');
      expect(stateCookie).toBeDefined();
      expect(stateCookie!.httpOnly).toBe(true);
      expect(stateCookie!.sameSite).toBe('lax');
      expect(stateCookie!.path).toBe('/');
      expect(stateCookie!.maxAge).toBe(600);
    });

    it('Login 端点设置 oauth_state_data cookie（HttpOnly, SameSite=lax, path=/）', async () => {
      const response = await LoginGet(
        new NextRequest('http://localhost:4000/api/auth/login')
      );

      const stateDataCookie = response.cookies.get('oauth_state_data');
      expect(stateDataCookie).toBeDefined();
      expect(stateDataCookie!.httpOnly).toBe(true);
      expect(stateDataCookie!.sameSite).toBe('lax');
      expect(stateDataCookie!.path).toBe('/');
      expect(stateDataCookie!.maxAge).toBe(600);
    });

    it('oauth_state_data cookie 包含 verifier、nonce 和 redirect', async () => {
      const response = await LoginGet(
        new NextRequest('http://localhost:4000/api/auth/login')
      );

      const stateDataCookie = response.cookies.get('oauth_state_data');
      expect(stateDataCookie).toBeDefined();

      const parsed = JSON.parse(stateDataCookie!.value);
      expect(parsed).toHaveProperty('verifier');
      expect(parsed).toHaveProperty('nonce');
      expect(parsed).toHaveProperty('redirect');
      expect(parsed).toHaveProperty('createdAt');
    });

    it('Login 端点生成授权 URL 中的 state 与 cookie 中的 state 一致', async () => {
      const response = await LoginGet(
        new NextRequest('http://localhost:4000/api/auth/login')
      );

      const location = response.headers.get('location') || '';
      const url = new URL(location);
      const stateInUrl = url.searchParams.get('state');

      const stateCookie = response.cookies.get('oauth_state');
      expect(stateCookie!.value).toBe(stateInUrl);
    });

    it('生产环境设置 cookie secure 属性', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const response = await LoginGet(
        new NextRequest('http://localhost:4000/api/auth/login')
      );

      const stateCookie = response.cookies.get('oauth_state');
      expect(stateCookie!.secure).toBe(true);

      process.env.NODE_ENV = originalEnv;
    });
  });

  // ======== 授权码重用检测 ========

  describe('Authorization Code Reuse', () => {
    it('授权码重用时回调重定向到错误页（IdP 返回 invalid_grant）', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      } as Response);

      const url = new URL(
        'http://localhost:4100/api/auth/callback?code=reused-code&state=st'
      );
      const req = new NextRequest(url.toString());
      req.cookies.set('oauth_state', 'st');
      req.cookies.set(
        'oauth_state_data',
        JSON.stringify({ verifier: 'v', nonce: 'n', redirect: '/' })
      );

      const result = await CallbackGet(req);
      expect(result.status).toBe(307);

      const location = result.headers.get('location') || '';
      expect(location).toContain('error=');
    });
  });

  // ======== Login 端点错误处理 ========

  describe('Login 端点错误处理', () => {
    it('crypto 函数异常时返回 500 JSON', async () => {
      const { generateState } = await import('@/lib/crypto');
      (generateState as any).mockImplementationOnce(() => {
        throw new Error('crypto failure');
      });

      const response = await LoginGet(
        new NextRequest('http://localhost:4000/api/auth/login')
      );

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('AUTH_SSO_1006');
    });
  });
});
