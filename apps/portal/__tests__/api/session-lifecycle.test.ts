/**
 * JWT Cookie 会话生命周期测试 — 真实 DB (jwks 表)
 *
 * verifyAccessToken 路径需要 jwks 表提供签名公钥，
 * revokeUserToken 需要 access_tokens 表执行 DELETE。
 *
 * @req H-SESS-001~006, H-SSO-004
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { NextResponse } from 'next/server';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedJwks } from '../helpers/seed-fixtures';

const { mockGetRedis, mockStore, tdHolder } = vi.hoisted(() => {
  const storeMap = new Map<string, string>();

  return {
    tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
    mockStore: {
      clear: () => storeMap.clear(),
      get: (key: string) => storeMap.get(key),
      set: (key: string, value: string) => storeMap.set(key, value),
    },
    mockGetRedis: () => ({
      setex: async (key: string, _ttl: number, value: string) => {
        storeMap.set(key, value);
      },
      exists: async (key: string) => {
        return storeMap.has(key) ? 1 : 0;
      },
      get: async (key: string) => {
        return storeMap.get(key) || null;
      },
      del: async (key: string) => {
        storeMap.delete(key);
      },
      hset: async () => 1,
      hgetall: async () => ({}),
      expire: async () => 1,
      pipeline: () => ({
        setex: function () { return this; },
        del: function () { return this; },
        exec: async () => [],
      }),
    }),
  };
});

const td = createTestDbHandle();
tdHolder.current = td;

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

vi.mock('@/infrastructure/redis', () => ({
  getRedis: () => mockGetRedis(),
}));

const store = mockStore;

const mockCookiesGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: mockCookiesGet,
  }),
}));

vi.mock('jose', () => ({
  jwtVerify: vi.fn(async (token: string) => {
    if (token === 'valid-jwt') {
      return { payload: { sub: 'usr_1', jti: 'jti-123', exp: Math.floor(Date.now() / 1000) + 3600, roles: [], permissions: [], deptIds: [] } };
    }
    throw new Error('Invalid signature');
  }),
  decodeJwt: vi.fn((token: string) => {
    if (token === 'valid-jwt') {
      return { kid: 'test-kid-1', sub: 'usr_1', jti: 'jti-123', exp: Math.floor(Date.now() / 1000) + 3600 };
    }
    return null;
  }),
  decodeProtectedHeader: vi.fn((token: string) => {
    if (token === 'valid-jwt') {
      return { kid: 'test-kid-1', alg: 'ES256' };
    }
    throw new Error('Invalid JWT header');
  }),
  importJWK: vi.fn(async () => ({})),
  createRemoteJWKSet: vi.fn(() => vi.fn()),
}));

import {
  setJwtCookies,
  clearJwtCookies,
  getJwtFromCookie,
  getRefreshTokenFromCookie,
  decodeJwtPayload,
  revokeJti,
  isJtiRevoked,
  revokeUserToken,
} from '@/lib/session';
import { COOKIE_NAMES } from '@auth-sso/contracts';
import { verifyAccessToken } from '@/lib/auth/token';

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, {
    jwks: seedJwks({ kid: 'test-kid-1' }),
  });
  store.clear();
  vi.clearAllMocks();
});

describe('JWT Cookie Session Lifecycle', () => {
  describe('setJwtCookies', () => {
    it('正确将 JWT 写入 Response Cookie', () => {
      const response = NextResponse.next();
      const setSpy = vi.spyOn(response.cookies, 'set');

      setJwtCookies(response, 'access-token', 'refresh-token', 3600);

      expect(setSpy).toHaveBeenCalledWith(COOKIE_NAMES.JWT, 'access-token', expect.objectContaining({
        path: '/',
        httpOnly: true,
        maxAge: 3600,
      }));
      expect(setSpy).toHaveBeenCalledWith(COOKIE_NAMES.REFRESH, 'refresh-token', expect.objectContaining({
        path: '/',
        httpOnly: true,
        maxAge: 604800,
      }));
    });

    it('Cookie 包含 sameSite=lax 防 CSRF', () => {
      const response = NextResponse.next();
      const setSpy = vi.spyOn(response.cookies, 'set');

      setJwtCookies(response, 'access-token', undefined, 3600);

      expect(setSpy).toHaveBeenCalledWith(COOKIE_NAMES.JWT, 'access-token', expect.objectContaining({
        sameSite: 'lax',
      }));
    });

    it('无 refresh token 时不设置 REFRESH Cookie', () => {
      const response = NextResponse.next();
      const setSpy = vi.spyOn(response.cookies, 'set');

      setJwtCookies(response, 'access-token', undefined, 3600);

      const refreshCalls = setSpy.mock.calls.filter((c: any) => c[0] === COOKIE_NAMES.REFRESH);
      expect(refreshCalls).toHaveLength(0);
    });
  });

  describe('clearJwtCookies', () => {
    it('正确在响应头中追加 Max-Age=0 清理 Cookie', () => {
      const response = new Response();
      clearJwtCookies(response);
      const setCookies = response.headers.getSetCookie();
      expect(setCookies.some(c => c.includes(`${COOKIE_NAMES.JWT}=;`) && c.includes('Max-Age=0'))).toBe(true);
      expect(setCookies.some(c => c.includes(`${COOKIE_NAMES.REFRESH}=;`) && c.includes('Max-Age=0'))).toBe(true);
    });
  });

  describe('getJwtFromCookie & getRefreshTokenFromCookie', () => {
    it('从 cookies 接口成功读取 Token', async () => {
      mockCookiesGet.mockImplementation((name: string) => {
        if (name === COOKIE_NAMES.JWT) return { value: 'jwt-val' };
        if (name === COOKIE_NAMES.REFRESH) return { value: 'refresh-val' };
        return null;
      });

      const jwt = await getJwtFromCookie();
      const refresh = await getRefreshTokenFromCookie();

      expect(jwt).toBe('jwt-val');
      expect(refresh).toBe('refresh-val');
    });

    it('Cookie 不存在时返回 null', async () => {
      mockCookiesGet.mockReturnValue(null);

      const jwt = await getJwtFromCookie();
      expect(jwt).toBeNull();
    });
  });

  describe('jti 黑名单机制', () => {
    it('能够正确加入和判断 jti 黑名单', async () => {
      await revokeJti('jti-123', Math.floor(Date.now() / 1000) + 3600);
      expect(await isJtiRevoked('jti-123')).toBe(true);
      expect(await isJtiRevoked('jti-not-exists')).toBe(false);
    });

    it('能够自动通过 token 进行注销', async () => {
      await revokeUserToken('valid-jwt');
      expect(await isJtiRevoked('jti-123')).toBe(true);
    });
  });

  describe('verifyAccessToken', () => {
    it('对有效 JWT 成功验签并返回载荷', async () => {
      const payload = await verifyAccessToken('valid-jwt');
      expect(payload).toBeTruthy();
      expect(payload!.sub).toBe('usr_1');
    });

    it('如果 jti 在黑名单中则返回 null', async () => {
      await revokeJti('jti-123', Math.floor(Date.now() / 1000) + 3600);
      const payload = await verifyAccessToken('valid-jwt');
      expect(payload).toBeNull();
    });

    it('无效 JWT 返回 null', async () => {
      const payload = await verifyAccessToken('invalid-jwt');
      expect(payload).toBeNull();
    });

    it('恶意/畸形 token 返回 null 不抛异常', async () => {
      const payload = await verifyAccessToken('');
      expect(payload).toBeNull();
    });
  });

  describe('decodeJwtPayload', () => {
    it('快速解码有效 JWT 载荷', () => {
      const payload = decodeJwtPayload('valid-jwt');
      expect(payload).toBeTruthy();
      expect(payload!.sub).toBe('usr_1');
    });

    it('无效 token 返回 null', () => {
      const payload = decodeJwtPayload('invalid-token');
      expect(payload).toBeNull();
    });
  });
});
