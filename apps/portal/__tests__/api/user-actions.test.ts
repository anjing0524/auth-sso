/**
 * User Server Actions 单元测试
 *
 * 验证所有 CRUD 操作的返回数据完整性和业务逻辑正确性。
 *
 * @req DC-USR-C, DC-USR-U, DC-USR-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 共享 DB mock（由 helpers/mock-db 工厂提供） ──────────────────────────
const holder = vi.hoisted<{ mockDb: ReturnType<typeof import('@/../__tests__/helpers/mock-db').createMockDb> | null }>(() => ({ mockDb: null }));

vi.mock('@/infrastructure/db', async () => {
  const { createMockDb } = await import('@/../__tests__/helpers/mock-db');
  holder.mockDb = createMockDb();
  return { db: holder.mockDb.db, schema: { users: {}, userRoles: {} } };
});
vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ claims: { deptIds: ['dept-1'] } })),
  logServerDataRead: vi.fn(async () => {}),
  canAccessDept: vi.fn(() => true),
 withAuth: (_o: any, h: Function) => async (...a: any[]) => h({ userId: 'admin-1', claims: { deptIds: ['dept-1'], permissions: [], roles: [] } }, ...a), withPermission: (_o: any, _r: any, h: Function) => async (...a: any[]) => h('admin-1', ...a) }));
vi.mock('@/lib/crypto', () => ({ generateUUID: () => 'aaaa-bbbb-cccc-dddd', generateId: (_len?: number) => 'aaaaaaaa', hashToken: (t: string) => t }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock('@/lib/session/revoke', () => ({ revokeUserAccessByUserId: vi.fn(async () => 0) }));
vi.mock('@/infrastructure/redis', () => ({}));

import { createUserAction, updateUserAction, toggleUserStatusAction, deleteUserAction } from '@/app/(dashboard)/users/actions';

const mockDb = holder.mockDb!;

const now = new Date();
const activeUserRow = {
  id: 'user-1', username: 'testuser', name: 'Test', email: 'test@example.com',
  status: 'ACTIVE', passwordHash: '$2a$10$hash', deptId: 'dept-1', avatarUrl: null,
  emailVerified: null, lastLoginAt: null, deletedAt: null, createdAt: now, updatedAt: now,
};

describe('User Server Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.reset();
  });

  describe('createUserAction', () => {
    it('有效输入 → 返回 success: true 并包含完整用户数据', async () => {
      mockDb.setReturningResult([{
        id: 'new-user-id', username: 'newuser', name: 'New User',
        email: 'new@example.com', status: 'ACTIVE',
        createdAt: now.toISOString(), updatedAt: now.toISOString(),
      }]);

      const r: any = await createUserAction({
        username: 'newuser', name: 'New User',
        password: 'StrongP@ss1', email: 'new@example.com',
      } as any);

      expect(r.success).toBe(true);
      expect(r.data).toBeDefined();
      // createUserAction 使用 generateUUID() 生成 ID（mock 返回 'aaaa-bbbb-cccc-dddd'）
      expect(r.data.id).toBeDefined();
      expect(r.message).toBe('用户创建成功');

      // 验证 DB 写入内容：密码已哈希（非明文）、用户名、邮箱正确写入
      const writes = mockDb.getWrites();
      const insert = writes.find(w => w.type === 'insert');
      expect(insert).toBeDefined();
      expect(insert!.data.passwordHash).toBeDefined();
      expect(insert!.data.passwordHash).not.toBe('StrongP@ss1'); // 密码已哈希
      expect(insert!.data.username).toBe('newuser');
      expect(insert!.data.email).toBe('new@example.com');
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
      mockDb.setQueryResult([activeUserRow]);
      mockDb.setRowCountResult(1);

      const r: any = await updateUserAction('user-1', { name: 'Updated Name' } as any);

      expect(r.success).toBe(true);
      expect(r.message).toBe('更新成功');
      expect(r.data).toBeDefined();
      expect(r.data.id).toBe('user-1');
    });

    it('不存在用户 → 抛出 EntityNotFoundError', async () => {
      mockDb.setQueryResult([]);

      await expect(
        updateUserAction('nonexistent', { name: 'X' } as any)
      ).rejects.toThrow();
    });
  });

  describe('toggleUserStatusAction', () => {
    it('ACTIVE 用户 → 返回 success: true 且 status 变为 DISABLED', async () => {
      mockDb.setQueryResult([{ ...activeUserRow, status: 'ACTIVE' }]);
      mockDb.setRowCountResult(1);

      const r: any = await toggleUserStatusAction('user-1');

      expect(r.success).toBe(true);
      expect(r.data).toBeDefined();
      // toggleUserStatus 域逻辑：ACTIVE → DISABLED
      expect(r.data.status).toBe('DISABLED');
      expect(r.message).toContain('已禁用');

      // 验证 DB 写入 status='DISABLED'
      const updates = mockDb.getWrites().filter(w => w.type === 'update');
      expect(updates.length).toBeGreaterThanOrEqual(1);
      expect(updates[0]!.data.status).toBe('DISABLED');
    });

    it('DISABLED 用户 → 返回 success: true 且 status 变为 ACTIVE', async () => {
      mockDb.setQueryResult([{ ...activeUserRow, status: 'DISABLED' }]);
      mockDb.setRowCountResult(1);

      const r: any = await toggleUserStatusAction('user-2');

      expect(r.success).toBe(true);
      expect(r.data.status).toBe('ACTIVE');
    });

    it('不存在用户 → 抛出错误', async () => {
      mockDb.setQueryResult([]);

      await expect(
        toggleUserStatusAction('nonexistent')
      ).rejects.toThrow();
    });
  });

  describe('deleteUserAction', () => {
    it('可删除用户 → 返回 success: true', async () => {
      mockDb.setQueryResult([activeUserRow]);
      mockDb.setRowCountResult(1);

      const r: any = await deleteUserAction('user-1');

      expect(r.success).toBe(true);
      expect(r.message).toBe('用户已逻辑删除');
      expect(r.data.id).toBe('user-1');
    });

    it('不存在用户 → 抛出错误', async () => {
      mockDb.setQueryResult([]);

      await expect(
        deleteUserAction('nonexistent')
      ).rejects.toThrow();
    });
  });
});
