/**
 * 数据范围（Data Scope）集成测试 — 真实 DB、经门面
 *
 * 覆盖 `@/lib/authz` 的读路径原语：
 * - `resolveScope(executor, userId)` 从真实 DB 计算角色部门 + 子树展开
 * - `isWithinScope(scope, targetDeptId)` 用真实快照验证纯判定
 *
 * 种子数据链路：departments → users → roles → userRoles
 *   resolveScope(td.db, userId) → users → userRoles → roles.dept_id → 子树展开
 *
 * 部门树（三级，`ancestors` 为完整祖先链）：
 *   ROOT(ancestors=null) ├── TECH(ancestors=ROOT) ├── FE(ancestors=ROOT/TECH)
 *                        │                        └── BE(ancestors=ROOT/TECH)
 *                        └── MKT(ancestors=ROOT)
 *
 * **2026-10-13 修正**：本文件此前把"非根角色的深度 ≥ 2 后代被漏掉"写成了期望
 * （`ADMIN → {TECH}`、`MULTI_ROLE → {TECH, MKT}`），而 FE/BE 明明是 TECH 的子部门。
 * 根因是子树谓词少了两条分支（`ancestors` 是**完整祖先链**，`FE` 的是 `ROOT/TECH`，
 * 既不等于 `TECH` 也不以 `TECH/` 开头）。已修复并更正期望——决策见 ADR-014。
 *
 * @req H-DSCOPE-001~003, H-ACL-002
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

// ── 被测门面 ───────────────────────────────────────
import { resolveScope, isWithinScope } from '@/lib/authz';

// ── 常量 ID ────────────────────────────────────────
const ROOT_DEPT_ID = '00000000-0000-4000-8000-000000000001';
const TECH_DEPT_ID = '00000000-0000-4000-8000-000000000002';
const FE_DEPT_ID = '00000000-0000-4000-8000-000000000003';
const BE_DEPT_ID = '00000000-0000-4000-8000-000000000004';
const MKT_DEPT_ID = '00000000-0000-4000-8000-000000000005';
const ADMIN_USER_ID = '00000000-0000-4000-8000-000000000101';
const TECH_USER_ID = '00000000-0000-4000-8000-000000000201';
const NO_ROLE_USER_ID = '00000000-0000-4000-8000-000000000301';
const MULTI_ROLE_USER_ID = '00000000-0000-4000-8000-000000000401';
const TECH_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000501';
const FE_LEAD_ROLE_ID = '00000000-0000-4000-8000-000000000502';
const MKT_ROLE_ID = '00000000-0000-4000-8000-000000000503';
const INACTIVE_ROLE_ID = '00000000-0000-4000-8000-000000000504';

const now = new Date();

// ── 生命周期 ───────────────────────────────────────
beforeAll(async () => {
  await td.connect();
});
afterAll(async () => {
  await td.close();
});
beforeEach(async () => {
  vi.clearAllMocks();
  await td.cleanup();
});

// ── 种子工具 ───────────────────────────────────────
async function seedDataScopeFixture() {
  await seedTestData(td.db, {
    departments: [
      {
        id: ROOT_DEPT_ID,
        parentId: null,
        name: '总公司',
        code: 'ROOT',
        ancestors: null,
        sort: 0,
        status: 'ACTIVE' as const,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: TECH_DEPT_ID,
        parentId: ROOT_DEPT_ID,
        name: '技术部',
        code: 'TECH',
        ancestors: ROOT_DEPT_ID,
        sort: 1,
        status: 'ACTIVE' as const,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: FE_DEPT_ID,
        parentId: TECH_DEPT_ID,
        name: '前端组',
        code: 'FE',
        ancestors: `${ROOT_DEPT_ID}/${TECH_DEPT_ID}`,
        sort: 0,
        status: 'ACTIVE' as const,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: BE_DEPT_ID,
        parentId: TECH_DEPT_ID,
        name: '后端组',
        code: 'BE',
        ancestors: `${ROOT_DEPT_ID}/${TECH_DEPT_ID}`,
        sort: 1,
        status: 'ACTIVE' as const,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: MKT_DEPT_ID,
        parentId: ROOT_DEPT_ID,
        name: '市场部',
        code: 'MKT',
        ancestors: ROOT_DEPT_ID,
        sort: 2,
        status: 'ACTIVE' as const,
        createdAt: now,
        updatedAt: now,
      },
    ],
    users: [
      {
        id: ADMIN_USER_ID,
        username: 'admin',
        email: 'admin@test.com',
        emailVerified: true,
        mobile: null,
        mobileVerified: false,
        name: 'Admin',
        passwordHash: 'hash',
        passwordHistory: null,
        avatarUrl: null,
        status: 'ACTIVE' as const,
        deptId: ROOT_DEPT_ID,
        lastLoginAt: null,
        deletedAt: null,
        passwordChangedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: TECH_USER_ID,
        username: 'techuser',
        email: 'tech@test.com',
        emailVerified: true,
        mobile: null,
        mobileVerified: false,
        name: 'Tech User',
        passwordHash: 'hash',
        passwordHistory: null,
        avatarUrl: null,
        status: 'ACTIVE' as const,
        deptId: TECH_DEPT_ID,
        lastLoginAt: null,
        deletedAt: null,
        passwordChangedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: NO_ROLE_USER_ID,
        username: 'norole',
        email: 'norole@test.com',
        emailVerified: true,
        mobile: null,
        mobileVerified: false,
        name: 'No Role User',
        passwordHash: 'hash',
        passwordHistory: null,
        avatarUrl: null,
        status: 'ACTIVE' as const,
        deptId: ROOT_DEPT_ID,
        lastLoginAt: null,
        deletedAt: null,
        passwordChangedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: MULTI_ROLE_USER_ID,
        username: 'multirole',
        email: 'multi@test.com',
        emailVerified: true,
        mobile: null,
        mobileVerified: false,
        name: 'Multi Role User',
        passwordHash: 'hash',
        passwordHistory: null,
        avatarUrl: null,
        status: 'ACTIVE' as const,
        deptId: TECH_DEPT_ID,
        lastLoginAt: null,
        deletedAt: null,
        passwordChangedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    roles: [
      {
        id: TECH_ADMIN_ROLE_ID,
        name: '技术管理员',
        code: 'TECH_ADMIN',
        description: '技术部管理员',
        deptId: TECH_DEPT_ID,
        isSystem: false,
        status: 'ACTIVE' as const,
        sort: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: FE_LEAD_ROLE_ID,
        name: '前端组长',
        code: 'FE_LEAD',
        description: '前端组负责人',
        deptId: FE_DEPT_ID,
        isSystem: false,
        status: 'ACTIVE' as const,
        sort: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: MKT_ROLE_ID,
        name: '市场专员',
        code: 'MKT_SPEC',
        description: '市场部专员',
        deptId: MKT_DEPT_ID,
        isSystem: false,
        status: 'ACTIVE' as const,
        sort: 2,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: INACTIVE_ROLE_ID,
        name: '已禁用角色',
        code: 'INACTIVE',
        description: '状态为 DISABLED',
        deptId: ROOT_DEPT_ID,
        isSystem: false,
        status: 'DISABLED' as const,
        sort: 3,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });

  // user_roles 绑定
  await td.db.insert(schema.userRoles).values([
    { userId: ADMIN_USER_ID, roleId: TECH_ADMIN_ROLE_ID, createdAt: now },
    { userId: TECH_USER_ID, roleId: FE_LEAD_ROLE_ID, createdAt: now },
    { userId: MULTI_ROLE_USER_ID, roleId: TECH_ADMIN_ROLE_ID, createdAt: now },
    { userId: MULTI_ROLE_USER_ID, roleId: MKT_ROLE_ID, createdAt: now },
  ]);
}

// ========================================================================
// Tests
// ========================================================================

describe('resolveScope — 有效部门范围（真实 DB）', () => {
  it('用户不存在时为空范围', async () => {
    await seedDataScopeFixture();
    // 使用合法 UUID 格式的不存在用户 ID
    const scope = await resolveScope(td.db, '00000000-0000-4000-8000-000000000999');
    expect(scope.deptIds).toEqual([]);
  });

  it('用户无角色时为空范围', async () => {
    await seedDataScopeFixture();
    const scope = await resolveScope(td.db, NO_ROLE_USER_ID);
    expect(scope.deptIds).toEqual([]);
  });

  it('单角色 + 叶子部门 — 只有该部门自身', async () => {
    await seedDataScopeFixture();
    // TECH_USER_ID → FE_LEAD_ROLE → deptId = FE_DEPT_ID（FE 无子部门）
    const scope = await resolveScope(td.db, TECH_USER_ID);
    expect(new Set(scope.deptIds)).toEqual(new Set([FE_DEPT_ID]));
  });

  it('**非根角色覆盖全部后代**：TECH 角色 → TECH + FE + BE', async () => {
    await seedDataScopeFixture();
    // ADMIN_USER_ID → TECH_ADMIN_ROLE → deptId = TECH_DEPT_ID
    // FE/BE 是 TECH 的子部门，其 ancestors 为 `ROOT/TECH` ⇒ 谓词必须逐段判定才命中。
    // 【本用例此前写反】：它断言 `{TECH}` 且把 FE/BE 当作"不在管辖范围"，即把
    // "深度 ≥ 2 的后代被漏掉"这个缺陷钉成了期望。已更正为真实语义。
    const scope = await resolveScope(td.db, ADMIN_USER_ID);
    expect(new Set(scope.deptIds)).toEqual(new Set([TECH_DEPT_ID, FE_DEPT_ID, BE_DEPT_ID]));
    expect(scope.deptIds.length).toBe(3);
    // 回归点：深度 ≥ 2 的后代必须可见
    expect(scope.deptIds).toContain(FE_DEPT_ID);
    expect(scope.deptIds).toContain(BE_DEPT_ID);
    // 修复只扩大自家子树，不得越界到兄弟部门或祖先部门
    expect(scope.deptIds).not.toContain(MKT_DEPT_ID);
    expect(scope.deptIds).not.toContain(ROOT_DEPT_ID);
  });

  it('多角色多部门 — 合并去重', async () => {
    await seedDataScopeFixture();
    // MULTI_ROLE_USER_ID → TECH_ADMIN_ROLE (deptId = TECH_DEPT_ID) + MKT_ROLE (deptId = MKT_DEPT_ID)
    const scope = await resolveScope(td.db, MULTI_ROLE_USER_ID);
    expect(new Set(scope.deptIds)).toEqual(
      new Set([TECH_DEPT_ID, FE_DEPT_ID, BE_DEPT_ID, MKT_DEPT_ID]),
    );
    expect(scope.deptIds.length).toBe(4);
  });

  it('角色状态为 DISABLED 时不参与计算', async () => {
    await seedDataScopeFixture();
    await td.db.insert(schema.userRoles).values([
      { userId: NO_ROLE_USER_ID, roleId: INACTIVE_ROLE_ID, createdAt: now },
    ]);
    const scope = await resolveScope(td.db, NO_ROLE_USER_ID);
    expect(scope.deptIds).toEqual([]);
  });

  it('混合 ACTIVE + DISABLED 角色 — 只计有效角色', async () => {
    await seedDataScopeFixture();
    // 额外给 MULTI_ROLE_USER_ID 绑定一个 DISABLED 角色（不影响结果）
    await td.db.insert(schema.userRoles).values([
      { userId: MULTI_ROLE_USER_ID, roleId: INACTIVE_ROLE_ID, createdAt: now },
    ]);
    // 结果应与"多角色多部门"相同
    const scope = await resolveScope(td.db, MULTI_ROLE_USER_ID);
    expect(new Set(scope.deptIds)).toEqual(
      new Set([TECH_DEPT_ID, FE_DEPT_ID, BE_DEPT_ID, MKT_DEPT_ID]),
    );
  });

  it('角色 deptId 为根部门 — 子树展开覆盖直接子部门与更深层后代', async () => {
    // `ancestors` 是**父链、不含自身**：根 null、直接子部门 = 根 ID、更深层 = `根/一级`。
    // 因此子树谓词需要两条：`ancestors = deptId`（直接子部门）+ `ancestors LIKE deptId/%`（更深层）。
    //
    // 回归记录：此用例原先断言"直接子部门不匹配 LIKE，故被排除"，并把 MKT 排除在期望集
    // 之外——等于把缺陷固化成了规范。真实后果是：角色在根部门时可见范围漏掉全部一级子部门，
    // /api/departments 对真实管理员返回断裂的树（父不在结果里的孙部门变成顶层）。
    await seedDataScopeFixture();
    // 给 ADMIN_USER 再加一个根部门角色
    await td.db.insert(schema.roles).values({
      id: '00000000-0000-4000-8000-000000000505',
      name: '根管理员',
      code: 'ROOT_ADMIN',
      description: '总公司管理员',
      deptId: ROOT_DEPT_ID,
      isSystem: false,
      status: 'ACTIVE' as const,
      sort: 4,
      createdAt: now,
      updatedAt: now,
    });
    await td.db.insert(schema.userRoles).values([
      { userId: ADMIN_USER_ID, roleId: '00000000-0000-4000-8000-000000000505', createdAt: now },
    ]);

    const scope = await resolveScope(td.db, ADMIN_USER_ID);
    // 两个角色：TECH_ADMIN(deptId=TECH) + ROOT_ADMIN(deptId=ROOT)
    //   TECH: id=TECH → TECH，以及其后代 FE/BE（ancestors = `ROOT/TECH`）
    //   ROOT: id=ROOT → ROOT，直接子部门 TECH/MKT（ancestors = ROOT），深层 FE/BE（ancestors 以 `ROOT/` 开头）
    expect(new Set(scope.deptIds)).toEqual(
      new Set([ROOT_DEPT_ID, TECH_DEPT_ID, MKT_DEPT_ID, FE_DEPT_ID, BE_DEPT_ID]),
    );
    expect(scope.deptIds.length).toBe(5);
    // 直接子部门必须在范围内（这是本用例的回归点）
    expect(scope.deptIds).toContain(MKT_DEPT_ID);
  });
});

describe('isWithinScope — 真实快照上的纯判定', () => {
  // 纯边界（空范围 / 目标 null / undefined）的三条真值已在
  // `authz-write.test.ts` 的「isWithinScope / assertWithinScope — 纯判定」覆盖；
  // 此处只验"真实 DB 快照 + 判定"这条链，避免重复用例。
  it('与 DB 查询结果一致（自家子树 true，兄弟/祖先部门 false）', async () => {
    await seedDataScopeFixture();
    const scope = await resolveScope(td.db, ADMIN_USER_ID);
    // ADMIN → TECH_ADMIN_ROLE → deptId = TECH_DEPT_ID（含子树 FE/BE）
    expect(isWithinScope(scope, TECH_DEPT_ID)).toBe(true);
    expect(isWithinScope(scope, FE_DEPT_ID)).toBe(true);
    expect(isWithinScope(scope, BE_DEPT_ID)).toBe(true);
    // MKT 是兄弟部门、ROOT 是祖先部门，均不在范围内
    expect(isWithinScope(scope, MKT_DEPT_ID)).toBe(false);
    expect(isWithinScope(scope, ROOT_DEPT_ID)).toBe(false);
  });
});
