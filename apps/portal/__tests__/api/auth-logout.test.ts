/**
 * 登出 API 单元测试 (POST /api/auth/logout)
 *
 * 覆盖范围：
 * - 无 Cookie → 200（始终成功）
 * - 有 JWT Cookie → 撤销 jti + 清除 Cookie
 * - 有 Login Session → 撤销 jti
 * - 错误处理 → 仍清除全部 Cookie（fail-open）
 *
 * @req AUTH-003
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// =========================================
// Mock 基础设施（vi.hoisted 共享状态）
// =========================================
const {
  mockVerifyAccessToken,
  mockDecodeJwtPayload,
  mockRevokeJti,
  mockGetRefreshTokenFromCookie,
  mockMapDomainError,
  getCookieValues,
  setCookieValues,
} = vi.hoisted(() => {
  const cookieStore: Record<string, string> = {};

  return {
    mockVerifyAccessToken: vi.fn(),
    mockDecodeJwtPayload: vi.fn(),
    mockRevokeJti: vi.fn(),
    mockGetRefreshTokenFromCookie: vi.fn(),
    mockMapDomainError: vi.fn(),
    getCookieValues() {
      return { ...cookieStore };
    },
    setCookieValues(vals: Record<string, string>) {
      Object.keys(cookieStore).forEach((k) => delete cookieStore[k]);
      Object.assign(cookieStore, vals);
    },
  };
});

// Mock cookies
vi.mock('next/headers', () => ({
  cookies: async () => {
    const store = getCookieValues();
    return {
      get: (name: string) => {
        const val = store[name];
        return val ? { name, value: val } : undefined;
      },
    };
  },
}));

// Mock DB
vi.mock('@/infrastructure/db', () => {
  const thenable = () => {
    const o: any = () => {};
    o.then = (fn: Function) => fn(undefined);
    return o;
  };

  return {
    db: new Proxy({}, {
      get() {
        return () => thenable();  // 任何 db 方法都返回 thenable
      },
    }),
    schema: { refreshTokens: { tokenHash: 'tokenHash', userId: 'userId', revoked: 'revoked' } },
  };
});

vi.mock('@/lib/session/revoke', () => ({
  revokeJti: mockRevokeJti,
}));

vi.mock('@/lib/auth/token', () => ({
  verifyAccessToken: mockVerifyAccessToken,
}));

vi.mock('@/lib/session/jwt', () => ({
  decodeJwtPayload: mockDecodeJwtPayload,
}));

vi.mock('@/lib/session/cookies', () => ({
  getRefreshTokenFromCookie: mockGetRefreshTokenFromCookie,
}));

vi.mock('@/domain/shared/error-mapping', () => ({
  mapDomainError: mockMapDomainError,
}));

vi.mock('@auth-sso/contracts', () => ({
  COOKIE_NAMES: {
    JWT: 'portal_jwt_token',
    LOGIN_SESSION: 'login_session',
    REFRESH: 'portal_refresh_token',
  },
}));

import { POST } from '@/app/api/auth/logout/route';

beforeEach(() => {
  vi.clearAllMocks();
  setCookieValues({});
  mockGetRefreshTokenFromCookie.mockResolvedValue(null);
  mockMapDomainError.mockImplementation((err: any) => ({
    status: 500,
    error: 'INTERNAL_ERROR',
    message: err?.message || 'Error',
  }));
});

describe('POST /api/auth/logout', () => {
  it('无 Cookie 时仍返回 200', async () => {
    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it('有 JWT Cookie 时撤销 jti 并清除 Cookie', async () => {
    setCookieValues({ portal_jwt_token: 'valid-jwt' });
    mockVerifyAccessToken.mockResolvedValueOnce({
      jti: 'jti-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'user-uuid',
    });
    mockRevokeJti.mockResolvedValueOnce(undefined);

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockVerifyAccessToken).toHaveBeenCalledWith('valid-jwt');
    expect(mockRevokeJti).toHaveBeenCalledWith('jti-1', expect.any(Number));

    // 三种 Cookie 均被清除
    expect(res.cookies.get('portal_jwt_token')?.value).toBe('');
    expect(res.cookies.get('portal_jwt_token')?.maxAge).toBe(0);
    expect(res.cookies.get('login_session')?.maxAge).toBe(0);
    expect(res.cookies.get('portal_refresh_token')?.maxAge).toBe(0);
  });

  it('有 login_session Cookie 时撤销其 jti', async () => {
    setCookieValues({ login_session: 'session-jwt' });
    mockDecodeJwtPayload.mockReturnValueOnce({
      jti: 'session-jti',
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    mockRevokeJti.mockResolvedValueOnce(undefined);

    const res = await POST();

    expect(res.status).toBe(200);
    expect(mockDecodeJwtPayload).toHaveBeenCalledWith('session-jwt');
    expect(mockRevokeJti).toHaveBeenCalledWith('session-jti', expect.any(Number));
  });

  it('verifyAccessToken 抛出异常时仍然清除 Cookie（fail-open）', async () => {
    setCookieValues({ portal_jwt_token: 'bad-jwt' });
    mockVerifyAccessToken.mockRejectedValueOnce(new Error('Token invalid'));

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // 仍然清除全部 Cookie
    expect(res.cookies.get('portal_jwt_token')?.maxAge).toBe(0);
  });

  it('revokeJti 失败时仍然清除 Cookie', async () => {
    setCookieValues({ portal_jwt_token: 'valid-jwt' });
    mockVerifyAccessToken.mockResolvedValueOnce({
      jti: 'jti-fail',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'user-uuid',
    });
    mockRevokeJti.mockRejectedValueOnce(new Error('Redis down'));

    const res = await POST();

    expect(res.status).toBe(200);
    expect(res.cookies.get('portal_jwt_token')?.maxAge).toBe(0);
  });

  it('有 Login Session 但无 jti 时不调用 revokeJti', async () => {
    setCookieValues({ login_session: 'session-no-jti' });
    mockDecodeJwtPayload.mockReturnValueOnce({ sub: 'user-uuid' });

    const res = await POST();

    expect(res.status).toBe(200);
    expect(mockRevokeJti).not.toHaveBeenCalled();
  });
});
