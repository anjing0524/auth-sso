/**
 * 数据范围（Data Scope）单元测试
 *
 * 覆盖 `auth-middleware.ts` 中全部 5 种数据范围类型的过滤与校验逻辑：
 * - ALL           - 无限制
 * - DEPT          - 仅本部门
 * - SELF          - 仅本人
 * - DEPT_AND_SUB  - 本部门及所有子部门（递归 CTE）
 * - CUSTOM        - 自定义部门列表
 *
 * 直接测试 checkDataScope() 和 getDataScopeFilter() 两个公开函数，
 * 通过 mock 依赖（getUserPermissionContext、db）隔离外部影响。
 *
 * @req SCOPE-001~005
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted shared mock state ──────────────────────────────────────────────

const mockDbState = vi.hoisted(() => ({
  queryResult: [] as any[],
  executeResult: [] as { id: string }[],
  shouldThrow: null as Error | null,
}));

const mockDataScope = vi.hoisted(() => ({
  /** 当前权限上下文，每个测试可以修改其引用属性来模拟不同场景 */
  permissionContext: {
    roles: [{ id: 'role-1', code: 'TEST', name: '测试人员' }],
    permissions: ['department:list'],
    dataScopeType: 'ALL' as string,
    deptId: undefined as string | undefined,
  },
}));

// ── Module mocks ───────────────────────────────────────────────────────────

vi.mock('@/lib/permissions', () => ({
  getUserPermissionContext: vi.fn(() => mockDataScope.permissionContext),
}));

vi.mock('@/lib/db', () => {
  /** 链式查询构建器 */
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
      roleDataScopes: {},
    },
  };
});

// 导入被测试的真实函数（保持 mock 之后导入以确保模块解析正确）
import { checkDataScope, getDataScopeFilter } from '@/lib/auth-middleware';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('getDataScopeFilter', () => {
  beforeEach(() => {
    mockDbState.queryResult = [];
    mockDbState.executeResult = [];
    mockDbState.shouldThrow = null;
    vi.clearAllMocks();

    // 恢复默认权限上下文（ALL 类型）
    mockDataScope.permissionContext.dataScopeType = 'ALL';
    mockDataScope.permissionContext.deptId = undefined;
  });

  // @req SCOPE-001
  it('ALL 类型返回 { type: "ALL" } 且不限制', async () => {
    const result = await getDataScopeFilter('user-1');
    expect(result).toEqual({ type: 'ALL' });
  });

  // @req SCOPE-002
  it('DEPT 类型返回当前部门 ID 列表', async () => {
    mockDataScope.permissionContext.dataScopeType = 'DEPT';
    mockDataScope.permissionContext.deptId = 'dept-1';

    const result = await getDataScopeFilter('user-1');
    expect(result).toEqual({ type: 'LIST', deptIds: ['dept-1'] });
  });

  // @req SCOPE-003
  it('SELF 类型返回 { type: "SELF" }', async () => {
    mockDataScope.permissionContext.dataScopeType = 'SELF';
    mockDataScope.permissionContext.deptId = 'dept-1';

    const result = await getDataScopeFilter('user-1');
    expect(result).toEqual({ type: 'SELF' });
  });

  // @req SCOPE-004
  it('DEPT_AND_SUB 通过递归 CTE 查询子部门 ID 列表', async () => {
    mockDataScope.permissionContext.dataScopeType = 'DEPT_AND_SUB';
    mockDataScope.permissionContext.deptId = 'dept-1';
    mockDbState.executeResult = [{ id: 'dept-1' }, { id: 'dept-2' }, { id: 'dept-3' }];

    const result = await getDataScopeFilter('user-1');
    expect(result).toEqual({ type: 'LIST', deptIds: ['dept-1', 'dept-2', 'dept-3'] });
  });

  // @req SCOPE-004
  it('DEPT_AND_SUB 在 db.execute 查询失败时故障安全降级为仅当前部门', async () => {
    mockDataScope.permissionContext.dataScopeType = 'DEPT_AND_SUB';
    mockDataScope.permissionContext.deptId = 'dept-1';
    mockDbState.shouldThrow = new Error('DB connection timeout');

    const result = await getDataScopeFilter('user-1');
    // 故障安全（fail-safe）：查询异常 → 仅返回本部门，不泄露范围外数据
    expect(result).toEqual({ type: 'LIST', deptIds: ['dept-1'] });
  });

  // @req SCOPE-005
  it('CUSTOM 类型从 role_data_scopes 表查询去重部门 ID', async () => {
    mockDataScope.permissionContext.dataScopeType = 'CUSTOM';
    mockDataScope.permissionContext.deptId = 'dept-1';
    mockDataScope.permissionContext.roles = [
      { id: 'role-a', code: 'ROLE_A', name: '角色A' },
      { id: 'role-b', code: 'ROLE_B', name: '角色B' },
    ];
    mockDbState.queryResult = [{ deptId: 'dept-3' }, { deptId: 'dept-4' }];

    const result = await getDataScopeFilter('user-1');
    expect(result).toEqual({ type: 'LIST', deptIds: ['dept-3', 'dept-4'] });
  });

  it('CUSTOM 类型在无角色时返回空列表', async () => {
    mockDataScope.permissionContext.dataScopeType = 'CUSTOM';
    mockDataScope.permissionContext.deptId = 'dept-1';
    mockDataScope.permissionContext.roles = [];

    const result = await getDataScopeFilter('user-1');
    expect(result).toEqual({ type: 'LIST', deptIds: [] });
  });

  it('权限上下文为 null 时返回空列表', async () => {
    const { getUserPermissionContext } = await import('@/lib/permissions');
    (getUserPermissionContext as any).mockReturnValueOnce(null);

    const result = await getDataScopeFilter('user-1');
    expect(result).toEqual({ type: 'LIST', deptIds: [] });
  });
});

