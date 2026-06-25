/**
 * 数据范围（Data Scope）单元测试 — v3.2 重构
 *
 * 测试 getUserRoleDeptIds() 函数：
 * - 正常路径：从用户角色收集 dept_id，展开子树，返回去重数组
 * - 空角色：返回空数组
 * - 用户不存在：返回空数组
 * - 子树展开正确性
 *
 * @req H-DSCOPE-001~003
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted shared mock state ──────────────────────────────────────────────

const { mockDb } = vi.hoisted(() => {
  const createQueryMock = () => {
    let userResult: any = null;
    let deptRows: { id: string }[] = [];

    return {
      userResult,
      deptRows,
      setUserResult(r: any) { userResult = r; },
      setDeptRows(rows: { id: string }[]) { deptRows = rows; },
      db: {
        query: {
          users: {
            findFirst: vi.fn().mockImplementation(() => userResult),
          },
        },
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(deptRows),
          }),
        })),
      },
    };
  };

  return { mockDb: createQueryMock() };
});

vi.mock('@/infrastructure/db', () => ({
  db: mockDb.db,
  schema: {
    users: { id: 'users.id', deptId: 'users.dept_id' },
    departments: { id: 'departments.id', ancestors: 'departments.ancestors' },
  },
}));

import { getUserRoleDeptIds } from '@/lib/auth/data-scope';

describe('getUserRoleDeptIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.setUserResult(null);
    mockDb.setDeptRows([]);
  });

  it('用户不存在时返回空数组', async () => {
    const result = await getUserRoleDeptIds('nonexistent');
    expect(result).toEqual([]);
  });

  it('用户无角色时返回空数组', async () => {
    mockDb.setUserResult({ userRoles: [] });
    const result = await getUserRoleDeptIds('user-1');
    expect(result).toEqual([]);
  });

  it('用户角色无 deptId 时返回空数组', async () => {
    mockDb.setUserResult({
      userRoles: [
        { role: null },
        { role: { deptId: null, status: 'ACTIVE' } },
      ],
    });
    const result = await getUserRoleDeptIds('user-1');
    expect(result).toEqual([]);
  });

  it('单角色单部门 — 返回部门及其子部门', async () => {
    mockDb.setUserResult({
      userRoles: [
        { role: { deptId: 'dept-1', status: 'ACTIVE' } },
      ],
    });
    mockDb.setDeptRows([
      { id: 'dept-1' },
      { id: 'dept-1a' },
      { id: 'dept-1b' },
    ]);
    const result = await getUserRoleDeptIds('user-1');
    expect(result).toEqual(expect.arrayContaining(['dept-1', 'dept-1a', 'dept-1b']));
    expect(result.length).toBe(3);
  });

  it('多角色同部门 — 去重返回', async () => {
    mockDb.setUserResult({
      userRoles: [
        { role: { deptId: 'dept-1', status: 'ACTIVE' } },
        { role: { deptId: 'dept-1', status: 'ACTIVE' } },
      ],
    });
    mockDb.setDeptRows([
      { id: 'dept-1' },
      { id: 'dept-1a' },
    ]);
    const result = await getUserRoleDeptIds('user-1');
    // 子树查询只会调用一次（因为 dept-1 去重为 1 个 dept_id）
    expect(result.length).toBe(2);
  });

  it('多角色多部门 — 合并子树去重', async () => {
    mockDb.setUserResult({
      userRoles: [
        { role: { deptId: 'dept-1', status: 'ACTIVE' } },
        { role: { deptId: 'dept-2', status: 'ACTIVE' } },
      ],
    });

    // 第一次 select 调用返回 dept-1 的子树
    // 第二次 select 调用返回 dept-2 的子树
    let callCount = 0;
    const originalSelect = mockDb.db.select;
    originalSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve([{ id: 'dept-1' }, { id: 'dept-1a' }]);
          }
          return Promise.resolve([{ id: 'dept-2' }, { id: 'dept-2a' }, { id: 'dept-1a' }]);
        }),
      }),
    }));

    const result = await getUserRoleDeptIds('user-1');
    expect(result).toEqual(expect.arrayContaining(['dept-1', 'dept-1a', 'dept-2', 'dept-2a']));
    expect(result.length).toBe(4);
    expect(callCount).toBe(2);
  });
});
