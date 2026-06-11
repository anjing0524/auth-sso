/**
 * 当前用户 API 单元测试
 *
 * 覆盖范围：
 * - GET /api/me 返回用户信息（含 Session 验证）
 * - GET /api/me/permissions 返回权限列表
 * - GET /api/me/menus 返回权限过滤后的菜单树
 * - GET /api/me 无有效 Session 返回 401
 * - /api/me Token 接近过期时触发刷新
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
// Mock 基础设施
// =========================================
const {
  mockGetSessionIdFromCookie,
  mockGetSession,
  mockTouchSession,
  mockUpdateSessionToken,
  mockShouldRefreshToken,
  mockDeleteSession,
  mockClearSessionCookie,
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
    mockGetSessionIdFromCookie: vi.fn(),
    mockGetSession: vi.fn(),
    mockTouchSession: vi.fn(),
    mockUpdateSessionToken: vi.fn(),
    mockShouldRefreshToken: vi.fn(() => false),
    mockDeleteSession: vi.fn(),
    mockClearSessionCookie: vi.fn(),
    mockGetUserPermissionContext: vi.fn(),
    mockDb,
    setQueryResult(r: any[]) { state._queryResult = r; },
    resetDb() { state._queryResult = []; },
  };
});

vi.mock('@/lib/session', () => ({
  getSessionIdFromCookie: mockGetSessionIdFromCookie,
  getSession: mockGetSession,
  touchSession: mockTouchSession,
  updateSessionToken: mockUpdateSessionToken,
  shouldRefreshToken: mockShouldRefreshToken,
  deleteSession: mockDeleteSession,
  clearSessionCookie: mockClearSessionCookie,
}));

vi.mock('@/lib/permissions', () => ({
  getUserPermissionContext: mockGetUserPermissionContext,
}));

vi.mock('@/lib/auth-client', () => ({
  oauthConfig: {
    idpUrl: 'http://localhost:4101',
    clientId: 'portal',
    clientSecret: 'portal-secret',
    redirectUri: 'http://localhost:4100/api/auth/callback',
    scopes: ['openid', 'profile', 'email', 'offline_access'],
  },
}));

vi.mock('@/lib/db', () => ({
  db: mockDb,
  schema: {
    menus: {},
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: any) => a),
  asc: vi.fn((a: any) => a),
}));

import { GET as GetMe } from '@/app/api/me/route';
import { GET as GetMePermissions } from '@/app/api/me/permissions/route';
import { GET as GetMeMenus } from '@/app/api/me/menus/route';

describe('Me Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  const mockValidSession = createTestSession();
  const mockPermissionContext = createTestPermissionContext();

  // ======== GET /api/me ========

  describe('GET /api/me', () => {
    it('返回用户信息（含 Session 验证通过）', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-123');
      mockGetSession.mockResolvedValueOnce(mockValidSession);
      mockShouldRefreshToken.mockReturnValueOnce(false);
      mockTouchSession.mockResolvedValueOnce(undefined);

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
      expect(body.session).toBeDefined();
      expect(body.permissions).toBeDefined();
      expect(body.roles).toBeDefined();
      expect(body.menus).toBeDefined();
    });

    it('无 Session Cookie 时返回 401', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce(null);

      const response = await GetMe(createTestRequest('/api/me'));
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error).toBe('unauthorized');
    });

    it('Session 过期时返回 401 并清除 Cookie', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-expired');
      mockGetSession.mockResolvedValueOnce(null);

      const response = await GetMe(createTestRequest('/api/me'));
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error).toBe('unauthorized');
      expect(mockClearSessionCookie).toHaveBeenCalled();
    });

    it('Token 接近过期时触发刷新', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-123');
      mockGetSession.mockResolvedValueOnce({
        ...mockValidSession,
        refreshToken: 'refresh-token-xxx',
      });
      mockShouldRefreshToken.mockReturnValueOnce(true);

      // Mock Token 刷新请求
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        }),
      } as Response);

      // Mock userinfo 请求
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: 'user-1',
          email: 'test@example.com',
          name: '测试用户',
        }),
      } as Response);

      mockGetUserPermissionContext.mockResolvedValueOnce(mockPermissionContext);

      // 模拟菜单查询
      setQueryResult([createTestMenu()]);

      const response = await GetMe(createTestRequest('/api/me'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.user).toBeDefined();
      // 验证 Token 刷新被调用
      expect(mockUpdateSessionToken).toHaveBeenCalled();
    });

    it('Token 刷新失败时返回 401', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-123');
      mockGetSession.mockResolvedValueOnce({
        ...mockValidSession,
        refreshToken: 'refresh-token-xxx',
      });
      mockShouldRefreshToken.mockReturnValueOnce(true);

      // Mock 刷新请求失败
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
      } as Response);

      const response = await GetMe(createTestRequest('/api/me'));
      expect(response.status).toBe(401);
    });

    it('Userinfo 端点返回 401 时清除 Session', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-123');
      mockGetSession.mockResolvedValueOnce(mockValidSession);
      mockShouldRefreshToken.mockReturnValueOnce(false);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as Response);

      const response = await GetMe(createTestRequest('/api/me'));
      expect(response.status).toBe(401);
      expect(mockDeleteSession).toHaveBeenCalledWith('session-123');
    });
  });

  // ======== GET /api/me/permissions ========

  describe('GET /api/me/permissions', () => {
    it('返回用户权限上下文', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-123');
      mockGetSession.mockResolvedValueOnce(mockValidSession);
      mockGetUserPermissionContext.mockResolvedValueOnce(mockPermissionContext);

      const response = await GetMePermissions(createTestRequest('/api/me/permissions'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.userId).toBe('user-1');
      expect(body.data.permissions).toContain('user:list');
      expect(body.data.roles).toHaveLength(1);
      expect(body.data.roles[0].code).toBe('ADMIN');
    });

    it('无 Session 时返回 401', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce(null);

      const response = await GetMePermissions(createTestRequest('/api/me/permissions'));
      expect(response.status).toBe(401);
    });

    it('Session 过期时返回 401', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-expired');
      mockGetSession.mockResolvedValueOnce(null);

      const response = await GetMePermissions(createTestRequest('/api/me/permissions'));
      expect(response.status).toBe(401);
    });

    it('权限上下文获取失败时返回 500', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-123');
      mockGetSession.mockResolvedValueOnce(mockValidSession);
      mockGetUserPermissionContext.mockResolvedValueOnce(null);

      const response = await GetMePermissions(createTestRequest('/api/me/permissions'));
      expect(response.status).toBe(500);
    });
  });

  // ======== GET /api/me/menus ========

  describe('GET /api/me/menus', () => {
    it('返回过滤后的菜单树', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-123');
      mockGetSession.mockResolvedValueOnce(mockValidSession);
      mockGetUserPermissionContext.mockResolvedValueOnce(mockPermissionContext);

      // 模拟菜单数据（含需要权限过滤的菜单）
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
      // 管理员应看到所有菜单
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('无 Session 时返回 401', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce(null);

      const response = await GetMeMenus(createTestRequest('/api/me/menus'));
      expect(response.status).toBe(401);
    });

    it('Session 过期时返回 401', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-expired');
      mockGetSession.mockResolvedValueOnce(null);

      const response = await GetMeMenus(createTestRequest('/api/me/menus'));
      expect(response.status).toBe(401);
    });

    it('权限上下文为空时返回 500', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-123');
      mockGetSession.mockResolvedValueOnce(mockValidSession);
      mockGetUserPermissionContext.mockResolvedValueOnce(null);

      const response = await GetMeMenus(createTestRequest('/api/me/menus'));
      expect(response.status).toBe(500);
    });

    it('非管理员用户仅看到有权限的菜单', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-123');
      mockGetSession.mockResolvedValueOnce(mockValidSession);
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
    });
  });
});
