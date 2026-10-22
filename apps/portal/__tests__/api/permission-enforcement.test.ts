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
  seedSuperAdminRole, seedUserRoleBinding,
} from '../helpers/seed-fixtures';
import { seedSigningKeys } from '../helpers/seed-signing-keys';
import type { SeedData } from '../helpers/test-db';
import type * as permissionsModule from '@/lib/permissions';
import type * as redisModule from '@/infrastructure/redis';

// =========================================
// 真实测试 DB 句柄
// =========================================
const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));

// 真实 Redis：正常路径走真身（jti 黑名单与权限缓存都是真库，每用例前被全局钩子清空）。
// 「Redis 不可用」类用例打开 faultHolder.failRedis 注入**可抛错**的故障——改造前这里
// 是一个永不抛错的 fake（所有方法返回常量），于是那两条用例实际测的是"缓存未命中"，
// 而不是"基础设施故障"（普查 N3；ADR-022 §3 要求故障注入必须可抛错）。
vi.mock(import('@/infrastructure/redis'), async (importOriginal): Promise<Partial<typeof redisModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    getRedis: () => {
      if (!faultHolder.failRedis) return actual.getRedis();
      const thrower = async () => { throw new Error('Redis down (injected)'); };
      return {
        connect: thrower, ping: thrower, get: thrower, getdel: thrower, setex: thrower,
        del: thrower, keys: thrower, quit: thrower, sadd: thrower, srem: thrower,
        smembers: thrower, expire: thrower, hset: thrower, hgetall: thrower,
        exists: thrower, incr: thrower,
        pipeline: () => { throw new Error('Redis down (injected)'); },
      };
    },
  };
});

// =========================================
// Mock — JWT 层（crypto 操作，无法用真实 DB 替代）
// =========================================
const {
  cookieHolder,
  faultHolder,
  mockHeadersGet,
  mockConnection,
} = vi.hoisted(() => ({
  /** 当前请求携带的 Cookie JWT（真实 `getJwtFromCookie` 会读它） */
  cookieHolder: { value: null as string | null },
  /** 故障注入开关：打开后所有 Redis 命令抛错 */
  faultHolder: { failRedis: false },
  mockHeadersGet: vi.fn().mockReturnValue(null),
  mockConnection: vi.fn().mockResolvedValue(undefined),
}));

// =========================================
// Mock — permission context（控制 checkPermission 返回的权限/角色）
// =========================================
const { mockGetUserPermissionContext } = vi.hoisted(() => ({
  mockGetUserPermissionContext: vi.fn(),
}));

// 只替换"输入"那一半：`toPermissionContextOrNull` 用 `importOriginal()` 取**真身**。
// 改造前这里手写重实现了它、注释却自称"用真实实现"——正是普查 N4：手写副本与真身
// 各自演化，而测试在副本身上断言（ADR-022 §4(a) 的注解 kind 只对被替换的导出成立）。
// @allow-module-mock @/lib/permissions input-fixture: 权限上下文是本文件被测判定（权限/角色/管理员绕过）的输入；真实 PG 驱动的上下文解析由 rt-permission-failure 覆盖
vi.mock(import('@/lib/permissions'), async (importOriginal): Promise<Partial<typeof permissionsModule>> => {
  const actual = await importOriginal();
  return { ...actual, getUserPermissionContext: mockGetUserPermissionContext };
});

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    connection: mockConnection,
  };
});

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: mockHeadersGet,
  }),
  cookies: async () => ({
    get: (name: string) =>
      cookieHolder.value === null ? undefined : { name, value: cookieHolder.value },
  }),
}));

// `@/lib/session` 与 `@/lib/auth/token` 不再 mock：`getJwtFromCookie` 走真实实现
// （读下面 mock 的 `next/headers` cookies），`verifyAccessToken` 走真实 ES256
// （密钥对由 `seedSigningKeys` 种入真库）。

import { checkPermission, withAuth, withPermission } from '@/lib/auth';
import type { PermissionCheckResult } from '@/lib/auth';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { ForbiddenError, UnauthenticatedError } from '@/domain/shared/errors';
import { signAccessToken } from '@/lib/auth/token';
import { COMMON_ERRORS, PORTAL_CLIENT_ID } from '@auth-sso/contracts';

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
  };
}

