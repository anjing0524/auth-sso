/**
 * 用户管理 API 单元测试
 *
 * 覆盖范围：
 * - 用户列表查询（分页、关键字搜索）
 * - 用户创建（必填校验、重复检查、数据范围）
 * - 用户详情查询（publicId 支持）
 * - 用户更新
 * - 用户软删除
 * - 权限检查（403）
 * - 数据范围检查（403）
 *
 * @req B-USR-L, B-USR-S, B-USR-C, B-USR-R, B-USR-U, B-USR-D, B-USR-ST
 * @req SCOPE-001, SCOPE-002, SCOPE-003
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createTestUser } from '../helpers/test-fixtures';
import { createTestRequest } from '../helpers/test-utils';

// =========================================
// Mock 基础设施（全部通过 vi.hoisted 初始化，保证 vi.mock 工厂可引用）
// =========================================
const {
  db,
  setQueryResult,
  resetDb,
  mockWithPermission,
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

  const createTx = () =>
    new Proxy({} as any, {
      get(_t: any, prop: string) {
        if (prop === 'insert' || prop === 'update' || prop === 'delete')
          return () => ({
            values: (data: any) => ({
              then: (r: Function) => r([{ ...data, id: 'tx-id' }]),
            }),
            where: () => ({ then: (r: Function) => r([1]) }),
          });
        if (prop === 'select') return () => createChain();
        return () => createChain();
      },
    });

  const db = new Proxy({} as any, {
    get(_t: any, prop: string) {
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
      if (prop === 'delete')
        return () => ({
          where: () => ({ then: (resolve: Function) => resolve([1]) }),
        });
      if (prop === 'transaction')
        return async (cb: (tx: any) => Promise<any>) => cb(createTx());
      return undefined;
    },
  });

  const mockWithPermission = vi.fn(
    async (_req: any, _opts: any, handler: (userId: string) => Promise<Response>) =>
      handler('admin-user-1'),
  );
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
    mockCheckDataScope,
    mockGetDataScopeFilter,
  };
});

vi.mock('@/lib/db', () => ({
  db,
  schema: {
    users: {},
    departments: {},
    roles: {},
    userRoles: {},
    accounts: {},
    auditLogs: {},
    loginLogs: {},
  },
}));

vi.mock('@/lib/auth-middleware', () => ({
  withPermission: mockWithPermission,
  checkDataScope: mockCheckDataScope,
  getDataScopeFilter: mockGetDataScopeFilter,
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn((pw: string) => `hashed_${pw}`),
  },
  hash: vi.fn((pw: string) => `hashed_${pw}`),
}));

vi.mock('@/lib/audit', () => ({
  logAuditEvent: vi.fn(async () => {}),
  logLoginEvent: vi.fn(async () => {}),
  getClientIP: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/lib/session', () => ({
  revokeUserSessions: vi.fn(async () => {}),
}));

vi.mock('@/lib/redis', () => ({}));

// =========================================
// 引入被测试模块（mocks 之后）
// =========================================
import { GET as ListUsers, POST as CreateUser } from '@/app/api/users/route';
import {
  GET as GetUser,
  PUT as UpdateUser,
  DELETE as DeleteUser,
} from '@/app/api/users/[id]/route';

describe('User Management API', () => {
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
        deptName: 'Engineering',
      });
      expect(body.pagination).toEqual({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
    });

    it('filters users by keyword search', async () => {
      setQueryResult([
        {
          id: 'u2',
          publicId: 'u_002',
          username: 'target',
          email: 'target@test.com',
          name: 'Target User',
          avatarUrl: null,
          status: 'ACTIVE',
          deptId: 'dept-2',
          deptName: 'Business',
          createdAt: new Date('2026-01-01'),
          lastLoginAt: null,
          count: 1,
        },
      ]);

      const response = await ListUsers(
        createTestRequest('/api/users', { searchParams: { keyword: 'target' } }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].username).toBe('target');
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

  // ======== POST /api/users ========

  describe('POST /api/users (create)', () => {
    it('creates user successfully returning public_id', async () => {
      setQueryResult([]);

      const response = await CreateUser(
        createTestRequest('/api/users', {
          method: 'POST',
          body: {
            username: 'newuser',
            email: 'new@test.com',
            name: 'New User',
            password: 'Pass1234',
            deptId: 'dept-1',
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toMatchObject({
        username: 'newuser',
        email: 'new@test.com',
        name: 'New User',
      });
      expect(body.data.publicId).toContain('user_');
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await CreateUser(
        createTestRequest('/api/users', {
          method: 'POST',
          body: { username: 'newuser' },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('AUTH_SSO_1005');
    });

    it('returns 400 when email or username already exists', async () => {
      setQueryResult([
        createTestUser({
          username: 'existing',
          email: 'existing@test.com',
          publicId: 'u_existing',
        }),
      ]);

      const response = await CreateUser(
        createTestRequest('/api/users', {
          method: 'POST',
          body: {
            username: 'existing',
            email: 'existing@test.com',
            name: 'Duplicate User',
            password: 'Pass1234',
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('AUTH_SSO_3002');
    });

    it('returns 403 when deptId is outside data scope', async () => {
      setQueryResult([]);
      mockCheckDataScope.mockResolvedValueOnce(false);

      const response = await CreateUser(
        createTestRequest('/api/users', {
          method: 'POST',
          body: {
            username: 'outofscope',
            email: 'out@test.com',
            name: 'Out of Scope',
            password: 'Pass1234',
            deptId: 'dept-restricted',
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe('AUTH_SSO_1003');
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
        deptName: 'Engineering',
      });
    });

    it('returns 404 for nonexistent user', async () => {
      setQueryResult([]);

      const response = await GetUser(createTestRequest('/api/users/nonexistent'), {
        params: Promise.resolve({ id: 'nonexistent' }),
      });

      expect(response.status).toBe(404);
    });

    it('returns 403 when data scope rejects access', async () => {
      setQueryResult([createTestUser({ deptId: 'dept-restricted' })]);
      mockCheckDataScope.mockResolvedValueOnce(false);

      const response = await GetUser(createTestRequest('/api/users/user-1'), {
        params: Promise.resolve({ id: 'user-1' }),
      });

      expect(response.status).toBe(403);
    });
  });

  // ======== PUT /api/users/[id] ========

  describe('PUT /api/users/[id] (update)', () => {
    it('updates user info', async () => {
      setQueryResult([createTestUser({ deptId: 'dept-1' })]);

      const response = await UpdateUser(
        createTestRequest('/api/users/user-1', {
          method: 'PUT',
          body: { name: 'Updated Name', email: 'updated@test.com' },
        }),
        { params: Promise.resolve({ id: 'user-1' }) },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 404 for nonexistent user', async () => {
      setQueryResult([]);

      const response = await UpdateUser(
        createTestRequest('/api/users/nonexistent', {
          method: 'PUT',
          body: { name: 'New Name' },
        }),
        { params: Promise.resolve({ id: 'nonexistent' }) },
      );

      expect(response.status).toBe(404);
    });
  });

  // ======== DELETE /api/users/[id] ========

  describe('DELETE /api/users/[id] (delete)', () => {
    it('soft-deletes user (sets status to DELETED)', async () => {
      setQueryResult([createTestUser()]);

      const response = await DeleteUser(
        createTestRequest('/api/users/user-1', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'user-1' }) },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.message).toContain('逻辑删除');
    });

    it('returns 404 for nonexistent user', async () => {
      setQueryResult([]);

      const response = await DeleteUser(
        createTestRequest('/api/users/nonexistent', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'nonexistent' }) },
      );

      expect(response.status).toBe(404);
    });
  });
});
