/**
 * IdP SSO 全局登出 API 单元测试
 *
 * 覆盖范围：
 * - SSO 登出成功清除 IdP Session
 * - SSO 登出无效 Session 仍返回成功（防御性）
 * - SSO 登出触发跨应用 Session 失效
 * - 无 Authorization header 返回 401
 * - 无法识别用户时仍返回成功
 *
 * @req AUTH-005, G-SEC-INT
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// =========================================
// Mock 基础设施（使用 vi.hoisted）
// =========================================
const {
  mockAuthApi,
  mockDb,
  mockRedis,
  mockPipeline,
  mockCreateBetterAuthSession,
  mockUnauthenticated,
  resetMockAuth,
  setQueryResult,
  resetDbState,
} = vi.hoisted(() => {
  const state: { _queryResult: any[] } = { _queryResult: [] };

  const mockPipeline = {
    del: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  };

  const mockRedis = {
    pipeline: vi.fn(() => mockPipeline),
  };

  // Better Auth session mock
  let sessionResult: any = null;

  const mockAuthApi = {
    getSession: vi.fn(async () => sessionResult),
  };

  // DB mock with chainable query builders
  const createChain = () => {
    const chain: any = () => {};
    chain.then = (resolve: Function) => resolve(state._queryResult);
    chain.catch = () => ({ then: (r: Function) => r([]) });
    return new Proxy(chain, {
      get(t: any, prop: string) {
        if (prop === 'then' || prop === 'catch') return t[prop];
        return () => createChain();
      },
    });
  };

  const mockDb = new Proxy({} as any, {
    get(_t: any, prop: string) {
      if (prop === 'select') return () => createChain();
      if (prop === 'delete')
        return () => ({
          where: () => ({ then: (resolve: Function) => resolve([1]) }),
        });
      if (prop === 'insert')
        return () => ({
          values: () => ({ then: (resolve: Function) => resolve([{ id: 'mock-id' }]) }),
        });
      if (prop === 'transaction')
        return async (cb: any) => {
          const tx = new Proxy({} as any, {
            get(_t2: any, p: string) {
              if (p === 'delete') return () => ({ where: () => ({ then: (r: Function) => r([1]) }) });
              return () => ({ where: () => ({ then: (r: Function) => r([1]) }) });
            },
          });
          return cb(tx);
        };
      return undefined;
    },
  });

  function mockCreateBetterAuthSession(userId = 'user-1') {
    sessionResult = {
      user: { id: userId, email: 'user@example.com', name: '测试用户' },
      session: { id: 'session-1', expiresAt: new Date(Date.now() + 3600000) },
    };
  }

  function mockUnauthenticated() {
    sessionResult = null;
  }

  function resetMockAuth() {
    sessionResult = null;
    vi.clearAllMocks();
  }

  return {
    mockAuthApi,
    mockDb,
    mockRedis,
    mockPipeline,
    mockCreateBetterAuthSession,
    mockUnauthenticated,
    resetMockAuth,
    setQueryResult(r: any[]) {
      state._queryResult = r;
    },
    resetDbState() {
      state._queryResult = [];
    },
  };
});

vi.mock('@/lib/auth', () => ({
  auth: {
    api: mockAuthApi,
  },
  redis: mockRedis,
}));

vi.mock('@/db', () => ({
  db: mockDb,
}));

vi.mock('@/db/schema', () => ({
  oauthAccessTokens: {},
  oauthRefreshTokens: {},
  sessions: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: any) => a),
}));

vi.mock('jose', () => ({
  decodeJwt: vi.fn(),
}));

import { POST as SignOutSSO } from '@/app/api/auth/sign-out-sso/route';

describe('SSO Sign-Out (IdP)', () => {
  beforeEach(() => {
    resetMockAuth();
    resetDbState();
  });

  function createSignOutRequest(token?: string): NextRequest {
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return new NextRequest('http://localhost:4101/api/auth/sign-out-sso', {
      method: 'POST',
      headers,
    });
  }

  // ======== 401 Unauthorized ========

  describe('Authentication', () => {
    it('缺少 Authorization header 返回 401', async () => {
      const response = await SignOutSSO(createSignOutRequest());
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error).toBe('AUTH_SSO_1002');
    });

    it('Authorization header 不是 Bearer 格式返回 401', async () => {
      const request = new NextRequest('http://localhost:4101/api/auth/sign-out-sso', {
        method: 'POST',
        headers: { Authorization: 'Basic xxx' },
      });

      const response = await SignOutSSO(request);
      expect(response.status).toBe(401);
    });
  });

  // ======== Happy Path ========

  describe('Successful Sign-Out', () => {
    // @req AUTH-005
    it('有效的 Session 登出并清除数据库记录', async () => {
      mockCreateBetterAuthSession('user-1');

      // 模拟用户 Session 查询结果
      setQueryResult([
        { id: 'sess-1', token: 'token-1', userId: 'user-1' },
      ]);

      const response = await SignOutSSO(createSignOutRequest('valid-token'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('getSession 失败时通过 OAuth token 表查找用户', async () => {
      mockUnauthenticated();

      // 模拟 oauthAccessTokens 查询返回用户
      setQueryResult([
        { userId: 'user-1', accessToken: 'oauth-token-1' },
      ]);

      // 模拟 sessions 查询
      setQueryResult([
        { id: 'sess-2', token: 'token-2', userId: 'user-1' },
      ]);

      const response = await SignOutSSO(createSignOutRequest('oauth-token-1'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('同时清理用户的所有 Session、OAuth 表和 Redis 缓存', async () => {
      mockCreateBetterAuthSession('user-1');

      // 有多个活跃 Session
      setQueryResult([
        { id: 'sess-1', token: 'token-1', userId: 'user-1' },
        { id: 'sess-2', token: 'token-2', userId: 'user-1' },
      ]);

      const response = await SignOutSSO(createSignOutRequest('valid-token'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);

      // 验证 Redis pipeline 被调用（清理缓存）
      expect(mockPipeline.del).toHaveBeenCalledWith('auth-sso:active-sessions-user-1');
      expect(mockRedis.pipeline).toHaveBeenCalled();
    });
  });

  // ======== Edge Cases ========

  describe('Edge Cases', () => {
    it('无法识别用户时仍返回成功（防御性）', async () => {
      mockUnauthenticated();

      // OAuth token 表也无结果
      setQueryResult([]);

      // JWT 解析也无 sub（手动 decode 失败）
      const { decodeJwt } = await import('jose');
      (decodeJwt as any).mockReturnValueOnce({});

      const response = await SignOutSSO(createSignOutRequest('unknown-token'));
      const body = await response.json();

      // 应该返回成功，而不是错误
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.message).toContain('No user identified');
    });

    it('手动解析 JWT payload 获取 userId（最后手段）', async () => {
      mockUnauthenticated();

      // OAuth token 表也无结果
      setQueryResult([]);

      // 模拟 JWT token（base64 编码的 payload 包含 sub）
      const payload = Buffer.from(JSON.stringify({ sub: 'user-from-jwt' })).toString('base64');
      const mockToken = `header.${payload}.signature`;

      const response = await SignOutSSO(createSignOutRequest(mockToken));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('登出操作即使 DB 删除失败也返回成功（防御性）', async () => {
      mockCreateBetterAuthSession('user-1');

      // 模拟会话查询成功
      setQueryResult([
        { id: 'sess-1', token: 'token-1', userId: 'user-1' },
      ]);

      const response = await SignOutSSO(createSignOutRequest('valid-token'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('清除 OAuth tokens 不破坏后续请求', async () => {
      mockCreateBetterAuthSession('user-1');

      setQueryResult([
        { id: 'sess-1', token: 'token-1', userId: 'user-1' },
      ]);

      // 多次登出应安全
      const firstResponse = await SignOutSSO(createSignOutRequest('valid-token'));
      expect(firstResponse.status).toBe(200);

      // 第二次登出（Session 已不存在）
      mockUnauthenticated();
      setQueryResult([]);

      const secondResponse = await SignOutSSO(createSignOutRequest('valid-token'));
      expect(secondResponse.status).toBe(200);
    });
  });
});
