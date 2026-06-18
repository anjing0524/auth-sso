/**
 * 用户管理与控制层单元测试
 * 
 * 覆盖范围：
 * - 用户列表查询 REST API (GET /api/users)
 * - 用户详情查询 REST API (GET /api/users/[id])
 * - 核心写入 Server Actions 流程及入参门禁校验
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createTestUser } from '../helpers/test-fixtures';
import { createTestRequest } from '../helpers/test-utils';

// =========================================
// Mock 基础设施
// =========================================
const {
  db,
  setQueryResult,
  resetDb,
  mockWithPermission,
  mockCheckPermission,
  mockCheckDataScope,
  mockGetDataScopeFilter,
} = vi.hoisted(() => {
  const state: { _queryResult: any[] } = { _queryResult: [] };

  const createChain = () => {
    const chain: any = () => {};
    chain.then = (resolve: Function) => resolve(state._queryResult);
    chain.catch = () => ({ then: (r: Function) => r([]) });
    return new Proxy(chain, {
      get(t: any, prop: string) {
        if (prop === 'then' || prop === 'catch') return t[prop];
        return () => createChain();
      },
    });
  };

  const db = new Proxy({} as any, {
    get(_t: any, prop: string) {
      if (prop === 'query') {
        return {
          users: {
            findFirst: async () => state._queryResult[0] || null,
          },
          departments: {
            findFirst: async () => ({ id: 'dept-1', name: 'Engineering' }),
          }
        };
      }
      if (prop === 'select') return () => createChain();
      if (prop === 'insert')
        return () => ({
          values: (data: any) => ({
            then: (resolve: Function) => resolve([{ ...data, id: 'mock-id' }]),
          }),
        });
      if (prop === 'update')
        return () => ({
          set: () => ({
            where: () => ({ then: (resolve: Function) => resolve([1]) }),
          }),
        });
      if (prop === 'transaction')
        return (fn: Function) => {
          // 事务 mock：传入的 tx 同样代理 db 的所有方法
          const tx = new Proxy({} as any, {
            get(_t2: any, prop2: string) {
              if (prop2 === 'query') {
                return {
                  users: {
                    findFirst: async () => state._queryResult[0] || null,
                  },
                };
              }
              if (prop2 === 'insert')
                return () => ({
                  values: (data: any) => Promise.resolve([{ ...data, id: 'mock-id' }]),
                });
              if (prop2 === 'update')
                return () => ({
                  set: () => ({ where: () => Promise.resolve([1]) }),
                });
              return undefined;
            },
          });
          return fn(tx);
        };
      return undefined;
    },
  });

  const mockWithPermission = vi.fn(
    async (_opts: any, handler: (userId: string) => Promise<Response>) =>
      handler('admin-user-1'),
  );
  const mockCheckPermission = vi.fn(async () => ({ authorized: true, userId: 'admin-user-1', error: undefined as string | undefined }));
  const mockCheckDataScope = vi.fn(async () => true);
  const mockGetDataScopeFilter = vi.fn(async () => ({ type: 'ALL' }));

  return {
    db,
    setQueryResult(r: any[]) {
      state._queryResult = r;
    },
    resetDb() {
      state._queryResult = [];
    },
    mockWithPermission,
    mockCheckPermission,
    mockCheckDataScope,
    mockGetDataScopeFilter,
  };
});

vi.mock('@/infrastructure/db', () => ({
  db,
  schema: {
    users: {
      username: 'username',
      email: 'email',
      id: 'id',
    },
    departments: {},
    roles: {},
    userRoles: {},
    auditLogs: {},
  },
}));

vi.mock('@/lib/auth', () => ({
  withAuth: (_opts: unknown, fn: Function) => async (...args: unknown[]) => {
    // 模拟真实 withAuth 的鉴权 + 错误映射行为
    const check = await mockCheckPermission();
    if (!check.authorized || !check.userId) {
      return { success: false, error: 'FORBIDDEN', message: check.error || '权限不足' };
    }
    try {
      return await fn({ userId: check.userId }, ...args);
    } catch (err: unknown) {
      const e = err as Error & { code?: string };
      return { success: false, error: e.code || 'INTERNAL_ERROR', message: e.message || '服务器错误' };
    }
  },
  withPermission: mockWithPermission,
  checkPermission: mockCheckPermission,
  checkDataScope: mockCheckDataScope,
  getDataScopeFilter: mockGetDataScopeFilter,
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn(async (pw: string) => `hashed_${pw}`),
}));

vi.mock('@/lib/permissions', () => ({
  refreshUserPermissionCache: vi.fn(async () => {}),
  clearUserPermissionCache: vi.fn(async () => {}),
}));

// =========================================
// 引入被测试模块
// =========================================
import { GET as ListUsers } from '@/app/api/users/route';
import { GET as GetUser } from '@/app/api/users/[id]/route';
import {
  createUserAction,
  updateUserAction,
  deleteUserAction,
  toggleUserStatusAction,
} from '@/app/(dashboard)/users/actions';

describe('User Management API & Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  // ======== GET /api/users ========
  describe('GET /api/users (list)', () => {
    it('returns paginated user list with total and page', async () => {
      setQueryResult([
        {
          id: 'u1',
          publicId: 'u_001',
          username: 'user1',
          email: 'u1@test.com',
          name: 'User One',
          avatarUrl: null,
          status: 'ACTIVE',
          deptId: 'dept-1',
          deptName: 'Engineering',
          createdAt: new Date('2026-01-01'),
          lastLoginAt: null,
          count: 1,
        },
      ]);

      const response = await ListUsers(
        createTestRequest('/api/users', { searchParams: { page: '1', pageSize: '10' } }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        publicId: 'u_001',
        username: 'user1',
        name: 'User One',
      });
    });

    it('returns 403 without user:list permission', async () => {
      mockWithPermission.mockImplementationOnce(
        async () =>
          NextResponse.json(
            { error: 'forbidden', message: 'Insufficient permissions' },
            { status: 403 },
          ),
      );

      const response = await ListUsers(createTestRequest('/api/users'));
      expect(response.status).toBe(403);
    });
  });

  // ======== GET /api/users/[id] ========
  describe('GET /api/users/[id] (detail)', () => {
    it('returns user detail by public_id', async () => {
      setQueryResult([
        createTestUser({ deptName: 'Engineering', code: 'USER' }),
      ]);

      const response = await GetUser(createTestRequest('/api/users/u_abc123'), {
        params: Promise.resolve({ id: 'u_abc123' }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toMatchObject({
        publicId: 'u_abc123',
        name: '测试用户',
        email: 'test@example.com',
      });
    });

    it('returns 404 for nonexistent user', async () => {
      setQueryResult([]);

      const response = await GetUser(createTestRequest('/api/users/nonexistent'), {
        params: Promise.resolve({ id: 'nonexistent' }),
      });

      expect(response.status).toBe(404);
    });
  });

  // ======== Server Actions ========
  describe('createUserAction', () => {
    it('creates user successfully with valid inputs', async () => {
      setQueryResult([]);
      const input = {
        username: 'newactionuser',
        email: 'action@test.com',
        name: 'Action User',
        password: 'Pass1234',
        deptId: 'dept-1',
      };

      const res = await createUserAction(input);
      expect(res.success).toBe(true);
      expect(res.message).toContain('创建成功');
    });

    it('creates user successfully via React 19 Form Action signature', async () => {
      setQueryResult([]);
      const formData = new FormData();
      formData.append('username', 'newactionuser');
      formData.append('email', 'action@test.com');
      formData.append('name', 'Action User');
      formData.append('password', 'Pass1234');
      formData.append('deptId', 'dept-1');

      const res = await createUserAction(null, formData);
      expect(res.success).toBe(true);
      expect(res.message).toContain('创建成功');
    });

    it('returns validation error when email is invalid', async () => {
      const input = {
        username: 'newactionuser',
        email: 'invalid-email',
        name: 'Action User',
        password: 'Pass1234',
      };

      const res = await createUserAction(input);
      expect(res.success).toBe(false);
      expect(res.message).toBe('邮箱格式不合法');
    });

    it('returns 403 when checkPermission fails', async () => {
      mockCheckPermission.mockResolvedValueOnce({ authorized: false, userId: '', error: '权限不足' });
      const res = await createUserAction(null);
      expect(res.success).toBe(false);
      expect(res.message).toContain('权限不足');
    });
  });

  describe('updateUserAction', () => {
    it('updates user info successfully', async () => {
      setQueryResult([createTestUser({ id: 'u-1' })]);
      const res = await updateUserAction('u-1', { name: 'New Name', email: 'newemail@test.com' });
      expect(res.success).toBe(true);
      expect(res.message).toContain('更新成功');
    });

    it('returns error when user is not found', async () => {
      setQueryResult([]);
      const res = await updateUserAction('nonexistent', { name: 'New Name' });
      expect(res.success).toBe(false);
      expect(res.message).toContain('不存在');
    });

    it('returns validation error on empty ID', async () => {
      const res = await updateUserAction('', { name: 'New Name' });
      expect(res.success).toBe(false);
      expect(res.message).toBe('用户ID不能为空');
    });
  });

  describe('deleteUserAction', () => {
    it('logical deletes user successfully', async () => {
      setQueryResult([createTestUser({ id: 'u-1' })]);
      const res = await deleteUserAction('u-1');
      expect(res.success).toBe(true);
      expect(res.message).toContain('逻辑删除');
    });
  });

  describe('toggleUserStatusAction', () => {
    it('toggles user status successfully', async () => {
      const activeUser = {
        id: 'u-1', publicId: 'user_1', username: 'test',
        email: 'test@example.com', name: 'Test',
        status: 'ACTIVE', deptId: null, avatarUrl: null, createdAt: new Date(),
      };
      setQueryResult([activeUser]);
      const res = await toggleUserStatusAction('u-1');
      expect(res.success).toBe(true);
      expect(res.message).toContain('已禁用');
    });

    it('throws error when user is logical DELETED in toggleStatus', async () => {
      const deletedUser = {
        id: 'u-1', publicId: 'user_1', username: 'test',
        email: 'test@example.com', name: 'Test',
        status: 'DELETED', deptId: null, avatarUrl: null, createdAt: new Date(),
      };
      setQueryResult([deletedUser]);
      const res = await toggleUserStatusAction('u-1');
      expect(res.success).toBe(false);
      expect(res.message).toContain('已逻辑删除的用户无法操作状态');
    });
  });
});
