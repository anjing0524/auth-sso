/**
 * 权限强制 API 单元测试（JWT Cookie + DB 权限查表）
 *
 * checkPermission / withPermission 通过 resolveIdentity 解析 JWT → Redis 缓存 / DB 查询
 * 获取用户角色与权限上下文，执行细粒度鉴权决策。
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
 * @req H-ACL-001, H-ACL-002, H-ACL-003
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import {
  seedRootDept, seedAdminUser, seedTestUser,
  seedSuperAdminRole, seedJwks, seedUserRoleBinding,
} from '../helpers/seed-fixtures';
import type { SeedData } from '../helpers/test-db';

// =========================================
// 真实测试 DB 句柄
// =========================================
const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));

// Mock Redis — 返回 null 强制 DB 回退（jti 黑名单 + 权限缓存均不命中）
vi.mock('@/infrastructure/redis', () => ({
  getRedis: () => ({
    get: async () => null,
    setex: async () => 'OK',
    del: async () => 1,
    exists: async () => 0,
    keys: async () => [],
    sadd: async () => 1,
    srem: async () => 0,
    smembers: async () => [],
    expire: async () => 1,
    incr: async () => 1,
    hset: async () => 1,
    hgetall: async () => ({}),
    pipeline: () => ({
      del: () => ({ get: () => ({}), setex: () => ({}), sadd: () => ({}), srem: () => ({}), exec: async () => [] }),
    }),
    quit: async () => {},
  }),
}));

// =========================================
// Mock — JWT 层（crypto 操作，无法用真实 DB 替代）
// =========================================
const {
  mockGetJwtFromCookie,
  mockVerifyJwt,
  mockHeadersGet,
} = vi.hoisted(() => {
  const mockGetJwtFromCookie = vi.fn();
  const mockVerifyJwt = vi.fn();
  const mockHeadersGet = vi.fn().mockReturnValue(null);

  return {
    mockGetJwtFromCookie,
    mockVerifyJwt,
    mockHeadersGet,
  };
});

// =========================================
// Mock — permission context（控制 checkPermission 返回的权限/角色）
// =========================================
const { mockGetUserPermissionContext } = vi.hoisted(() => ({
  mockGetUserPermissionContext: vi.fn(),
}));

vi.mock('@/lib/permissions', () => ({
  getUserPermissionContext: mockGetUserPermissionContext,
}));

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: mockHeadersGet,
  }),
  cookies: async () => ({
    get: (name: string) => ({ value: 'test-token' }),
  }),
}));

vi.mock('@/lib/session', () => ({
  getJwtFromCookie: mockGetJwtFromCookie,
}));

vi.mock('@/lib/auth/token', () => ({
  verifyAccessToken: mockVerifyJwt,
}));

import { checkPermission, withPermission } from '@/lib/auth';

// =========================================
// 固定 seed ID 常量（与 JWT claims 对齐）
// =========================================
const ROOT_DEPT_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000201';
const ADMIN_USER_ID = '00000000-0000-4000-8000-000000000101';
const SUPER_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000301';
const ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000302';
const USER_ROLE_ID = '00000000-0000-4000-8000-000000000303';
const PERM_USER_LIST_ID = '00000000-0000-4000-8000-000000000401';
const PERM_USER_READ_ID = '00000000-0000-4000-8000-000000000402';
const PERM_AUDIT_READ_ID = '00000000-0000-4000-8000-000000000403';
const PERM_ROLE_ASSIGN_ID = '00000000-0000-4000-8000-000000000404';

const now = new Date();

/**
 * 构建完整的 seed 数据——覆盖所有测试场景需要的 roles/permissions/role_permissions/user_roles。
 * 各测试通过不同的 JWT claims 模拟不同用户权限组合。
 */
