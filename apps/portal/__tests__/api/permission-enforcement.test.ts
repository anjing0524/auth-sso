/**
 * 权限强制 API 单元测试（JWT Cookie 无状态版）
 *
 * 覆盖范围：
 * - checkPermission 无 JWT Cookie → 401
 * - checkPermission 无效 JWT → 401
 * - checkPermission 缺少权限 → 403
 * - checkPermission 拥有权限 → authorized
 * - checkPermission requireAll 模式
 * - checkPermission 角色检查
 * - checkPermission 超级管理员绕过
 * - withPermission 包装器正确处理
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
  mockGetJwtFromCookie,
  mockVerifyJwt,
  mockGetUserPermissionContext,
} = vi.hoisted(() => {
  const mockGetJwtFromCookie = vi.fn();
  const mockVerifyJwt = vi.fn();
  const mockGetUserPermissionContext = vi.fn();

  return {
    mockGetJwtFromCookie,
    mockVerifyJwt,
    mockGetUserPermissionContext,
  };
});

vi.mock('@/lib/session', () => ({
  getJwtFromCookie: mockGetJwtFromCookie,
  verifyJwt: mockVerifyJwt,
}));

vi.mock('@/lib/permissions', () => ({
  getUserPermissionContext: mockGetUserPermissionContext,
}));

vi.mock('@/infrastructure/db', () => ({
  db: {},
  schema: {},
}));

import { checkPermission, withPermission } from '@/lib/auth';

describe('Permission Enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createRequest(): NextRequest {
    return new NextRequest('http://localhost:4100/api/test');
  }

  const defaultClaims = {
    sub: 'user-1',
    jti: 'jti-123',
    iss: 'http://localhost:4101',
  };

  // ======== checkPermission ========

  describe('checkPermission', () => {
    it('JWT Cookie 不存在时返回 401', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce(null);

      const result = await checkPermission(createRequest(), {
        permissions: ['user:list'],
      });

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(401);
    });

    it('JWT 验签失败时返回 401', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('invalid-token');
      mockVerifyJwt.mockResolvedValueOnce(null);

      const result = await checkPermission(createRequest(), {
        permissions: ['user:list'],
      });

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(401);
    });

    it('权限上下文中无所需权限时返回 403', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
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
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
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

    it('拥有多个权限中的任一即通过（或逻辑）', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: 'role-1', code: 'USER', name: '普通用户' }],
        permissions: ['user:list'],
        dataScopeType: 'SELF',
      });

      const result = await checkPermission(createRequest(), {
        permissions: ['audit:read', 'user:list'],
      });

      expect(result.authorized).toBe(true);
    });

    // @req AUTH-006
    it('requireAll 模式：缺少任一权限时返回 403', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
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
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
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
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
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
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
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

    it('超级管理员角色（ADMIN）绕过所有权限检查', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: 'role-1', code: 'ADMIN', name: '管理员' }],
        permissions: [],
        dataScopeType: 'ALL',
      });

      const result = await checkPermission(createRequest(), {
        permissions: ['nonexistent:permission'],
      });

      expect(result.authorized).toBe(true);
      expect(result.userId).toBe('user-1');
    });

    it('超级管理员角色（SUPER_ADMIN）绕过所有权限检查', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: 'role-1', code: 'SUPER_ADMIN', name: '超级管理员' }],
        permissions: [],
        dataScopeType: 'ALL',
      });

      const result = await checkPermission(createRequest(), {
        permissions: ['nonexistent:permission'],
      });

      expect(result.authorized).toBe(true);
    });

    it('无权限列表且无角色列表时仅要求登录', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: 'role-1', code: 'USER', name: '普通用户' }],
        permissions: [],
        dataScopeType: 'SELF',
      });

      const result = await checkPermission(createRequest(), {});

      expect(result.authorized).toBe(true);
      expect(result.userId).toBe('user-1');
    });

    it('权限上下文为 null 时返回 500', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce(null);

      const result = await checkPermission(createRequest(), {
        permissions: ['user:list'],
      });

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(500);
    });

    it('验签通过的 claims 被传递到 result 中', async () => {
      const claims = {
        sub: 'user-1',
        jti: 'jti-123',
        iss: 'http://localhost:4101',
        roles: ['ADMIN'],
        permissions: ['user:list'],
        deptId: 'dept-1',
        dataScopeType: 'ALL' as const,
      };
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(claims);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: 'role-1', code: 'ADMIN', name: '管理员' }],
        permissions: ['user:list'],
        dataScopeType: 'ALL',
      });

      const result = await checkPermission(createRequest(), {});

      expect(result.authorized).toBe(true);
      expect(result.claims).toEqual(claims);
    });
  });

  // ======== withPermission ========

  describe('withPermission', () => {
    // @req AUTH-003
    it('权限通过时执行 handler 并返回结果', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
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
      expect(handler).toHaveBeenCalledWith('user-1', defaultClaims);
    });

    it('权限不通过时返回 403 且不执行 handler', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
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
      expect(body.error).toBe('AUTH_SSO_1003');
      expect(handler).not.toHaveBeenCalled();
    });

    it('角色匹配时执行 handler', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
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
      expect(handler).toHaveBeenCalledWith('user-1', defaultClaims);
    });

    it('无 Session 时返回 401（forbidden error code）', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce(null);

      const handler = vi.fn(async () => NextResponse.json({ success: true }));

      const response = await withPermission(
        createRequest(),
        { permissions: ['user:list'] },
        handler
      );

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('AUTH_SSO_1003');
      expect(handler).not.toHaveBeenCalled();
    });

    it('handler 异常时返回 500', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: 'role-1', code: 'USER', name: '普通用户' }],
        permissions: ['user:list'],
        dataScopeType: 'SELF',
      });

      const handler = vi.fn(async () => {
        throw new Error('Handler crashed');
      });

      const response = await withPermission(
        createRequest(),
        { permissions: ['user:list'] },
        handler
      );

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('AUTH_SSO_1006');
    });

    it('超级管理员角色即使无指定权限也能通过', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: 'role-1', code: 'SUPER_ADMIN', name: '超级管理员' }],
        permissions: [],
        dataScopeType: 'ALL',
      });

      const handler = vi.fn(async (userId: string) =>
        NextResponse.json({ success: true, userId })
      );

      const response = await withPermission(
        createRequest(),
        { permissions: ['anything'] },
        handler
      );

      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalledWith('user-1', defaultClaims);
    });
  });
});
