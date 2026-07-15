/**
 * 登出 API 集成测试 (POST /api/auth/logout) — 真实 DB
 *
 * 真实 DB 用于 refresh_tokens 撤销、用户查询等操作。
 * JWT 验签 / jti 黑名单 (Redis) / Cookie 读取均保持 mock。
 *
 * @req H-SSO-003, H-SSO-004
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';

const {
  mockVerifyAccessToken,
  mockDecodeJwtPayload,
  mockRevokeJti,
  mockRevokeUserAccessByUserId,
  mockGetRefreshTokenFromCookie,
  mockMapDomainError,
  getCookieValues,
  setCookieValues,
  tdHolder,
} = vi.hoisted(() => {
  const cookieStore: Record<string, string> = {};

  return {
    mockVerifyAccessToken: vi.fn(),
    mockDecodeJwtPayload: vi.fn(),
    mockRevokeJti: vi.fn(),
    mockRevokeUserAccessByUserId: vi.fn(),
    mockGetRefreshTokenFromCookie: vi.fn(),
    mockMapDomainError: vi.fn(),
    tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
    getCookieValues() {
      return { ...cookieStore };
    },
    setCookieValues(vals: Record<string, string>) {
      Object.keys(cookieStore).forEach((k) => delete cookieStore[k]);
      Object.assign(cookieStore, vals);
    },
  };
});

const td = createTestDbHandle();
tdHolder.current = td;

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

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

vi.mock('@/lib/session/revoke', () => ({
  revokeJti: mockRevokeJti,
  revokeUserAccessByUserId: mockRevokeUserAccessByUserId,
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

vi.mock('@/lib/audit', () => ({
  writeLoginLog: () => {},
  extractClientIP: () => null,
  extractUserAgent: () => null,
}));

vi.mock('@/domain/shared/error-mapping', () => ({
  mapDomainError: mockMapDomainError,
}));

vi.mock('@auth-sso/contracts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@auth-sso/contracts')>();
  return {
    ...actual,
  };
});

import { POST } from '@/app/api/auth/logout/route';

const now = new Date();
const TEST_USER_ID = '00000000-0000-4000-8000-000000000301';

function seedTestUsers() {
  return [{
    id: TEST_USER_ID, username: 'testuser', email: 'test@example.com', name: 'Test',
    passwordHash: '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe',
    status: 'ACTIVE' as const,
    emailVerified: true, mobileVerified: false,
    passwordHistory: null, avatarUrl: null, mobile: null, deptId: null,
    lastLoginAt: null, deletedAt: null, passwordChangedAt: null,
    createdAt: now, updatedAt: now,
  }];
}

function buildPostRequest(): any {
  return new Request('http://localhost/api/auth/logout', { method: 'POST' });
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, { users: seedTestUsers() });
  vi.clearAllMocks();
  setCookieValues({});
  mockGetRefreshTokenFromCookie.mockResolvedValue(null);
  mockRevokeUserAccessByUserId.mockResolvedValue(0);
  mockMapDomainError.mockImplementation((err: any) => ({
    status: 500,
    error: 'INTERNAL_ERROR',
    message: err?.message || 'Error',
  }));
});

describe('POST /api/auth/logout', () => {
  it('无 Cookie 时仍返回 200', async () => {
    const res = await POST(buildPostRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
  });

  it('有 JWT Cookie 时撤销 jti 并清除 Cookie', async () => {
    setCookieValues({ portal_jwt_token: 'valid-jwt' });
    mockVerifyAccessToken.mockResolvedValueOnce({
      jti: 'jti-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: TEST_USER_ID,
    });
    mockRevokeJti.mockResolvedValueOnce(undefined);

    const res = await POST(buildPostRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockVerifyAccessToken).toHaveBeenCalledWith('valid-jwt');
    expect(mockRevokeJti).toHaveBeenCalledWith('jti-1', expect.any(Number));

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

    const res = await POST(buildPostRequest());

    expect(res.status).toBe(200);
    expect(mockDecodeJwtPayload).toHaveBeenCalledWith('session-jwt');
    expect(mockRevokeJti).toHaveBeenCalledWith('session-jti', expect.any(Number));
  });

  it('verifyAccessToken 抛出异常时仍然清除 Cookie（fail-open）', async () => {
    setCookieValues({ portal_jwt_token: 'bad-jwt' });
    mockVerifyAccessToken.mockRejectedValueOnce(new Error('Token invalid'));

    const res = await POST(buildPostRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(res.cookies.get('portal_jwt_token')?.maxAge).toBe(0);
  });

  it('revokeJti 失败时仍然清除 Cookie', async () => {
    setCookieValues({ portal_jwt_token: 'valid-jwt' });
    mockVerifyAccessToken.mockResolvedValueOnce({
      jti: 'jti-fail',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: TEST_USER_ID,
    });
    mockRevokeJti.mockRejectedValueOnce(new Error('Redis down'));

    const res = await POST(buildPostRequest());

    expect(res.status).toBe(200);
    expect(res.cookies.get('portal_jwt_token')?.maxAge).toBe(0);
  });

  it('有 Login Session 但无 jti 时不调用 revokeJti', async () => {
    setCookieValues({ login_session: 'session-no-jti' });
    mockDecodeJwtPayload.mockReturnValueOnce({ sub: TEST_USER_ID });

    const res = await POST(buildPostRequest());

    expect(res.status).toBe(200);
    expect(mockRevokeJti).not.toHaveBeenCalled();
  });
});
