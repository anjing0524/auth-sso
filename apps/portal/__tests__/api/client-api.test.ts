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

vi.mock('@/lib/db', () => ({ db: mocks.db, schema: mocks.schema }));
vi.mock('@/lib/auth-middleware', () => ({ withPermission: mocks.authFn }));
vi.mock('@/lib/audit', () => ({ logAuditEvent: mocks.auditFn, getClientIP: vi.fn(() => '127.0.0.1') }));

import { GET as ListClients, POST as CreateClient } from '@/app/api/clients/route';
import { GET as GetClient, PUT as UpdateClient, DELETE as DeleteClient } from '@/app/api/clients/[id]/route';
import { POST as RotateSecret } from '@/app/api/clients/[id]/secret/route';
import { GET as ListTokens, DELETE as RevokeTokens } from '@/app/api/clients/[id]/tokens/route';
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
    disabled: false,
    skipConsent: false,
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

  describe('POST /api/clients', () => {
    it('成功创建 Client，返回 client_id 和 secret（仅一次）', async () => {
      const req = createTestRequest('/api/clients', {
        method: 'POST',
        body: { name: '新应用', redirectUris: ['http://localhost:4100/callback'] },
      });
      const res = await CreateClient(req);
      expect(res.status).toBe(200);

      const body = await parseResponseJson(res);
      expect(body.success).toBe(true);
      expect(body.data.clientId).toBeTruthy();
      expect(body.data.clientSecret).toBeTruthy();
      expect(body.data.name).toBe('新应用');
    });

    it('缺少必填字段时返回 400', async () => {
      const req = createTestRequest('/api/clients', { method: 'POST', body: { name: '' } });
      const res = await CreateClient(req);
      expect(res.status).toBe(400);
      expect((await parseResponseJson(res)).error).toBe('AUTH_SSO_1005');
    });

    it('无效的 redirect_uri 格式返回验证错误', async () => {
      const req = createTestRequest('/api/clients', {
        method: 'POST',
        body: { name: '测试应用', redirectUris: ['not-a-valid-url'] },
      });
      const res = await CreateClient(req);
      expect(res.status).toBe(400);
      const body = await parseResponseJson(res);
      expect(body.error).toBe('AUTH_SSO_7004');
      expect(body.message).toContain('not-a-valid-url');
    });
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

  describe('PUT /api/clients/[id]', () => {
    it('更新重定向 URI 成功', async () => {
      mocks.setQueryResult([makeClientRow({ redirectUrls: JSON.stringify(['http://localhost:4100/new']) })]);
      const res = await UpdateClient(
        createTestRequest('/api/clients/client-1', { method: 'PUT', body: { name: '更新', redirectUris: ['http://localhost:4100/new'] } }),
        { params: Promise.resolve({ id: 'client-1' }) } as any,
      );
      const body = await parseResponseJson(res);
      expect(body.success).toBe(true);
      expect(body.data.redirectUris).toContain('http://localhost:4100/new');
    });

    it('不存在的 Client 返回 404', async () => {
      mocks.setQueryResult([]);
      const res = await UpdateClient(createTestRequest('/api/clients/nx', { method: 'PUT', body: { name: 'x' } }), { params: Promise.resolve({ id: 'nx' }) } as any);
      expect(res.status).toBe(404);
    });

    it('无效 redirect URI 格式返回验证错误', async () => {
      mocks.setQueryResult([makeClientRow()]);
      const res = await UpdateClient(createTestRequest('/api/clients/c1', { method: 'PUT', body: { redirectUris: ['bad'] } }), { params: Promise.resolve({ id: 'c1' }) } as any);
      expect(res.status).toBe(400);
    });

    it('更新 status 为 DISABLED 同步设置 disabled=true', async () => {
      mocks.setQueryResult([makeClientRow({ status: 'DISABLED', disabled: true })]);
      const body = await parseResponseJson(await UpdateClient(
        createTestRequest('/api/clients/c1', { method: 'PUT', body: { status: 'DISABLED' } }),
        { params: Promise.resolve({ id: 'c1' }) } as any,
      ));
      expect(body.data.status).toBe('DISABLED');
      expect(body.data.disabled).toBe(true);
    });
  });

  describe('DELETE /api/clients/[id]', () => {
    it('soft 模式删除 Client', async () => {
      mocks.setQueryResult([makeClientRow()]);
      const body = await parseResponseJson(await DeleteClient(
        createTestRequest('/api/clients/c1', { method: 'DELETE', searchParams: { mode: 'soft' } }),
        { params: Promise.resolve({ id: 'c1' }) } as any,
      ));
      expect(body.message).toContain('已删除');
    });

    it('默认 disable 模式禁用 Client', async () => {
      mocks.setQueryResult([makeClientRow()]);
      const body = await parseResponseJson(await DeleteClient(
        createTestRequest('/api/clients/c1', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'c1' }) } as any,
      ));
      expect(body.message).toContain('已禁用');
      expect(body.data.status).toBe('DISABLED');
    });

    it('不存在的 Client 返回 404', async () => {
      mocks.setQueryResult([]);
      const res = await DeleteClient(createTestRequest('/api/clients/nx', { method: 'DELETE' }), { params: Promise.resolve({ id: 'nx' }) } as any);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/clients/[id]/secret', () => {
    it('成功轮换 Secret', async () => {
      mocks.setQueryResult([makeClientRow()]);
      const body = await parseResponseJson(await RotateSecret(
        createTestRequest('/api/clients/c1/secret', { method: 'POST' }),
        { params: Promise.resolve({ id: 'c1' }) } as any,
      ));
      expect(body.success).toBe(true);
      expect(body.data.clientSecret).toBeTruthy();
    });

    it('不存在的 Client 返回 404', async () => {
      mocks.setQueryResult([]);
      const res = await RotateSecret(createTestRequest('/api/clients/nx/secret', { method: 'POST' }), { params: Promise.resolve({ id: 'nx' }) } as any);
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

  describe('DELETE /api/clients/[id]/tokens', () => {
    it('revokeAll 撤销全部 Token', async () => {
      mocks.setQueryResult([makeClientRow()]);
      mocks.setReturningResult([{ id: 't1' }, { id: 't2' }]);
      const body = await parseResponseJson(await RevokeTokens(
        createTestRequest('/api/clients/c1/tokens', { method: 'DELETE', body: { revokeAll: true } }),
        { params: Promise.resolve({ id: 'c1' }) } as any,
      ));
      expect(body.data.revokedCount).toBe(2);
    });

    it('tokenIds 指定撤销', async () => {
      mocks.setQueryResult([makeClientRow()]);
      mocks.setReturningResult([{ id: 't1' }]);
      const body = await parseResponseJson(await RevokeTokens(
        createTestRequest('/api/clients/c1/tokens', { method: 'DELETE', body: { tokenIds: ['t1'] } }),
        { params: Promise.resolve({ id: 'c1' }) } as any,
      ));
      expect(body.data.revokedCount).toBe(1);
    });

    it('不传 tokenIds 或 revokeAll 返回 400', async () => {
      mocks.setQueryResult([makeClientRow()]);
      const res = await RevokeTokens(
        createTestRequest('/api/clients/c1/tokens', { method: 'DELETE', body: {} }),
        { params: Promise.resolve({ id: 'c1' }) } as any,
      );
      expect(res.status).toBe(400);
    });
  });
});
