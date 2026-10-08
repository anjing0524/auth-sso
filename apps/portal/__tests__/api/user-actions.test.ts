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
import { seedAdminUser, seedRootDept, seedSuperAdminRole, seedTestUser, seedUserRoleBinding } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';

// ── 测试数据库 ──────────────────────────────────────
const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));
vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ userId: '00000000-0000-4000-8000-000000000101' })),
  logServerDataRead: vi.fn(async () => {}),
  getUserRoleDeptIds: vi.fn().mockResolvedValue([]),
  canAccessDept: vi.fn(() => true),
  requireDeptAccess: vi.fn(async () => {}),
  withAuth: (_o: any, h: Function) => async (...a: any[]) =>
    h({ userId: '00000000-0000-4000-8000-000000000101' }, ...a),
  withPermission: (_o: any, h: Function) => async () => h('00000000-0000-4000-8000-000000000101'),
}));
vi.mock('@/lib/crypto', () => ({
  generateUUID: () => 'aabbccdd-eeff-4000-8000-000000000001',
  generateId: (_len?: number) => 'aaaaaaaa',
  hashToken: (t: string) => t,
}));
vi.mock('@/lib/session/revoke', () => ({ revokeUserAccessByUserId: vi.fn(async () => 0) }));
vi.mock('@/infrastructure/redis', () => ({}));

import { db } from '@/infrastructure/db';
import { createUserAction, updateUserAction, toggleUserStatusAction, deleteUserAction, resetPasswordAction } from '@/app/(dashboard)/users/actions';

const ADMIN_ID = '00000000-0000-4000-8000-000000000101';
const DEPT_ID = '00000000-0000-4000-8000-000000000001';

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
  // 数据范围守卫现由真实 resolveScope（lib/authz）解析，走原生 SQL 读
  // user_roles → roles.dept_id，不再经过被 mock 的 @/lib/auth。
  // 因此操作者必须在库中真实拥有一个根部门角色，否则可见范围为空、守卫正确拒绝。
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser(),
    roles: seedSuperAdminRole({ deptId: '00000000-0000-4000-8000-000000000001' }),
    userRoles: seedUserRoleBinding(ADMIN_ID, '00000000-0000-4000-8000-000000000301'),
  });
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

// ── resetPasswordAction：安全关键操作，此前零覆盖 ──────────────
//
// 该 action 承担两条安全不变量，且此前**没有任何测试**：
// 1. NFR-SEC-15 禁止重用最近 5 次密码（命中历史必须拒绝，且不落库）
// 2. 重置后撤销目标用户全部会话（B-USR-PW）
// 数据范围守卫与 404 由 withScopedRow 承担（其自身已有独立覆盖）。

describe('resetPasswordAction', () => {
  const NEW_PASSWORD = 'BrandNew@654321';

  async function rowOf(id: string) {
    const [row] = await td.db.select({
      passwordHash: schema.users.passwordHash,
      passwordHistory: schema.users.passwordHistory,
    }).from(schema.users).where(eq(schema.users.id, id));
    return row;
  }

  it('有效输入 → 更新密码哈希并把旧哈希推入历史', async () => {
    const { hashPassword } = await import('@/domain/auth/password');
    await td.db.insert(schema.users).values(seedTestUser({ passwordHash: await hashPassword('Old@123456') })[0]!);
    const before = await rowOf('00000000-0000-4000-8000-000000000201');

    const res = await resetPasswordAction('00000000-0000-4000-8000-000000000201', NEW_PASSWORD);

    expect(res.success).toBe(true);
    const after = await rowOf('00000000-0000-4000-8000-000000000201');
    expect(after!.passwordHash).not.toBe(before!.passwordHash);
    expect(after!.passwordHistory).toContain(before!.passwordHash);
  });

  it('弱密码 → 拒绝且不落库', async () => {
    const { hashPassword } = await import('@/domain/auth/password');
    await td.db.insert(schema.users).values(seedTestUser({ passwordHash: await hashPassword('Old@123456') })[0]!);
    const before = await rowOf('00000000-0000-4000-8000-000000000201');

    const res = await resetPasswordAction('00000000-0000-4000-8000-000000000201', 'short');

    expect(res.success).toBe(false);
    const after = await rowOf('00000000-0000-4000-8000-000000000201');
    expect(after!.passwordHash).toBe(before!.passwordHash);
  });

  it('**新密码命中历史 → 拒绝且不落库**（NFR-SEC-15）', async () => {
    const { hashPassword } = await import('@/domain/auth/password');
    const reusedHash = await hashPassword(NEW_PASSWORD);
    await td.db.insert(schema.users).values(seedTestUser({
      passwordHash: await hashPassword('Current@123456'),
      passwordHistory: [reusedHash],
    })[0]!);
    const before = await rowOf('00000000-0000-4000-8000-000000000201');

    await expect(
      resetPasswordAction('00000000-0000-4000-8000-000000000201', NEW_PASSWORD),
    ).rejects.toThrow('新密码不能与最近使用过的密码相同');

    const after = await rowOf('00000000-0000-4000-8000-000000000201');
    expect(after!.passwordHash).toBe(before!.passwordHash);
  });

  it('目标用户不存在 → EntityNotFoundError（不与其他失败混淆）', async () => {
    await expect(
      resetPasswordAction('00000000-0000-4000-8000-000000000999', NEW_PASSWORD),
    ).rejects.toThrow(EntityNotFoundError);
  });

  it('重置成功后撤销该用户全部会话（B-USR-PW）', async () => {
    const { hashPassword } = await import('@/domain/auth/password');
    const { revokeUserAccessByUserId } = await import('@/lib/session/revoke');
    await td.db.insert(schema.users).values(seedTestUser({ passwordHash: await hashPassword('Old@123456') })[0]!);

    await resetPasswordAction('00000000-0000-4000-8000-000000000201', NEW_PASSWORD);

    expect(revokeUserAccessByUserId).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000201');
  });
});
