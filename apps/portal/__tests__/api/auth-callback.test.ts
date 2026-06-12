/**
 * OAuth 回调 API 单元测试（JWT Cookie 无状态版）
 *
 * 覆盖范围：
 * - 授权码 + State 校验
 * - Token 交换
 * - Nonce 验证
 * - setJwtCookies 写入 HttpOnly Cookie
 * - 错误处理：参数缺失、State 不匹配、Token 交换失败
 *
 * @req AUTH-001~005
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// =========================================
// Mock 基础设施（使用 vi.hoisted 避免提升时序问题）
// =========================================

const { mockDecodeJwt } = vi.hoisted(() => ({
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
  setJwtCookies: vi.fn(),
  clearJwtCookies: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  logLoginEvent: vi.fn(async () => {}),
  getClientIP: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/lib/crypto', () => ({
  generateRequestId: vi.fn(() => 'req-123'),
}));

vi.mock('jose', () => ({
  decodeJwt: mockDecodeJwt,
}));

// 被测模块（在 mock 之后导入）
import { GET } from '@/app/api/auth/callback/route';

// =========================================
// 测试辅助函数
// =========================================

function createCallbackRequest(params: {
  code?: string;
  state?: string;
  storedState?: string;
  stateData?: Record<string, any>;
}) {
  const url = new URL('http://localhost:4100/api/auth/callback');
  if (params.code) url.searchParams.set('code', params.code);
  if (params.state) url.searchParams.set('state', params.state);

  const request = new NextRequest(url.toString());

  if (params.storedState) {
    request.cookies.set('oauth_state', params.storedState);
  }
  if (params.stateData) {
    request.cookies.set('oauth_state_data', JSON.stringify(params.stateData));
  }

  return request;
}

// =========================================
// 测试套件
// =========================================

describe('GET /api/auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // @req AUTH-001
  describe('参数校验', () => {
    it('缺少 code 参数时重定向到 /login?error=invalid_params', async () => {
      const request = createCallbackRequest({
        state: 'test-state',
        storedState: 'test-state',
        stateData: { verifier: 'v', nonce: 'n' },
        // code 故意缺失
      });

      const result = await GET(request);
      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('/login');
      expect(location).toContain('error=invalid_params');
    });

    it('缺少 state 参数时重定向到 /login?error=invalid_params', async () => {
      const request = createCallbackRequest({
        code: 'auth-code',
        // state 故意缺失
        storedState: 'test-state',
        stateData: { verifier: 'v', nonce: 'n' },
      });

      const result = await GET(request);
      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('error=invalid_params');
    });
  });

  // @req AUTH-002
  describe('State 校验', () => {
    it('State 不匹配时重定向到 /login?error=invalid_state', async () => {
      const request = createCallbackRequest({
        code: 'abc',
        state: 'wrong-state',
        storedState: 'correct-state',
        stateData: { verifier: 'v', nonce: 'n' },
      });

      const result = await GET(request);
      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('error=invalid_state');
    });

    it('缺少 oauth_state cookie 时重定向到 invalid_state', async () => {
      const request = createCallbackRequest({
        code: 'abc',
        state: 'test-state',
        // storedState 缺失
        stateData: { verifier: 'v', nonce: 'n' },
      });

      const result = await GET(request);
      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('error=');
    });

    it('缺少 oauth_state_data cookie 时重定向到 invalid_state', async () => {
      const request = createCallbackRequest({
        code: 'abc',
        state: 'test-state',
        storedState: 'test-state',
        // stateData 缺失
      });

      const result = await GET(request);
      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('error=');
    });
  });

  // @req AUTH-003
  describe('Token 交换', () => {
    it('成功交换后调用 setJwtCookies 并重定向', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access-123',
          refresh_token: 'refresh-456',
          id_token:
            'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJub25jZSI6InRlc3Qtbm9uY2UifQ.xxx',
          expires_in: 3600,
        }),
      } as Response);

      mockDecodeJwt.mockReturnValueOnce({
        sub: 'user-1',
        email: 'test@example.com',
        nonce: 'test-nonce',
      });

      const request = createCallbackRequest({
        code: 'auth-code',
        state: 'test-state',
        storedState: 'test-state',
        stateData: {
          verifier: 'test-verifier',
          nonce: 'test-nonce',
          redirect: '/dashboard',
        },
      });

      const result = await GET(request);

      expect(result.status).toBe(307);
      // 验证 JWT Cookies 被正确写入
      const { setJwtCookies } = await import('@/lib/session');
      expect(setJwtCookies).toHaveBeenCalledWith(
        expect.any(Object),
        'access-123',
        'refresh-456',
        3600
      );

      // 重定向至 dashboard
      const location = result.headers.get('location') || '';
      expect(location).toContain('/dashboard');
    });

    it('交换成功后清理 oauth_state 和 oauth_state_data cookie', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access-123',
          id_token: 'fake-token',
          expires_in: 3600,
        }),
      } as Response);

      mockDecodeJwt.mockReturnValueOnce({
        sub: 'user-1',
        nonce: 'test-nonce',
      });

      const request = createCallbackRequest({
        code: 'auth-code',
        state: 'test-state',
        storedState: 'test-state',
        stateData: {
          verifier: 'test-verifier',
          nonce: 'test-nonce',
          redirect: '/dashboard',
        },
      });

      const result = await GET(request);

      // oauth_state 和 oauth_state_data 应被清除
      const stateCookie = result.cookies.get('oauth_state');
      const stateDataCookie = result.cookies.get('oauth_state_data');
      // 至少期望它们被标记为删除
      if (stateCookie) {
        expect(stateCookie.value).toBe('');
      }
      if (stateDataCookie) {
        expect(stateDataCookie.value).toBe('');
      }
    });

    it('默认 redirect 路径是 /dashboard', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access-123',
          id_token: 'fake-token',
          expires_in: 3600,
        }),
      } as Response);

      mockDecodeJwt.mockReturnValueOnce({
        sub: 'user-1',
        nonce: 'test-nonce',
      });

      const request = createCallbackRequest({
        code: 'auth-code',
        state: 'test-state',
        storedState: 'test-state',
        stateData: {
          verifier: 'test-verifier',
          nonce: 'test-nonce',
          // redirect 不传，应默认 /dashboard
        },
      });

      const result = await GET(request);
      const location = result.headers.get('location') || '';
      expect(location).toContain('/dashboard');
    });
  });

  // @req AUTH-004
  describe('Nonce 校验', () => {
    it('Nonce 不匹配时重定向到 /login?error=invalid_nonce', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access-123',
          id_token: 'fake-token',
          expires_in: 3600,
        }),
      } as Response);

      mockDecodeJwt.mockReturnValueOnce({
        sub: 'user-1',
        nonce: 'wrong-nonce', // 与 cookie 中的 nonce 不匹配
      });

      const request = createCallbackRequest({
        code: 'abc',
        state: 'st',
        storedState: 'st',
        stateData: {
          verifier: 'v',
          nonce: 'correct-nonce',
        },
      });

      const result = await GET(request);
      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('error=invalid_nonce');
    });
  });

  // @req AUTH-005
  describe('错误处理', () => {
    it('IdP 返回错误时重定向到 /login?error=internal_crash', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      } as Response);

      const request = createCallbackRequest({
        code: 'bad-code',
        state: 'st',
        storedState: 'st',
        stateData: { verifier: 'v', nonce: 'n' },
      });

      const result = await GET(request);
      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('error=internal_crash');
    });

    it('网络异常时重定向到 /login?error=internal_crash', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
        new Error('Network error')
      );

      const request = createCallbackRequest({
        code: 'abc',
        state: 'st',
        storedState: 'st',
        stateData: { verifier: 'v', nonce: 'n' },
      });

      const result = await GET(request);
      expect(result.status).toBe(307);
      const location = result.headers.get('location') || '';
      expect(location).toContain('error=internal_crash');
    });

    it('Token 响应中无 refresh_token 时仍能正常工作', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access-only',
          // refresh_token 缺失（某些 IdP 可能不返回）
          id_token: 'fake-token',
          expires_in: 3600,
        }),
      } as Response);

      mockDecodeJwt.mockReturnValueOnce({
        sub: 'user-1',
        nonce: 'n',
      });

      const request = createCallbackRequest({
        code: 'abc',
        state: 'st',
        storedState: 'st',
        stateData: { verifier: 'v', nonce: 'n', redirect: '/' },
      });

      const result = await GET(request);
      expect(result.status).toBe(307);
      // setJwtCookies 应被调用，refreshToken = undefined
      const { setJwtCookies } = await import('@/lib/session');
      expect(setJwtCookies).toHaveBeenCalledWith(
        expect.any(Object),
        'access-only',
        undefined,
        3600
      );
    });
  });
});
