/**
 * POST /api/users/[id]/reset-password —— 范围守卫 / 404 / 复用校验 / 写入的**同事务**语义
 *
 * ## 为什么补这个文件（架构评审 R2 候选 R11）
 *
 * 该端点此前**零测试覆盖**，而它的守卫当时写成
 * `withScopedWrite({...}, async () => undefined)` —— 事务里什么都没做，随后的
 * `passwordHistory` 读取走事务外 `db`、写入又是**另一个**事务。于是「快照与写入同事务」
 * （ADR-014 / H-ACL-002）被打破，而没人发现；文件头注释当时还在宣称它成立。
 *
 * 本文件把该端点真正测起来：**只 mock 鉴权结果**，真实 `withPermission`（含错误映射）、
 * 真实 `lib/authz` 守卫、真实 bcrypt、真实 DB 全程参与 —— 领域错误以「映射后的
 * 403/404/400 响应」出现，与生产契约一致。
 *
 * @req H-ACL-002, H-DSCOPE-003, NFR-SEC-15, B-USR-PW
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedRootDept, seedPortalClient } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';
import type * as permModule from '@/lib/auth/check-permission';

const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));

// @allow-module-mock @/lib/auth/check-permission auth-bypass: 只为进入 handler 伪造"已授权"上下文；真实 withPermission（含错误映射）与真实 lib/authz 守卫全程参与（依赖它的断言：reset-password-scope.test.ts 全部用例）
vi.mock(import('@/lib/auth/check-permission'), async (importOriginal): Promise<Partial<typeof permModule>> => {
  const actual = await importOriginal();
  return { ...actual,
  checkPermission: async () => ({ authorized: true, userId: OPERATOR_ID }),
  requirePermission: async () => ({ userId: OPERATOR_ID }),
};
});;

import { POST } from '@/app/api/users/[id]/reset-password/route';
import { hashPassword } from '@/domain/auth/password';

const ROOT_DEPT_ID = '00000000-0000-4000-8000-000000000001';
const TECH_DEPT_ID = '00000000-0000-4000-8000-000000000002';
const MKT_DEPT_ID = '00000000-0000-4000-8000-000000000005';
const OPERATOR_ID = '00000000-0000-4000-8000-000000000101';
const TARGET_IN_SCOPE_ID = '00000000-0000-4000-8000-000000000201';
const TARGET_OUT_OF_SCOPE_ID = '00000000-0000-4000-8000-000000000202';
const TECH_ROLE_ID = '00000000-0000-4000-8000-000000000301';

const OLD_PASSWORD = 'OldPassw0rd!1';
const REUSED_PASSWORD = 'Reused!Pass9';
const NEW_PASSWORD = 'NewPassw0rd!23';

const now = new Date();

function user(id: string, username: string, deptId: string, passwordHash: string, passwordHistory: string[] | null = null) {
  return {
    id,
    username,
    email: `${username}@test.com`,
    emailVerified: true,
    mobile: null,
    mobileVerified: false,
    name: username,
    passwordHash,
    passwordHistory,
    status: 'ACTIVE' as const,
    deptId,
    createdAt: now,
    updatedAt: now,
  };
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => { await td.cleanup(); });

/** 操作者只有 TECH 部门的角色 ⇒ 有效范围 = {TECH}（不含兄弟部门 MKT） */
async function seedScopeFixture(): Promise<string> {
  const oldHash = await hashPassword(OLD_PASSWORD);
  await seedTestData(td.db, {
    departments: [
      ...seedRootDept(),
      {
        id: TECH_DEPT_ID, parentId: ROOT_DEPT_ID, name: '技术部', code: 'TECH',
        ancestors: ROOT_DEPT_ID, sort: 1, status: 'ACTIVE' as const, createdAt: now, updatedAt: now,
      },
      {
        id: MKT_DEPT_ID, parentId: ROOT_DEPT_ID, name: '市场部', code: 'MKT',
        ancestors: ROOT_DEPT_ID, sort: 2, status: 'ACTIVE' as const, createdAt: now, updatedAt: now,
      },
    ],
    users: [
      user(OPERATOR_ID, 'operator', ROOT_DEPT_ID, oldHash),
      user(TARGET_IN_SCOPE_ID, 'in-scope', TECH_DEPT_ID, oldHash),
      user(TARGET_OUT_OF_SCOPE_ID, 'out-of-scope', MKT_DEPT_ID, oldHash),
    ],
    roles: [
      {
        id: TECH_ROLE_ID, name: '技术管理员', code: 'TECH_ADMIN', description: '',
        deptId: TECH_DEPT_ID, isSystem: false, status: 'ACTIVE' as const, sort: 0,
        createdAt: now, updatedAt: now,
      },
    ],
    userRoles: [{ userId: OPERATOR_ID, roleId: TECH_ROLE_ID, createdAt: now }],
    clients: seedPortalClient(),
  });
  return oldHash;
}

