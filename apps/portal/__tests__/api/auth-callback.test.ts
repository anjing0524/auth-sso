/**
 * OAuth 回调 API 单元测试
 *
 * 覆盖范围：
 * - 授权码 + State 校验
 * - Token 交换
 * - Nonce 验证
 * - Session 创建与 Cookie 设置
 * - 错误处理：参数缺失、State 不匹配、Token 交换失败
 *
 * @req AUTH-001~005
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/auth/callback/route';

// Mock 外部依赖
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
  decodeJwt: vi.fn(() => ({
    sub: 'user-1',
    email: 'test@example.com',
    nonce: 'test-nonce',
  })),
}));

/**
 * 创建带 OAuth state cookies 的回调请求
 */
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

describe('GET /api/auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // @req AUTH-001
  it('缺少 code 参数时重定向到登录页', async () => {
    const request = createCallbackRequest({
      state: 'test-state',
      storedState: 'test-state',
      stateData: { verifier: 'v', nonce: 'n', redirect: '/' },
    });
    // 不传 code
    // 注意：callback 在缺少 code 时使用 request.nextUrl.searchParams
    // 需要用完整 URL
    const url = new URL('http://localhost:4100/api/auth/callback?state=test-state');
    const req = new NextRequest(url.toString());
    req.cookies.set('oauth_state', 'test-state');
    req.cookies.set('oauth_state_data', JSON.stringify({ verifier: 'v', nonce: 'n' }));

    const result = await GET(req);
    expect(result.status).toBe(307);
    const location = result.headers.get('location') || '';
    expect(location).toContain('/login');
    expect(location).toContain('error=invalid_params');
  });

  // @req AUTH-002
  it('State 不匹配时重定向到登录页', async () => {
    const url = new URL('http://localhost:4100/api/auth/callback?code=abc&state=wrong-state');
    const req = new NextRequest(url.toString());
    req.cookies.set('oauth_state', 'correct-state');
    req.cookies.set('oauth_state_data', JSON.stringify({ verifier: 'v', nonce: 'n' }));

    const result = await GET(req);
    expect(result.status).toBe(307);
    const location = result.headers.get('location') || '';
    expect(location).toContain('error=invalid_state');
  });

  // @req AUTH-003
  it('Token 交换成功后创建 Session 并重定向', async () => {
    // Mock fetch 返回成功 Token 响应
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'access-123',
        refresh_token: 'refresh-456',
        id_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJub25jZSI6InRlc3Qtbm9uY2UifQ.xxx',
        expires_in: 3600,
      }),
    } as Response);

    const url = new URL('http://localhost:4100/api/auth/callback?code=auth-code&state=test-state');
    const req = new NextRequest(url.toString());
    req.cookies.set('oauth_state', 'test-state');
    req.cookies.set('oauth_state_data', JSON.stringify({
      verifier: 'test-verifier',
      nonce: 'test-nonce',
      redirect: '/dashboard',
    }));

    const result = await GET(req);
    expect(result.status).toBe(307);

    // 验证 Session 创建被调用
    const { createSession } = await import('@/lib/session');
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
      })
    );

    // 验证重定向到 dashboard
    const location = result.headers.get('location') || '';
    expect(location).toContain('dashboard');
  });

  // @req AUTH-004
  it('Nonce 不匹配时重定向到登录页', async () => {
    // 返回不匹配的 nonce
    const { decodeJwt } = await import('jose');
    (decodeJwt as any).mockReturnValueOnce({
      sub: 'user-1',
      email: 'test@example.com',
      nonce: 'wrong-nonce',
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'access-123',
        id_token: 'fake-token',
        expires_in: 3600,
      }),
    } as Response);

    const url = new URL('http://localhost:4100/api/auth/callback?code=abc&state=st');
    const req = new NextRequest(url.toString());
    req.cookies.set('oauth_state', 'st');
    req.cookies.set('oauth_state_data', JSON.stringify({
      verifier: 'v',
      nonce: 'correct-nonce',
    }));

    const result = await GET(req);
    expect(result.status).toBe(307);
    const location = result.headers.get('location') || '';
    expect(location).toContain('error=invalid_nonce');
  });

  // @req AUTH-005
  it('Token 交换失败时重定向到登录页（内部错误）', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    } as Response);

    const url = new URL('http://localhost:4100/api/auth/callback?code=bad-code&state=st');
    const req = new NextRequest(url.toString());
    req.cookies.set('oauth_state', 'st');
    req.cookies.set('oauth_state_data', JSON.stringify({
      verifier: 'v',
      nonce: 'n',
    }));

    const result = await GET(req);
    expect(result.status).toBe(307);
    const location = result.headers.get('location') || '';
    expect(location).toContain('error=internal_crash');
  });

  it('网络异常时重定向到登录页', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

    const url = new URL('http://localhost:4100/api/auth/callback?code=abc&state=st');
    const req = new NextRequest(url.toString());
    req.cookies.set('oauth_state', 'st');
    req.cookies.set('oauth_state_data', JSON.stringify({
      verifier: 'v',
      nonce: 'n',
    }));

    const result = await GET(req);
    expect(result.status).toBe(307);
    const location = result.headers.get('location') || '';
    expect(location).toContain('error=internal_crash');
  });
});
