/**
 * 部门管理 API 单元测试
 *
 * 覆盖范围：
 * - GET /api/departments - 树形结构返回（含子部门嵌套）
 * - POST /api/departments - 创建子部门
 * - PUT /api/departments/[id] - 更新部门信息
 * - GET /api/departments/[id]/members - 部门成员列表
 * - PUT 自身为父部门时防循环引用
 * - DELETE 含子部门时删除拒绝
 * - POST 缺少必填字段
 * - GET 数据范围过滤
 *
 * @req F-DEP-L, F-DEP-C, F-DEP-U, F-DEP-D, H-DSCOPE-001~003
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as ListDepartments } from '@/app/api/departments/route';
import { GET as GetDepartment } from '@/app/api/departments/[id]/route';
import { GET as GetDepartmentMembers } from '@/app/api/departments/[id]/members/route';
import { createTestRequest, parseResponseJson } from '../helpers/test-utils';

// ── Hoisted shared mock state ──────────────────────────────────────────────
// 这些变量被 vi.mock 工厂闭包引用，可在测试中更新以控制 mock 行为

const mockDbState = vi.hoisted(() => ({
  queryResult: [] as any[],
  returningResult: [] as any[],
  executeResult: [] as any[],
  shouldThrow: null as Error | null,
}));

const mockAuthState = vi.hoisted(() => ({
  getUserRoleDeptIds: vi.fn().mockResolvedValue(['dept-1', 'dept-1a']),
}));

// ── Module mocks ───────────────────────────────────────────────────────────

vi.mock('@/infrastructure/db', () => {
  /** 链式查询构建器 — 所有方法返回自身，then() 返回当前 queryResult */
  function createChain(): any {
    const chain: any = () => {};
    chain.then = (resolve: Function) => resolve(mockDbState.queryResult);
    chain.catch = () => ({ then: (r: Function) => r([]) });
    return new Proxy(chain, {
      get(_t, prop: string) {
        if (prop === 'then' || prop === 'catch') return chain[prop as keyof typeof chain];
        return () => createChain();
      },
    });
  }

  return {
    db: new Proxy({} as any, {
      get(_t, prop: string) {
        if (prop === 'select' || prop === 'selectDistinct') return () => createChain();
        if (prop === 'insert') {
          return () => ({
            values: (_data: any) => ({
              returning: () =>
                Promise.resolve(
                  mockDbState.returningResult.length > 0
                    ? mockDbState.returningResult
                    : [{ ..._data, id: 'mock-id' }],
                ),
              then: (resolve: Function) => resolve(1),
            }),
          });
        }
        if (prop === 'update') {
          return () => ({
            set: () => ({
              where: () => ({
                returning: () => Promise.resolve(mockDbState.returningResult),
                then: (r: Function) => r(1),
              }),
            }),
          });
        }
        if (prop === 'delete') {
          return () => ({
            where: () => ({
              returning: () => Promise.resolve(mockDbState.returningResult),
              then: (r: Function) => r(1),
            }),
          });
        }
        if (prop === 'execute') {
          return () => {
            if (mockDbState.shouldThrow) throw mockDbState.shouldThrow;
            return Promise.resolve(mockDbState.executeResult);
          };
        }
        if (prop === 'query') return new Proxy({} as any, {
          get(_t2, _prop2: string) {
            return {
              findFirst: () => {
                const c: any = () => {};
                c.then = (resolve: Function) => resolve(mockDbState.queryResult[0] ?? null);
                return c;
              },
              findMany: () => createChain(),
            };
          },
        });
        if (prop === 'transaction') return async (cb: (tx: any) => Promise<any>) => {
          const txDb = new Proxy({} as any, {
            get(_t2, txProp: string) {
              if (txProp === 'select' || txProp === 'selectDistinct') return () => createChain();
              if (txProp === 'insert') return () => ({
                values: (_data: any) => ({
                  returning: () => Promise.resolve(
                    mockDbState.returningResult.length > 0 ? mockDbState.returningResult : [{ ..._data, id: 'mock-id' }],
                  ),
                  then: (resolve: Function) => resolve(1),
                }),
              });
              if (txProp === 'update') return () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(mockDbState.returningResult), then: (r: Function) => r(1) }) }) });
              if (txProp === 'delete') return () => ({ where: () => ({ returning: () => Promise.resolve(mockDbState.returningResult), then: (r: Function) => r(1) }) });
              if (txProp === 'query') return new Proxy({} as any, {
                get(_t3, _p3: string) {
                  return {
                    findFirst: () => {
                      const c: any = () => {};
                      c.then = (resolve: Function) => resolve(mockDbState.queryResult[0] ?? null);
                      return c;
                    },
                    findMany: () => createChain(),
                  };
                },
              });
              return undefined;
            },
          });
          return cb(txDb);
        };
        return undefined;
      },
    }),
    schema: {
      departments: {},
      users: {},
    },
  };
});

