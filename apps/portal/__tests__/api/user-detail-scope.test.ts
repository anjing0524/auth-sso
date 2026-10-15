/**
 * 用户详情读口的数据范围测试（真实 DB）
 *
 * 锁住一处**真实越权**：`getUser` 的 SQL 里没有任何范围条件（JSDoc 却声称
 * 「已内置底层越权校验（IDOR 防护）」），而 `(dashboard)/users/[id]/page.tsx`
 * 直接用它渲染详情——页面路径只要改 URL 里的 id 就能跨部门读任意用户。
 * REST 路径之所以没暴露，只是因为调用点自己补了 `resolveScope` + `isWithinScope`：
 * **同一读口，两种正确性**，缺陷源于 interface 允许了错误用法（ADR-014 的原话）。
 *
 * 本文件断言的是**数据范围**而非 HTTP 状态码，因此直接调用读模型
 * （与 `role-data-scope.test.ts` 同一形状）；末尾另有一组 REST 契约用例，
 * 锁住「范围外与不存在同形返回 404」——ADR-014 第 3 步记载的读路径语义。
 *
 * @req H-ACL-002, H-DSCOPE-001
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { createTestRequest } from '../helpers/test-utils';
import * as schema from '@/db/schema';

// ── 测试数据库 ──────────────────────────────────────
const { tdHolder } = vi.hoisted(() => ({ tdHolder: { current: null as any } }));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current.db; },
  schema,
}));

// 'use cache' 指令在测试运行时无缓存语义，仅需提供同名依赖
vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

// @allow-module-mock @/lib/auth auth-bypass: 本文件断言读口的数据范围，mock 仅用于构造「已登录/已授权」的请求上下文（依赖它的断言：user-detail-scope.test.ts 的 REST 契约用例）
vi.mock(import('@/lib/auth'), async (importOriginal): Promise<Partial<typeof authModule>> => {
  const actual = await importOriginal();
  return { ...actual,
    resolveIdentity: vi.fn(async () => ({ userId: OPERATOR_ID, expiresAt: null, issuedAt: null })),
    logServerDataRead: vi.fn(async () => {}),
    withPermission: vi.fn(async (_o: unknown, handler: Function) => handler(OPERATOR_ID)),
};
});

// ── 被测模块 ────────────────────────────────────────
import { db } from '@/infrastructure/db';
import { getUser, getUserRoles, getOwnUser, getDepartmentOptions } from '@/app/(dashboard)/users/data';
import { resolveScope } from '@/lib/authz';
import { GET as GetUser } from '@/app/api/users/[id]/route';
import type * as authModule from '@/lib/auth';

const td = createTestDbHandle();
tdHolder.current = td;

// ── 夹具：三个部门，其中 FE 与 MKT 是 ROOT 下互不从属的兄弟 ──
const ROOT_DEPT_ID = '00000000-0000-4000-8000-000000000001';
const FE_DEPT_ID = '00000000-0000-4000-8000-000000000003';
const MKT_DEPT_ID = '00000000-0000-4000-8000-000000000005';

const OPERATOR_ID = '00000000-0000-4000-8000-000000000101';
/** 操作者的角色在 FE 部门 → 其可见范围 = FE 子树，**不含** ROOT 与 MKT */
const OPERATOR_ROLE_ID = '00000000-0000-4000-8000-000000000302';

const FE_USER_ID = '00000000-0000-4000-8000-000000000201';
const MKT_USER_ID = '00000000-0000-4000-8000-000000000202';
const NO_DEPT_USER_ID = '00000000-0000-4000-8000-000000000203';
/** 自己的部门(MKT)不在自己范围(FE)内的用户 —— 用于证明自我读口不可由范围读口替代 */
const SELF_OUT_OF_SCOPE_USER_ID = '00000000-0000-4000-8000-000000000204';

const now = new Date();

function departments() {
    return [
    { id: ROOT_DEPT_ID, parentId: null, name: '总公司', code: 'ROOT', ancestors: null, sort: 0, status: 'ACTIVE' as const, createdAt: now, updatedAt: now },
    { id: FE_DEPT_ID, parentId: ROOT_DEPT_ID, name: '前端组', code: 'FE', ancestors: ROOT_DEPT_ID, sort: 0, status: 'ACTIVE' as const, createdAt: now, updatedAt: now },
    { id: MKT_DEPT_ID, parentId: ROOT_DEPT_ID, name: '市场部', code: 'MKT', ancestors: ROOT_DEPT_ID, sort: 1, status: 'ACTIVE' as const, createdAt: now, updatedAt: now },
    ];
}

