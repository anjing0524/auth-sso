/**
 * User Server Actions 集成测试（真实 DB）
 *
 * 使用事务回滚隔离，验证所有 CRUD 操作端到端正确性。
 *
 * @req DC-USR-C, DC-USR-U, DC-USR-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { EntityNotFoundError } from '@/domain/shared/errors';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedRootDept, seedTestUser } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';

// ── 测试数据库 ──────────────────────────────────────
const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));
vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ claims: { deptIds: ['00000000-0000-4000-8000-000000000001'] } })),
  logServerDataRead: vi.fn(async () => {}),
  canAccessDept: vi.fn(() => true),
  withAuth: (_o: any, h: Function) => async (...a: any[]) =>
    h({ userId: '00000000-0000-4000-8000-000000000101', claims: { deptIds: ['00000000-0000-4000-8000-000000000001'], permissions: [], roles: [] } }, ...a),
  withPermission: (_o: any, _r: any, h: Function) => async (...a: any[]) => h('00000000-0000-4000-8000-000000000101', ...a),
}));
vi.mock('@/lib/crypto', () => ({
  generateUUID: () => 'aabbccdd-eeff-4000-8000-000000000001',
  generateId: (_len?: number) => 'aaaaaaaa',
  hashToken: (t: string) => t,
}));
vi.mock('@/lib/session/revoke', () => ({ revokeUserAccessByUserId: vi.fn(async () => 0) }));
vi.mock('@/infrastructure/redis', () => ({}));

import { db } from '@/infrastructure/db';
import { createUserAction, updateUserAction, toggleUserStatusAction, deleteUserAction } from '@/app/(dashboard)/users/actions';

const ADMIN_ID = '00000000-0000-4000-8000-000000000101';
const DEPT_ID = '00000000-0000-4000-8000-000000000001';

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, { departments: seedRootDept() });
});

describe('User Server Actions', () => {
  describe('createUserAction', () => {
    it('有效输入 → 返回 success: true 并写入用户', async () => {
      const r: any = await createUserAction({
        username: 'newuser', name: 'New User',
        password: 'StrongP@ss1', email: 'new@example.com',
      } as any);

      expect(r.success).toBe(true);
      expect(r.data).toBeDefined();
      expect(r.message).toBe('用户创建成功');

      const allUsers = await db.select().from(schema.users);
      const newUser = allUsers.find(u => u.username === 'newuser');
      expect(newUser).toBeDefined();
      expect(newUser!.email).toBe('new@example.com');
      expect(newUser!.passwordHash).toBeDefined();
      expect(newUser!.passwordHash).not.toBe('StrongP@ss1');
    });

    it('缺 username → 返回 success: false 并包含错误码', async () => {
      const r: any = await createUserAction({
        username: '', name: '', password: '', email: '',
      } as any);

      expect(r.success).toBe(false);
      expect(r.error).toBeDefined();
    });
  });

  describe('updateUserAction', () => {
    it('存在用户 → 返回 success: true', async () => {
      await seedTestData(td.db, { users: seedTestUser() });
      const r: any = await updateUserAction('00000000-0000-4000-8000-000000000201', { name: 'Updated Name' } as any);

      expect(r.success).toBe(true);
      expect(r.message).toBe('更新成功');
      expect(r.data).toBeDefined();
      expect(r.data.id).toBe('00000000-0000-4000-8000-000000000201');

      const rows = await db.select().from(schema.users);
      const updated = rows.find(u => u.id === '00000000-0000-4000-8000-000000000201');
      expect(updated!.name).toBe('Updated Name');
    });

    it('不存在用户 → 抛出 EntityNotFoundError', async () => {
      await expect(
        updateUserAction('00000000-0000-4000-8000-000000000999', { name: 'X' } as any)
      ).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('toggleUserStatusAction', () => {
    it('ACTIVE 用户 → 变为 DISABLED', async () => {
      await seedTestData(td.db, { users: seedTestUser({ status: 'ACTIVE' }) });
      const r: any = await toggleUserStatusAction('00000000-0000-4000-8000-000000000201');

      expect(r.success).toBe(true);
      expect(r.data.status).toBe('DISABLED');
      expect(r.message).toContain('已禁用');

      const rows = await db.select().from(schema.users);
      const user = rows.find(u => u.id === '00000000-0000-4000-8000-000000000201');
      expect(user!.status).toBe('DISABLED');
    });

    it('DISABLED 用户 → 变为 ACTIVE', async () => {
      await seedTestData(td.db, { users: seedTestUser({ status: 'DISABLED' }) });
      const r: any = await toggleUserStatusAction('00000000-0000-4000-8000-000000000201');

      expect(r.success).toBe(true);
      expect(r.data.status).toBe('ACTIVE');
    });

    it('不存在用户 → 抛出错误', async () => {
      await expect(
        toggleUserStatusAction('00000000-0000-4000-8000-000000000999')
      ).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('deleteUserAction', () => {
    it('可删除用户 → 返回 success: true', async () => {
      await seedTestData(td.db, { users: seedTestUser() });
      const r: any = await deleteUserAction('00000000-0000-4000-8000-000000000201');

      expect(r.success).toBe(true);
      expect(r.message).toBe('用户已逻辑删除');
      expect(r.data.id).toBe('00000000-0000-4000-8000-000000000201');
    });

    it('不存在用户 → 抛出错误', async () => {
      await expect(
        deleteUserAction('00000000-0000-4000-8000-000000000999')
      ).rejects.toThrow(EntityNotFoundError);
    });
  });
});
