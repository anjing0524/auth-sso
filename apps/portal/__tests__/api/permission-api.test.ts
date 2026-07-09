/**
 * 权限管理 API 单元测试
 *
 * @req D-PRM-L, D-PRM-C, D-PRM-U, D-PRM-D
 * @req E-MNU-U, E-MNU-D, E-MNU-PB
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  let _queryResult: any[] = [];
  let _queryQueue: any[][] = [];
  let _returningResult: any[] = [];
  let _rowCountResult = 1;
  let _executeResult: any[] = [];
  let _inserts: any[] = [];

  function createChain(): any {
    const chain: any = () => {};
    chain.then = (resolve: Function) => {
      const result = _queryQueue.length > 0 ? (_queryQueue.shift() ?? _queryResult) : _queryResult;
      resolve(result);
    };
    chain.catch = () => ({ then: (r: Function) => r([]) });
    return new Proxy(chain, {
      get(t, prop: string) {
        if (prop === 'then' || prop === 'catch') return chain[prop];
        return () => createChain();
      },
    });
  }

  function createTx(): any {
    return new Proxy({} as any, {
      get(_t, prop: string) {
        if (prop === 'select' || prop === 'selectDistinct') return () => createChain();
        if (prop === 'insert') return () => ({
          values: (data: any) => {
            _inserts.push(data);
            return {
              returning: () => Promise.resolve(_returningResult.length > 0 ? _returningResult : [{ ...data, id: 'mock-id' }]),
              then: (resolve: Function) => resolve(_rowCountResult),
            };
          },
        });
        if (prop === 'update') return () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(_returningResult), then: (r: Function) => r(_rowCountResult) }) }) });
        if (prop === 'delete') return () => ({ where: () => ({ returning: () => Promise.resolve(_returningResult), then: (r: Function) => r(_rowCountResult) }) });
        if (prop === 'execute') return () => Promise.resolve(_executeResult);
        if (prop === 'query') return new Proxy({} as any, {
          get(_t2, _prop2: string) {
            return {
              findFirst: () => {
                const c: any = () => {};
                c.then = (resolve: Function) => resolve(_queryResult[0] ?? null);
                return c;
              },
              findMany: () => createChain(),
            };
          },
        });
        return undefined;
      },
    });
  }

  const db = new Proxy({} as any, {
    get(_t, prop: string) {
      if (prop === 'select' || prop === 'selectDistinct') return () => createChain();
      if (prop === 'insert') return () => ({
        values: (data: any) => {
          _inserts.push(data);
          return {
            returning: () => Promise.resolve(_returningResult.length > 0 ? _returningResult : [{ ...data, id: 'mock-id' }]),
            then: (resolve: Function) => resolve(_rowCountResult),
          };
        },
      });
      if (prop === 'update') return () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(_returningResult), then: (r: Function) => r(_rowCountResult) }) }) });
      if (prop === 'delete') return () => ({ where: () => ({ returning: () => Promise.resolve(_returningResult), then: (r: Function) => r(_rowCountResult) }) });
      if (prop === 'execute') return () => Promise.resolve(_executeResult);
      if (prop === 'query') return new Proxy({} as any, {
        get(_t2, _prop2: string) {
          return {
            findFirst: () => {
              const c: any = () => {};
              c.then = (resolve: Function) => resolve(_queryResult[0] ?? null);
              return c;
            },
            findMany: () => createChain(),
          };
        },
      });
      if (prop === 'transaction') return async (cb: (tx: any) => Promise<any>) => cb(createTx());
      return undefined;
    },
  });

  const schema = new Proxy({} as any, {
    get(_t: any, _prop: string) {
      return new Proxy({} as any, {
        get(_t2: any, _prop2: string) { return {}; },
      });
    },
  });

  const authFn = vi.fn(
    async (_options: any, handler: (userId: string) => Promise<any>) => {
      try { return await handler('test-user-id'); }
      catch (err) {
        const { mapDomainError } = await import('@/domain/shared/error-mapping');
        const mapped = mapDomainError(err);
        return new Response(JSON.stringify({ error: mapped.error, message: mapped.message }), { status: mapped.status, headers: { 'Content-Type': 'application/json' } });
      }
    }
  );

  return {
    db,
    schema,
    authFn,
    setQueryResult(r: any[]) { _queryResult = r; _queryQueue = []; },
    setQueryQueue(q: any[][]) { _queryQueue = q; },
    setReturningResult(r: any[]) { _returningResult = r; },
    setRowCountResult(n: number) { _rowCountResult = n; },
    setExecuteResult(r: any[]) { _executeResult = r; },
    getInserts() { return _inserts; },
    reset() {
      _queryResult = [];
      _queryQueue = [];
      _returningResult = [];
      _rowCountResult = 1;
      _executeResult = [];
      _inserts = [];
    },
  };
});

vi.mock('@/infrastructure/db', () => ({ db: mocks.db, schema: mocks.schema }));
vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ claims: { deptIds: ['dept-1'] } })),
  logServerDataRead: vi.fn(async () => {}),
  canAccessDept: vi.fn(() => true),
 withPermission: mocks.authFn }));
vi.mock('@/lib/crypto', () => ({
  generateId: vi.fn(() => 'mock_id_12345'),
  generateUUID: vi.fn(() => '00000000-0000-4000-8000-000000000001'),
  generatePermissionPublicId: vi.fn(() => 'perm_mock01'),
  generateRequestId: vi.fn(() => 'req_mock01'),
  hashClientSecret: (s: string) => 'hash:' + s,
}));

import { GET as ListPermissions } from '@/app/api/permissions/route';
import { GET as GetPermission } from '@/app/api/permissions/[id]/route';
import { POST as RegisterPermissions } from '@/app/api/permissions/register/route';
import { createTestRequest, parseResponseJson } from '../helpers/test-utils';

function makePermissionRow(overrides: Record<string, any> = {}) {
  return {
    id: 'perm-1',
    publicId: 'p_perm01',
    code: 'user:list',
    name: '用户列表',
    type: 'API',
    resource: 'user',
    action: 'list',
    parentId: null,
    status: 'ACTIVE',
    sort: 1,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeRegisterClientRow(overrides: Record<string, any> = {}) {
  return {
    id: 'reg-client-1',
    clientId: 'registry-client',
    clientSecret: 'hash:registry-secret',
    name: '权限注册客户端',
    status: 'ACTIVE',
    isInternal: true,
    ...overrides,
  };
}

describe('Permission API', () => {
  beforeEach(() => {
    mocks.reset();
    vi.clearAllMocks();
  });

  // ================================================
  // GET /api/permissions
  // ================================================
  describe('GET /api/permissions', () => {
    it('返回全部权限列表', async () => {
      mocks.setQueryResult([
        makePermissionRow({ code: 'user:list', sort: 1 }),
        makePermissionRow({ id: 'perm-2', publicId: 'p02', code: 'role:list', name: '角色列表', sort: 2 }),
        makePermissionRow({ id: 'perm-3', publicId: 'p03', code: 'dept:list', type: 'DATA', sort: 3 }),
      ]);
      const body = await parseResponseJson(await ListPermissions(createTestRequest('/api/permissions')));
      expect(body.data).toHaveLength(3);
      expect(body.data[0].code).toBe('user:list');
    });

    it('支持 type 过滤', async () => {
      mocks.setQueryResult([makePermissionRow({ code: 'role:list', type: 'MENU' })]);
      const body = await parseResponseJson(await ListPermissions(createTestRequest('/api/permissions', { searchParams: { type: 'MENU' } })));
      expect(body.data).toHaveLength(1);
      expect(body.data[0].type).toBe('MENU');
    });

    it('空列表返回空数组', async () => {
      mocks.setQueryResult([]);
      expect((await parseResponseJson(await ListPermissions(createTestRequest('/api/permissions')))).data).toEqual([]);
    });
  });

  // ================================================
  // GET /api/permissions/[id]
  // ================================================
  describe('GET /api/permissions/[id]', () => {
    it('返回权限详情', async () => {
      mocks.setQueryResult([makePermissionRow()]);
      const body = await parseResponseJson(await GetPermission(createTestRequest('/api/permissions/p1'), { params: Promise.resolve({ id: 'p1' }) } as any));
      expect(body.data.code).toBe('user:list');
    });

    it('支持 publicId', async () => {
      mocks.setQueryResult([makePermissionRow()]);
      const body = await parseResponseJson(await GetPermission(createTestRequest('/api/permissions/p_perm01'), { params: Promise.resolve({ id: 'p_perm01' }) } as any));
      expect(body.data.code).toBe('user:list');
    });

    it('不存在返回 404', async () => {
      mocks.setQueryResult([]);
      const res = await GetPermission(createTestRequest('/api/permissions/nx'), { params: Promise.resolve({ id: 'nx' }) } as any);
      expect(res.status).toBe(404);
    });
  });



  // ================================================
  // POST /api/permissions/register - 权限树同步
  // ================================================
  describe('POST /api/permissions/register', () => {
    function createRegisterReq(
      permissions: any[],
      opts: { clientId?: string; clientSecret?: string; noAuth?: boolean } = {},
    ) {
      const { clientId = 'registry-client', clientSecret = 'registry-secret', noAuth = false } = opts;
      const headers: Record<string, string> = {};
      if (!noAuth) {
        headers['Authorization'] = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      }
      return createTestRequest('/api/permissions/register', { method: 'POST', headers, body: { permissions } });
    }

    it('缺少 Basic Auth 返回 401', async () => {
      const res = await RegisterPermissions(createRegisterReq([], { noAuth: true }));
      expect(res.status).toBe(401);
    });

    it('无效 Client 凭证返回 403', async () => {
      mocks.setQueryResult([]);
      const res = await RegisterPermissions(createRegisterReq([{ code: 'u:l', name: 'x', type: 'API' }], { clientId: 'bad', clientSecret: 'bad' }));
      expect(res.status).toBe(403);
    });

    it('缺少 permissions 数组返回 400', async () => {
      mocks.setQueryResult([makeRegisterClientRow()]);
      const res = await RegisterPermissions(createTestRequest('/api/permissions/register', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from('registry-client:registry-secret').toString('base64') },
        body: {},
      }));
      expect(res.status).toBe(400);
    });

    it('完整同步权限树成功（新权限全部插入）', async () => {
      // client 查询 → clientRow；事务内权限查询 → 空（无旧权限）
      mocks.setQueryQueue([[makeRegisterClientRow()], []]);
      mocks.setExecuteResult([]);

      const body = await parseResponseJson(await RegisterPermissions(createRegisterReq([
        { code: 'user:list', name: '用户列表', type: 'API', resource: 'user', action: 'list', sort: 1 },
        { code: 'user:create', name: '创建用户', type: 'API', resource: 'user', action: 'create', sort: 2 },
        {
          code: 'system', name: '系统管理', type: 'MENU', sort: 0,
          children: [{ code: 'system:config', name: '系统配置', type: 'MENU', sort: 1 }],
        },
      ])));

      expect(body.success).toBe(true);
      expect(body.stats).toBeDefined();
      expect(body.stats.inserted).toBe(4);
      expect(body.stats.updated).toBe(0);
      expect(body.stats.deprecated).toBe(0);
    });

    it('两阶段事务：新权限插入 + 旧权限软删除', async () => {
      const existingPerms = [
        { id: 'p-ex-1', code: 'user:list', name: '旧用户列表', type: 'API', status: 'ACTIVE', clientId: 'registry-client' },
        { id: 'p-ex-2', code: 'role:list', name: '旧角色列表', type: 'API', status: 'ACTIVE', clientId: 'registry-client' },
        { id: 'p-ex-3', code: 'will:remain', name: '保留权限', type: 'API', status: 'ACTIVE', clientId: 'registry-client' },
      ];
      // 组合 client 数据 + 已有权限数据（同一 _queryResult 用于 db.select 和 tx.select）
      mocks.setQueryResult([makeRegisterClientRow(), ...existingPerms]);
      mocks.setExecuteResult([]);

      const body = await parseResponseJson(await RegisterPermissions(createRegisterReq([
        { code: 'user:list', name: '更新后的用户列表', type: 'API' },
        { code: 'will:remain', name: '保留权限', type: 'API' },
      ])));

      expect(body.success).toBe(true);
      expect(body.stats.inserted).toBe(0);
      // role:list 不包含在传入树中且 status=ACTIVE -> deprecated
      expect(body.stats.deprecated).toBeGreaterThanOrEqual(1);
      // user:list 已存在且 name 变更 -> updated
      expect(body.stats.updated).toBeGreaterThanOrEqual(1);
    });

    it('全局 code 冲突（被其他 client 占用）返回 409 + 前缀建议', async () => {
      // mock 返回有效 client 行，但其 code 已被其他 client 占用
      mocks.setQueryResult([makeRegisterClientRow({ clientId: 'other-client', code: 'user:list' })]);
      const res = await RegisterPermissions(createRegisterReq([
        { code: 'user:list', name: '用户列表', type: 'API' },
      ]));
      expect(res.status).toBe(409);
      const body = await parseResponseJson(res);
      expect(body.error).toBe('conflict');
      expect(body.message).toContain('user:list');
    });

    it('批量内重复 code 返回验证错误', async () => {
      mocks.setQueryResult([makeRegisterClientRow()]);
      const res = await RegisterPermissions(createRegisterReq([
        { code: 'user:list', name: '用户列表', type: 'API' },
        { code: 'user:list', name: '重复', type: 'API' },
      ]));
      expect(res.status).toBe(400);
    });

    it('PAGE/DIRECTORY 节点的 path/icon/visible 透传落库', async () => {
      mocks.setQueryResult([makeRegisterClientRow()]);
      mocks.setExecuteResult([]);

      const body = await parseResponseJson(await RegisterPermissions(createRegisterReq([
        {
          code: 'erp:orders', name: '订单', type: 'DIRECTORY', sort: 1,
          children: [
            { code: 'erp:order:list', name: '订单列表', type: 'PAGE',
              path: '/orders', icon: 'orders', visible: true, sort: 1 },
          ],
        },
      ])));

      expect(body.success).toBe(true);
      const inserts = mocks.getInserts();
      const pageRow = inserts.find((r: any) => r.code === 'erp:order:list');
      expect(pageRow).toBeDefined();
      expect(pageRow.path).toBe('/orders');
      expect(pageRow.icon).toBe('orders');
      expect(pageRow.visible).toBe(true);
    });
  });
});