function resetRequest(targetId: string, password: string): NextRequest {
  return new NextRequest(`http://localhost:4100/api/users/${targetId}/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

function callRoute(targetId: string, password: string) {
  return POST(resetRequest(targetId, password), { params: Promise.resolve({ id: targetId }) });
}

/** 读目标用户的密码列（真实 DB） */
async function readPasswordState(userId: string) {
  const rows = await td.db
    .select({ passwordHash: schema.users.passwordHash, passwordHistory: schema.users.passwordHistory })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return rows[0]!;
}

describe('POST /api/users/[id]/reset-password — 范围与写入', () => {
  it('范围内：重置成功，密码与历史被更新（真实 bcrypt + 真实事务）', async () => {
    const oldHash = await seedScopeFixture();

    const res = await callRoute(TARGET_IN_SCOPE_ID, NEW_PASSWORD);

    expect(res.status).toBe(200);
    const after = await readPasswordState(TARGET_IN_SCOPE_ID);
    expect(after.passwordHash).not.toBe(oldHash);
    // 旧 hash 进入历史首位
    expect(after.passwordHistory?.[0]).toBe(oldHash);
  });

  it('**越界目标 → 403，且密码一个字都没被写**', async () => {
    const oldHash = await seedScopeFixture();

    const res = await callRoute(TARGET_OUT_OF_SCOPE_ID, NEW_PASSWORD);

    expect(res.status).toBe(403);
    // 关键断言：守卫与写入同事务 ⇒ 拒绝时不可能留下半写
    const after = await readPasswordState(TARGET_OUT_OF_SCOPE_ID);
    expect(after.passwordHash).toBe(oldHash);
    expect(after.passwordHistory).toBeNull();
  });

  it('目标不存在 → 404（DomainError 经真实映射链，而不是 rejects）', async () => {
    await seedScopeFixture();

    const res = await callRoute('00000000-0000-4000-8000-00000000dead', NEW_PASSWORD);

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('复用最近用过的密码 → 400，且密码不被写', async () => {
    const oldHash = await seedScopeFixture();
    const reusedHash = await hashPassword(REUSED_PASSWORD);
    await td.db.update(schema.users)
      .set({ passwordHistory: [reusedHash] })
      .where(eq(schema.users.id, TARGET_IN_SCOPE_ID));

    const res = await callRoute(TARGET_IN_SCOPE_ID, REUSED_PASSWORD);

    expect(res.status).toBe(400);
    const after = await readPasswordState(TARGET_IN_SCOPE_ID);
    expect(after.passwordHash).toBe(oldHash);
    expect(after.passwordHistory).toEqual([reusedHash]);
  });

  it('**目标账号从未设置密码 → 管理员仍能设置初始密码**', async () => {
    await seedScopeFixture();
    // 该账号没有密码（passwordHash NULL）——这正是"管理员重置"该覆盖的场景之一
    await td.db.update(schema.users)
      .set({ passwordHash: null, passwordHistory: null })
      .where(eq(schema.users.id, TARGET_IN_SCOPE_ID));

    const res = await callRoute(TARGET_IN_SCOPE_ID, NEW_PASSWORD);

    // 领域规则「无密码不能**自助**改密」不得套到管理员路径上
    expect(res.status).toBe(200);
    const after = await readPasswordState(TARGET_IN_SCOPE_ID);
    expect(after.passwordHash).not.toBeNull();
    // 且历史里**不得出现空串哨兵**：此前用 `pushPasswordHistory(history, passwordHash ?? '')`
    // 把 `''` 当成"旧哈希"写进了 `password_history`（ADR-016 明令禁止的空哨兵形态）。
    expect(after.passwordHistory ?? []).not.toContain('');
    expect(after.passwordHistory ?? []).toEqual([]);
  });

  it('密码不合规 → 400（策略校验先于任何事务）', async () => {
    const oldHash = await seedScopeFixture();

    const res = await callRoute(TARGET_IN_SCOPE_ID, 'short');

    expect(res.status).toBe(400);
    const after = await readPasswordState(TARGET_IN_SCOPE_ID);
    expect(after.passwordHash).toBe(oldHash);
  });
});