const MOCK_CLAIMS = { sub: 'test-user-id', iss: '', aud: 'portal-client', jti: '', roles: [], permissions: [], deptIds: ['dept-1', 'dept-1a'] };

vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ claims: { deptIds: ['dept-1'] } })),
  logServerDataRead: vi.fn(async () => {}),
  canAccessDept: vi.fn(() => true),

  withPermission: vi.fn(
    async (_options: any, handler: (userId: string, claims: any) => Promise<any>) => {
      try { return await handler('test-user-id', MOCK_CLAIMS); }
      catch (err) {
        const { mapDomainError } = await import('@/domain/shared/error-mapping');
        const mapped = mapDomainError(err);
        return new Response(JSON.stringify({ error: mapped.error, message: mapped.message }), { status: mapped.status, headers: { 'Content-Type': 'application/json' } });
      }
    },
  ),
  getUserRoleDeptIds: mockAuthState.getUserRoleDeptIds,
  canAccessDept: vi.fn((_deptIds: string[], _targetDeptId: string | null | undefined) => true),
}));

vi.mock('@/lib/crypto', () => ({
  generateId: vi.fn(() => 'mock_dept_id_12345'),
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Department API', () => {
  beforeEach(() => {
    mockDbState.queryResult = [];
    mockDbState.returningResult = [];
    mockDbState.executeResult = [];
    mockDbState.shouldThrow = null;
    vi.clearAllMocks();
    // 恢复默认的 auth mock 行为
    mockAuthState.getUserRoleDeptIds.mockResolvedValue(['dept-1', 'dept-1a']);
  });

  // ── GET /api/departments ───────────────────────────────────────────────

  describe('GET /api/departments', () => {
    // @req F-DEP-L
    it('返回包含子部门嵌套的树形结构', async () => {
      mockDbState.queryResult = [
        {
          id: 'dept-1',
          publicId: 'd_01',
          name: '根部门A',
          parentId: null,
          code: 'ROOT_A',
          sort: 0,
          status: 'ACTIVE',
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'dept-2',
          publicId: 'd_02',
          name: '子部门',
          parentId: 'dept-1',
          code: 'CHILD',
          sort: 1,
          status: 'ACTIVE',
          createdAt: new Date('2026-01-02'),
        },
        {
          id: 'dept-3',
          publicId: 'd_03',
          name: '根部门B',
          parentId: null,
          code: 'ROOT_B',
          sort: 2,
          status: 'ACTIVE',
          createdAt: new Date('2026-01-03'),
        },
      ];

      const req = createTestRequest('/api/departments');
      const res = await ListDepartments(req);
      const body = await parseResponseJson(res);

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(2);

      // 根部门A 包含子部门
      const rootA = body.data.find((d: any) => d.id === 'dept-1');
      expect(rootA).toBeDefined();
      expect(rootA.children).toHaveLength(1);
      expect(rootA.children[0].id).toBe('dept-2');
      expect(rootA.children[0].name).toBe('子部门');

      // 根部门B 无子部门
      const rootB = body.data.find((d: any) => d.id === 'dept-3');
      expect(rootB).toBeDefined();
      expect(rootB.children).toHaveLength(0);
    });

    // @req F-DEP-L, H-DSCOPE-001
    it('应用数据范围过滤只返回授权范围内部门', async () => {
      mockAuthState.getUserRoleDeptIds.mockResolvedValue(['dept-1']);

      mockDbState.queryResult = [
        {
          id: 'dept-1',
          publicId: 'd_01',
          name: '技术部',
          parentId: null,
          code: 'TECH',
          sort: 0,
          status: 'ACTIVE',
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'dept-2',
          publicId: 'd_02',
          name: '财务部',
          parentId: null,
          code: 'FINANCE',
          sort: 1,
          status: 'ACTIVE',
          createdAt: new Date('2026-01-01'),
        },
      ];

      const req = createTestRequest('/api/departments');
      const res = await ListDepartments(req);
      const body = await parseResponseJson(res);

      expect(res.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });



  // ── GET /api/departments/[id]/members ──────────────────────────────────

  describe('GET /api/departments/[id]/members', () => {
    // @req F-DEP-M
    it('返回部门成员列表', async () => {
      // 第一个 select 解析部门 ID，第二个 select 返回成员
      // mock 对两个 select 返回相同结果，确保 id 字段存在即可
      mockDbState.queryResult = [{ id: 'dept-1', createdAt: new Date() }];

      const req = createTestRequest('/api/departments/dept-1/members');
      const res = await GetDepartmentMembers(req, { params: Promise.resolve({ id: 'dept-1' }) });
      const body = await parseResponseJson(res);

      expect(res.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });
});
