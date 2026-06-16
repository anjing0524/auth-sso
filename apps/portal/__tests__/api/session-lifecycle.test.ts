import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// 使用 vi.hoisted 解决 Vitest 模拟提升与局部变量隔离的问题
const { mockGetRedis, mockStore } = vi.hoisted(() => {
  const storeMap = new Map<string, string>();
  return {
    mockStore: {
      clear: () => storeMap.clear(),
      get: (key: string) => storeMap.get(key),
      set: (key: string, value: string) => storeMap.set(key, value),
    },
    mockGetRedis: () => ({
      setex: async (key: string, ttl: number, value: string) => {
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
    }),
  };
});

// Mock Redis 接口
vi.mock('@/infrastructure/redis', () => ({
  getRedis: () => mockGetRedis(),
}));

const store = mockStore;

// Mock next/headers
const mockCookiesGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: mockCookiesGet,
  }),
}));

// Mock jose
vi.mock('jose', () => ({
  jwtVerify: vi.fn(async (token) => {
    if (token === 'valid-jwt') {
      return { payload: { sub: 'usr_1', jti: 'jti-123', exp: Math.floor(Date.now() / 1000) + 3600 } };
    }
    throw new Error('Invalid signature');
  }),
  decodeJwt: vi.fn((token) => {
    if (token === 'valid-jwt') {
      return { sub: 'usr_1', jti: 'jti-123', exp: Math.floor(Date.now() / 1000) + 3600 };
    }
    return null;
  }),
  createRemoteJWKSet: vi.fn(() => vi.fn()),
}));

import {
  setJwtCookies,
  clearJwtCookies,
  getJwtFromCookie,
  getRefreshTokenFromCookie,
  verifyJwt,
  decodeJwtPayload,
  revokeJti,
  isJtiRevoked,
  revokeUserToken,
  JWT_COOKIE_NAME,
  REFRESH_COOKIE_NAME
} from '@/lib/session';

describe('JWT Cookie Session Lifecycle', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  describe('setJwtCookies', () => {
    it('正确将 JWT 写入 Response Cookie', () => {
      const response = NextResponse.next();
      const setSpy = vi.spyOn(response.cookies, 'set');
      
      setJwtCookies(response, 'access-token', 'refresh-token', 3600);
      
      expect(setSpy).toHaveBeenCalledWith(JWT_COOKIE_NAME, 'access-token', expect.objectContaining({
        path: '/',
        httpOnly: true,
        maxAge: 3600,
      }));
      expect(setSpy).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, 'refresh-token', expect.objectContaining({
        path: '/api/auth/refresh',
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60,
      }));
    });
  });

  describe('clearJwtCookies', () => {
    it('正确在响应头中追加 Max-Age=0 清理 Cookie', () => {
      const response = new Response();
      clearJwtCookies(response);
      const setCookies = response.headers.getSetCookie();
      expect(setCookies.some(c => c.includes(`${JWT_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);
      expect(setCookies.some(c => c.includes(`${REFRESH_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);
    });
  });

  describe('getJwtFromCookie & getRefreshTokenFromCookie', () => {
    it('从 cookies 接口成功读取 Token', async () => {
      mockCookiesGet.mockImplementation((name) => {
        if (name === JWT_COOKIE_NAME) return { value: 'jwt-val' };
        if (name === REFRESH_COOKIE_NAME) return { value: 'refresh-val' };
        return null;
      });

      const jwt = await getJwtFromCookie();
      const refresh = await getRefreshTokenFromCookie();

      expect(jwt).toBe('jwt-val');
      expect(refresh).toBe('refresh-val');
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

  describe('verifyJwt', () => {
    it('对有效 JWT 成功验签并返回载荷', async () => {
      const payload = await verifyJwt('valid-jwt');
      expect(payload).toBeTruthy();
      expect(payload!.sub).toBe('usr_1');
    });

    it('如果 jti 在黑名单中则返回 null', async () => {
      await revokeJti('jti-123', Math.floor(Date.now() / 1000) + 3600);
      const payload = await verifyJwt('valid-jwt');
      expect(payload).toBeNull();
    });

    it('无效 JWT 返回 null', async () => {
      const payload = await verifyJwt('invalid-jwt');
      expect(payload).toBeNull();
    });
  });

  describe('decodeJwtPayload', () => {
    it('快速解码有效 JWT 载荷', () => {
      const payload = decodeJwtPayload('valid-jwt');
      expect(payload).toBeTruthy();
      expect(payload!.sub).toBe('usr_1');
    });
  });
});
