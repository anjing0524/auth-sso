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

vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ userId: '00000000-0000-4000-8000-000000000101', claims: { sub: '', iss: '', aud: 'auth-sso', jti: '' } })),
  logServerDataRead: vi.fn(async () => {}),
  withPermission: mockWithPermission,
}));

vi.mock('@/lib/crypto', () => ({
  generateUUID: () => 'aabbccdd-eeff-4000-8000-000000000001',
  generateId: (_len?: number) => 'aaaaaaaa',
  hashToken: (t: string) => t,
}));

vi.mock('@/lib/audit', () => ({
  logAuditEvent: vi.fn(async () => {}),
  getClientIP: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/infrastructure/redis', () => ({}));

// ── 被测试模块 ─────────────────────────────────────
import { GET as ListRoles } from '@/app/api/roles/route';
import { GET as GetRole } from '@/app/api/roles/[id]/route';
import { GET as GetRolePermissions } from '@/app/api/roles/[id]/permissions/route';

const ROLE_ID = '00000000-0000-4000-8000-000000000301';
const PERM_ID = '00000000-0000-4000-8000-000000000401';
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
