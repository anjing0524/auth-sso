/**
 * 用户管理 API 与 Server Actions 集成测试（真实 DB）
 *
 * 覆盖范围：
 * - 用户列表查询 REST API (GET /api/users)
 * - 用户详情查询 REST API (GET /api/users/[id])
 * - 核心写入 Server Actions 流程及入参门禁校验
 *
 * @req B-USR-L, B-USR-C, B-USR-R, B-USR-U, B-USR-D, B-USR-ST, B-USR-PW
 * @req DC-USR-C, DC-USR-U, DC-USR-D, DC-USR-ST
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { NextResponse } from 'next/server';
import { COMMON_ERRORS } from '@auth-sso/contracts';
import { EntityNotFoundError } from '@/domain/shared/errors';
import { createTestRequest } from '../helpers/test-utils';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedRootDept, seedTestUser } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';

// ════════════════════════════════════════════════════════
// Hoisted mocks
// ════════════════════════════════════════════════════════
const { tdHolder, mockAuthCheck, mockWithPermission } = vi.hoisted(() => {
  const tdHolder: { current: any } = { current: null };
  const mockAuthCheck = vi.fn(async () => ({
    authorized: true,
    userId: '00000000-0000-4000-8000-000000000101',
    error: undefined as string | undefined,
  }));
  // withPermission: 直接调用 handler 并返回其结果（NextResponse）
  const mockWithPermission = vi.fn(
    async (opts: any, resource: any, handler?: Function) => {
      const h = (typeof resource === 'function' ? resource : handler)!;
      return h('00000000-0000-4000-8000-000000000101', { deptIds: ['00000000-0000-4000-8000-000000000001'] });
    },
  );
  return { tdHolder, mockAuthCheck, mockWithPermission };
});

// ════════════════════════════════════════════════════════
// Module mocks — schema 直接引用 top-level import（避免 getter
// 在模块加载期触发 td TDZ），db 通过 holder 间接访问
// ════════════════════════════════════════════════════════
vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current.db; },
  schema,
}));

vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ claims: { deptIds: ['00000000-0000-4000-8000-000000000001'] } })),
  logServerDataRead: vi.fn(async () => {}),
  canAccessDept: vi.fn(() => true),
  withAuth: (_o: any, h: Function) => async (...a: any[]) => {
    const check = await mockAuthCheck();
    if (!check.authorized) {
      return { success: false, error: 'FORBIDDEN', message: check.error || '权限不足' };
    }
    try {
      return await h(
        { userId: check.userId, claims: { deptIds: ['00000000-0000-4000-8000-000000000001'], permissions: [], roles: [] } },
        ...a,
      );
    } catch (err: unknown) {
      const e = err as Error & { code?: string };
      return { success: false, error: e.code || 'INTERNAL_ERROR', message: e.message || '服务器错误' };
    }
  },
  withPermission: mockWithPermission,
}));

vi.mock('@/lib/crypto', () => ({
  generateUUID: () => 'aabbccdd-eeff-4000-8000-000000000001',
  generateId: (_len?: number) => 'aaaaaaaa',
  hashToken: (t: string) => t,
}));

vi.mock('@/lib/session/revoke', () => ({ revokeUserAccessByUserId: vi.fn(async () => 0) }));
vi.mock('@/infrastructure/redis', () => ({ getRedis: vi.fn(() => null) }));
vi.mock('@/domain/auth/password', () => ({
  hashPassword: vi.fn(async (pw: string) => `$2b$10$${pw}_hashed`),
  isPasswordReused: vi.fn(async () => false),
  pushPasswordHistory: vi.fn(() => [] as string[]),
}));

// ════════════════════════════════════════════════════════
// 初始化 td
// ════════════════════════════════════════════════════════
const td = createTestDbHandle();
tdHolder.current = td;

// ════════════════════════════════════════════════════════
// 引入被测试模块
// ════════════════════════════════════════════════════════
import { db } from '@/infrastructure/db';
import { GET as ListUsers } from '@/app/api/users/route';
import { GET as GetUser } from '@/app/api/users/[id]/route';
import {
  createUserAction,
  updateUserAction,
  deleteUserAction,
  toggleUserStatusAction,
  unlockUserAction,
  resetPasswordAction,
} from '@/app/(dashboard)/users/actions';

// ════════════════════════════════════════════════════════
// 测试生命周期
// ════════════════════════════════════════════════════════
const DEPT_ID = '00000000-0000-4000-8000-000000000001';

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, { departments: seedRootDept() });
  vi.clearAllMocks();
});

describe('User Management API & Actions', () => {
  describe('GET /api/users (list)', () => {
    it('分页返回用户列表，含 total 和 page', async () => {
      await seedTestData(td.db, { users: seedTestUser() });

      const response = await ListUsers(
        createTestRequest('/api/users', { searchParams: { page: '1', pageSize: '10' } }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        username: 'testuser',
        name: '测试用户',
      });
      expect(body.pagination).toBeDefined();
      expect(body.pagination.total).toBe(1);
    });

    it('无 user:list 权限时返回 403', async () => {
      mockWithPermission.mockImplementationOnce(
        async () => NextResponse.json({ error: 'forbidden', message: 'Insufficient permissions' }, { status: 403 }),
      );

      const response = await ListUsers(createTestRequest('/api/users'));
      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/users/[id] (detail)', () => {
    it('返回用户详情', async () => {
      await seedTestData(td.db, { users: seedTestUser() });

      const response = await GetUser(createTestRequest('/api/users/u'), {
        params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000201' }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        id: '00000000-0000-4000-8000-000000000201',
        username: 'testuser',
        name: '测试用户',
        email: 'test@example.com',
      });
    });

    it('不存在的用户返回 404', async () => {
      const response = await GetUser(createTestRequest('/api/users/nonexistent'), {
        params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000999' }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe('createUserAction', () => {
    it('有效输入 → 返回 success: true 并写入用户', async () => {
      const input = {
        username: 'newactionuser',
        email: 'action@test.com',
        name: 'Action User',
        password: 'Pass1234!9',
        deptId: DEPT_ID,
      };

      const res = await createUserAction(input);
      expect(res.success).toBe(true);
      expect(res.message).toContain('创建成功');

      const allUsers = await db.select().from(schema.users);
      const newUser = allUsers.find(u => u.username === 'newactionuser');
      expect(newUser).toBeDefined();
      expect(newUser!.email).toBe('action@test.com');
      expect(newUser!.passwordHash).toBeDefined();
    });

    it('React 19 FormData 签名也正常创建用户', async () => {
      const formData = new FormData();
      formData.append('username', 'newactionuser2');
      formData.append('email', 'action2@test.com');
      formData.append('name', 'Action User 2');
      formData.append('password', 'Pass1234!9');
      formData.append('deptId', DEPT_ID);

      const res = await createUserAction(null, formData);
      expect(res.success).toBe(true);
      expect(res.message).toContain('创建成功');

      const rows = await db.select().from(schema.users);
      expect(rows.find(u => u.username === 'newactionuser2')).toBeDefined();
    });

    it('邮箱不合法 → 返回 validation error', async () => {
      const input = {
        username: 'newactionuser',
        email: 'invalid-email',
        name: 'Action User',
        password: 'Pass1234!9',
      };

      const res = await createUserAction(input);
      expect(res.success).toBe(false);
      expect(res.message).toBe('邮箱格式不合法');
    });

    it('鉴权失败 → 返回 false', async () => {
      mockAuthCheck.mockResolvedValueOnce({ authorized: false, userId: '', error: '权限不足' });
      const res = await createUserAction({} as any);
      expect(res.success).toBe(false);
      expect(res.message).toContain('权限不足');
    });
  });

  describe('updateUserAction', () => {
    it('存在用户 → 返回 success: true', async () => {
      await seedTestData(td.db, { users: seedTestUser() });

      const res = await updateUserAction(
        '00000000-0000-4000-8000-000000000201',
        { name: 'New Name', email: 'newemail@test.com' } as any,
      );
      expect(res.success).toBe(true);
      expect(res.message).toContain('更新成功');

      const rows = await db.select().from(schema.users);
      const updated = rows.find(u => u.id === '00000000-0000-4000-8000-000000000201');
      expect(updated!.name).toBe('New Name');
      expect(updated!.email).toBe('newemail@test.com');
    });

    it('不存在用户 → 返回错误', async () => {
      const res = await updateUserAction('00000000-0000-4000-8000-000000000999', { name: 'X' } as any);
      expect(res.success).toBe(false);
      expect(res.message).toContain('不存在');
    });

    it('空 ID → 返回 validation error', async () => {
      const res = await updateUserAction('', { name: 'New Name' } as any);
      expect(res.success).toBe(false);
      expect(res.message).toBe('用户ID不能为空');
    });
  });

  describe('deleteUserAction', () => {
    it('可删除用户 → 逻辑删除成功', async () => {
      await seedTestData(td.db, { users: seedTestUser() });

      const res = await deleteUserAction('00000000-0000-4000-8000-000000000201');
      expect(res.success).toBe(true);
      expect(res.message).toContain('已逻辑删除');
      expect(res.data.id).toBe('00000000-0000-4000-8000-000000000201');

      const rows = await db.select().from(schema.users);
      const user = rows.find(u => u.id === '00000000-0000-4000-8000-000000000201');
      expect(user!.status).toBe('DELETED');
    });
  });

  describe('toggleUserStatusAction', () => {
    it('ACTIVE 用户 → 变为 DISABLED', async () => {
      await seedTestData(td.db, { users: seedTestUser({ status: 'ACTIVE' }) });

      const res = await toggleUserStatusAction('00000000-0000-4000-8000-000000000201');
      expect(res.success).toBe(true);
      expect(res.message).toContain('已禁用');

      const rows = await db.select().from(schema.users);
      const user = rows.find(u => u.id === '00000000-0000-4000-8000-000000000201');
      expect(user!.status).toBe('DISABLED');
    });

    it('DELETED 用户 → 返回错误', async () => {
      await seedTestData(td.db, { users: seedTestUser({ status: 'DELETED' }) });

      const res = await toggleUserStatusAction('00000000-0000-4000-8000-000000000201');
      expect(res.success).toBe(false);
      expect(res.message).toContain('已逻辑删除');
    });
  });

  describe('unlockUserAction', () => {
    it('LOCKED 用户 → 解锁成功', async () => {
      await seedTestData(td.db, { users: seedTestUser({ status: 'LOCKED' }) });

      const res = await unlockUserAction('00000000-0000-4000-8000-000000000201');
      expect(res.success).toBe(true);
      expect(res.message).toContain('已解锁');

      const rows = await db.select().from(schema.users);
      const user = rows.find(u => u.id === '00000000-0000-4000-8000-000000000201');
      expect(user!.status).toBe('ACTIVE');
    });

    it('DELETED 用户 → 返回错误', async () => {
      await seedTestData(td.db, { users: seedTestUser({ status: 'DELETED' }) });

      const res = await unlockUserAction('00000000-0000-4000-8000-000000000201');
      expect(res.success).toBe(false);
      expect(res.message).toContain('已逻辑删除');
    });
  });

  describe('resetPasswordAction', () => {
    it('重置密码 → 返回 success', async () => {
      await seedTestData(td.db, { users: seedTestUser() });

      const res = await resetPasswordAction('00000000-0000-4000-8000-000000000201', 'NewPass1word');
      expect(res.success).toBe(true);
      expect(res.message).toContain('密码已重置');

      const rows = await db.select().from(schema.users);
      const user = rows.find(u => u.id === '00000000-0000-4000-8000-000000000201');
      expect(user!.passwordHash).toBeDefined();
    });

    it('密码过短 → 拒绝', async () => {
      const res = await resetPasswordAction('00000000-0000-4000-8000-000000000201', 'short');
      expect(res.success).toBe(false);
      expect(res.error).toBe(COMMON_ERRORS.VALIDATION_ERROR);
    });

    it('密码无大写 → 拒绝', async () => {
      const res = await resetPasswordAction('00000000-0000-4000-8000-000000000201', 'alllowercase1');
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });
  });
});
