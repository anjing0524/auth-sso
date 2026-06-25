/**
 * 当前用户 API 单元测试（JWT Cookie 无状态版）
 *
 * 覆盖范围：
 * - GET /api/me 返回用户信息、权限、角色及动态菜单树（含 JWT 验证 + 菜单过滤）
 * - GET /api/me/permissions 返回权限列表
 * - GET /api/me 无有效 JWT 返回 401
 *
 * @req B-USR-R, H-AUTH-001
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestRequest } from '../helpers/test-utils';
import {
  createTestPermissionContext,
  createTestMenu,
} from '../helpers/test-fixtures';

// =========================================
// Mock 基础设施（使用 vi.hoisted 共享状态）
// =========================================
const {
  mockGetJwtFromCookie,
  mockVerifyAccessToken,
  mockGetUserPermissionContext,
  mockDb,
  setQueryResult,
  resetDb,
  mockHeadersGet,
} = vi.hoisted(() => {
  const state: { _queryResult: any[] } = { _queryResult: [] };
  const mockHeadersGet = vi.fn().mockReturnValue(null);

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
      // 支持 Relational Queries：db.query.<table>.findFirst/findMany
      if (prop === 'query') {
        return new Proxy({} as any, {
          get: () => ({
            findFirst: () => {
              const c: any = () => {};
              c.then = (resolve: Function) => resolve(state._queryResult[0] ?? null);
              return c;
            },
            findMany: () => createChain(),
          }),
        });
      }
      return undefined;
    },
  });

  return {
    mockGetJwtFromCookie: vi.fn(),
    mockVerifyAccessToken: vi.fn(),
    mockGetUserPermissionContext: vi.fn(),
    mockDb,
    mockHeadersGet,
    setQueryResult(r: any[]) {
      state._queryResult = r;
    },
    resetDb() {
      state._queryResult = [];
    },
  };
});

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: mockHeadersGet,
  }),
}));

vi.mock('@/lib/session', () => ({
  getJwtFromCookie: mockGetJwtFromCookie,
}));

vi.mock('@/lib/auth/token', () => ({
  verifyAccessToken: mockVerifyAccessToken,
}));

vi.mock('@/lib/permissions', () => ({
  getUserPermissionContext: mockGetUserPermissionContext,
}));

vi.mock('@/lib/menu-tree', () => ({
  getDynamicMenuTree: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/infrastructure/db', () => ({
  db: mockDb,
  schema: {
    users: {},
    menus: {},
    departments: {},
    roles: {},
    userRoles: {},
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: any) => a),
  or: vi.fn((...args: any[]) => args[0]),
  asc: vi.fn((a: any) => a),
  desc: vi.fn((a: any) => a),
  and: vi.fn((...args: any[]) => args[0]),
  sql: { raw: vi.fn((s: string) => s) },
}));

// =========================================
// 被测模块导入
// =========================================
import { GET as GetMe } from '@/app/api/me/route';
import { GET as GetMePermissions } from '@/app/api/me/permissions/route';

describe('Me Endpoints', () => {
  const mockClaims = {
    sub: 'user-1',
    email: 'test@example.com',
    name: '测试用户',
    jti: 'jti-123',
    iss: 'http://localhost:4101',
    exp: 9999999999,
    roles: ['ADMIN'],
    permissions: ['user:list'],
    deptId: 'dept-1',
    deptIds: ['dept-1'],
  };
  const mockPermissionContext = createTestPermissionContext();

  // 模拟用户 DB 行
  function makeUserRow(overrides: Record<string, any> = {}) {
    return {
      id: 'user-1',
      publicId: 'pub_user_1',
      email: 'test@example.com',
      name: '测试用户',
      username: 'testuser',
      avatarUrl: null,
      emailVerified: true,
      deptId: null,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: new Date(),
      // getUser 经 Relational Queries 取出，roles 以 userRoles 嵌套结构返回
      userRoles: [] as Array<{ role: Record<string, any> }>,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    mockHeadersGet.mockImplementation(() => null);
    mockGetJwtFromCookie.mockReset();
    mockVerifyAccessToken.mockReset();
    mockGetUserPermissionContext.mockReset();
  });

  // ======== GET /api/me ========

  describe('GET /api/me', () => {
    it('返回用户信息（含 JWT 验证通过）', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-jwt-token');
      mockVerifyAccessToken.mockResolvedValueOnce(mockClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce(mockPermissionContext);
      // 模拟用户查询 + 菜单查询
      setQueryResult([makeUserRow(), createTestMenu()]);

      // 注意：由于 db.select() 被调用两次（用户查询和菜单查询），
      // 需要确保每次调用返回对应的结果。mockDb proxy 每次返回 state._queryResult
      // 两次调用都会返回相同的数组。用户查询取第一个元素。
      const response = await GetMe(createTestRequest('/api/me'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.user).toBeDefined();
      expect(body.user.email).toBe('test@example.com');
      expect(body.tokenInfo).toBeDefined();
      expect(body.permissions).toBeDefined();
      expect(body.roles).toBeDefined();
      expect(body.menus).toBeDefined();
    });

    it('无 JWT Cookie 时返回 401', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce(null);

      const response = await GetMe(createTestRequest('/api/me'));
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error).toBeDefined();
    });

    it('通过 Authorization 请求头读取 JWT（无 Gateway 且 Cookie 为空）', async () => {
      const validJwtStr = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEiLCJyb2xlcyI6WyJBRE1JTiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOmxpc3QiXSwiZGVwdElkIjoiZGVwdC0xIiwiZGF0YVNjb3BlVHlwZSI6IkFMTCJ9.signature';
      mockHeadersGet.mockImplementation((name: string) => {
        if (name.toLowerCase() === 'authorization') return `Bearer ${validJwtStr}`;
        return null;
      });
      mockGetJwtFromCookie.mockResolvedValueOnce(null);
      mockVerifyAccessToken.mockResolvedValueOnce(mockClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce(mockPermissionContext);
      setQueryResult([makeUserRow(), createTestMenu()]);

      const response = await GetMe(createTestRequest('/api/me'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.user.email).toBe('test@example.com');
      expect(mockVerifyAccessToken).toHaveBeenCalledWith(validJwtStr);
    });

    it('在 Gateway 信任路径下通过 Authorization 请求头解析 JWT 且零验签', async () => {
      const validJwtStr = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEiLCJyb2xlcyI6WyJBRE1JTiJdLCJwZXJtaXNzaW9ucyI6WyJ1c2VyOmxpc3QiXSwiZGVwdElkIjoiZGVwdC0xIiwiZGF0YVNjb3BlVHlwZSI6IkFMTCJ9.signature';
      mockHeadersGet.mockImplementation((name: string) => {
        if (name.toLowerCase() === 'x-user-id') return 'user-1';
        if (name.toLowerCase() === 'authorization') return `Bearer ${validJwtStr}`;
        return null;
      });
      mockGetJwtFromCookie.mockResolvedValueOnce(null);
      mockGetUserPermissionContext.mockResolvedValueOnce(mockPermissionContext);
      setQueryResult([makeUserRow(), createTestMenu()]);

      const response = await GetMe(createTestRequest('/api/me'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.user.email).toBe('test@example.com');
      expect(mockVerifyAccessToken).not.toHaveBeenCalled();
    });

    it('JWT 验签失败时返回 401', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('invalid-token');
      mockVerifyAccessToken.mockResolvedValueOnce(null);

      const response = await GetMe(createTestRequest('/api/me'));
      expect(response.status).toBe(401);
    });

    it('权限上下文为空时仍返回用户信息', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-jwt-token');
      mockVerifyAccessToken.mockResolvedValueOnce(mockClaims);
      // 权限上下文为 null
      mockGetUserPermissionContext.mockResolvedValueOnce(null);
      setQueryResult([makeUserRow()]);

      const response = await GetMe(createTestRequest('/api/me'));
      expect(response.status).toBe(200);
      // 即使权限上下文缺失，也应返回用户基本信息
    });

    it('返回 tokenInfo.expiresAt 用于前端静默刷新调度', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-jwt-token');
      mockVerifyAccessToken.mockResolvedValueOnce({
        ...mockClaims,
        exp: 2000000000,
      });
      mockGetUserPermissionContext.mockResolvedValueOnce(mockPermissionContext);
      setQueryResult([makeUserRow(), createTestMenu()]);

      const response = await GetMe(createTestRequest('/api/me'));
      const body = await response.json();

      // exp 是 Unix 秒，前端需要乘以 1000
      expect(body.tokenInfo.expiresAt).toBe(2000000000 * 1000);
    });
  });

  // ======== GET /api/me/permissions ========

  describe('GET /api/me/permissions', () => {
    it('返回用户权限上下文', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-jwt-token');
      mockVerifyAccessToken.mockResolvedValueOnce(mockClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce(mockPermissionContext);

      const response = await GetMePermissions(createTestRequest('/api/me/permissions'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.userId).toBe('user-1');
      expect(body.data.permissions).toContain('user:list');
      expect(body.data.roles).toHaveLength(1);
      expect(body.data.roles[0].code).toBe('ADMIN');
    });

    it('无 JWT 时返回 401', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce(null);

      const response = await GetMePermissions(createTestRequest('/api/me/permissions'));
      expect(response.status).toBe(401);
    });

    it('JWT 无效时返回 401', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('invalid-token');
      mockVerifyAccessToken.mockResolvedValueOnce(null);

      const response = await GetMePermissions(createTestRequest('/api/me/permissions'));
      expect(response.status).toBe(401);
    });

    it('权限上下文获取失败时返回 500', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-jwt-token');
      mockVerifyAccessToken.mockResolvedValueOnce(mockClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce(null);

      const response = await GetMePermissions(createTestRequest('/api/me/permissions'));
      expect(response.status).toBe(500);
    });
  });
});
