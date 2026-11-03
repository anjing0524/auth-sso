/**
 * 内置权限启停只能由 SUPER_ADMIN break-glass 执行（ADR-032）。
 *
 * 普通 ADMIN / 部门权限管理员即使有 portal:permission:update，也不能停用
 * 被服务端硬编码引用的核心权限；否则所有非 break-glass 用户会一起 403。
 *
 * @req H-ACL-003
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
// @allow-module-mock @/lib/auth/verify-jwt auth-bypass: 只提供“普通权限管理员已登录”输入；permission-breakglass.test.ts 全部用例依赖它；鉴权链路其余部分走真身
vi.mock(import('@/lib/auth/verify-jwt'), async (importOriginal): Promise<Partial<typeof verifyJwtModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveIdentity: async () => ({
      userId: '00000000-0000-4000-8000-000000000701',
      expiresAt: null,
      issuedAt: null,
    }),
  };
});

import { updatePermissionAction } from '@/app/(dashboard)/permissions/actions';

const ROOT_ID = '00000000-0000-4000-8000-000000000001';
const OPERATOR_ID = '00000000-0000-4000-8000-000000000701';
const ROLE_ID = '00000000-0000-4000-8000-000000000711';
const UPDATE_PERMISSION_ID = '00000000-0000-4000-8000-000000000721';
const CORE_PERMISSION_ID = '00000000-0000-4000-8000-000000000722';
const now = new Date();

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedTestUser({ id: OPERATOR_ID, username: 'perm_manager', email: 'pm@example.com' }),
    roles: [{
      id: ROLE_ID, name: '权限管理员', code: 'PERMISSION_MANAGER',
      deptId: ROOT_ID, isSystem: false, status: 'ACTIVE', sort: 1, createdAt: now, updatedAt: now,
    }],
    permissions: [
      {
        id: UPDATE_PERMISSION_ID, name: '修改权限', code: 'portal:permission:update',
        type: 'API', status: 'ACTIVE', sort: 1, createdAt: now, updatedAt: now,
      },
      {
        id: CORE_PERMISSION_ID, name: '查看用户列表', code: 'portal:user:list',
        type: 'API', status: 'ACTIVE', sort: 2, createdAt: now, updatedAt: now,
      },
    ],
    rolePermissions: [
      { roleId: ROLE_ID, permissionId: UPDATE_PERMISSION_ID, createdAt: now },
    ],
    userRoles: [{ userId: OPERATOR_ID, roleId: ROLE_ID, createdAt: now }],
  });
});

describe('内置权限状态 break-glass', () => {
  it('普通权限管理员不能停用核心权限，且 DB 保持 ACTIVE', async () => {
    const r = await updatePermissionAction(CORE_PERMISSION_ID, { status: 'DISABLED' });
    expect(r.success).toBe(false);
    expect(r.message).toContain('内置权限状态只能由 SUPER_ADMIN 修改');
    const row = await td.db.query.permissions.findFirst({ where: eq(schema.permissions.id, CORE_PERMISSION_ID) });
    expect(row?.status).toBe('ACTIVE');
  });
});
