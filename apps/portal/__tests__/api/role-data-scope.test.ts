/**
 * 角色读模型数据范围测试（真实 DB）
 *
 * 锁住一处 fail-open：`getRoles` 的部门范围过滤曾经是**可选**参数，
 * 省略即不追加任何 WHERE 条件 → 返回全部部门的角色。与
 * `db/user-queries.ts` 的 `sql\`FALSE\`` fail-closed 语义直接矛盾。
 *
 * 本文件断言的是**数据范围**而非 HTTP 状态码，因此直接调用读模型，
 * 不经过 route.ts（那里永远传了 deptIds，所以路由级测试无法暴露该缺陷）。
 *
 * @req H-ACL-002, H-DSCOPE-001
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import * as schema from '@/db/schema';

// ── 测试数据库 ──────────────────────────────────────
const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));

// 'use cache' 指令在测试运行时无缓存语义，仅需提供同名依赖
vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

// ── 被测模块 ────────────────────────────────────────
import { getRoles } from '@/app/(dashboard)/roles/data';

const ROOT_DEPT_ID = '00000000-0000-4000-8000-000000000001';
const FE_DEPT_ID = '00000000-0000-4000-8000-000000000003';
const MKT_DEPT_ID = '00000000-0000-4000-8000-000000000005';
const ROOT_ROLE_ID = '00000000-0000-4000-8000-000000000301';
const FE_ROLE_ID = '00000000-0000-4000-8000-000000000302';
const MKT_ROLE_ID = '00000000-0000-4000-8000-000000000303';

const BASE = { page: 1, pageSize: 20, keyword: '', status: '' } as const;

/** 两个互不从属的部门 —— 用于证明范围过滤真的按部门生效 */
function roleScopeDepartments() {
  const now = new Date();
  return [
    {
      id: ROOT_DEPT_ID, parentId: null, name: '总公司', code: 'ROOT',
      ancestors: null, sort: 0, status: 'ACTIVE' as const, createdAt: now, updatedAt: now,
    },
    {
      id: FE_DEPT_ID, parentId: ROOT_DEPT_ID, name: '前端组', code: 'FE',
      ancestors: ROOT_DEPT_ID, sort: 0, status: 'ACTIVE' as const, createdAt: now, updatedAt: now,
    },
    {
      id: MKT_DEPT_ID, parentId: ROOT_DEPT_ID, name: '市场部', code: 'MKT',
      ancestors: ROOT_DEPT_ID, sort: 1, status: 'ACTIVE' as const, createdAt: now, updatedAt: now,
    },
  ];
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, { departments: roleScopeDepartments() });
  // 三个部门各一个角色 —— 跨部门数据在库中真实存在
  await td.db.insert(schema.roles).values([
    { id: ROOT_ROLE_ID, name: '根角色', code: 'ROOT_ROLE', deptId: ROOT_DEPT_ID },
    { id: FE_ROLE_ID, name: '前端角色', code: 'FE_ROLE', deptId: FE_DEPT_ID },
    { id: MKT_ROLE_ID, name: '市场角色', code: 'MKT_ROLE', deptId: MKT_DEPT_ID },
  ]);
});

describe('getRoles — 数据范围 fail-closed', () => {
  it('空范围（无可见部门）→ 返回空集，而非全表', async () => {
    const result = await getRoles({ ...BASE, deptIds: [] });
    expect(result.data).toEqual([]);
    expect(result.pagination.total).toBe(0);
  });

  it('范围只含一个部门 → 只返回该部门的角色（不泄漏其他部门）', async () => {
    const result = await getRoles({ ...BASE, deptIds: [FE_DEPT_ID] });
    expect(result.data.map((r) => r.id)).toEqual([FE_ROLE_ID]);
  });

  it('范围含两个部门 → 返回两个部门角色并集，且不含范围外角色', async () => {
    const result = await getRoles({ ...BASE, deptIds: [ROOT_DEPT_ID, MKT_DEPT_ID] });
    const ids = result.data.map((r) => r.id).sort();
    expect(ids).toEqual([ROOT_ROLE_ID, MKT_ROLE_ID].sort());
    expect(ids).not.toContain(FE_ROLE_ID);
  });

  it('范围外的关键字仍不得越界（关键字不能放大范围）', async () => {
    const result = await getRoles({ ...BASE, keyword: '前端', deptIds: [MKT_DEPT_ID] });
    expect(result.data).toEqual([]);
  });
});
