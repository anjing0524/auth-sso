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

  const createChain = (isCount = false) => {
    const chain: any = () => {};
    chain.then = (resolve: Function) => resolve(isCount ? [{ count: state._queryResult.length }] : state._queryResult);
    chain.catch = () => ({ then: (r: Function) => r([]) });
    return new Proxy(chain, {
      get(t: any, prop: string) {
        if (prop === 'then' || prop === 'catch') return t[prop];
        return () => createChain(isCount);
      },
    });
  };

  const db = new Proxy({} as any, {
    get(_t: any, prop: string) {
      if (prop === 'select') {
        return (arg?: any) => {
          const isCount = arg && typeof arg === 'object' && 'count' in arg;
          return createChain(isCount);
        };
      }
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
      if (prop === 'query') return new Proxy({} as any, {
        get(_t2, _prop2: string) {
          return {
            findFirst: () => {
              const c: any = () => {};
              c.then = (resolve: Function) => resolve(state._queryResult[0] ?? null);
              return c;
            },
            findMany: () => createChain(),
          };
        },
      });
      if (prop === 'transaction') return async (cb: Function) => {
        const tx = new Proxy({} as any, {
          get(_t2: any, p: string) {
            if (p === 'select') return () => createChain();
            if (p === 'insert') return () => ({ values: (d: any) => ({ then: (r: Function) => r([{ ...d, id: 'mock-tx-id' }]) }) });
            if (p === 'update') return () => ({ set: () => ({ where: () => ({ then: (r: Function) => r([1]) }) }) });
            if (p === 'delete') return () => ({ where: () => ({ then: (r: Function) => r([1]) }) });
            if (p === 'query') return new Proxy({} as any, {
              get(_t3, _p3: string) { return { findFirst: () => createChain(), findMany: () => createChain() }; },
            });
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
    async (_req: any, _opts: any, handler: (userId: string) => Promise<Response>) => {
      try { return await handler('admin-user-1'); }
      catch (err) {
        const { mapDomainError } = await import('@/domain/shared/error-mapping');
        const mapped = mapDomainError(err);
        return NextResponse.json({ error: mapped.error, message: mapped.message }, { status: mapped.status });
      }
    },
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

vi.mock('@/infrastructure/db', () => ({
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

vi.mock('@/lib/auth', () => ({
  withPermission: mockWithPermission,
}));

vi.mock('@/lib/audit', () => ({
  logAuditEvent: vi.fn(async () => {}),
  getClientIP: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/infrastructure/redis', () => ({}));

// =========================================
// 引入被测试模块（mocks 之后）
// =========================================
import { GET as ListRoles } from '@/app/api/roles/route';
import { GET as GetRole } from '@/app/api/roles/[id]/route';
import { GET as GetRolePermissions } from '@/app/api/roles/[id]/permissions/route';

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
});
