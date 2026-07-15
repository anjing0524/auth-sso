/**
 * Department Server Actions 单元测试
 *
 * @req DC-DEPT-C, DC-DEPT-U, DC-DEPT-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntityNotFoundError } from '@/domain/shared/errors';

const holder = vi.hoisted<{ mockDb: ReturnType<typeof import('@/../__tests__/helpers/mock-db').createMockDb> | null }>(() => ({ mockDb: null }));

vi.mock('@/infrastructure/db', async () => {
  const { createMockDb } = await import('@/../__tests__/helpers/mock-db');
  holder.mockDb = createMockDb();
  return { db: holder.mockDb.db, schema: { departments: {} } };
});
vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ claims: { deptIds: ['dept-1'] } })),
  logServerDataRead: vi.fn(async () => {}),
  canAccessDept: vi.fn(() => true),
  withAuth: (_o: any, h: Function) => async (...a: any[]) => h({ userId: 'admin-1', claims: { deptIds: ['dept-1'], permissions: [], roles: [] } }, ...a),
}));
vi.mock('@/lib/crypto', () => ({ generateUUID: () => 'aaaa-bbbb-cccc-dddd', generateId: () => 'a'.repeat(20) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { createDepartmentAction, updateDepartmentAction, deleteDepartmentAction } from '@/app/(dashboard)/departments/actions';

const mockDb = holder.mockDb!;
const now = new Date();
const deptRow = { id: 'dept-1', name: 'Engineering', code: 'ENG', parentId: null, ancestors: null, status: 'ACTIVE', sort: 1, createdAt: now, updatedAt: now };

describe('Department Server Actions', () => {
  beforeEach(() => { vi.clearAllMocks(); mockDb.reset(); });

  describe('createDepartmentAction', () => {
    it('有效输入 → success 且 DB insert 包含 name/code', async () => {
      const r: any = await createDepartmentAction({ name: 'New', code: 'ND', sort: 1, parentId: null });
      expect(r.success).toBe(true);
      expect(r.data.id).toBeDefined();
      const writes = mockDb.getWrites();
      const insert = writes.find(w => w.type === 'insert');
      expect(insert).toBeDefined();
      expect(insert!.data.name).toBe('New');
      expect(insert!.data.code).toBe('ND');
    });

    it('缺 name → error 含错误码', async () => {
      const r: any = await createDepartmentAction({ name: '', code: '', sort: 1, parentId: null } as any);
      expect(r.success).toBe(false);
      expect(r.error).toBeDefined();
      expect(r.message).toBeDefined();
    });
  });

  describe('updateDepartmentAction', () => {
    it('存在 → success 且 DB update 写入 name', async () => {
      mockDb.setQueryResult([deptRow]);
      mockDb.setFindFirstNestedResult(deptRow);
      mockDb.setRowCountResult(1);
      const r: any = await updateDepartmentAction('dept-1', { name: 'Updated' } as any);
      expect(r.success).toBe(true);
      expect(r.data.id).toBe('dept-1');
      const writes = mockDb.getWrites();
      const update = writes.find(w => w.type === 'update');
      expect(update).toBeDefined();
      expect(update!.data.name).toBe('Updated');
    });

    it('不存在 → throw EntityNotFoundError', async () => {
      mockDb.setQueryResult([]);
      await expect(updateDepartmentAction('bad', { name: 'X' } as any)).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('deleteDepartmentAction', () => {
    it('不存在 → throw EntityNotFoundError', async () => {
      mockDb.setQueryResult([]);
      await expect(deleteDepartmentAction('bad')).rejects.toThrow(EntityNotFoundError);
    });
  });
});
