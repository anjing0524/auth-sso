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

vi.mock('@/lib/db', () => ({ db: mocks.db, schema: mocks.schema }));
vi.mock('@/lib/auth-middleware', () => ({ withPermission: mocks.authFn }));

import { GET as ListMenus, POST as CreateMenu } from '@/app/api/menus/route';
import { GET as GetMenu, PATCH as UpdateMenu, DELETE as DeleteMenu } from '@/app/api/menus/[id]/route';
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
    it('返回按 sort 排序的菜单列表，含 permissionCode', async () => {
      mocks.setQueryResult([
        makeMenuRow({ id: 'm1', name: '系统管理', permissionCode: 'system:manage', sort: 1 }),
        makeMenuRow({ id: 'm2', publicId: 'm02', name: '用户管理', path: '/users', permissionCode: 'user:list', sort: 2, parentId: 'm1' }),
      ]);

      const body = await parseResponseJson(await ListMenus(createTestRequest('/api/menus')));
      expect(body.data).toHaveLength(2);
      body.data.forEach((m: any) => {
        if (m.path) expect(m.permissionCode).toBeDefined();
      });
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

  describe('POST /api/menus', () => {
    it('成功创建菜单节点', async () => {
      const body = await parseResponseJson(
        await CreateMenu(createTestRequest('/api/menus', {
          method: 'POST',
          body: { name: '用户列表', path: '/users', permissionCode: 'user:list', parentId: 'm1', sort: 10 },
        }))
      );
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('用户列表');
    });

    it('缺少 name 返回 400', async () => {
      const res = await CreateMenu(createTestRequest('/api/menus', { method: 'POST', body: { path: '/test' } }));
      expect(res.status).toBe(400);
      expect((await parseResponseJson(res)).message).toContain('菜单名称');
    });

    it('创建目录类型菜单', async () => {
      const body = await parseResponseJson(
        await CreateMenu(createTestRequest('/api/menus', { method: 'POST', body: { name: '系统设置', menuType: 'DIRECTORY', sort: 0 } }))
      );
      expect(body.success).toBe(true);
    });

    it('创建按钮类型菜单', async () => {
      const body = await parseResponseJson(
        await CreateMenu(createTestRequest('/api/menus', { method: 'POST', body: { name: '新增按钮', permissionCode: 'user:create', menuType: 'BUTTON' } }))
      );
      expect(body.success).toBe(true);
    });
  });

  describe('PATCH /api/menus/[id]', () => {
    it('更新菜单名称和路径', async () => {
      mocks.setQueryResult([{ id: 'm1' }]);
      mocks.setRowCountResult(1);
      const body = await parseResponseJson(
        await UpdateMenu(
          createTestRequest('/api/menus/m1', { method: 'PATCH', body: { name: '更新后', path: '/new' } }),
          { params: Promise.resolve({ id: 'm1' }) } as any,
        )
      );
      expect(body.success).toBe(true);
    });

    it('更新权限绑定和可见性', async () => {
      mocks.setQueryResult([{ id: 'm1' }]);
      mocks.setRowCountResult(1);
      const body = await parseResponseJson(
        await UpdateMenu(
          createTestRequest('/api/menus/m1', { method: 'PATCH', body: { permissionCode: 'user:update', visible: false } }),
          { params: Promise.resolve({ id: 'm1' }) } as any,
        )
      );
      expect(body.success).toBe(true);
    });

    it('更新 menuType 和 status', async () => {
      mocks.setQueryResult([{ id: 'm1' }]);
      mocks.setRowCountResult(1);
      const body = await parseResponseJson(
        await UpdateMenu(
          createTestRequest('/api/menus/m1', { method: 'PATCH', body: { menuType: 'BUTTON', status: 'DISABLED' } }),
          { params: Promise.resolve({ id: 'm1' }) } as any,
        )
      );
      expect(body.success).toBe(true);
    });

    it('支持 publicId 更新', async () => {
      mocks.setQueryResult([{ id: 'm1' }]);
      mocks.setRowCountResult(1);
      const body = await parseResponseJson(
        await UpdateMenu(
          createTestRequest('/api/menus/m_menu01', { method: 'PATCH', body: { name: '公共ID更新' } }),
          { params: Promise.resolve({ id: 'm_menu01' }) } as any,
        )
      );
      expect(body.success).toBe(true);
    });
  });

  describe('DELETE /api/menus/[id]', () => {
    it('递归删除菜单及其子项', async () => {
      // 使用 queryQueue 模拟逐步耗尽的查询：
      //   query1: 根菜单查找，返回 [{ id: 'm1' }]
      //   query2: 子菜单查找，返回 [{ id: 'm2' }]
      //   query3: 子菜单的子菜单，返回 []（无更深层子菜单）
      mocks.setQueryQueue([
        [{ id: 'm1' }],
        [{ id: 'm2' }],
        [],
      ]);

      const body = await parseResponseJson(
        await DeleteMenu(
          createTestRequest('/api/menus/m1', { method: 'DELETE' }),
          { params: Promise.resolve({ id: 'm1' }) } as any,
        )
      );
      expect(body.success).toBe(true);
      expect(body.message).toContain('递归删除');
    });

    it('不存在的菜单返回 404', async () => {
      mocks.setQueryResult([]);
      const res = await DeleteMenu(
        createTestRequest('/api/menus/nx', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'nx' }) } as any,
      );
      expect(res.status).toBe(404);
    });

    it('支持 publicId 删除', async () => {
      mocks.setQueryQueue([
        [{ id: 'm1' }],
        [],
      ]);
      await DeleteMenu(
        createTestRequest('/api/menus/m_menu01', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'm_menu01' }) } as any,
      );
      // No exception = pass
    });
  });
});
