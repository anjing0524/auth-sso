/**
 * Client 管理 API 单元测试
 *
 * @req G-CLT-L, G-CLT-C, G-CLT-U, G-CLT-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  let _queryResult: any[] = [];
  let _returningResult: any[] = [];
  let _rowCountResult = 1;

  function createChain(): any {
    const chain: any = () => {};
    chain.then = (resolve: Function) => resolve(_queryResult);
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
          values: (data: any) => ({
            returning: () => Promise.resolve(_returningResult.length > 0 ? _returningResult : [{ ...data, id: 'mock-id' }]),
            then: (resolve: Function) => resolve(_rowCountResult),
          }),
        });
        if (prop === 'update') return () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(_returningResult), then: (r: Function) => r(_rowCountResult) }) }) });
        if (prop === 'delete') return () => ({ where: () => ({ returning: () => Promise.resolve(_returningResult), then: (r: Function) => r(_rowCountResult) }) });
        if (prop === 'execute') return () => Promise.resolve([]);
        if (prop === 'query') return new Proxy({} as any, {
          get(_t2, _prop2: string) { return { findFirst: () => createChain(), findMany: () => createChain() }; },
        });
        return undefined;
      },
    });
  }

  const db = new Proxy({} as any, {
    get(_t, prop: string) {
      if (prop === 'select' || prop === 'selectDistinct') return () => createChain();
      if (prop === 'insert') return () => ({
        values: (data: any) => ({
          returning: () => Promise.resolve(_returningResult.length > 0 ? _returningResult : [{ ...data, id: 'mock-id' }]),
          then: (resolve: Function) => resolve(_rowCountResult),
        }),
      });
      if (prop === 'update') return () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(_returningResult), then: (r: Function) => r(_rowCountResult) }) }) });
      if (prop === 'delete') return () => ({ where: () => ({ returning: () => Promise.resolve(_returningResult), then: (r: Function) => r(_rowCountResult) }) });
      if (prop === 'execute') return () => Promise.resolve([]);
      if (prop === 'query') return new Proxy({} as any, {
        get(_t2, _prop2: string) {
          return {
            findFirst: () => {
              const c: any = () => {};
              c.then = (resolve: Function) => resolve(_queryResult[0] ?? null);
              return new Proxy(c, { get(_t3, p: string) { return p === 'then' || p === 'catch' ? c[p] : () => c; } });
            },
            findMany: () => createChain(),
          };
        },
      });
      if (prop === 'transaction') return async (cb: (tx: any) => Promise<any>) => cb(createTx());
      return undefined;
    },
  });

  const authFn = vi.fn(
    async (_request: any, _options: any, handler: (userId: string) => Promise<any>) => handler('test-user-id')
  );

  // Schema Proxy: any access like schema.clients.id returns {} (prevents "Cannot read properties of undefined")
  const schema = new Proxy({} as any, {
    get(_t: any, _prop: string) {
      return new Proxy({} as any, {
        get(_t2: any, _prop2: string) { return {}; },
      });
    },
  });

  return {
    db,
    schema,
    authFn,
    auditFn: vi.fn(),
    setQueryResult(r: any[]) { _queryResult = r; },
    setReturningResult(r: any[]) { _returningResult = r; },
    setRowCountResult(n: number) { _rowCountResult = n; },
    reset() {
      _queryResult = [];
      _returningResult = [];
      _rowCountResult = 1;
    },
  };
});

vi.mock('@/infrastructure/db', () => ({ db: mocks.db, schema: mocks.schema }));
vi.mock('@/lib/auth', () => ({ withPermission: mocks.authFn }));
vi.mock('@/lib/audit', () => ({ logAuditEvent: mocks.auditFn, getClientIP: vi.fn(() => '127.0.0.1') }));

import { GET as ListClients } from '@/app/api/clients/route';
import { GET as GetClient } from '@/app/api/clients/[id]/route';
import { GET as ListTokens } from '@/app/api/clients/[id]/tokens/route';
import { createTestRequest, parseResponseJson } from '../helpers/test-utils';

function makeClientRow(overrides: Record<string, any> = {}) {
  return {
    id: 'client-1',
    publicId: 'c_cli01',
    name: '测试应用',
    clientId: 'test_client_id',
    clientSecret: 'hashed_secret',
    redirectUrls: JSON.stringify(['http://localhost:4100/api/auth/callback']),
    grantTypes: JSON.stringify(['authorization_code', 'refresh_token']),
    scopes: 'openid profile email',
    homepageUrl: null,
    icon: null,
    accessTokenTtl: 3600,
    refreshTokenTtl: 604800,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeTokenRow(overrides: Record<string, any> = {}) {
  return {
    id: 'token-1',
    userId: 'user-1',
    scopes: JSON.stringify(['openid', 'profile']),
    createdAt: new Date('2026-01-01'),
    expiresAt: new Date('2026-06-01'),
    userEmail: 'test@example.com',
    userName: '测试用户',
    ...overrides,
  };
}

describe('Client API', () => {
  beforeEach(() => {
    mocks.reset();
    vi.clearAllMocks();
  });

  describe('GET /api/clients', () => {
    it('返回分页 Client 列表', async () => {
      mocks.setQueryResult([makeClientRow({ count: 1 })]);

      const res = await ListClients(createTestRequest('/api/clients'));
      expect(res.status).toBe(200);

      const body = await parseResponseJson(res);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].redirectUris).toBeInstanceOf(Array);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.total).toBe(1);
    });

    it('空结果返回空数组和 total 0', async () => {
      mocks.setQueryResult([]);
      const body = await parseResponseJson(await ListClients(createTestRequest('/api/clients')));
      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(0);
    });

    it('redirectUrls 兼容 JSON 和逗号分隔格式', async () => {
      mocks.setQueryResult([
        makeClientRow({ count: 2, redirectUrls: '["http://localhost:4100/cb"]' }),
        makeClientRow({ id: 'client-2', publicId: 'c_cli02', name: 'CSV应用', clientId: 'csv_c', redirectUrls: 'http://localhost:4100/a, http://localhost:4100/b', count: 2 }),
      ]);
      const body = await parseResponseJson(await ListClients(createTestRequest('/api/clients')));
      expect(body.data[0].redirectUris).toEqual(['http://localhost:4100/cb']);
      expect(body.data[1].redirectUris).toContain('http://localhost:4100/a');
    });
  });

  describe('GET /api/clients/[id]', () => {
    it('返回 Client 详情', async () => {
      mocks.setQueryResult([makeClientRow()]);
      const res = await GetClient(createTestRequest('/api/clients/client-1'), { params: Promise.resolve({ id: 'client-1' }) } as any);
      const body = await parseResponseJson(res);
      expect(body.data.clientId).toBe('test_client_id');
    });

    it('不存在的 Client 返回 404', async () => {
      mocks.setQueryResult([]);
      const res = await GetClient(createTestRequest('/api/clients/nx'), { params: Promise.resolve({ id: 'nx' }) } as any);
      expect(res.status).toBe(404);
    });
  });



  describe('GET /api/clients/[id]/tokens', () => {
    it('返回分页 Token 列表', async () => {
      mocks.setQueryResult([{ ...makeClientRow(), count: 2, ...makeTokenRow() }]);
      const body = await parseResponseJson(await ListTokens(
        createTestRequest('/api/clients/c1/tokens'),
        { params: Promise.resolve({ id: 'c1' }) } as any,
      ));
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data[0].scopes).toBeInstanceOf(Array);
      expect(body.pagination).toBeDefined();
    });

    it('不存在的 Client 返回 404', async () => {
      mocks.setQueryResult([]);
      const res = await ListTokens(createTestRequest('/api/clients/nx/tokens'), { params: Promise.resolve({ id: 'nx' }) } as any);
      expect(res.status).toBe(404);
    });
  });
});
