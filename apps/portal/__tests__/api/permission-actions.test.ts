/**
 * Permission Server Actions 集成测试（真实 DB）
 *
 * @req D-PRM-C, D-PRM-U, D-PRM-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { EntityNotFoundError } from '@/domain/shared/errors';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedRootDept, seedTestPermission } from '../helpers/seed-fixtures';
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
}));
vi.mock('@/lib/permissions', () => ({ refreshUsersPermissionCache: vi.fn(async () => {}) }));
vi.mock('@/lib/session/revoke', () => ({ revokeUsersAccessByUserId: vi.fn(async () => {}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { db } from '@/infrastructure/db';
import { createPermissionAction, updatePermissionAction, deletePermissionAction } from '@/app/(dashboard)/permissions/actions';

const PERM_ID = '00000000-0000-4000-8000-000000000401';

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, { departments: seedRootDept() });
});

describe('Permission Server Actions', () => {
  describe('createPermissionAction', () => {
    it('有效输入 → DB insert 包含 code/name/type', async () => {
      const r: any = await createPermissionAction({
        code: 'NEW', name: 'New Permission', type: 'API',
      } as any);

      expect(r.success).toBe(true);
      expect(r.data).toBeDefined();
      expect(r.data.id).toBe('aabbccdd-eeff-4000-8000-000000000001');

      const perms = await db.select().from(schema.permissions);
      const created = perms.find(p => p.code === 'NEW');
      expect(created).toBeDefined();
      expect(created!.name).toBe('New Permission');
      expect(created!.type).toBe('API');
    });

    it('缺 code → 返回 success: false', async () => {
      const r: any = await createPermissionAction({
        code: '', name: '', type: '',
      } as any);

      expect(r.success).toBe(false);
      expect(r.error).toBeDefined();
    });
  });

  describe('updatePermissionAction', () => {
    it('存在 → 返回 success: true 且正确更新字段', async () => {
      await seedTestData(td.db, { permissions: seedTestPermission() });

      const r: any = await updatePermissionAction(PERM_ID, { name: 'Updated Name' } as any);

      expect(r.success).toBe(true);
      expect(r.data.id).toBe(PERM_ID);

      const perms = await db.select().from(schema.permissions);
      const updated = perms.find(p => p.id === PERM_ID);
      expect(updated).toBeDefined();
      expect(updated!.name).toBe('Updated Name');
    });

    it('不存在 → 抛出 EntityNotFoundError', async () => {
      await expect(
        updatePermissionAction('00000000-0000-4000-8000-000000000999', { name: 'X' } as any),
      ).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('deletePermissionAction', () => {
    it('存在 → 返回 success: true 且 data.id 正确', async () => {
      await seedTestData(td.db, { permissions: seedTestPermission() });

      const r: any = await deletePermissionAction(PERM_ID);

      expect(r.success).toBe(true);
      expect(r.data.id).toBe(PERM_ID);

      const perms = await db.select().from(schema.permissions);
      expect(perms.find(p => p.id === PERM_ID)).toBeUndefined();
    });

    it('不存在 → 抛出 EntityNotFoundError', async () => {
      await expect(
        deletePermissionAction('00000000-0000-4000-8000-000000000999'),
      ).rejects.toThrow(EntityNotFoundError);
    });
  });
});
