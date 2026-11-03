/**
 * 角色管理面的高权目标保护回归（ADR-032）
 *
 * 只 mock 身份；withAuth / 权限上下文 / 数据范围 / 角色权限边界全部走生产实现。
 *
 * 修复前：只持 role:update/delete/assign_permission 的低权操作者可以停用、删除
 * 同部门的高权自定义角色，或清空其权限；修复后统一 403 且 DB 不变。
 *
 * @req H-ACL-002, H-ACL-003
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedRootDept, seedTestUser } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';
import type * as verifyJwtModule from '@/lib/auth/verify-jwt';

const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));
vi.mock('@/infrastructure/redis', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

// @allow-module-mock @/lib/auth/verify-jwt auth-bypass: 只提供“低权操作者已登录”输入；role-admin-target.test.ts 全部用例依赖它；权限/范围/角色边界全部走生产代码
vi.mock(import('@/lib/auth/verify-jwt'), async (importOriginal): Promise<Partial<typeof verifyJwtModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveIdentity: async () => ({
      userId: '00000000-0000-4000-8000-000000000601',
      expiresAt: null,
      issuedAt: null,
    }),
  };
});

import { updateRoleAction, deleteRoleAction, updateRolePermissionsAction } from '@/app/(dashboard)/roles/actions';

const ROOT_ID = '00000000-0000-4000-8000-000000000001';
const OPERATOR_ID = '00000000-0000-4000-8000-000000000601';
const LOW_ROLE_ID = '00000000-0000-4000-8000-000000000611';
const HIGH_ROLE_ID = '00000000-0000-4000-8000-000000000612';
const LOW_PERMISSION_ID = '00000000-0000-4000-8000-000000000621';
const LOW_UPDATE_PERMISSION_ID = '00000000-0000-4000-8000-000000000623';
const LOW_DELETE_PERMISSION_ID = '00000000-0000-4000-8000-000000000624';
const LOW_ASSIGN_PERMISSION_ID = '00000000-0000-4000-8000-000000000625';
const HIGH_PERMISSION_ID = '00000000-0000-4000-8000-000000000622';
const now = new Date();

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedTestUser({ id: OPERATOR_ID, username: 'low_operator', email: 'low@example.com' }),
    roles: [
      {
        id: LOW_ROLE_ID, name: '低权角色管理', code: 'LOW_ROLE_MANAGER',
        deptId: ROOT_ID, isSystem: false, status: 'ACTIVE', sort: 1, createdAt: now, updatedAt: now,
      },
      {
        id: HIGH_ROLE_ID, name: '高权角色', code: 'HIGH_ROLE',
        deptId: ROOT_ID, isSystem: false, status: 'ACTIVE', sort: 2, createdAt: now, updatedAt: now,
      },
    ],
    permissions: [
      {
        id: LOW_PERMISSION_ID, name: '角色管理', code: 'portal:role:manage',
        type: 'API', status: 'ACTIVE', sort: 1, createdAt: now, updatedAt: now,
      },
      {
        id: LOW_UPDATE_PERMISSION_ID, name: '修改角色', code: 'portal:role:update',
        type: 'API', status: 'ACTIVE', sort: 2, createdAt: now, updatedAt: now,
      },
      {
        id: LOW_DELETE_PERMISSION_ID, name: '删除角色', code: 'portal:role:delete',
        type: 'API', status: 'ACTIVE', sort: 3, createdAt: now, updatedAt: now,
      },
      {
        id: LOW_ASSIGN_PERMISSION_ID, name: '分配角色权限', code: 'portal:role:assign_permission',
        type: 'API', status: 'ACTIVE', sort: 4, createdAt: now, updatedAt: now,
      },
      {
        id: HIGH_PERMISSION_ID, name: '删除用户', code: 'portal:user:delete',
        type: 'API', status: 'ACTIVE', sort: 5, createdAt: now, updatedAt: now,
      },
    ],
    rolePermissions: [
      { roleId: LOW_ROLE_ID, permissionId: LOW_PERMISSION_ID, createdAt: now },
      { roleId: LOW_ROLE_ID, permissionId: LOW_UPDATE_PERMISSION_ID, createdAt: now },
      { roleId: LOW_ROLE_ID, permissionId: LOW_DELETE_PERMISSION_ID, createdAt: now },
      { roleId: LOW_ROLE_ID, permissionId: LOW_ASSIGN_PERMISSION_ID, createdAt: now },
      { roleId: HIGH_ROLE_ID, permissionId: HIGH_PERMISSION_ID, createdAt: now },
    ],
    userRoles: [{ userId: OPERATOR_ID, roleId: LOW_ROLE_ID, createdAt: now }],
  });
});

describe('角色管理高权目标保护', () => {
  it('非 break-glass 不得停用权限高于自身的角色', async () => {
    const r = await updateRoleAction(HIGH_ROLE_ID, { status: 'DISABLED' });
    expect(r.success).toBe(false);
    expect(r.message).toContain('不能操作权限高于自身的角色');
    const row = await td.db.query.roles.findFirst({ where: eq(schema.roles.id, HIGH_ROLE_ID) });
    expect(row?.status).toBe('ACTIVE');
  });

  it('非 break-glass 不得删除权限高于自身的角色', async () => {
    const r = await deleteRoleAction(HIGH_ROLE_ID);
    expect(r.success).toBe(false);
    expect(r.message).toContain('不能操作权限高于自身的角色');
    const row = await td.db.query.roles.findFirst({ where: eq(schema.roles.id, HIGH_ROLE_ID) });
    expect(row).toBeDefined();
  });

  it('非 break-glass 不得清空权限高于自身的角色权限', async () => {
    const r = await updateRolePermissionsAction(HIGH_ROLE_ID, []);
    expect(r.success).toBe(false);
    expect(r.message).toContain('不能操作权限高于自身的角色');
    const rows = await td.db
      .select()
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, HIGH_ROLE_ID));
    expect(rows).toHaveLength(1);
  });
});
