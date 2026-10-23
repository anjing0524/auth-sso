/**
 * H-C-06 — 密码复用判定必须包含**当前密码**
 *
 * 缺陷：复用比较只查 `password_history`（history 只在改密时把旧 hash 推入），
 * 于是 `newPassword === currentPassword` 被接受——与「新密码不能与最近使用过的
 * 密码相同」（NFR-SEC-15）的承诺不符。自助改密与管理员重置两条路径同缺口。
 *
 * @req NFR-SEC-15, FR-USR-10, B-USR-PW
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import {
  seedAdminUser, seedRootDept, seedSuperAdminRole, seedTestUser, seedUserRoleBinding, seedPortalClient,
} from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';
import type * as permModule from '@/lib/auth/check-permission';

const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));
// @allow-module-mock @/lib/auth/check-permission auth-bypass: 只为进入 handler 伪造"已授权"上下文；真实 withPermission（错误映射）、真实 withScopedRow 与真实领域判定全程参与（依赖它的断言：crud-hc06-password-current.test.ts 全部用例）
vi.mock(import('@/lib/auth/check-permission'), async (importOriginal): Promise<Partial<typeof permModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    checkPermission: async () => ({ authorized: true, userId: '00000000-0000-4000-8000-000000000101' }),
    requirePermission: async () => ({ userId: '00000000-0000-4000-8000-000000000101' }),
  };
});

import { POST as resetPasswordRoute } from '@/app/api/users/[id]/reset-password/route';
import { changeOwnPassword } from '@/lib/account/change-password';
import { hashPassword, verifyPassword } from '@/domain/auth/password';

const ADMIN_ID = '00000000-0000-4000-8000-000000000101';
const TARGET_ID = '00000000-0000-4000-8000-000000000201';
const ROOT_DEPT_ID = '00000000-0000-4000-8000-000000000001';
const ROLE_ID = '00000000-0000-4000-8000-000000000301';

const CURRENT = 'Current@123456';
const NEXT = 'NextPass@654321';

async function hashOf(id: string) {
  const [row] = await td.db.select({
    passwordHash: schema.users.passwordHash,
    passwordHistory: schema.users.passwordHistory,
  }).from(schema.users).where(eq(schema.users.id, id));
  return row!;
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: [
      ...seedAdminUser(),
      ...seedTestUser({ passwordHash: await hashPassword(CURRENT) }),
    ],
    roles: seedSuperAdminRole({ deptId: ROOT_DEPT_ID }),
    userRoles: seedUserRoleBinding(ADMIN_ID, ROLE_ID),
    clients: seedPortalClient(),
  });
});

describe('H-C-06 — 自助改密', () => {
  it('**新密码 = 当前密码 → 拒绝**且不落库', async () => {
    const before = await hashOf(TARGET_ID);

    await expect(changeOwnPassword(TARGET_ID, CURRENT, CURRENT)).rejects.toThrow(
      '新密码不能与最近使用过的密码相同',
    );

    const after = await hashOf(TARGET_ID);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.passwordHistory).toBeNull();
  });

  it('正常改密仍成功（当前密码不等于新密码）', async () => {
    const result = await changeOwnPassword(TARGET_ID, CURRENT, NEXT);

    expect(result.ok).toBe(true);
    const after = await hashOf(TARGET_ID);
    expect(after.passwordHistory).toHaveLength(1);
    // bcrypt 每次哈希 salt 不同：断言"历史里的旧 hash 能验证 CURRENT"，而不是字面相等
    expect(await verifyPassword(CURRENT, after.passwordHistory![0]!)).toBe(true);
    // 改密后 NEXT 成为"当前密码"，再把它当新密码也必须被拒（历史+当前双保险）
    await expect(changeOwnPassword(TARGET_ID, NEXT, NEXT)).rejects.toThrow(
      '新密码不能与最近使用过的密码相同',
    );
  });
});

describe('H-C-06 — 管理员重置（REST）', () => {
  it('**重置为当前密码 → 400**且不落库', async () => {
    const before = await hashOf(TARGET_ID);
    const req = new NextRequest(`http://localhost:4100/api/users/${TARGET_ID}/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: CURRENT }),
    });

    const res = await resetPasswordRoute(req, { params: Promise.resolve({ id: TARGET_ID }) });

    expect(res.status).toBe(400);
    expect((await hashOf(TARGET_ID)).passwordHash).toBe(before.passwordHash);
  });

  it('重置为历史密码 → 400（既有语义保持）', async () => {
    const reused = await hashPassword(NEXT);
    await td.db.update(schema.users)
      .set({ passwordHistory: [reused] })
      .where(eq(schema.users.id, TARGET_ID));
    const before = await hashOf(TARGET_ID);

    const req = new NextRequest(`http://localhost:4100/api/users/${TARGET_ID}/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: NEXT }),
    });
    const res = await resetPasswordRoute(req, { params: Promise.resolve({ id: TARGET_ID }) });

    expect(res.status).toBe(400);
    expect((await hashOf(TARGET_ID)).passwordHash).toBe(before.passwordHash);
  });
});
