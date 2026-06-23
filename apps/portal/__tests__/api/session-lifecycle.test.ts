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

// Mock DB 接口，防止 verifyAccessToken 执行真实数据库查询
vi.mock('@/infrastructure/db', () => {
  const mockJwkRow = {
    id: 'mock-kid',
    publicKey: JSON.stringify({
      kty: 'EC',
      crv: 'P-256',
      x: 'f83OJ3D2xF1Bg8vub9tM1gGPT34Ogv50GI1g9SamyC8',
      y: 'x_9LH9FHme7alQA9g1y5OB84XJWADnVEhypT5sR-vCs',
    }),
    privateKey: JSON.stringify({
      kty: 'EC',
      crv: 'P-256',
      x: 'f83OJ3D2xF1Bg8vub9tM1gGPT34Ogv50GI1g9SamyC8',
      y: 'x_9LH9FHme7alQA9g1y5OB84XJWADnVEhypT5sR-vCs',
      d: 'jpsQnnGQmLv7UfFpQ9k8-kH6-4SJyvK2Wj2N2aQeE24',
    }),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 3600 * 1000),
  };

  const createChain = () => {
    const chain: any = () => {};
    chain.then = (resolve: Function) => resolve([mockJwkRow]);
    return new Proxy(chain, {
      get(target: any, prop: string) {
        if (prop === 'then' || prop === 'catch') return target[prop];
        return () => createChain();
      },
    });
  };

  return {
    db: {
      select: () => createChain(),
    },
    schema: {
      jwks: {
        createdAt: 'createdAt',
      },
    },
  };
});

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
      return { kid: 'test-kid-1', sub: 'usr_1', jti: 'jti-123', exp: Math.floor(Date.now() / 1000) + 3600 };
    }
    return null;
  }),
  decodeProtectedHeader: vi.fn((token) => {
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
      
      expect(setSpy).toHaveBeenCalledWith(COOKIE_NAMES.JWT, 'access-token', expect.objectContaining({
        path: '/',
        httpOnly: true,
        maxAge: 3600,
      }));
      expect(setSpy).toHaveBeenCalledWith(COOKIE_NAMES.REFRESH, 'refresh-token', expect.objectContaining({
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
      expect(setCookies.some(c => c.includes(`${COOKIE_NAMES.JWT}=;`) && c.includes('Max-Age=0'))).toBe(true);
      expect(setCookies.some(c => c.includes(`${COOKIE_NAMES.REFRESH}=;`) && c.includes('Max-Age=0'))).toBe(true);
    });
  });

  describe('getJwtFromCookie & getRefreshTokenFromCookie', () => {
    it('从 cookies 接口成功读取 Token', async () => {
      mockCookiesGet.mockImplementation((name) => {
        if (name === COOKIE_NAMES.JWT) return { value: 'jwt-val' };
        if (name === COOKIE_NAMES.REFRESH) return { value: 'refresh-val' };
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
  });

  describe('decodeJwtPayload', () => {
    it('快速解码有效 JWT 载荷', () => {
      const payload = decodeJwtPayload('valid-jwt');
      expect(payload).toBeTruthy();
      expect(payload!.sub).toBe('usr_1');
    });
  });
});