function user(id: string, username: string, name: string, deptId: string | null) {
    return {
    id, username, email: `${username}@example.com`, emailVerified: true,
    mobile: null, mobileVerified: false, name,
    passwordHash: '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe',
    passwordHistory: null, avatarUrl: null, status: 'ACTIVE' as const, deptId,
    lastLoginAt: null, deletedAt: null, passwordChangedAt: null,
    createdAt: now, updatedAt: now,
  };
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, {
    departments: departments(),
    users: [
      user(OPERATOR_ID, 'operator', '操作者', MKT_DEPT_ID),
      user(FE_USER_ID, 'feuser', '前端用户', FE_DEPT_ID),
      user(MKT_USER_ID, 'mktuser', '市场用户', MKT_DEPT_ID),
      user(NO_DEPT_USER_ID, 'nodept', '无部门用户', null),
      user(SELF_OUT_OF_SCOPE_USER_ID, 'selfelsewhere', '跨部门自我', MKT_DEPT_ID),
    ],
    roles: [{ id: OPERATOR_ROLE_ID, name: '前端角色', code: 'FE_ROLE', deptId: FE_DEPT_ID }],
    userRoles: [
      { userId: OPERATOR_ID, roleId: OPERATOR_ROLE_ID, createdAt: now },
      // 该用户的角色在 FE，但本人挂在 MKT —— 自己的记录落在自己的范围之外
      { userId: SELF_OUT_OF_SCOPE_USER_ID, roleId: OPERATOR_ROLE_ID, createdAt: now },
    ],
  });
});

describe('getUser — 范围必须进入 SQL（H-ACL-002）', () => {
  it('范围内用户 → 返回详情（含部门名与角色）', async () => {
    const scope = await resolveScope(db, OPERATOR_ID);
    const detail = await getUser(FE_USER_ID, scope);

    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({ id: FE_USER_ID, username: 'feuser', deptName: '前端组' });
  });

  it('范围外用户 → null，且不泄漏该用户的任何字段', async () => {
    const scope = await resolveScope(db, OPERATOR_ID);
    const detail = await getUser(MKT_USER_ID, scope);

    // 不是"返回了数据再由调用方判断"，而是读口本身不可见
    expect(detail).toBeNull();
  });

  it('空范围 → null（fail-closed，不得退化为不过滤）', async () => {
    const detail = await getUser(FE_USER_ID, { deptIds: [] });
    expect(detail).toBeNull();
  });

  it('无部门用户 → null（与 isWithinScope「无法证明归属即拒绝」等价）', async () => {
    const scope = await resolveScope(db, OPERATOR_ID);
    const detail = await getUser(NO_DEPT_USER_ID, scope);
    expect(detail).toBeNull();
  });

  it('不存在的用户与范围外用户同形（不可用状态码探测存在性）', async () => {
    const scope = await resolveScope(db, OPERATOR_ID);
    const missing = await getUser('00000000-0000-4000-8000-000000000999', scope);
    const outOfScope = await getUser(MKT_USER_ID, scope);

    expect(missing).toBeNull();
    expect(outOfScope).toBeNull();
  });
});

describe('getUserRoles — 同一读口家族，同一范围约束', () => {
  it('范围外用户 → null（不可见，与「可见但无角色」可判别）', async () => {
    const scope = await resolveScope(db, OPERATOR_ID);
    expect(await getUserRoles(MKT_USER_ID, scope)).toBeNull();
  });

  it('范围内但无角色 → 空数组（不与「不可见」混淆）', async () => {
    const scope = await resolveScope(db, OPERATOR_ID);
    expect(await getUserRoles(FE_USER_ID, scope)).toEqual([]);
  });

  it('不存在的用户 → null（与范围外同形）', async () => {
    const scope = await resolveScope(db, OPERATOR_ID);
    expect(await getUserRoles('00000000-0000-4000-8000-000000000999', scope)).toBeNull();
  });
});

describe('getDepartmentOptions — 同类问题：下拉不得泄漏范围外部门', () => {
  it('只返回范围内部门（范围外部门的名称与 ID 都不可见）', async () => {
    const scope = await resolveScope(db, OPERATOR_ID);
    const options = await getDepartmentOptions(scope);

    expect(options.map(o => o.id)).toEqual([FE_DEPT_ID]);
  });

  it('空范围 → 空列表', async () => {
    expect(await getDepartmentOptions({ deptIds: [] })).toEqual([]);
  });
});

describe('getOwnUser — 身份绑定的自我读口，不受范围约束', () => {
  it('自己的部门不在自己范围内时，仍能读到自己的记录', async () => {
    const scope = await resolveScope(db, SELF_OUT_OF_SCOPE_USER_ID);
    // 前置：该用户的范围确实不含自己的部门（否则本用例退化为重复覆盖）
    expect(scope.deptIds).not.toContain(MKT_DEPT_ID);

    // 范围读口读不到自己 —— 这正是不能让 /api/me、/profile 走范围读口的原因
    expect(await getUser(SELF_OUT_OF_SCOPE_USER_ID, scope)).toBeNull();
    // 身份读口读得到
    const own = await getOwnUser(SELF_OUT_OF_SCOPE_USER_ID);
    expect(own).toMatchObject({ id: SELF_OUT_OF_SCOPE_USER_ID, username: 'selfelsewhere' });
  });
});

describe('GET /api/users/[id] — 读路径范围外与不存在同形返回 404', () => {
  it('范围内用户 → 200', async () => {
    const response = await GetUser(createTestRequest('/api/users/x'), {
      params: Promise.resolve({ id: FE_USER_ID }),
    });
    expect(response.status).toBe(200);
  });

  it('范围外用户 → 404（不是 403：不泄漏该用户是否存在）', async () => {
    const response = await GetUser(createTestRequest('/api/users/x'), {
      params: Promise.resolve({ id: MKT_USER_ID }),
    });
    expect(response.status).toBe(404);
  });
});
