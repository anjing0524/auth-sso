/**
 * 菜单管理 API 单元测试
 *
 * @req E-MNU-L, E-MNU-C, E-MNU-U, E-MNU-D, E-MNU-PB
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  let _queryResult: any[] = [];
  let _queryQueue: any[][] = [];
  let _returningResult: any[] = [];
  let _rowCountResult = 1;

  function createChain(): any {
    const chain: any = () => {};
    chain.then = (resolve: Function) => {
      if (_queryQueue.length > 0) resolve(_queryQueue.shift()!);
      else resolve(_queryResult);
    };
    return new Proxy(chain, {
      get(t, prop: string) {
        if (prop === 'then' || prop === 'catch') return chain[prop];
        return () => createChain();
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
              c.then = (resolve: Function) => {
                if (_queryQueue.length > 0) resolve(_queryQueue.shift()![0] ?? null);
                else resolve(_queryResult[0] ?? null);
              };
              return new Proxy(c, { get(_t3, p: string) { return p === 'then' || p === 'catch' ? c[p] : () => c; } });
            },
            findMany: () => createChain(),
          };
        },
      });
      if (prop === 'transaction') return async (cb: (tx: any) => Promise<any>) => {
        const txDb = new Proxy({} as any, {
          get(_t2, prop2: string) { return db[prop2]; },
        });
        return cb(txDb);
      };
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
    async (_request: any, _options: any, handler: (userId: string) => Promise<any>) => handler('test-user-id')
  );

  return {
    db,
    schema,
    authFn,
    setQueryResult(r: any[]) { _queryResult = r; },
    setQueryQueue(queue: any[][]) { _queryQueue = queue; },
    setReturningResult(r: any[]) { _returningResult = r; },
    setRowCountResult(n: number) { _rowCountResult = n; },
    reset() {
      _queryResult = [];
      _queryQueue = [];
      _returningResult = [];
      _rowCountResult = 1;
    },
  };
});

vi.mock('@/infrastructure/db', () => ({ db: mocks.db, schema: mocks.schema }));
vi.mock('@/lib/auth', () => ({ withPermission: mocks.authFn }));

import { GET as ListMenus } from '@/app/api/menus/route';
import { GET as GetMenu } from '@/app/api/menus/[id]/route';
import { createTestRequest, parseResponseJson } from '../helpers/test-utils';

function makeMenuRow(overrides: Record<string, any> = {}) {
  return {
    id: 'menu-1',
    publicId: 'm_menu01',
    parentId: null,
    name: '系统管理',
    path: '/system',
    permissionCode: 'system:manage',
    icon: 'settings',
    component: null,
    visible: true,
    sort: 1,
    menuType: 'MENU',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('Menu API', () => {
  beforeEach(() => {
    mocks.reset();
    vi.clearAllMocks();
  });

  describe('GET /api/menus', () => {
    it('返回按 sort 排序的菜单树，含 permissionCode', async () => {
      mocks.setQueryResult([
        makeMenuRow({ id: 'm1', name: '系统管理', permissionCode: 'system:manage', sort: 1 }),
        makeMenuRow({ id: 'm2', publicId: 'm02', name: '用户管理', path: '/users', permissionCode: 'user:list', sort: 2, parentId: 'm1' }),
      ]);

      const body = await parseResponseJson(await ListMenus(createTestRequest('/api/menus')));
      // 树形结构：1 个根节点（m1），其 children 包含 m2
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({ name: '系统管理' });
      expect(body.data[0].children).toHaveLength(1);
      expect(body.data[0].children[0]).toMatchObject({ name: '用户管理', path: '/users' });
    });

    it('空列表返回空数组', async () => {
      mocks.setQueryResult([]);
      expect((await parseResponseJson(await ListMenus(createTestRequest('/api/menus')))).data).toEqual([]);
    });

    it('无权限返回 403', async () => {
      mocks.authFn.mockImplementationOnce(
        async () => new Response(JSON.stringify({ error: 'FORBIDDEN', message: '无权限' }), { status: 403 })
      );
      const res = await ListMenus(createTestRequest('/api/menus'));
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/menus/[id]', () => {
    it('返回菜单详情', async () => {
      mocks.setQueryResult([makeMenuRow()]);
      const body = await parseResponseJson(
        await GetMenu(createTestRequest('/api/menus/m1'), { params: Promise.resolve({ id: 'm1' }) } as any)
      );
      expect(body.data.name).toBe('系统管理');
    });

    it('支持 publicId 查找', async () => {
      mocks.setQueryResult([makeMenuRow()]);
      const body = await parseResponseJson(
        await GetMenu(createTestRequest('/api/menus/m_menu01'), { params: Promise.resolve({ id: 'm_menu01' }) } as any)
      );
      expect(body.data.name).toBe('系统管理');
    });

    it('不存在的菜单返回 404', async () => {
      mocks.setQueryResult([]);
      const res = await GetMenu(createTestRequest('/api/menus/nx'), { params: Promise.resolve({ id: 'nx' }) } as any);
      expect(res.status).toBe(404);
    });
  });
});