// =========================================
// Lifecycle
// =========================================
beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  vi.clearAllMocks();
  cookieHolder.value = null;
  faultHolder.failRedis = false;
  await td.cleanup();
  await seedTestData(td.db, buildFullSeed());
  // 真实 ES256：种入密钥对（内含签名密钥缓存重置）
  await seedSigningKeys(td);

  // 默认权限上下文：USER 角色 + 全部 4 个权限
  mockGetUserPermissionContext.mockResolvedValue( { kind: 'ok', context:{
    roles: [{ id: USER_ROLE_ID, code: 'USER', name: '普通用户' }],
    permissions: ['portal:user:list', 'portal:user:read', 'portal:audit:read', 'portal:role:assign'],
    deptIds: [ROOT_DEPT_ID],
  } });
});

/**
 * 让当前请求带上一枚**真实签名**的 Access Token（aud = PORTAL_CLIENT_ID）。
 * 取代改造前的 `mockGetJwtFromCookie('valid-token') + mockVerifyJwt(claims)` 组合——
 * 那套组合里"验签"从未真正发生。
 */
async function givenValidToken(userId: string = USER_ID): Promise<void> {
  const { token } = await signAccessToken(userId, PORTAL_CLIENT_ID, 'openid');
  cookieHolder.value = token;
}

/**
 * 判别式联合的两把小钥匙 —— 让「通过必有 userId、失败必带原因」成为**类型层面**的事实。
 *
 * 先取再断言，取不到就抛出并说明实际是什么：比 `expect(result.userId)` 更能定位问题，
 * 也不依赖断言顺序（`expect(result.authorized).toBe(true)` 不会让 TS 收窄）。
 */
function passUserId(result: PermissionCheckResult): string {
  if (!result.authorized) throw new Error(`期望鉴权通过，实际失败：${result.reason.message}`);
  return result.userId;
}

function failureReason(result: PermissionCheckResult) {
  if (result.authorized) throw new Error('期望鉴权失败，实际通过');
  return result.reason;
}

