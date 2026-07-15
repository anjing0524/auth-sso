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
import { seedRootDept } from '../helpers/seed-fixtures';
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
    return handler('00000000-0000-4000-8000-000000000101', {
      deptIds: ['00000000-0000-4000-8000-000000000001'],
      permissions: [],
      roles: [],
    });
  });
  return { mockWithPermission };
});

vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ claims: { deptIds: ['00000000-0000-4000-8000-000000000001'] } })),
  logServerDataRead: vi.fn(async () => {}),
  canAccessDept: vi.fn(() => true),
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

const DEPT_ID = '00000000-0000-4000-8000-000000000001';
const ROLE_ID = '00000000-0000-4000-8000-000000000301';
const PERM_ID = '00000000-0000-4000-8000-000000000401';

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  await td.cleanup();
  await seedTestData(td.db, { departments: seedRootDept() });
});

describe('Role Management API', () => {
  async function seedRole(overrides: Partial<typeof schema.roles.$inferInsert> = {}) {
    await td.db.insert(schema.roles).values({
      id: ROLE_ID,
      name: 'Admin',
      code: 'ADMIN',
      description: '管理员角色',
      deptId: DEPT_ID,
      isSystem: false,
      status: 'ACTIVE',
      sort: 0,
      ...overrides,
    });
  }

  async function seedPermission(overrides: Partial<typeof schema.permissions.$inferInsert> = {}) {
    await td.db.insert(schema.permissions).values({
      id: PERM_ID,
      code: 'user:list',
      name: 'User List',
      type: 'API',
      resource: 'user',
      action: 'list',
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
      await seedRole();

      const response = await ListRoles(createTestRequest('/api/roles'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        name: 'Admin',
        code: 'ADMIN',
        deptId: DEPT_ID,
      });
      expect(body.pagination).toBeDefined();
      expect(body.pagination.total).toBe(1);
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
      await seedRole();

      const response = await GetRole(createTestRequest(`/api/roles/${ROLE_ID}`), {
        params: Promise.resolve({ id: ROLE_ID }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ name: 'Admin', deptId: DEPT_ID });
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
      await seedRole();
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
        code: 'user:list',
        name: 'User List',
        type: 'API',
        resource: 'user',
        action: 'list',
      });
    });
  });
});
