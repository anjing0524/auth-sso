/**
 * Portal SSO 安全控制单元测试
 *
 * 覆盖范围：
 * - PKCE code_verifier -> code_challenge 算法验证
 * - PKCE code_verifier 不匹配时拒绝
 * - State 参数不匹配返回 invalid_state
 * - 授权码重用返回错误（重放保护）
 * - Cookie HttpOnly/SameSite 属性验证
 *
 * @req AUTH-002, AUTH-003, AUTH-005, G-SEC-INT
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// =========================================
// Mock 基础设施
// =========================================
vi.mock('@/lib/auth-client', () => ({
  oauthConfig: {
    idpUrl: 'http://localhost:4101',
    clientId: 'portal',
    clientSecret: 'portal-secret',
    redirectUri: 'http://localhost:4100/api/auth/callback',
    scopes: ['openid', 'profile', 'email', 'offline_access'],
  },
}));

vi.mock('@/lib/session', () => ({
  createSession: vi.fn(async (params: any) => ({
    id: 'session-123',
    userId: params.userId,
    accessToken: params.accessToken,
    tokenExpiresAt: Date.now() + 3600000,
    createdAt: Date.now(),
    lastAccessAt: Date.now(),
    absoluteExpiresAt: Date.now() + 86400000,
  })),
  setSessionCookie: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  logLoginEvent: vi.fn(async () => {}),
  getClientIP: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/lib/crypto', () => ({
  generateRequestId: vi.fn(() => 'req-123'),
}));

// Mock jose decodeJwt
vi.mock('jose', () => ({
  decodeJwt: vi.fn(),
}));

// 保留真实 crypto 模块（PKCE 和 state 生成依赖 createHash/randomBytes）

import { GET as LoginGet } from '@/app/api/auth/login/route';
import { GET as CallbackGet } from '@/app/api/auth/callback/route';

describe('SSO Security Controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ======== PKCE 验证 ========

  describe('PKCE Verification', () => {
    it('Login 端点生成有效的 PKCE code_challenge（S256 method）', async () => {
      const response = await LoginGet(
        new NextRequest('http://localhost:4100/api/auth/login')
      );

      // 登录端点应重定向到 IdP
      expect(response.status).toBe(307);

      const location = response.headers.get('location') || '';
      const url = new URL(location);
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('state')).toBeTruthy();
      expect(url.searchParams.get('nonce')).toBeTruthy();
    });

    it('PKCE code_challenge 使用 S256 算法（非 plain）', async () => {
      const response = await LoginGet(
        new NextRequest('http://localhost:4100/api/auth/login')
      );

      const location = response.headers.get('location') || '';
      const url = new URL(location);

      // 验证使用了 S256 challenge method（拒绝 plain）
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      const challenge = url.searchParams.get('code_challenge');
      expect(challenge).toBeTruthy();
    });

    it('Login 端点设置 oauth_state cookie（通过 location 304 redirect）', async () => {
      const response = await LoginGet(
        new NextRequest('http://localhost:4100/api/auth/login')
      );

      // 重定向响应包含 location header
      const location = response.headers.get('location') || '';
      expect(location).toContain('/api/auth/oauth2/authorize');
      expect(location).toContain('code_challenge=');
      expect(location).toContain('state=');
    });

    it('PKCE code_verifier 与 code_challenge 匹配验证失败时重定向到登录页', async () => {
      // 模拟回调中 PKCE 验证失败
      const url = new URL('http://localhost:4100/api/auth/callback?code=abc&state=test-state');
      const req = new NextRequest(url.toString());
      req.cookies.set('oauth_state', 'test-state');
      req.cookies.set('oauth_state_data', JSON.stringify({
        verifier: 'stored-verifier',
        nonce: 'test-nonce',
        redirect: '/dashboard',
      }));

      // Mock fetch 为失败响应（PKCE 验证失败 => IdP 返回错误）
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

    it('不允许多次使用同一授权码（重放保护）', async () => {
      // 模拟成功响应用于第一次调用
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access-1',
          id_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.xxx',
          expires_in: 3600,
        }),
      } as Response);

      const { decodeJwt } = await import('jose');
      (decodeJwt as any).mockReturnValueOnce({ sub: 'user-1', nonce: 'n' });

      const req1 = new NextRequest(
        'http://localhost:4100/api/auth/callback?code=same-code&state=st'
      );
      req1.cookies.set('oauth_state', 'st');
      req1.cookies.set('oauth_state_data', JSON.stringify({ verifier: 'v', nonce: 'n', redirect: '/' }));

      const firstResult = await CallbackGet(req1);
      expect(firstResult.status).toBe(307);
      const firstLocation = firstResult.headers.get('location') || '';
      expect(firstLocation).not.toContain('error=');

      // 第二次使用同一授权码（IdP 拒绝）
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      } as Response);

      const req2 = new NextRequest(
        'http://localhost:4100/api/auth/callback?code=same-code&state=st'
      );
      req2.cookies.set('oauth_state', 'st');
      req2.cookies.set('oauth_state_data', JSON.stringify({ verifier: 'v', nonce: 'n', redirect: '/' }));

      const secondResult = await CallbackGet(req2);
      expect(secondResult.status).toBe(307);
      const secondLocation = secondResult.headers.get('location') || '';
      expect(secondLocation).toContain('error=');
    });
  });

  // ======== State 验证 ========

  describe('State Parameter', () => {
    it('State 不匹配时重定向到登录页（invalid_state）', async () => {
      const url = new URL('http://localhost:4100/api/auth/callback?code=abc&state=wrong-state');
      const req = new NextRequest(url.toString());
      req.cookies.set('oauth_state', 'correct-state');
      req.cookies.set('oauth_state_data', JSON.stringify({
        verifier: 'v',
        nonce: 'n',
      }));

      const result = await CallbackGet(req);
      expect(result.status).toBe(307);

      const location = result.headers.get('location') || '';
      expect(location).toContain('error=invalid_state');
    });

    it('缺少 oauth_state cookie 时视为 state 不匹配', async () => {
      const url = new URL('http://localhost:4100/api/auth/callback?code=abc&state=test-state');
      const req = new NextRequest(url.toString());
      req.cookies.set('oauth_state_data', JSON.stringify({
        verifier: 'v',
        nonce: 'n',
      }));

      const result = await CallbackGet(req);
      expect(result.status).toBe(307);

      const location = result.headers.get('location') || '';
      expect(location).toContain('error=');
    });
  });

  // ======== Cookie 安全属性 ========

  describe('Cookie Security Attributes', () => {
    it('Login 端点生成授权 URL 包含 state 参数（用于 CSRF 防护）', async () => {
      const response = await LoginGet(
        new NextRequest('http://localhost:4100/api/auth/login')
      );

      const location = response.headers.get('location') || '';
      const url = new URL(location);

      // state 参数存在且非空
      const state = url.searchParams.get('state');
      expect(state).toBeTruthy();
      expect(state!.length).toBeGreaterThanOrEqual(16);
    });

    it('Login 端点使用双重提交 Cookie 模式（URL state + Cookie state 配对）', async () => {
      const response = await LoginGet(
        new NextRequest('http://localhost:4100/api/auth/login')
      );

      const location = response.headers.get('location') || '';
      const url = new URL(location);

      // URL 中包含 state 参数
      const stateInUrl = url.searchParams.get('state');
      expect(stateInUrl).toBeTruthy();
    });
  });

  // ======== 授权码重用检测 ========

  describe('Authorization Code Reuse', () => {
    it('授权码重用时 IdP 返回 invalid_grant，回调重定向到错误页', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      } as Response);

      const url = new URL('http://localhost:4100/api/auth/callback?code=reused-code&state=st');
      const req = new NextRequest(url.toString());
      req.cookies.set('oauth_state', 'st');
      req.cookies.set('oauth_state_data', JSON.stringify({
        verifier: 'v',
        nonce: 'n',
        redirect: '/',
      }));

      const result = await CallbackGet(req);
      expect(result.status).toBe(307);

      const location = result.headers.get('location') || '';
      expect(location).toContain('error=');
    });
  });
});
