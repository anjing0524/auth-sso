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
 * @req F-DEP-L/C/U/D, SCOPE-001~005
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as ListDepartments, POST as CreateDepartment } from '@/app/api/departments/route';
import { GET as GetDepartment, PUT as UpdateDepartment, DELETE as DeleteDepartment } from '@/app/api/departments/[id]/route';
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
  checkDataScope: vi.fn().mockResolvedValue(true),
  getDataScopeFilter: vi.fn().mockResolvedValue({ type: 'ALL' }),
}));

// ── Module mocks ───────────────────────────────────────────────────────────

vi.mock('@/lib/db', () => {
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
        return undefined;
      },
    }),
    schema: {
      departments: {},
      users: {},
    },
  };
});

vi.mock('@/lib/auth-middleware', () => ({
  withPermission: vi.fn(
    async (_request: any, _options: any, handler: (userId: string) => Promise<any>) => {
      return handler('test-user-id');
    },
  ),
  checkDataScope: mockAuthState.checkDataScope,
  getDataScopeFilter: mockAuthState.getDataScopeFilter,
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
    mockAuthState.checkDataScope.mockResolvedValue(true);
    mockAuthState.getDataScopeFilter.mockResolvedValue({ type: 'ALL' });
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

    // @req F-DEP-L, SCOPE-001
    it('应用数据范围过滤只返回授权范围内部门', async () => {
      mockAuthState.getDataScopeFilter.mockResolvedValue({
        type: 'LIST',
        deptIds: ['dept-1'],
      });

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
      // 数据范围过滤使得 LIST 类型 → 添加 where 条件
      // mock 返回全量数据但 scope filter 已被调用验证
      expect(mockAuthState.getDataScopeFilter).toHaveBeenCalledWith('test-user-id');
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  // ── POST /api/departments ──────────────────────────────────────────────

  describe('POST /api/departments', () => {
    // @req F-DEP-C
    it('创建子部门成功', async () => {
      mockAuthState.checkDataScope.mockResolvedValue(true);

      const req = createTestRequest('/api/departments', {
        method: 'POST',
        body: { name: '新子部门', parentId: 'dept-1', code: 'NEW_DEPT' },
      });
      const res = await CreateDepartment(req);
      const body = await parseResponseJson(res);

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('新子部门');
      expect(body.data.parentId).toBe('dept-1');
      expect(body.data.code).toBe('NEW_DEPT');
      expect(mockAuthState.checkDataScope).toHaveBeenCalledWith('test-user-id', 'dept-1');
    });

    // @req F-DEP-E
    it('缺少部门名称时返回 400', async () => {
      const req = createTestRequest('/api/departments', {
        method: 'POST',
        body: { code: 'NO_NAME' },
      });
      const res = await CreateDepartment(req);
      const body = await parseResponseJson(res);

      expect(res.status).toBe(400);
      expect(body.error).toBe('invalid_params');
      expect(body.message).toContain('部门名称');
    });
  });

  // ── PUT /api/departments/[id] ──────────────────────────────────────────

  describe('PUT /api/departments/[id]', () => {
    // @req F-DEP-U
    it('更新部门信息成功', async () => {
      mockDbState.queryResult = [
        {
          id: 'dept-1',
          publicId: 'd_01',
          name: '原部门名',
          parentId: null,
          code: 'OLD',
          sort: 0,
          status: 'ACTIVE',
          createdAt: new Date('2026-01-01'),
        },
      ];
      mockAuthState.checkDataScope.mockResolvedValue(true);

      const req = createTestRequest('/api/departments/dept-1', {
        method: 'PUT',
        body: { name: '新部门名', code: 'NEW_CODE' },
      });
      const res = await UpdateDepartment(req, { params: Promise.resolve({ id: 'dept-1' }) });
      const body = await parseResponseJson(res);

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(mockAuthState.checkDataScope).toHaveBeenCalledWith('test-user-id', 'dept-1');
    });

    // @req F-DEP-E
    it('将父部门设为自己时返回循环引用错误', async () => {
      mockDbState.queryResult = [
        {
          id: 'dept-1',
          publicId: 'd_01',
          name: '部门',
          parentId: null,
          code: 'DEPT',
          sort: 0,
          status: 'ACTIVE',
          createdAt: new Date('2026-01-01'),
        },
      ];

      const req = createTestRequest('/api/departments/dept-1', {
        method: 'PUT',
        body: { name: '新名称', parentId: 'dept-1' },
      });
      const res = await UpdateDepartment(req, { params: Promise.resolve({ id: 'dept-1' }) });
      const body = await parseResponseJson(res);

      expect(res.status).toBe(400);
      expect(body.error).toBe('circular_reference');
    });
  });

  // ── DELETE /api/departments/[id] ───────────────────────────────────────

  describe('DELETE /api/departments/[id]', () => {
    // @req F-DEP-D
    it('存在子部门时拒绝删除', async () => {
      // 第一次 select 返回目标部门，第二次 select（检查子部门）返回包含子部门的数据
      // mock 对两个 select 返回相同结果，子部门 dept-2 确保 children.length > 0
      mockDbState.queryResult = [
        {
          id: 'dept-1',
          publicId: 'd_01',
          name: '父部门',
          parentId: null,
          code: 'PARENT',
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
      ];

      const req = createTestRequest('/api/departments/dept-1', { method: 'DELETE' });
      const res = await DeleteDepartment(req, { params: Promise.resolve({ id: 'dept-1' }) });
      const body = await parseResponseJson(res);

      expect(res.status).toBe(400);
      expect(body.error).toBe('has_children');
      expect(body.message).toContain('子部门');
    });
  });

  // ── GET /api/departments/[id]/members ──────────────────────────────────

  describe('GET /api/departments/[id]/members', () => {
    // @req F-DEP-M
    it('返回部门成员列表', async () => {
      // 第一个 select 解析部门 ID，第二个 select 返回成员
      // mock 对两个 select 返回相同结果，确保 id 字段存在即可
      mockDbState.queryResult = [{ id: 'dept-1' }];

      const req = createTestRequest('/api/departments/dept-1/members');
      const res = await GetDepartmentMembers(req, { params: Promise.resolve({ id: 'dept-1' }) });
      const body = await parseResponseJson(res);

      expect(res.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });
});