describe('checkDataScope', () => {
  beforeEach(() => {
    mockDbState.executeResult = [];
    mockDbState.shouldThrow = null;
    vi.clearAllMocks();

    mockDataScope.permissionContext.dataScopeType = 'ALL';
    mockDataScope.permissionContext.deptId = undefined;
  });

  // @req SCOPE-001
  it('ALL 类型始终通过数据范围检查', async () => {
    mockDataScope.permissionContext.dataScopeType = 'ALL';

    // 无论目标部门是什么，都应通过
    expect(await checkDataScope('user-1', 'dept-999')).toBe(true);
    expect(await checkDataScope('user-1', 'any-dept')).toBe(true);
  });

  // @req SCOPE-002
  it('DEPT 类型通过同部门检查，拒绝跨部门', async () => {
    mockDataScope.permissionContext.dataScopeType = 'DEPT';
    mockDataScope.permissionContext.deptId = 'dept-1';

    // 同部门通过
    expect(await checkDataScope('user-1', 'dept-1')).toBe(true);
    // 不同部门拒绝
    expect(await checkDataScope('user-1', 'dept-2')).toBe(false);
  });

  // @req SCOPE-003
  it('SELF 类型通过同部门检查，拒绝跨部门', async () => {
    mockDataScope.permissionContext.dataScopeType = 'SELF';
    mockDataScope.permissionContext.deptId = 'dept-1';

    // 同部门通过
    expect(await checkDataScope('user-1', 'dept-1')).toBe(true);
    // 不同部门拒绝
    expect(await checkDataScope('user-1', 'dept-2')).toBe(false);
  });

  // @req SCOPE-004
  it('DEPT_AND_SUB 通过同部门和子部门检查', async () => {
    mockDataScope.permissionContext.dataScopeType = 'DEPT_AND_SUB';
    mockDataScope.permissionContext.deptId = 'dept-1';

    // 同部门通过（不涉及 db.execute，直接比对）
    expect(await checkDataScope('user-1', 'dept-1')).toBe(true);

    // 子部门通过（需 db.execute 返回子部门记录）
    mockDbState.executeResult = [{ id: 'dept-2' }];
    expect(await checkDataScope('user-1', 'dept-2')).toBe(true);

    // 非子部门拒绝（execute 返回空）
    mockDbState.executeResult = [];
    expect(await checkDataScope('user-1', 'dept-999')).toBe(false);
  });

  // @req SCOPE-004
  it('DEPT_AND_SUB 在 db.execute 异常时通过严格部门和失败安全降级', async () => {
    mockDataScope.permissionContext.dataScopeType = 'DEPT_AND_SUB';
    mockDataScope.permissionContext.deptId = 'dept-1';

    // 同部门: 直接比对通过，无需查询
    expect(await checkDataScope('user-1', 'dept-1')).toBe(true);

    // 非同部门 + 查询异常 → 降级为严格部门比对
    mockDbState.shouldThrow = new Error('DB error');
    // 此时 target dept-2 !== dept-1，且查询抛出异常 → 返回 context.deptId === targetDeptId = false
    expect(await checkDataScope('user-1', 'dept-2')).toBe(false);
  });

  // @req SCOPE-005
  it('CUSTOM 类型在 role_data_scopes 中有记录时通过', async () => {
    mockDataScope.permissionContext.dataScopeType = 'CUSTOM';
    mockDataScope.permissionContext.deptId = 'dept-1';
    mockDataScope.permissionContext.roles = [
      { id: 'role-a', code: 'ROLE_A', name: '角色A' },
    ];

    // roleDataScopes 查询返回记录 → 通过
    mockDbState.queryResult = [{ roleId: 'role-a', deptId: 'dept-3' }];
    expect(await checkDataScope('user-1', 'dept-3')).toBe(true);

    // 无记录 → 拒绝
    mockDbState.queryResult = [];
    expect(await checkDataScope('user-1', 'dept-4')).toBe(false);
  });

  it('未知的 dataScopeType 时返回 false', async () => {
    mockDataScope.permissionContext.dataScopeType = 'INVALID_TYPE';

    const result = await checkDataScope('user-1', 'dept-1');
    expect(result).toBe(false);
  });

  it('权限上下文为 null 时返回 false', async () => {
    const { getUserPermissionContext } = await import('@/lib/permissions');
    (getUserPermissionContext as any).mockReturnValueOnce(null);

    const result = await checkDataScope('user-1', 'dept-1');
    expect(result).toBe(false);
  });
});