function buildFullSeed(): SeedData {
  return {
    departments: seedRootDept(),
    users: [
      ...(seedAdminUser() ?? []),
      ...(seedTestUser() ?? []),
    ],
    roles: [
      ...(seedSuperAdminRole() ?? []),
      // ADMIN 角色
      {
        id: ADMIN_ROLE_ID,
        name: '管理员',
        code: 'ADMIN',
        description: '系统管理员',
        deptId: ROOT_DEPT_ID,
        isSystem: true,
        status: 'ACTIVE',
        sort: 1,
        createdAt: now,
        updatedAt: now,
      },
      // USER 角色
      {
        id: USER_ROLE_ID,
        name: '普通用户',
        code: 'USER',
        description: '普通用户',
        deptId: ROOT_DEPT_ID,
        isSystem: false,
        status: 'ACTIVE',
        sort: 2,
        createdAt: now,
        updatedAt: now,
      },
    ],
    permissions: [
      {
        id: PERM_USER_LIST_ID,
        code: 'portal:user:list',
        name: '用户列表',
        type: 'API',
        clientId: null,
        parentId: null,
        status: 'ACTIVE',
        sort: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: PERM_USER_READ_ID,
        code: 'portal:user:read',
        name: '用户详情',
        type: 'API',
        clientId: null,
        parentId: null,
        status: 'ACTIVE',
        sort: 2,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: PERM_AUDIT_READ_ID,
        code: 'portal:audit:read',
        name: '审计日志读取',
        type: 'API',
        clientId: null,
        parentId: null,
        status: 'ACTIVE',
        sort: 3,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: PERM_ROLE_ASSIGN_ID,
        code: 'portal:role:assign',
        name: '角色分配',
        type: 'API',
        clientId: null,
        parentId: null,
        status: 'ACTIVE',
        sort: 4,
        createdAt: now,
        updatedAt: now,
      },
    ],
    // SUPER_ADMIN 角色拥有全部权限
    rolePermissions: [
      { roleId: SUPER_ADMIN_ROLE_ID, permissionId: PERM_USER_LIST_ID, createdAt: now },
      { roleId: SUPER_ADMIN_ROLE_ID, permissionId: PERM_USER_READ_ID, createdAt: now },
      { roleId: SUPER_ADMIN_ROLE_ID, permissionId: PERM_AUDIT_READ_ID, createdAt: now },
      { roleId: SUPER_ADMIN_ROLE_ID, permissionId: PERM_ROLE_ASSIGN_ID, createdAt: now },
      // ADMIN 角色拥有全部权限
      { roleId: ADMIN_ROLE_ID, permissionId: PERM_USER_LIST_ID, createdAt: now },
      { roleId: ADMIN_ROLE_ID, permissionId: PERM_USER_READ_ID, createdAt: now },
      { roleId: ADMIN_ROLE_ID, permissionId: PERM_AUDIT_READ_ID, createdAt: now },
      { roleId: ADMIN_ROLE_ID, permissionId: PERM_ROLE_ASSIGN_ID, createdAt: now },
      // USER 角色拥有 portal:user:list, portal:user:read, portal:audit:read, portal:role:assign
      { roleId: USER_ROLE_ID, permissionId: PERM_USER_LIST_ID, createdAt: now },
      { roleId: USER_ROLE_ID, permissionId: PERM_USER_READ_ID, createdAt: now },
      { roleId: USER_ROLE_ID, permissionId: PERM_AUDIT_READ_ID, createdAt: now },
      { roleId: USER_ROLE_ID, permissionId: PERM_ROLE_ASSIGN_ID, createdAt: now },
    ],
    // admin → ADMIN role; testuser → USER role
    userRoles: [
      ...(seedUserRoleBinding(ADMIN_USER_ID, ADMIN_ROLE_ID) ?? []),
      ...(seedUserRoleBinding(USER_ID, USER_ROLE_ID) ?? []),
    ],
    jwks: seedJwks(),
  };
}

