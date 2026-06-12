/**
 * 角色管理 API 单元测试
 *
 * 覆盖范围：
 * - 角色列表查询
 * - 角色创建（必填校验、编码重复检查）
 * - 角色详情查询
 * - 角色更新
 * - 角色删除（含系统角色保护）
 * - 角色权限绑定（查询、分配）
 * - 权限检查（403）
 *
 * @req C-ROL-L, C-ROL-C, C-ROL-U, C-ROL-D, C-ROL-PA, C-ROL-CA, C-ROL-DS
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createTestRole, createTestPermission } from '../helpers/test-fixtures';
import { createTestRequest } from '../helpers/test-utils';

// =========================================
// Mock 基础设施（全部通过 vi.hoisted 初始化）
// =========================================
const { db, setQueryResult, resetDb, mockWithPermission } = vi.hoisted(() => {
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
      if (prop === 'transaction') return async (cb: Function) => {
        const tx = new Proxy({} as any, {
          get(_t2: any, p: string) {
            if (p === 'select') return () => createChain();
            if (p === 'insert') return () => ({ values: (d: any) => ({ then: (r: Function) => r([{ ...d, id: 'mock-tx-id' }]) }) });
            if (p === 'update') return () => ({ set: () => ({ where: () => ({ then: (r: Function) => r([1]) }) }) });
            if (p === 'delete') return () => ({ where: () => ({ then: (r: Function) => r([1]) }) });
            return undefined;
          },
        });
        return cb(tx);
      };
      if (prop === 'delete')
        return () => ({
          where: () => ({ then: (resolve: Function) => resolve([1]) }),
        });
      return undefined;
    },
  });

  const mockWithPermission = vi.fn(
    async (_req: any, _opts: any, handler: (userId: string) => Promise<Response>) =>
      handler('admin-user-1'),
  );

  return {
    db,
    setQueryResult(r: any[]) {
      state._queryResult = r;
    },
    resetDb() {
      state._queryResult = [];
    },
    mockWithPermission,
  };
});

vi.mock('@/lib/db', () => ({
  db,
  schema: {
    roles: {},
    permissions: {},
    userRoles: {},
    rolePermissions: {},
    auditLogs: {},
    users: {},
  },
}));

vi.mock('@/lib/auth-middleware', () => ({
  withPermission: mockWithPermission,
}));

vi.mock('@/lib/audit', () => ({
  logAuditEvent: vi.fn(async () => {}),
  getClientIP: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/lib/redis', () => ({}));

// =========================================
// 引入被测试模块（mocks 之后）
// =========================================
import { GET as ListRoles, POST as CreateRole } from '@/app/api/roles/route';
import {
  GET as GetRole,
  PUT as UpdateRole,
  DELETE as DeleteRole,
} from '@/app/api/roles/[id]/route';
import {
  GET as GetRolePermissions,
  POST as AssignRolePermissions,
} from '@/app/api/roles/[id]/permissions/route';

describe('Role Management API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  // ======== GET /api/roles ========

  describe('GET /api/roles (list)', () => {
    it('returns role list with dataScopeType', async () => {
      setQueryResult([
        createTestRole({ name: 'Admin', code: 'ADMIN', dataScopeType: 'ALL' }),
      ]);

      const response = await ListRoles(createTestRequest('/api/roles'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        name: 'Admin',
        code: 'ADMIN',
        dataScopeType: 'ALL',
      });
      expect(body.pagination).toBeDefined();
      expect(body.pagination.total).toBe(1);
    });

    it('returns 403 without role:list permission', async () => {
      mockWithPermission.mockImplementationOnce(
        async () =>
          NextResponse.json({ error: 'forbidden', message: 'Insuff. permissions' }, { status: 403 }),
      );

      const response = await ListRoles(createTestRequest('/api/roles'));
      expect(response.status).toBe(403);
    });
  });

  // ======== POST /api/roles ========

  describe('POST /api/roles (create)', () => {
    it('creates role successfully', async () => {
      setQueryResult([]);

      const response = await CreateRole(
        createTestRequest('/api/roles', {
          method: 'POST',
          body: { name: 'Test Role', code: 'TEST_ROLE', description: 'Test description' },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toMatchObject({ name: 'Test Role', code: 'TEST_ROLE' });
      expect(body.data.publicId).toContain('role_');
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await CreateRole(
        createTestRequest('/api/roles', {
          method: 'POST',
          body: { name: 'test' },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('AUTH_SSO_1005');
    });

    it('returns 400 when role code already exists', async () => {
      setQueryResult([createTestRole({ code: 'DUPLICATE_CODE' })]);

      const response = await CreateRole(
        createTestRequest('/api/roles', {
          method: 'POST',
          body: { name: 'Duplicate Role', code: 'DUPLICATE_CODE' },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('AUTH_SSO_5002');
    });
  });

  // ======== GET /api/roles/[id] ========

  describe('GET /api/roles/[id] (detail)', () => {
    it('returns role detail', async () => {
      setQueryResult([
        createTestRole({ name: 'Admin', dataScopeType: 'ALL' }),
      ]);

      const response = await GetRole(createTestRequest('/api/roles/role-1'), {
        params: Promise.resolve({ id: 'role-1' }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toMatchObject({ name: 'Admin', dataScopeType: 'ALL' });
    });

    it('returns 404 for nonexistent role', async () => {
      setQueryResult([]);

      const response = await GetRole(createTestRequest('/api/roles/nonexistent'), {
        params: Promise.resolve({ id: 'nonexistent' }),
      });

      expect(response.status).toBe(404);
    });
  });

  // ======== PUT /api/roles/[id] ========

  describe('PUT /api/roles/[id] (update)', () => {
    it('updates role name/description', async () => {
      setQueryResult([createTestRole()]);

      const response = await UpdateRole(
        createTestRequest('/api/roles/role-1', {
          method: 'PUT',
          body: { name: 'Updated Role', description: 'Updated desc' },
        }),
        { params: Promise.resolve({ id: 'role-1' }) },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 404 for nonexistent role', async () => {
      setQueryResult([]);

      const response = await UpdateRole(
        createTestRequest('/api/roles/nonexistent', {
          method: 'PUT',
          body: { name: 'New Name' },
        }),
        { params: Promise.resolve({ id: 'nonexistent' }) },
      );

      expect(response.status).toBe(404);
    });
  });

  // ======== DELETE /api/roles/[id] ========

  describe('DELETE /api/roles/[id] (delete)', () => {
    it('deletes role successfully', async () => {
      setQueryResult([createTestRole({ isSystem: false })]);

      const response = await DeleteRole(
        createTestRequest('/api/roles/role-1', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'role-1' }) },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 400 for system role (isSystem=true)', async () => {
      setQueryResult([createTestRole({ isSystem: true })]);

      const response = await DeleteRole(
        createTestRequest('/api/roles/system-role', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'system-role' }) },
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('AUTH_SSO_5003');
    });
  });

  // ======== GET /api/roles/[id]/permissions ========

  describe('GET /api/roles/[id]/permissions', () => {
    it('returns bound permissions', async () => {
      setQueryResult([
        {
          ...createTestPermission({ code: 'user:list', name: 'User List' }),
          type: 'API',
          resource: 'user',
          action: 'list',
          assignedAt: new Date('2026-01-01'),
        },
      ]);

      const response = await GetRolePermissions(
        createTestRequest('/api/roles/role-1/permissions'),
        { params: Promise.resolve({ id: 'role-1' }) },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        code: 'user:list',
        name: 'User List',
        type: 'API',
        resource: 'user',
        action: 'list',
      });
    });
  });

  // ======== POST /api/roles/[id]/permissions ========

  describe('POST /api/roles/[id]/permissions', () => {
    it('binds permissions to role', async () => {
      setQueryResult([createTestRole()]);

      const response = await AssignRolePermissions(
        createTestRequest('/api/roles/role-1/permissions', {
          method: 'POST',
          body: { permissionIds: ['perm-1', 'perm-2'] },
        }),
        { params: Promise.resolve({ id: 'role-1' }) },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.assignedCount).toBe(2);
    });

    it('returns 400 for invalid permissionIds format', async () => {
      const response = await AssignRolePermissions(
        createTestRequest('/api/roles/role-1/permissions', {
          method: 'POST',
          body: { permissionIds: 'not-an-array' },
        }),
        { params: Promise.resolve({ id: 'role-1' }) },
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('AUTH_SSO_1005');
    });

    it('returns 404 for nonexistent role', async () => {
      setQueryResult([]);

      const response = await AssignRolePermissions(
        createTestRequest('/api/roles/nonexistent/permissions', {
          method: 'POST',
          body: { permissionIds: ['perm-1'] },
        }),
        { params: Promise.resolve({ id: 'nonexistent' }) },
      );

      expect(response.status).toBe(404);
    });
  });
});
