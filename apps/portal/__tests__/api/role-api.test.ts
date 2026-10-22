/**
 * 角色管理 API 集成测试（真实 DB）
 *
 * 覆盖范围：
 * - 角色列表查询
 * - 权限检查（403）
 * - 角色详情查询
 * - 角色不存在（404）
 * - 角色权限绑定查询
 *
 * @req C-ROL-L, C-ROL-U, C-ROL-PA
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { NextResponse } from 'next/server';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedRootDept, seedSuperAdminRole, seedUserRoleBinding } from '../helpers/seed-fixtures';
import { createTestRequest } from '../helpers/test-utils';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';

// ── 测试数据库 ──────────────────────────────────────
const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));

const { mockWithPermission } = vi.hoisted(() => {
  const mockWithPermission = vi.fn(async (_options: any, handler: Function) => {
    return handler('00000000-0000-4000-8000-000000000101');
  });
  return { mockWithPermission };
});

// @allow-module-mock @/lib/auth auth-bypass: 本文件被测语义不依赖登录/授权链路，mock 仅用于构造"已登录/已授权"的请求上下文（依赖它的断言：role-api.test.ts 全部用例）
vi.mock(import('@/lib/auth'), async (importOriginal): Promise<Partial<typeof authModule>> => {
  const actual = await importOriginal();
  return { ...actual,
    resolveIdentity: vi.fn(async () => ({ userId: '00000000-0000-4000-8000-000000000101', expiresAt: null, issuedAt: null })),
    logServerDataRead: vi.fn(async () => {}),
    withPermission: mockWithPermission,
};
});

// @allow-module-mock @/lib/crypto input-fixture: 只覆盖「确定性 ID」这类输入，其余导出（含 hashToken）走真身
vi.mock(import('@/lib/crypto'), async (importOriginal): Promise<Partial<typeof cryptoModule>> => {
    const actual = await importOriginal();
    // 只覆盖「确定性 ID」，其余导出（含 hashToken 的真实 sha256）走真身：
    // 早先整体替换会把 hashToken 变成 undefined，而注解却写着「哈希走真实实现」
    return {
    ...actual,
    generateUUID: () => 'aabbccdd-eeff-4000-8000-000000000001',
    generateId: (_len?: number) => 'aaaaaaaa',
  };
});


vi.mock('@/infrastructure/redis', () => ({}));

// @allow-module-mock @/lib/permissions input-fixture: 只提供"刷新已完成"这类输入；真实 PG 驱动的分级由 permission-enforcement / rt-permission-failure 覆盖
vi.mock(import('@/lib/permissions'), async (importOriginal): Promise<Partial<typeof permissionsModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    refreshUsersPermissionCache: vi.fn(async () => ({ succeeded: 0, failed: 0 })),
  };
});
// @allow-module-mock @/lib/session/revoke input-fixture: 只提供"撤销已完成"这类输入；真实 Redis 撤销由 force-logout-revocation / oauth-revoke 覆盖
vi.mock(import('@/lib/session/revoke'), async (importOriginal): Promise<Partial<typeof sessionRevokeModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    revokeUsersAccessByUserId: vi.fn(async () => ({ succeeded: 0, failed: 0 })),
  };
});

// ── 被测试模块 ─────────────────────────────────────
import { GET as ListRoles } from '@/app/api/roles/route';
import { GET as GetRole } from '@/app/api/roles/[id]/route';
import { GET as GetRolePermissions, POST as AssignRolePermissions, PUT as PutRolePermissions } from '@/app/api/roles/[id]/permissions/route';
import type * as authModule from '@/lib/auth';
import type * as cryptoModule from '@/lib/crypto';
import type * as permissionsModule from '@/lib/permissions';
import type * as sessionRevokeModule from '@/lib/session/revoke';


const ROLE_ID = '00000000-0000-4000-8000-000000000301';
const PERM_ID = '00000000-0000-4000-8000-000000000401';
const PERM_ID_2 = '00000000-0000-4000-8000-000000000402';
const ADMIN_ID = '00000000-0000-4000-8000-000000000101';
/** 操作者自己的角色，须与被测的 ROLE_ID 区分（否则主键冲突） */
const ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000399';
/**
 * 操作者所属部门：被测角色也播种在此部门，使其落在操作者数据范围内。
 * 与 `ROOT`（0000…001）平级，因此操作者看不到 ROOT 子树的内容。
 */