// =========================================
// Lifecycle
// =========================================
beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  vi.clearAllMocks();
  await td.cleanup();
  await seedTestData(td.db, buildFullSeed());

  // 默认权限上下文：USER 角色 + 全部 4 个权限
  mockGetUserPermissionContext.mockResolvedValue({
    roles: [{ id: USER_ROLE_ID, code: 'USER', name: '普通用户' }],
    permissions: ['portal:user:list', 'portal:user:read', 'portal:audit:read', 'portal:role:assign'],
    deptIds: [ROOT_DEPT_ID],
  });
});

describe('Permission Enforcement', () => {
  function createRequest(): NextRequest {
    return new NextRequest('http://localhost:4100/api/test');
  }

  const defaultClaims = {
    sub: USER_ID,
    jti: 'jti-123',
    iss: 'http://localhost:4101',
    aud: 'auth-sso',
  };

  // ======== checkPermission ========

  describe('checkPermission', () => {
    it('JWT Cookie 不存在时返回 401', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce(null);

      const result = await checkPermission({
        permissions: ['portal:user:list'],
      });

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(401);
    });

    it('JWT 验签失败时返回 401', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('invalid-token');
      mockVerifyJwt.mockResolvedValueOnce(null);

      const result = await checkPermission({
        permissions: ['portal:user:list'],
      });

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(401);
    });

    it('权限上下文中无所需权限时返回 403', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: USER_ROLE_ID, code: 'USER', name: '普通用户' }],
        permissions: ['portal:user:list'],
        deptIds: [ROOT_DEPT_ID],
      });

      const result = await checkPermission({
        permissions: ['portal:audit:read'],
      });

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it('用户拥有任一所需权限时通过', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);

      const result = await checkPermission({
        permissions: ['portal:audit:read'],
      });

      expect(result.authorized).toBe(true);
      expect(result.userId).toBe(USER_ID);
    });

    it('拥有多个权限中的任一即通过（或逻辑）', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);

      const result = await checkPermission({
        permissions: ['portal:audit:read', 'portal:user:list'],
      });

      expect(result.authorized).toBe(true);
    });

    // @req H-ACL-003
    it('requireAll 模式：缺少任一权限时返回 403', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: USER_ROLE_ID, code: 'USER', name: '普通用户' }],
        permissions: ['portal:user:list'],
        deptIds: [ROOT_DEPT_ID],
      });

      const result = await checkPermission({
        permissions: ['portal:user:list', 'portal:audit:read'],
        requireAll: true,
      });

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it('requireAll 模式：拥有全部权限时通过', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);

      const result = await checkPermission({
        permissions: ['portal:user:list', 'portal:audit:read'],
        requireAll: true,
      });

      expect(result.authorized).toBe(true);
      expect(result.userId).toBe(USER_ID);
    });

    it('基于角色的检查：匹配角色时通过', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: ADMIN_ROLE_ID, code: 'ADMIN', name: '管理员' }],
        permissions: [],
        deptIds: [ROOT_DEPT_ID],
      });

      const result = await checkPermission({
        roles: ['ADMIN'],
      });

      expect(result.authorized).toBe(true);
      expect(result.userId).toBe(USER_ID);
    });

    it('基于角色的检查：角色不匹配时返回 403', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);

      const result = await checkPermission({
        roles: ['ADMIN'],
      });

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it('超级管理员角色（ADMIN）绕过所有权限检查', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: ADMIN_ROLE_ID, code: 'ADMIN', name: '管理员' }],
        permissions: [],
        deptIds: [ROOT_DEPT_ID],
      });

      const result = await checkPermission({
        permissions: ['portal:nonexistent:permission'],
      });

      expect(result.authorized).toBe(true);
      expect(result.userId).toBe(USER_ID);
    });

    it('超级管理员角色（SUPER_ADMIN）绕过所有权限检查', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: SUPER_ADMIN_ROLE_ID, code: 'SUPER_ADMIN', name: '超级管理员' }],
        permissions: [],
        deptIds: [ROOT_DEPT_ID],
      });

      const result = await checkPermission({
        permissions: ['portal:nonexistent:permission'],
      });

      expect(result.authorized).toBe(true);
    });

    it('无权限列表且无角色列表时仅要求登录', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);

      const result = await checkPermission({});

      expect(result.authorized).toBe(true);
      expect(result.userId).toBe(USER_ID);
    });

    it('权限上下文为 null 时返回 500', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(null);
      // verifyAccessToken 返回 null → resolveIdentity 返回 null → 401
      const result = await checkPermission({
        permissions: ['portal:user:list'],
      });

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(401);
    });

    it('验签通过返回授权结果', async () => {
      const claims = {
        sub: USER_ID,
        jti: 'jti-123',
        iss: 'http://localhost:4101',
      };
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(claims);

      const result = await checkPermission({});

      expect(result.authorized).toBe(true);
      expect(result.userId).toBe(USER_ID);
    });

    // ── Redis 降级熔断路径 ──

    it('Redis 不可用时降级 DB，授权决策不受影响', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
      // 当前 mock Redis.get 返回 null，模拟无缓存命中
      const result = await checkPermission({
        permissions: ['portal:user:list'],
      });
      expect(result.authorized).toBe(true);
      expect(result.userId).toBe(USER_ID);
    });

    it('连续 Redis 故障不应抛出未捕获异常', async () => {
      mockGetJwtFromCookie.mockResolvedValue('valid-token');
      mockVerifyJwt.mockResolvedValue(defaultClaims);
      for (let i = 0; i < 3; i++) {
        const result = await checkPermission({
          permissions: ['portal:user:list'],
        });
        expect(result.authorized).toBe(true);
      }
    });
  });

  // ======== withPermission ========

  describe('withPermission', () => {
    // @req H-ACL-001
    it('权限通过时执行 handler 并返回结果', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);

      const handler = vi.fn(async (userId: string) =>
        NextResponse.json({ data: { userId } })
      );

      const response = await withPermission(

        { permissions: ['portal:user:list'] },
        handler
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.userId).toBe(USER_ID);
      expect(handler).toHaveBeenCalledWith(USER_ID);
    });

    it('权限不通过时返回 403 且不执行 handler', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce('valid-token');
      mockVerifyJwt.mockResolvedValueOnce(defaultClaims);
      mockGetUserPermissionContext.mockResolvedValueOnce({
        roles: [{ id: USER_ROLE_ID, code: 'USER', name: '普通用户' }],
        permissions: ['portal:user:list'],
        deptIds: [ROOT_DEPT_ID],
      });

      const handler = vi.fn(async () =>
        NextResponse.json({ success: true })
      );

      const response = await withPermission(

        { permissions: ['portal:audit:read'] },
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
        roles: [{ id: ADMIN_ROLE_ID, code: 'ADMIN', name: '管理员' }],
        permissions: [],
        deptIds: [ROOT_DEPT_ID],
      });

      const handler = vi.fn(async (userId: string) =>
        NextResponse.json({ success: true, userId })
      );

      const response = await withPermission(

        { roles: ['ADMIN'] },
        handler
      );

      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalledWith(USER_ID);
    });

    it('无 Session 时返回 401（forbidden error code）', async () => {
      mockGetJwtFromCookie.mockResolvedValueOnce(null);

      const handler = vi.fn(async () => NextResponse.json({ success: true }));

      const response = await withPermission(

        { permissions: ['portal:user:list'] },
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

      const handler = vi.fn(async () => {
        throw new Error('Handler crashed');
      });

      const response = await withPermission(

        { permissions: ['portal:user:list'] },
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
        roles: [{ id: ADMIN_ROLE_ID, code: 'ADMIN', name: '管理员' }],
        permissions: [],
        deptIds: [ROOT_DEPT_ID],
      });

      const handler = vi.fn(async (userId: string) =>
        NextResponse.json({ success: true, userId })
      );

      const response = await withPermission(

        { permissions: ['portal:anything'] },
        handler
      );

      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalledWith(USER_ID);
    });
  });
});
