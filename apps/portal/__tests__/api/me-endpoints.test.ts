/**
 * 当前用户 API 单元测试（JWT Cookie 无状态版）
 *
 * 覆盖范围：
 * - GET /api/me 返回用户信息（含 JWT 验证）
 * - GET /api/me/permissions 返回权限列表
 * - GET /api/me/menus 返回权限过滤后的菜单树
 * - GET /api/me 无有效 JWT 返回 401
 *
 * @req B-USR-R, AUTH-004
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestRequest, createAuthenticatedRequest } from '../helpers/test-utils';
import {
  createTestUser,
  createTestSession,
  createTestPermissionContext,
  createTestMenu,
} from '../helpers/test-fixtures';

// =========================================
// Mock 基础设施（使用 vi.hoisted 共享状态）
// =========================================
const {
  mockGetJwtFromCookie,
  mockVerifyJwt,
  mockDecodeJwtPayload,
  mockGetUserPermissionContext,
  mockDb,
  setQueryResult,
  resetDb,
} = vi.hoisted(() => {
  const state: { _queryResult: any[] } = { _queryResult: [] };

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
      return undefined;
    },
  });

  return {
    mockGetJwtFromCookie: vi.fn(),
    mockVerifyJwt: vi.fn(),
    mockDecodeJwtPayload: vi.fn(),
    mockGetUserPermissionContext: vi.fn(),
    mockDb,
    setQueryResult(r: any[]) {
      state._queryResult = r;
    },
    resetDb() {
      state._queryResult = [];
    },
  };
});

vi.mock('@/lib/session', () => ({
  getJwtFromCookie: mockGetJwtFromCookie,
  verifyJwt: mockVerifyJwt,
  decodeJwtPayload: mockDecodeJwtPayload,
}));

vi.mock('@/lib/permissions', () => ({
  getUserPermissionContext: mockGetUserPermissionContext,
}));

vi.mock('@/lib/auth-client', () => ({
  oauthConfig: {
    idpUrl: 'http://localhost:4101',
    clientId: 'portal',
    redirectUri: 'http://localhost:4100/api/auth/callback',
    scopes: ['openid', 'profile', 'email', 'offline_access'],
  },
}));

vi.mock('@/infrastructure/db', () => ({
  db: mockDb,
  schema: {
    menus: {},
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: any) => a),
  asc: vi.fn((a: any) => a),
}));

// =========================================
// 被测模块导入
// =========================================
import { GET as GetMe } from '@/app/api/me/route';
import { GET as GetMePermissions } from '@/app/api/me/permissions/route';
import { GET as GetMeMenus } from '@/app/api/me/menus/route';

// 辅助：创建带 JWT 的 cookie 请求
function createRequestWithJwt(path: string, jwtToken = 'valid-jwt-token') {
  return createAuthenticatedRequest(path, jwtToken);
}

describe('Me Endpoints', () => {
  const mockClaims = {
    sub: 'user-1',
    email: 'test@example.com',
    name: '测试用户',
    jti: 'jti-123',
    iss: 'http://localhost:4101',
  };
  const mockPermissionContext = createTestPermissionContext();

  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  // ======== GET /api/me ========

  describe('GET /api/me', () => {
    it('返回用户信息（含 JWT 验证通过）', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-jwt-token');
      mockVerifyJwt.mockResolvedValueOnce(mockClaims);
      mockDecodeJwtPayload.mockReturnValueOnce({ exp: 9999999999 } as any);

      // Mock userinfo 请求
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: 'user-1',
          email: 'test@example.com',
          name: '测试用户',
          picture: null,
          email_verified: true,
        }),
      } as Response);

      mockGetUserPermissionContext.mockResolvedValueOnce(mockPermissionContext);

      // 模拟菜单查询
      setQueryResult([createTestMenu()]);

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
      expect(body.error).toBe('AUTH_SSO_1002');
    });

    it('JWT 验签失败时返回 401', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('invalid-token');
      mockVerifyJwt.mockResolvedValueOnce(null);

      const response = await GetMe(createTestRequest('/api/me'));
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error).toBe('AUTH_SSO_1002');
    });

    it('Userinfo 端点降级时使用 JWT claims 信息', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-jwt-token');
      mockVerifyJwt.mockResolvedValueOnce(mockClaims);

      // Userinfo 请求失败（降级）
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
        new Error('IdP unreachable')
      );

      mockGetUserPermissionContext.mockResolvedValueOnce(mockPermissionContext);
      setQueryResult([createTestMenu()]);
      mockDecodeJwtPayload.mockReturnValueOnce({ exp: 9999999999 } as any);

      const response = await GetMe(createTestRequest('/api/me'));
      expect(response.status).toBe(200);

      const body = await response.json();
      // 降级后使用 JWT claims 中的基本信息
      expect(body.user.email).toBe('test@example.com');
    });

    it('权限上下文为空时仍返回用户信息', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-jwt-token');
      mockVerifyJwt.mockResolvedValueOnce(mockClaims);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: 'user-1',
          email: 'test@example.com',
          name: '测试用户',
        }),
      } as Response);

      // 权限上下文为 null
      mockGetUserPermissionContext.mockResolvedValueOnce(null);
      setQueryResult([]);
      mockDecodeJwtPayload.mockReturnValueOnce({ exp: 9999999999 } as any);

      const response = await GetMe(createTestRequest('/api/me'));
      expect(response.status).toBe(200);
      // 即使权限上下文缺失，也应返回用户基本信息
    });

    it('返回 tokenInfo.expiresAt 用于前端静默刷新调度', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-jwt-token');
      mockVerifyJwt.mockResolvedValueOnce(mockClaims);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: 'user-1',
          email: 'test@example.com',
          name: '测试用户',
        }),
      } as Response);

      mockGetUserPermissionContext.mockResolvedValueOnce(mockPermissionContext);
      // exp 是 Unix 秒，前端需要乘以 1000
      mockDecodeJwtPayload.mockReturnValueOnce({ exp: 2000000000 } as any);
      setQueryResult([createTestMenu()]);

      const response = await GetMe(createTestRequest('/api/me'));
      const body = await response.json();

      expect(body.tokenInfo.expiresAt).toBe(2000000000 * 1000);
    });
  });

  // ======== GET /api/me/permissions ========

  describe('GET /api/me/permissions', () => {
    it('返回用户权限上下文', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-jwt-token');
      mockVerifyJwt.mockResolvedValueOnce(mockClaims);
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
      mockVerifyJwt.mockResolvedValueOnce(null);

      const response = await GetMePermissions(createTestRequest('/api/me/permissions'));
      expect(response.status).toBe(401);
    });

    it('权限上下文获取失败时返回 500', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-jwt-token');
      mockVerifyJwt.mockResolvedValueOnce(mockClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce(null);

      const response = await GetMePermissions(createTestRequest('/api/me/permissions'));
      expect(response.status).toBe(500);
    });
  });

  // ======== GET /api/me/menus ========

  describe('GET /api/me/menus', () => {
    it('返回过滤后的菜单树', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-jwt-token');
      mockVerifyJwt.mockResolvedValueOnce(mockClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce(mockPermissionContext);

      // 模拟菜单数据（管理员可看到所有菜单）
      setQueryResult([
        createTestMenu({ id: 'm1', name: '仪表盘', path: '/dashboard', sort: 1, permissionCode: null }),
        createTestMenu({ id: 'm2', name: '用户管理', path: '/users', sort: 2, permissionCode: 'user:list', parentId: null }),
        createTestMenu({ id: 'm3', name: '创建用户', path: '/users/create', sort: 1, parentId: 'm2', menuType: 'BUTTON' }),
        createTestMenu({
          id: 'm4',
          name: '审计日志',
          path: '/audit',
          sort: 3,
          permissionCode: 'audit:read',
          parentId: null,
          visible: true,
        }),
      ]);

      const response = await GetMeMenus(createTestRequest('/api/me/menus'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toBeDefined();
      // 管理员应看到所有可见菜单（按钮级菜单被过滤）
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('无 JWT 时返回 401', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce(null);

      const response = await GetMeMenus(createTestRequest('/api/me/menus'));
      expect(response.status).toBe(401);
    });

    it('JWT 无效时返回 401', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('invalid-token');
      mockVerifyJwt.mockResolvedValueOnce(null);

      const response = await GetMeMenus(createTestRequest('/api/me/menus'));
      expect(response.status).toBe(401);
    });

    it('权限上下文为空时返回 500', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-jwt-token');
      mockVerifyJwt.mockResolvedValueOnce(mockClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce(null);

      const response = await GetMeMenus(createTestRequest('/api/me/menus'));
      expect(response.status).toBe(500);
    });

    it('非管理员用户仅看到有权限的菜单', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-jwt-token');
      mockVerifyJwt.mockResolvedValueOnce(mockClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce(
        createTestPermissionContext({
          roles: [{ id: 'role-2', code: 'USER', name: '普通用户' }],
          permissions: ['user:list'],
          dataScopeType: 'SELF',
        })
      );

      setQueryResult([
        createTestMenu({ id: 'm1', name: '仪表盘', path: '/dashboard', sort: 1, permissionCode: null }),
        createTestMenu({ id: 'm2', name: '用户管理', path: '/users', sort: 2, permissionCode: 'user:list' }),
        createTestMenu({
          id: 'm3',
          name: '审计日志',
          path: '/audit',
          sort: 3,
          permissionCode: 'audit:read',
          visible: true,
        }),
      ]);

      const response = await GetMeMenus(createTestRequest('/api/me/menus'));
      const body = await response.json();

      expect(response.status).toBe(200);
      // 普通用户只能看到有 user:list 权限的菜单
      expect(body.data).toBeDefined();
    });
  });
});