const ADMIN_DEPT_ID = '00000000-0000-4000-8000-000000000009';

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  await td.cleanup();
  // 读路径的数据范围由真实 resolveScope（lib/authz）解析，走原生 SQL 读
  // user_roles → roles.dept_id，不再经过被 mock 的 @/lib/auth。
  // 因此操作者必须在库中真实拥有一个角色，否则可见范围为空、
  // 读模型 fail-closed 返回空集/404。
  const now = new Date();
  await seedTestData(td.db, {
    departments: [
      ...seedRootDept(),
      { id: ADMIN_DEPT_ID, parentId: null, name: '运营部', code: 'OPS',
        ancestors: null, sort: 9, status: 'ACTIVE' as const, createdAt: now, updatedAt: now },
    ],
    users: seedAdminUser({ deptId: ADMIN_DEPT_ID }),
    roles: seedSuperAdminRole({ id: ADMIN_ROLE_ID, deptId: ADMIN_DEPT_ID }),
    userRoles: seedUserRoleBinding(ADMIN_ID, ADMIN_ROLE_ID),
  });
});

describe('Role Management API', () => {
  async function seedRole(overrides: Partial<typeof schema.roles.$inferInsert> = {}) {
    await td.db.insert(schema.roles).values({
      id: ROLE_ID,
      name: 'Admin',
      code: 'ADMIN',
      description: '管理员角色',
      deptId: ADMIN_DEPT_ID,
      isSystem: false,
      status: 'ACTIVE',
      sort: 0,
      ...overrides,
    });
  }

  async function seedPermission(overrides: Partial<typeof schema.permissions.$inferInsert> = {}) {
    await td.db.insert(schema.permissions).values({
      id: PERM_ID,
      code: 'portal:user:list',
      name: 'User List',
      type: 'API',
      status: 'ACTIVE',
      sort: 0,
      ...overrides,
    });
  }

  async function seedRolePermission(roleId: string, permissionId: string) {
    await td.db.insert(schema.rolePermissions).values({
      roleId,
      permissionId,
      createdAt: new Date('2026-01-01'),
    });
  }

  // ======== GET /api/roles ========

  describe('GET /api/roles (list)', () => {
    it('returns role list with pagination', async () => {
      // 待测角色与操作者同部门（ADMIN_DEPT_ID），故在数据范围内。
      // 列表同时会包含操作者自己的角色（同部门），因此断言"包含待测角色"
      // 而非精确条数——后者会让用例与夹具细节耦合。
      await seedRole({ deptId: ADMIN_DEPT_ID });

      const response = await ListRoles(createTestRequest('/api/roles'));
      const body = await response.json();

      expect(response.status).toBe(200);
      const adminRole = body.data.find((r: { id: string }) => r.id === ROLE_ID);
      expect(adminRole).toMatchObject({
        name: 'Admin',
        code: 'ADMIN',
        deptId: ADMIN_DEPT_ID,
      });
      expect(body.pagination).toBeDefined();
      expect(body.pagination.total).toBe(body.data.length);
    });

    it('returns 403 without role:list permission', async () => {
      vi.mocked(mockWithPermission).mockImplementationOnce(
        async () =>
          NextResponse.json({ error: 'forbidden', message: 'Insufficient permissions' }, { status: 403 }),
      );

      const response = await ListRoles(createTestRequest('/api/roles'));
      expect(response.status).toBe(403);
    });
  });

  // ======== GET /api/roles/[id] ========

  describe('GET /api/roles/[id] (detail)', () => {
    it('returns role detail', async () => {
      // 待测角色与操作者同部门（ADMIN_DEPT_ID），故落在数据范围内
      await seedRole({ deptId: ADMIN_DEPT_ID });

      const response = await GetRole(createTestRequest(`/api/roles/${ROLE_ID}`), {
        params: Promise.resolve({ id: ROLE_ID }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ name: 'Admin', deptId: ADMIN_DEPT_ID });
    });

    it('returns 404 for nonexistent role', async () => {
      const response = await GetRole(
        createTestRequest('/api/roles/00000000-0000-4000-8000-000000000999'),
        { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000999' }) },
      );

      expect(response.status).toBe(404);
    });
  });

  // ======== GET /api/roles/[id]/permissions ========

  // ======== POST/PUT /api/roles/[id]/permissions（角色权限授予） ========

  describe('POST|PUT /api/roles/[id]/permissions (assign)', () => {
    it('覆盖式授予权限：先 2 项、再替换为 1 项', async () => {
      await seedRole({ deptId: ADMIN_DEPT_ID });
      await seedPermission();
      await seedPermission({ id: PERM_ID_2, code: 'portal:user:create', name: 'User Create' });

      const first = await AssignRolePermissions(
        createTestRequest(`/api/roles/${ROLE_ID}/permissions`, {
          method: 'POST',
          body: { permissionIds: [PERM_ID, PERM_ID_2] },
        }),
        { params: Promise.resolve({ id: ROLE_ID }) },
      );
      expect(first.status).toBe(200);
      const bound = await td.db.select().from(schema.rolePermissions)
        .where(eq(schema.rolePermissions.roleId, ROLE_ID));
      expect(bound.map((b) => b.permissionId).sort()).toEqual([PERM_ID, PERM_ID_2].sort());

      const second = await PutRolePermissions(
        createTestRequest(`/api/roles/${ROLE_ID}/permissions`, {
          method: 'PUT',
          body: { permissionIds: [PERM_ID] },
        }),
        { params: Promise.resolve({ id: ROLE_ID }) },
      );
      expect(second.status).toBe(200);
      const replaced = await td.db.select().from(schema.rolePermissions)
        .where(eq(schema.rolePermissions.roleId, ROLE_ID));
      expect(replaced.map((b) => b.permissionId)).toEqual([PERM_ID]);
    });

    it('系统内置角色禁止修改权限绑定 → 400', async () => {
      await seedRole({ deptId: ADMIN_DEPT_ID, isSystem: true });
      await seedPermission();
      const response = await AssignRolePermissions(
        createTestRequest(`/api/roles/${ROLE_ID}/permissions`, {
          method: 'POST',
          body: { permissionIds: [PERM_ID] },
        }),
        { params: Promise.resolve({ id: ROLE_ID }) },
      );
      expect(response.status).toBe(400);
    });

    it('无效权限 ID → 400 且不改变绑定', async () => {
      await seedRole({ deptId: ADMIN_DEPT_ID });
      const response = await AssignRolePermissions(
        createTestRequest(`/api/roles/${ROLE_ID}/permissions`, {
          method: 'POST',
          body: { permissionIds: [PERM_ID] },
        }),
        { params: Promise.resolve({ id: ROLE_ID }) },
      );
      expect(response.status).toBe(400);
      const bound = await td.db.select().from(schema.rolePermissions)
        .where(eq(schema.rolePermissions.roleId, ROLE_ID));
      expect(bound).toHaveLength(0);
    });

    it('角色不存在 → 404', async () => {
      await seedPermission();
      const response = await AssignRolePermissions(
        createTestRequest(`/api/roles/${ROLE_ID}/permissions`, {
          method: 'POST',
          body: { permissionIds: [PERM_ID] },
        }),
        { params: Promise.resolve({ id: ROLE_ID }) },
      );
      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/roles/[id]/permissions', () => {
    it('returns bound permissions', async () => {
      await seedRole({ deptId: ADMIN_DEPT_ID });
      await seedPermission();
      await seedRolePermission(ROLE_ID, PERM_ID);

      const response = await GetRolePermissions(
        createTestRequest(`/api/roles/${ROLE_ID}/permissions`),
        { params: Promise.resolve({ id: ROLE_ID }) },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({
        code: 'portal:user:list',
        name: 'User List',
        type: 'API',
      });
    });
  });
});
