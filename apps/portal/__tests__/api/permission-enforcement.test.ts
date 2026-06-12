/**
 * 权限强制 API 单元测试
 *
 * 覆盖范围：
 * - withPermission 通过权限检查执行 handler
 * - withPermission requireAll 模式拒绝缺少任一权限
 * - withPermission 基于角色的检查通过
 * - withPermission 无权限/角色返回 403
 * - checkPermission 无有效 Session 返回 401
 *
 * @req AUTH-003, AUTH-005, AUTH-006
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// =========================================
// Mock 基础设施（使用 vi.hoisted）
// =========================================
const {
  mockGetSessionIdFromCookie,
  mockGetSession,
  mockGetUserPermissionContext,
} = vi.hoisted(() => {
  const mockGetSessionIdFromCookie = vi.fn();
  const mockGetSession = vi.fn();
  const mockGetUserPermissionContext = vi.fn();

  return {
    mockGetSessionIdFromCookie,
    mockGetSession,
    mockGetUserPermissionContext,
  };
});

vi.mock('@/lib/session', () => ({
  getSessionIdFromCookie: mockGetSessionIdFromCookie,
  getSession: mockGetSession,
}));

vi.mock('@/lib/permissions', () => ({
  getUserPermissionContext: mockGetUserPermissionContext,
}));

vi.mock('@/lib/db', () => ({
  db: {},
  schema: {},
}));

import { checkPermission, withPermission } from '@/lib/auth-middleware';

describe('Permission Enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createRequest(): NextRequest {
    return new NextRequest('http://localhost:4100/api/test');
  }

  // ======== checkPermission ========

  describe('checkPermission', () => {
    it('Session 不存在时返回 401', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce(null);

      const result = await checkPermission(createRequest(), {
        permissions: ['user:list'],
      });

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(401);
    });

    it('Session 已过期时返回 401', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-1');
      mockGetSession.mockResolvedValueOnce(null);

      const result = await checkPermission(createRequest(), {
        permissions: ['user:list'],
      });

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(401);
    });

    it('权限上下文中无所需权限时返回 403', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-1');
      mockGetSession.mockResolvedValueOnce({
        id: 'session-1',
        userId: 'user-1',
        accessToken: 'token',
      } as any);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: 'role-1', code: 'USER', name: '普通用户' }],
        permissions: ['user:list'],
        dataScopeType: 'SELF',
      });

      const result = await checkPermission(createRequest(), {
        permissions: ['audit:read'],
      });

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it('用户拥有任一所需权限时通过', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-1');
      mockGetSession.mockResolvedValueOnce({
        id: 'session-1',
        userId: 'user-1',
        accessToken: 'token',
      } as any);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: 'role-1', code: 'USER', name: '普通用户' }],
        permissions: ['user:list', 'audit:read'],
        dataScopeType: 'SELF',
      });

      const result = await checkPermission(createRequest(), {
        permissions: ['audit:read'],
      });

      expect(result.authorized).toBe(true);
      expect(result.userId).toBe('user-1');
    });

    // @req AUTH-006
    it('requireAll 模式：缺少任一权限时返回 403', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-1');
      mockGetSession.mockResolvedValueOnce({
        id: 'session-1',
        userId: 'user-1',
        accessToken: 'token',
      } as any);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: 'role-1', code: 'USER', name: '普通用户' }],
        permissions: ['user:list'],
        dataScopeType: 'SELF',
      });

      const result = await checkPermission(createRequest(), {
        permissions: ['user:list', 'audit:read'],
        requireAll: true,
      });

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it('requireAll 模式：拥有全部权限时通过', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-1');
      mockGetSession.mockResolvedValueOnce({
        id: 'session-1',
        userId: 'user-1',
        accessToken: 'token',
      } as any);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: 'role-1', code: 'USER', name: '普通用户' }],
        permissions: ['user:list', 'audit:read'],
        dataScopeType: 'SELF',
      });

      const result = await checkPermission(createRequest(), {
        permissions: ['user:list', 'audit:read'],
        requireAll: true,
      });

      expect(result.authorized).toBe(true);
      expect(result.userId).toBe('user-1');
    });

    it('基于角色的检查：匹配角色时通过', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-1');
      mockGetSession.mockResolvedValueOnce({
        id: 'session-1',
        userId: 'user-1',
        accessToken: 'token',
      } as any);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: 'role-1', code: 'ADMIN', name: '管理员' }],
        permissions: [],
        dataScopeType: 'ALL',
      });

      const result = await checkPermission(createRequest(), {
        roles: ['ADMIN'],
      });

      expect(result.authorized).toBe(true);
      expect(result.userId).toBe('user-1');
    });

    it('基于角色的检查：角色不匹配时返回 403', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-1');
      mockGetSession.mockResolvedValueOnce({
        id: 'session-1',
        userId: 'user-1',
        accessToken: 'token',
      } as any);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: 'role-1', code: 'USER', name: '普通用户' }],
        permissions: [],
        dataScopeType: 'SELF',
      });

      const result = await checkPermission(createRequest(), {
        roles: ['ADMIN'],
      });

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it('超级管理员角色绕过所有权限检查', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-1');
      mockGetSession.mockResolvedValueOnce({
        id: 'session-1',
        userId: 'user-1',
        accessToken: 'token',
      } as any);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: 'role-1', code: 'SUPER_ADMIN', name: '超级管理员' }],
        permissions: [],
        dataScopeType: 'ALL',
      });

      const result = await checkPermission(createRequest(), {
        permissions: ['nonexistent:permission'],
      });

      expect(result.authorized).toBe(true);
      expect(result.userId).toBe('user-1');
    });

    it('无权限列表且无角色列表时通过（仅要求登录）', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-1');
      mockGetSession.mockResolvedValueOnce({
        id: 'session-1',
        userId: 'user-1',
        accessToken: 'token',
      } as any);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: 'role-1', code: 'USER', name: '普通用户' }],
        permissions: [],
        dataScopeType: 'SELF',
      });

      const result = await checkPermission(createRequest(), {});

      expect(result.authorized).toBe(true);
      expect(result.userId).toBe('user-1');
    });
  });

  // ======== withPermission ========

  describe('withPermission', () => {
    // @req AUTH-003
    it('权限通过时执行 handler 并返回结果', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-1');
      mockGetSession.mockResolvedValueOnce({
        id: 'session-1',
        userId: 'user-1',
        accessToken: 'token',
      } as any);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: 'role-1', code: 'USER', name: '普通用户' }],
        permissions: ['user:list'],
        dataScopeType: 'SELF',
      });

      const handler = vi.fn(async (userId: string) =>
        NextResponse.json({ data: { userId } })
      );

      const response = await withPermission(
        createRequest(),
        { permissions: ['user:list'] },
        handler
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.userId).toBe('user-1');
      expect(handler).toHaveBeenCalledWith('user-1');
    });

    it('权限不通过时返回 403 且不执行 handler', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-1');
      mockGetSession.mockResolvedValueOnce({
        id: 'session-1',
        userId: 'user-1',
        accessToken: 'token',
      } as any);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: 'role-1', code: 'USER', name: '普通用户' }],
        permissions: ['user:list'],
        dataScopeType: 'SELF',
      });

      const handler = vi.fn(async () =>
        NextResponse.json({ success: true })
      );

      const response = await withPermission(
        createRequest(),
        { permissions: ['audit:read'] },
        handler
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('forbidden');
      expect(handler).not.toHaveBeenCalled();
    });

    it('角色匹配时执行 handler', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce('session-1');
      mockGetSession.mockResolvedValueOnce({
        id: 'session-1',
        userId: 'user-1',
        accessToken: 'token',
      } as any);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: 'role-1', code: 'ADMIN', name: '管理员' }],
        permissions: [],
        dataScopeType: 'ALL',
      });

      const handler = vi.fn(async (userId: string) =>
        NextResponse.json({ success: true, userId })
      );

      const response = await withPermission(
        createRequest(),
        { roles: ['ADMIN'] },
        handler
      );

      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalledWith('user-1');
    });

    it('无 Session 时返回 401', async () => {
      mockGetSessionIdFromCookie.mockResolvedValueOnce(null);

      const handler = vi.fn(async () => NextResponse.json({ success: true }));

      const response = await withPermission(
        createRequest(),
        { permissions: ['user:list'] },
        handler
      );

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('forbidden');
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
