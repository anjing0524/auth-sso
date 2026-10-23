/**
 * H-24（无部门用户死锁修复路径）+ H-25（users 侧角色-部门不变量）
 *
 * ## H-24
 * `deptId=null` 的用户因 `isWithinScope(null)` 恒拒，所有写操作（update/toggle/assign role）
 * 都 403 —— 连管理员"补部门"这条唯一修复路径也被挡住（数据只能靠 SQL 修）。
 * 修法：update 的受控例外——仅当目标是**无部门**用户且本次指定部门时，用拟落入部门
 * 参与范围断言；同时禁止把已有部门的用户清空（主动制造死锁）。
 *
 * ## H-25
 * users 侧与 roles 侧「有绑定用户不得迁部门」对称：迁部门前必须验证该用户现有角色
 * 都属于新部门（R-USER-ROLE），否则 422 提示先解除角色。
 *
 * @req R-USER-ROLE, DC-USR-U, H-ACL-002
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedRootDept, seedSuperAdminRole, seedTestUser, seedUserRoleBinding } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';

const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));
// @allow-module-mock @/lib/auth/verify-jwt auth-bypass: 只提供"谁已登录"这一输入；真实 withAuth（权限/错误映射）、真实 resolveScope 与真实事务守卫全程参与（依赖它的断言：crud-h24-h25-user-dept.test.ts 全部用例）
vi.mock(import('@/lib/auth/verify-jwt'), async (importOriginal): Promise<Partial<typeof verifyJwtModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveIdentity: async () => ({ userId: '00000000-0000-4000-8000-000000000101', expiresAt: null, issuedAt: null }),
  };
});
// @allow-module-mock @/lib/crypto input-fixture: 只覆盖确定性 ID，其余导出走真身（依赖它的断言：确定性 UUID 断言）
vi.mock(import('@/lib/crypto'), async (importOriginal): Promise<Partial<typeof cryptoModule>> => {
  const actual = await importOriginal();
  return { ...actual, generateUUID: () => 'aabbccdd-eeff-4000-8000-000000000001', generateId: () => 'aaaaaaaa' };
});

import { updateUserAction } from '@/app/(dashboard)/users/actions';
import type * as verifyJwtModule from '@/lib/auth/verify-jwt';
import type * as cryptoModule from '@/lib/crypto';

const ADMIN_ID = '00000000-0000-4000-8000-000000000101';
const NO_DEPT_USER_ID = '00000000-0000-4000-8000-000000000201';
const ROLE_USER_ID = '00000000-0000-4000-8000-000000000202';
const ROOT_DEPT_ID = '00000000-0000-4000-8000-000000000001';
const TECH_DEPT_ID = '00000000-0000-4000-8000-000000000002';
const MKT_DEPT_ID = '00000000-0000-4000-8000-000000000005';
const SUPER_ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000301';
const TECH_ROLE_ID = '00000000-0000-4000-8000-000000000302';

const now = new Date();

const ROOT = seedRootDept();
const TECH = {
  id: TECH_DEPT_ID, parentId: ROOT_DEPT_ID, name: '技术部', code: 'TECH',
  ancestors: ROOT_DEPT_ID, sort: 1, status: 'ACTIVE' as const, createdAt: now, updatedAt: now,
};
const MKT = {
  id: MKT_DEPT_ID, parentId: ROOT_DEPT_ID, name: '市场部', code: 'MKT',
  ancestors: ROOT_DEPT_ID, sort: 2, status: 'ACTIVE' as const, createdAt: now, updatedAt: now,
};

async function deptOf(id: string) {
  const [row] = await td.db.select({ deptId: schema.users.deptId }).from(schema.users).where(eq(schema.users.id, id));
  return row!.deptId;
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, {
    departments: [...ROOT, TECH, MKT],
    users: [
      ...seedAdminUser(),
      // 历史/引导态：无部门用户
      ...seedTestUser({ id: NO_DEPT_USER_ID, username: 'no-dept', email: 'nodept@example.com', deptId: null }),
      // 部门 A + 已绑定 A 部门角色（用于 H-25）
      ...seedTestUser({ id: ROLE_USER_ID, username: 'role-user', email: 'roleuser@example.com', deptId: TECH_DEPT_ID }),
    ],
    roles: [
      ...seedSuperAdminRole({ deptId: ROOT_DEPT_ID }),
      {
        id: TECH_ROLE_ID, name: '技术管理员', code: 'TECH_ADMIN', description: '',
        deptId: TECH_DEPT_ID, isSystem: false, status: 'ACTIVE' as const, sort: 0, createdAt: now, updatedAt: now,
      },
    ],
    userRoles: [
      ...seedUserRoleBinding(ADMIN_ID, SUPER_ADMIN_ROLE_ID),
      ...seedUserRoleBinding(ROLE_USER_ID, TECH_ROLE_ID),
    ],
  });
});

describe('H-24 — 无部门用户的"补部门"修复路径', () => {
  it('**管理员可为 deptId=null 的用户补部门**（此前恒 403，只能靠 SQL 修）', async () => {
    const r = await updateUserAction(NO_DEPT_USER_ID, { deptId: TECH_DEPT_ID } as never);

    expect(r.success).toBe(true);
    expect(await deptOf(NO_DEPT_USER_ID)).toBe(TECH_DEPT_ID);
  });

  it('无部门用户的其他编辑仍 fail-closed（403）——受控例外只覆盖"补部门"', async () => {
    const r = await updateUserAction(NO_DEPT_USER_ID, { name: '改个名字' } as never);

    if (r.success) expect.unreachable('无部门目标 + 未指定部门时应保持 fail-closed');
    expect(r.error).toBe('AUTH_SSO_1003');
    expect(await deptOf(NO_DEPT_USER_ID)).toBeNull();
  });

  it('**禁止把已有部门的用户清空**（DomainError 422，不制造死锁）', async () => {
    const r = await updateUserAction(ROLE_USER_ID, { deptId: null } as never);

    if (r.success) expect.unreachable('清空部门必须被拒绝');
    expect(r.message).toContain('不能清空用户所属部门');
    expect(await deptOf(ROLE_USER_ID)).toBe(TECH_DEPT_ID);
  });
});

describe('H-25 — 迁部门前重验角色归属（users 侧对称不变量）', () => {
  it('用户绑定 A 部门角色时迁到 B → 422 提示先解除角色，且部门不变', async () => {
    const r = await updateUserAction(ROLE_USER_ID, { deptId: MKT_DEPT_ID } as never);

    if (r.success) expect.unreachable('存在跨部门角色绑定时迁移必须被拒绝');
    expect(r.message).toContain('请先解除角色');
    expect(await deptOf(ROLE_USER_ID)).toBe(TECH_DEPT_ID);
  });

  it('解除角色后迁到 B → 成功', async () => {
    await td.db.delete(schema.userRoles).where(eq(schema.userRoles.userId, ROLE_USER_ID));

    const r = await updateUserAction(ROLE_USER_ID, { deptId: MKT_DEPT_ID } as never);

    expect(r.success).toBe(true);
    expect(await deptOf(ROLE_USER_ID)).toBe(MKT_DEPT_ID);
  });
});
