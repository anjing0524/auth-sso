/**
 * 数据范围（Data Scope）集成测试 — 真实 DB
 *
 * 覆盖：
 * - getUserRoleDeptIds() 从真实 DB 中计算角色部门 + 子树展开
 * - canAccessDept() 纯函数边界条件验证
 *
 * 种子数据链路：
 *   departments → users → roles → userRoles
 *   getUserRoleDeptIds(userId) 查询 users → userRoles → roles.dept_id → 子树展开
 *
 * @req H-DSCOPE-001~003
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

// ── 被测模块 ───────────────────────────────────────
import { getUserRoleDeptIds, canAccessDept } from '@/lib/auth/data-scope';

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

describe('getUserRoleDeptIds', () => {
  it('用户不存在时返回空数组', async () => {
    await seedDataScopeFixture();
    // 使用合法 UUID 格式的不存在用户 ID
    const result = await getUserRoleDeptIds('00000000-0000-4000-8000-000000000999');
    expect(result).toEqual([]);
  });

  it('用户无角色时返回空数组', async () => {
    await seedDataScopeFixture();
    const result = await getUserRoleDeptIds(NO_ROLE_USER_ID);
    expect(result).toEqual([]);
  });

  it('单角色单部门 — 返回角色对应部门自身', async () => {
    await seedDataScopeFixture();
    // TECH_USER_ID → FE_LEAD_ROLE → deptId = FE_DEPT_ID（无子部门）
    const result = await getUserRoleDeptIds(TECH_USER_ID);
    expect(new Set(result)).toEqual(new Set([FE_DEPT_ID]));
  });

  it('角色 deptId 为 TECH — 返回 TECH 部门自身', async () => {
    await seedDataScopeFixture();
    // ADMIN_USER_ID → TECH_ADMIN_ROLE → deptId = TECH_DEPT_ID
    const result = await getUserRoleDeptIds(ADMIN_USER_ID);
    expect(new Set(result)).toEqual(new Set([TECH_DEPT_ID]));
    expect(result.length).toBe(1);
  });

  it('多角色多部门 — 合并去重', async () => {
    await seedDataScopeFixture();
    // MULTI_ROLE_USER_ID → TECH_ADMIN_ROLE (deptId = TECH_DEPT_ID) + MKT_ROLE (deptId = MKT_DEPT_ID)
    const result = await getUserRoleDeptIds(MULTI_ROLE_USER_ID);
    expect(new Set(result)).toEqual(new Set([TECH_DEPT_ID, MKT_DEPT_ID]));
    expect(result.length).toBe(2);
  });

  it('角色状态为 DISABLED 时不参与计算', async () => {
    await seedDataScopeFixture();
    await td.db.insert(schema.userRoles).values([
      { userId: NO_ROLE_USER_ID, roleId: INACTIVE_ROLE_ID, createdAt: now },
    ]);
    const result = await getUserRoleDeptIds(NO_ROLE_USER_ID);
    expect(result).toEqual([]);
  });

  it('混合 ACTIVE + DISABLED 角色 — 只计有效角色', async () => {
    await seedDataScopeFixture();
    // 额外给 MULTI_ROLE_USER_ID 绑定一个 DISABLED 角色（不影响结果）
    await td.db.insert(schema.userRoles).values([
      { userId: MULTI_ROLE_USER_ID, roleId: INACTIVE_ROLE_ID, createdAt: now },
    ]);
    // 结果应与"多角色多部门"相同
    const result = await getUserRoleDeptIds(MULTI_ROLE_USER_ID);
    expect(new Set(result)).toEqual(new Set([TECH_DEPT_ID, MKT_DEPT_ID]));
  });

  it('角色 deptId 为根部门 — 子树正确展开', async () => {
    // 当 deptId 是根部门(ancestors=null)时，LIKE 'ROOT_ID/%' 匹配孙子级及更深部门
    // 注意：直接子部门(ancestors=ROOT_ID，无末尾'/')不匹配 LIKE 'ROOT_ID/%'
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

    const result = await getUserRoleDeptIds(ADMIN_USER_ID);
    // 两个角色：TECH_ADMIN(deptId=TECH) + ROOT_ADMIN(deptId=ROOT)
    // TECH: id=TECH_ID → TECH
    // ROOT: id=ROOT_ID → ROOT; LIKE 'ROOT_ID/%' → FE(ROOT_ID/TECH_ID), BE(ROOT_ID/TECH_ID)
    // 直接子部门 TECH/MKT 的 ancestors=ROOT_ID 不包含'/'，不匹配 LIKE 'ROOT_ID/%'
    expect(new Set(result)).toEqual(
      new Set([ROOT_DEPT_ID, TECH_DEPT_ID, FE_DEPT_ID, BE_DEPT_ID]),
    );
    expect(result.length).toBe(4);
  });
});

describe('canAccessDept', () => {
  it('targetDeptId 在 deptIds 中 → true', () => {
    expect(canAccessDept([TECH_DEPT_ID, FE_DEPT_ID], FE_DEPT_ID)).toBe(true);
  });

  it('targetDeptId 不在 deptIds 中 → false', () => {
    expect(canAccessDept([TECH_DEPT_ID], MKT_DEPT_ID)).toBe(false);
  });

  it('deptIds 为空 → false', () => {
    expect(canAccessDept([], TECH_DEPT_ID)).toBe(false);
  });

  it('targetDeptId 为 null → false', () => {
    expect(canAccessDept([TECH_DEPT_ID], null)).toBe(false);
  });

  it('targetDeptId 为 undefined → false', () => {
    expect(canAccessDept([TECH_DEPT_ID], undefined)).toBe(false);
  });

  it('与 DB 查询结果一致性验证', async () => {
    await seedDataScopeFixture();
    const deptIds = await getUserRoleDeptIds(ADMIN_USER_ID);
    // ADMIN → TECH_ADMIN_ROLE → deptId = TECH_DEPT_ID
    expect(canAccessDept(deptIds, TECH_DEPT_ID)).toBe(true);
    // FE / BE / MKT 不在其管辖范围
    expect(canAccessDept(deptIds, FE_DEPT_ID)).toBe(false);
    expect(canAccessDept(deptIds, BE_DEPT_ID)).toBe(false);
    expect(canAccessDept(deptIds, MKT_DEPT_ID)).toBe(false);
  });
});
