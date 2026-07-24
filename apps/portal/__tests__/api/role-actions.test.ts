/**
 * Role Server Actions 集成测试（真实 DB）
 *
 * 使用 TRUNCATE CASCADE 模式实现测试隔离，验证所有 CRUD 操作端到端正确性。
 *
 * @req C-ROL-C, C-ROL-U, C-ROL-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { COMMON_ERRORS } from '@auth-sso/contracts';
import { EntityNotFoundError, BusinessRuleViolationError } from '@/domain/shared/errors';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedRootDept } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';

// ── 测试数据库 ──────────────────────────────────────
const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));
vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ userId: '00000000-0000-4000-8000-000000000101', claims: { sub: '', iss: '', aud: 'auth-sso', jti: '' } })),
  logServerDataRead: vi.fn(async () => {}),
  getUserRoleDeptIds: vi.fn().mockResolvedValue([]),
  canAccessDept: vi.fn(() => true),
  withAuth: (_o: any, h: Function) => async (...a: any[]) =>
    h({ userId: '00000000-0000-4000-8000-000000000101' }, ...a),
}));
vi.mock('@/lib/crypto', () => ({
  generateUUID: () => 'aabbccdd-eeff-4000-8000-000000000001',
  generateId: (_len?: number) => 'aaaaaaaa',
}));
vi.mock('@/lib/permissions', () => ({ refreshUsersPermissionCache: vi.fn(async () => {}) }));
vi.mock('@/lib/session/revoke', () => ({ revokeUsersAccessByUserId: vi.fn(async () => {}) }));
vi.mock('@/infrastructure/redis', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { db } from '@/infrastructure/db';
import { createRoleAction, updateRoleAction, deleteRoleAction } from '@/app/(dashboard)/roles/actions';

const DEPT_ID = '00000000-0000-4000-8000-000000000001';
const ROLE_ID_UPDATE = '00000000-0000-4000-8000-000000000401';
const ROLE_ID_DELETE = '00000000-0000-4000-8000-000000000402';
const now = new Date();

function seedTestRole(overrides: Partial<typeof schema.roles.$inferInsert> = {}): Array<typeof schema.roles.$inferInsert> {
  return [{
    id: ROLE_ID_UPDATE,
    name: 'Test Role',
    code: 'TEST_ROLE',
    description: '',
    deptId: DEPT_ID,
    isSystem: false,
    status: 'ACTIVE' as const,
    sort: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }];
}

function seedDeleteRole(): Array<typeof schema.roles.$inferInsert> {
  return [{
    id: ROLE_ID_DELETE,
    name: 'Delete Role',
    code: 'DELETE_ROLE',
    description: '',
    deptId: DEPT_ID,
    isSystem: false,
    status: 'ACTIVE' as const,
    sort: 1,
    createdAt: now,
    updatedAt: now,
  }];
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, { departments: seedRootDept() });
});

describe('Role Server Actions', () => {
  describe('createRoleAction', () => {
    it('有效输入 → 返回 success: true 并写入角色', async () => {
      const r: any = await createRoleAction({ name: 'Test', code: 'TEST', sort: 1, deptId: DEPT_ID });
      expect(r.success).toBe(true);
      expect(r.data.id).toBeDefined();
      expect(r.data.id).toBe('aabbccdd-eeff-4000-8000-000000000001');

      const rows = await db.select().from(schema.roles);
      const role = rows.find(r => r.code === 'TEST');
      expect(role).toBeDefined();
      expect(role!.name).toBe('Test');
      expect(role!.deptId).toBe(DEPT_ID);
      expect(role!.status).toBe('ACTIVE');
    });

    it('缺 code → 返回 success: false 且包含 VALIDATION_ERROR', async () => {
      const r: any = await createRoleAction({ name: 'X', code: '', sort: 1, deptId: DEPT_ID } as any);
      expect(r.success).toBe(false);
      expect(r.error).toBe(COMMON_ERRORS.VALIDATION_ERROR);
    });

    it('部门不存在 → 抛出 EntityNotFoundError', async () => {
      await expect(
        createRoleAction({ name: 'X', code: 'XX', sort: 1, deptId: '00000000-0000-4000-8000-000000000999' }),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('部门已禁用 → 抛出 BusinessRuleViolationError', async () => {
      await seedTestData(td.db, {
        departments: [{
          id: '00000000-0000-4000-8000-000000000002',
          parentId: null,
          name: 'Disabled Dept',
          code: 'DISABLED',
          ancestors: null,
          sort: 0,
          status: 'DISABLED',
          createdAt: now,
          updatedAt: now,
        }],
      });
      await expect(
        createRoleAction({ name: 'X', code: 'XX', sort: 1, deptId: '00000000-0000-4000-8000-000000000002' }),
      ).rejects.toThrow(BusinessRuleViolationError);
    });
  });

  describe('updateRoleAction', () => {
    it('有效输入 → 返回 success: true 且 DB 中 name 已更新', async () => {
      await seedTestData(td.db, { roles: seedTestRole() });
      const r: any = await updateRoleAction(ROLE_ID_UPDATE, { name: 'Updated' } as any);
      expect(r.success).toBe(true);
      expect(r.message).toBe('角色更新成功');

      const rows = await db.select().from(schema.roles);
      const updated = rows.find(r => r.id === ROLE_ID_UPDATE);
      expect(updated!.name).toBe('Updated');
    });

    it('角色不存在 → 抛出 EntityNotFoundError', async () => {
      await expect(
        updateRoleAction('00000000-0000-4000-8000-000000000999', { name: 'X' } as any),
      ).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('deleteRoleAction', () => {
    it('非系统角色 → 返回 success: true 且角色已删除', async () => {
      await seedTestData(td.db, { roles: seedDeleteRole() });
      const r: any = await deleteRoleAction(ROLE_ID_DELETE);
      expect(r.success).toBe(true);
      expect(r.data.id).toBe(ROLE_ID_DELETE);
      expect(r.message).toBe('角色已删除');

      const rows = await db.select().from(schema.roles);
      const deleted = rows.find(r => r.id === ROLE_ID_DELETE);
      expect(deleted).toBeUndefined();
    });

    it('角色不存在 → 抛出 EntityNotFoundError', async () => {
      await expect(
        deleteRoleAction('00000000-0000-4000-8000-000000000999'),
      ).rejects.toThrow(EntityNotFoundError);
    });
  });
});
