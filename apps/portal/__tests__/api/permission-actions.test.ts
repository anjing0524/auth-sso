/**
 * Permission Server Actions 单元测试
 *
 * @req D-PRM-C, D-PRM-U, D-PRM-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const holder = vi.hoisted<{ mockDb: ReturnType<typeof import('@/../__tests__/helpers/mock-db').createMockDb> | null }>(() => ({ mockDb: null }));

vi.mock('@/infrastructure/db', async () => {
  const { createMockDb } = await import('@/../__tests__/helpers/mock-db');
  holder.mockDb = createMockDb();
  return { db: holder.mockDb.db, schema: { permissions: {}, rolePermissions: {}, userRoles: {} } };
});
vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ claims: { deptIds: ['dept-1'] } })),
  logServerDataRead: vi.fn(async () => {}),
  canAccessDept: vi.fn(() => true),
  withAuth: (_o: any, h: Function) => async (...a: any[]) => h({ userId: 'admin-1' }, ...a),
}));
vi.mock('@/lib/crypto', () => ({ generateUUID: () => 'aaaa-bbbb-cccc-dddd' }));
vi.mock('@/lib/permissions', () => ({ refreshUsersPermissionCache: vi.fn(async () => {}) }));
vi.mock('@/lib/session/revoke', () => ({ revokeUsersAccessByUserId: vi.fn(async () => {}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { createPermissionAction, updatePermissionAction, deletePermissionAction } from '@/app/(dashboard)/permissions/actions';

const mockDb = holder.mockDb!;

const now = new Date();
const permRow = { id: 'perm-1', code: 'TEST_PERM', name: 'Test', resource: 'test', action: 'read', type: 'API' as const, status: 'ACTIVE' as const, description: '', clientId: null, parentId: null, sort: 0, createdAt: now, updatedAt: now };

describe('Permission Server Actions', () => {
  beforeEach(() => { vi.clearAllMocks(); mockDb.reset(); });

  describe('createPermissionAction', () => {
    it('有效输入 → 返回 success 且 data.id 存在', async () => {
      const r: any = await createPermissionAction({ code: 'NEW', name: 'New', resource: '/api/test', action: 'GET', type: 'API' } as any);
      expect(r.success).toBe(true);
      expect(r.data.id).toBeDefined();
    });

    it('有效输入 → DB insert 包含 code/name/resource/action/type', async () => {
      await createPermissionAction({ code: 'NEW', name: 'New', resource: '/api/test', action: 'GET', type: 'API' } as any);
      const writes = mockDb.getWrites();
      const insert = writes.find(w => w.type === 'insert');
      expect(insert).toBeDefined();
      expect(insert!.data.code).toBe('NEW');
      expect(insert!.data.name).toBe('New');
      expect(insert!.data.resource).toBe('/api/test');
      expect(insert!.data.action).toBe('GET');
      expect(insert!.data.type).toBe('API');
    });

    it('缺 code → 返回 VALIDATION_ERROR', async () => {
      const r: any = await createPermissionAction({ code: '', name: '', resource: '', action: '', type: '' } as any);
      expect(r.success).toBe(false);
      expect(r.error).toBeDefined();
    });
  });

  describe('updatePermissionAction', () => {
    it('存在 → 返回 success 且存入正确字段', async () => {
      mockDb.setQueryResult([permRow]);
      const r: any = await updatePermissionAction('perm-1', { name: 'Updated Name' } as any);
      expect(r.success).toBe(true);
      const writes = mockDb.getWrites();
      const update = writes.find(w => w.type === 'update');
      expect(update).toBeDefined();
      expect(update!.data.name).toBe('Updated Name');
    });

    it('不存在 → 抛出 EntityNotFoundError', async () => {
      mockDb.setQueryResult([]);
      await expect(updatePermissionAction('bad', { name: 'X' } as any)).rejects.toThrow();
    });
  });

  describe('deletePermissionAction', () => {
    it('存在 → 返回 success 且 data.id 正确', async () => {
      mockDb.setQueryResult([permRow]);
      const r: any = await deletePermissionAction('perm-1');
      expect(r.success).toBe(true);
      expect(r.data.id).toBe('perm-1');
    });

    it('不存在 → 抛出 EntityNotFoundError', async () => {
      mockDb.setQueryResult([]);
      await expect(deletePermissionAction('bad')).rejects.toThrow();
    });
  });
});