describe('Permission Enforcement', () => {
  function createRequest(): NextRequest {
    return new NextRequest('http://localhost:4100/api/test');
  }

  // ======== checkPermission ========

  describe('checkPermission', () => {
    it('JWT Cookie 不存在时返回 401', async () => {
      cookieHolder.value = null;

      const result = await checkPermission({
        permissions: ['portal:user:list'],
      });

      expect(result.authorized).toBe(false);
      expect(failureReason(result)).toBeInstanceOf(UnauthenticatedError);
      expect(mapDomainError(failureReason(result)).status).toBe(401);
    });

    it('JWT 验签失败时返回 401', async () => {
      cookieHolder.value = 'invalid-token';

      const result = await checkPermission({
        permissions: ['portal:user:list'],
      });

      expect(result.authorized).toBe(false);
      expect(failureReason(result)).toBeInstanceOf(UnauthenticatedError);
      expect(mapDomainError(failureReason(result)).status).toBe(401);
    });

    it('权限上下文中无所需权限时返回 403', async () => {
      await givenValidToken();
      mockGetUserPermissionContext.mockResolvedValueOnce( { kind: 'ok', context:{
        roles: [{ id: USER_ROLE_ID, code: 'USER', name: '普通用户' }],
        permissions: ['portal:user:list'],
        deptIds: [ROOT_DEPT_ID],
      } });

      const result = await checkPermission({
        permissions: ['portal:audit:read'],
      });

      expect(result.authorized).toBe(false);
      expect(failureReason(result)).toBeInstanceOf(ForbiddenError);
      expect(mapDomainError(failureReason(result)).status).toBe(403);
    });

    it('用户拥有任一所需权限时通过', async () => {
      await givenValidToken();

      const result = await checkPermission({
        permissions: ['portal:audit:read'],
      });

      expect(result.authorized).toBe(true);
      expect(passUserId(result)).toBe(USER_ID);
    });

    it('拥有多个权限中的任一即通过（或逻辑）', async () => {
      await givenValidToken();

      const result = await checkPermission({
        permissions: ['portal:audit:read', 'portal:user:list'],
      });

      expect(result.authorized).toBe(true);
    });

    // @req H-ACL-003
    it('requireAll 模式：缺少任一权限时返回 403', async () => {
      await givenValidToken();
      mockGetUserPermissionContext.mockResolvedValueOnce( { kind: 'ok', context:{
        roles: [{ id: USER_ROLE_ID, code: 'USER', name: '普通用户' }],
        permissions: ['portal:user:list'],
        deptIds: [ROOT_DEPT_ID],
      } });

      const result = await checkPermission({
        permissions: ['portal:user:list', 'portal:audit:read'],
        requireAll: true,
      });

      expect(result.authorized).toBe(false);
      expect(failureReason(result)).toBeInstanceOf(ForbiddenError);
      expect(mapDomainError(failureReason(result)).status).toBe(403);
    });

    it('requireAll 模式：拥有全部权限时通过', async () => {
      await givenValidToken();

      const result = await checkPermission({
        permissions: ['portal:user:list', 'portal:audit:read'],
        requireAll: true,
      });

      expect(result.authorized).toBe(true);
      expect(passUserId(result)).toBe(USER_ID);
    });

    it('基于角色的检查：匹配角色时通过', async () => {
      await givenValidToken();
      mockGetUserPermissionContext.mockResolvedValueOnce( { kind: 'ok', context:{
        roles: [{ id: ADMIN_ROLE_ID, code: 'ADMIN', name: '管理员' }],
        permissions: [],
        deptIds: [ROOT_DEPT_ID],
      } });

      const result = await checkPermission({
        roles: ['ADMIN'],
      });

      expect(result.authorized).toBe(true);
      expect(passUserId(result)).toBe(USER_ID);
    });

    it('基于角色的检查：角色不匹配时返回 403', async () => {
      await givenValidToken();

      const result = await checkPermission({
        roles: ['ADMIN'],
      });

      expect(result.authorized).toBe(false);
      expect(failureReason(result)).toBeInstanceOf(ForbiddenError);
      expect(mapDomainError(failureReason(result)).status).toBe(403);
    });

    it('超级管理员角色（ADMIN）绕过所有权限检查', async () => {
      await givenValidToken();
      mockGetUserPermissionContext.mockResolvedValueOnce( { kind: 'ok', context:{
        roles: [{ id: ADMIN_ROLE_ID, code: 'ADMIN', name: '管理员' }],
        permissions: [],
        deptIds: [ROOT_DEPT_ID],
      } });

      const result = await checkPermission({
        permissions: ['portal:nonexistent:permission'],
      });

      expect(result.authorized).toBe(true);
      expect(passUserId(result)).toBe(USER_ID);
    });

    it('超级管理员角色（SUPER_ADMIN）绕过所有权限检查', async () => {
      await givenValidToken();
      mockGetUserPermissionContext.mockResolvedValueOnce( { kind: 'ok', context:{
        roles: [{ id: SUPER_ADMIN_ROLE_ID, code: 'SUPER_ADMIN', name: '超级管理员' }],
        permissions: [],
        deptIds: [ROOT_DEPT_ID],
      } });

      const result = await checkPermission({
        permissions: ['portal:nonexistent:permission'],
      });

      expect(result.authorized).toBe(true);
    });

    it('无权限列表且无角色列表时仅要求登录', async () => {
      await givenValidToken();

      const result = await checkPermission({});

      expect(result.authorized).toBe(true);
      expect(passUserId(result)).toBe(USER_ID);
    });

    it('权限上下文不可用（kind=unavailable）⇒ 按无权限处理：403，不得放行', async () => {
      // 改造前这条用例名写"返回 500"，实际却靠 `mockVerifyJwt → null` 测的是
      // "验签失败 ⇒ 401"（名与实不符）。真实语义是：上下文取不到（unavailable）
      // 时 `toPermissionContextOrNull` 返回 null ⇒ 主体无任何权限 ⇒ 403（fail-closed）。
      await givenValidToken();
      mockGetUserPermissionContext.mockResolvedValueOnce({ kind: 'unavailable' });

      const result = await checkPermission({
        permissions: ['portal:user:list'],
      });

      expect(result.authorized).toBe(false);
      expect(failureReason(result)).toBeInstanceOf(ForbiddenError);
      expect(mapDomainError(failureReason(result)).status).toBe(403);
    });

    it('验签通过返回授权结果', async () => {
      await givenValidToken();

      const result = await checkPermission({});

      expect(result.authorized).toBe(true);
      expect(passUserId(result)).toBe(USER_ID);
    });

    // ── Redis 降级熔断路径 ──

    it('Redis 不可用 ⇒ jti 黑名单查不了 ⇒ **fail-close 拒绝**（401），不得改判为放行', async () => {
      await givenValidToken();
      faultHolder.failRedis = true;

      const result = await checkPermission({
        permissions: ['portal:user:list'],
      });

      // 撤销状态无法确认时按"已撤销"处理（isJtiRevoked 的 fail-close）。
      // 改造前这里断言 authorized=true——那是"永不抛错的 fake"造出来的假象。
      expect(result.authorized).toBe(false);
      expect(failureReason(result)).toBeInstanceOf(UnauthenticatedError);
      expect(mapDomainError(failureReason(result)).status).toBe(401);
    });

    it('连续 Redis 故障：每次都稳定 fail-close，不抛未捕获异常、不放行', async () => {
      await givenValidToken();
      faultHolder.failRedis = true;

      for (let i = 0; i < 3; i += 1) {
        const result = await checkPermission({
          permissions: ['portal:user:list'],
        });
        expect(result.authorized).toBe(false);
        expect(failureReason(result)).toBeInstanceOf(UnauthenticatedError);
        expect(mapDomainError(failureReason(result)).status).toBe(401);
      }
    });
  });

  // ======== withPermission ========

  describe('withPermission', () => {
    // @req H-ACL-001
    it('权限通过时执行 handler 并返回结果', async () => {
      await givenValidToken();

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
      await givenValidToken();
      mockGetUserPermissionContext.mockResolvedValueOnce( { kind: 'ok', context:{
        roles: [{ id: USER_ROLE_ID, code: 'USER', name: '普通用户' }],
        permissions: ['portal:user:list'],
        deptIds: [ROOT_DEPT_ID],
      } });

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
      await givenValidToken();
      mockGetUserPermissionContext.mockResolvedValueOnce( { kind: 'ok', context:{
        roles: [{ id: ADMIN_ROLE_ID, code: 'ADMIN', name: '管理员' }],
        permissions: [],
        deptIds: [ROOT_DEPT_ID],
      } });

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

    it('无 Session 时返回 401 + UNAUTHORIZED（此前 401 却配 FORBIDDEN 码，自相矛盾）', async () => {
      cookieHolder.value = null;

      const handler = vi.fn(async () => NextResponse.json({ success: true }));

      const response = await withPermission(

        { permissions: ['portal:user:list'] },
        handler
      );

      expect(response.status).toBe(401);
      const body = await response.json();
      // 401 必须配 UNAUTHORIZED：此前是 401 + FORBIDDEN（码与状态自相矛盾）。
      // 根因是 withPermission 拿中文文案当码、withAuth 恒用 FORBIDDEN；
      // 现在两者都由 DomainError 决定（UnauthenticatedError=401 / ForbiddenError=403）
      expect(body.error).toBe('AUTH_SSO_1002');
      expect(handler).not.toHaveBeenCalled();
    });

    // 架构巡检候选 1 的核心不变量："一次失败 → 哪个码 + 哪个状态"只有**一个**答案。
    // 此前 withAuth 恒 403/FORBIDDEN、withPermission 用 check.statusCode，
    // checkPermission 自己又把中文文案放进名为 error 的字段 ⇒ 三个面各说各话。
    it('三面一致：未登录时 checkPermission 的原因 / withAuth 的 ApiError / withPermission 的响应都指向 401 + UNAUTHORIZED', async () => {
      cookieHolder.value = null;

      const check = await checkPermission({ permissions: ['portal:user:list'] });
      expect(failureReason(check)).toBeInstanceOf(UnauthenticatedError);
      expect(mapDomainError(failureReason(check))).toMatchObject({
        status: 401,
        error: COMMON_ERRORS.UNAUTHORIZED,
      });

      const action = withAuth(
        { permissions: ['portal:user:list'] },
        async () => ({ success: true as const, data: null })
      );
      const actionResult = await action();
      expect(actionResult.success).toBe(false);
      expect(actionResult.success === false && actionResult.error).toBe(COMMON_ERRORS.UNAUTHORIZED);

      const response = await withPermission(
        { permissions: ['portal:user:list'] },
        async () => NextResponse.json({ ok: true })
      );
      expect(response.status).toBe(401);
      expect((await response.json()).error).toBe(COMMON_ERRORS.UNAUTHORIZED);
    });

    it('handler 异常时返回 500', async () => {
      await givenValidToken();

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
      await givenValidToken();
      mockGetUserPermissionContext.mockResolvedValueOnce( { kind: 'ok', context:{
        roles: [{ id: ADMIN_ROLE_ID, code: 'ADMIN', name: '管理员' }],
        permissions: [],
        deptIds: [ROOT_DEPT_ID],
      } });

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
