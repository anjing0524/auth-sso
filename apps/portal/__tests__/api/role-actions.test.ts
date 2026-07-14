/**
 * Role Server Actions 单元测试
 *
 * @req DC-ROLE-C, DC-ROLE-U, DC-ROLE-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COMMON_ERRORS } from '@auth-sso/contracts';

const holder = vi.hoisted<{ mockDb: ReturnType<typeof import('@/../__tests__/helpers/mock-db').createMockDb> | null }>(() => ({ mockDb: null }));

vi.mock('@/infrastructure/db', async () => {
  const { createMockDb } = await import('@/../__tests__/helpers/mock-db');
  holder.mockDb = createMockDb();
  return { db: holder.mockDb.db, schema: { roles: {}, userRoles: {}, rolePermissions: {}, departments: {} } };
});
vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ claims: { deptIds: ['dept-1'] } })),
  logServerDataRead: vi.fn(async () => {}),
  canAccessDept: vi.fn(() => true),
  withAuth: (_o: any, h: Function) => async (...a: any[]) => h({ userId: 'admin-1', claims: { deptIds: ['dept-1'], permissions: [], roles: [] } }, ...a),
}));
vi.mock('@/lib/crypto', () => ({ generateUUID: () => 'aaaa-bbbb-cccc-dddd', generateId: () => 'a'.repeat(20) }));
vi.mock('@/lib/permissions', () => ({ refreshUsersPermissionCache: vi.fn(async () => {}) }));
vi.mock('@/lib/session/revoke', () => ({ revokeUsersAccessByUserId: vi.fn(async () => {}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { createRoleAction, updateRoleAction, deleteRoleAction } from '@/app/(dashboard)/roles/actions';

const mockDb = holder.mockDb!;

const now = new Date();
const deptId = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const roleRow = { id: 'role-1', code: 'TEST_ROLE', name: 'Test', isSystem: false, status: 'ACTIVE', deptId, sort: 1, description: '', createdAt: now, updatedAt: now };

describe('Role Server Actions', () => {
  beforeEach(() => { vi.clearAllMocks(); mockDb.reset(); });

  describe('createRoleAction', () => {
    it('有效输入 → success 且 DB insert 包含 code/name/deptId', async () => {
      // 部门查询返回 ACTIVE 部门
      mockDb.setFindFirstNestedResult({ id: deptId, status: 'ACTIVE' });
      const r: any = await createRoleAction({ name: 'Test', code: 'TEST', sort: 1, deptId });
      expect(r.success).toBe(true);
      expect(r.data.id).toBeDefined();
      const writes = mockDb.getWrites();
      const insert = writes.find(w => w.type === 'insert');
      expect(insert).toBeDefined();
      expect(insert!.data.code).toBe('TEST');
      expect(insert!.data.name).toBe('Test');
      expect(insert!.data.deptId).toBe(deptId);
      expect(insert!.data.status).toBe('ACTIVE');
    });

    it('缺 code → VALIDATION_ERROR', async () => {
      const r: any = await createRoleAction({ name: 'X', code: '', sort: 1, deptId } as any);
      expect(r.success).toBe(false);
      expect(r.error).toBe(COMMON_ERRORS.VALIDATION_ERROR);
    });

    it('部门不存在 → throw EntityNotFoundError', async () => {
      mockDb.setFindFirstNestedResult(null);
      await expect(createRoleAction({ name: 'X', code: 'XX', sort: 1, deptId })).rejects.toThrow();
    });

    it('部门已禁用 → throw BusinessRuleViolationError', async () => {
      mockDb.setFindFirstNestedResult({ id: deptId, status: 'DISABLED' });
      await expect(createRoleAction({ name: 'X', code: 'XX', sort: 1, deptId })).rejects.toThrow();
    });
  });

  describe('updateRoleAction', () => {
    it('有效输入 → success 且 DB update 写入 name', async () => {
      mockDb.setFindFirstNestedResult(roleRow);
      const r: any = await updateRoleAction('role-1', { name: 'Updated' } as any);
      expect(r.success).toBe(true);
      const writes = mockDb.getWrites();
      const update = writes.find(w => w.type === 'update');
      expect(update).toBeDefined();
      expect(update!.data.name).toBe('Updated');
    });

    it('不存在 → throw EntityNotFoundError', async () => {
      await expect(updateRoleAction('bad', { name: 'X' } as any)).rejects.toThrow();
    });
  });

  describe('deleteRoleAction', () => {
    it('非系统角色 → success 且返回确认消息', async () => {
      mockDb.setQueryResult([roleRow]);
      const r: any = await deleteRoleAction('role-1');
      expect(r.success).toBe(true);
      expect(r.data.id).toBe('role-1');
    });

    it('不存在 → throw EntityNotFoundError', async () => {
      mockDb.setQueryResult([]);
      await expect(deleteRoleAction('bad')).rejects.toThrow();
    });
  });
});
