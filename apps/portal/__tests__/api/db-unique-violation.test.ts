/**
 * 用户可触发的唯一约束冲突必须映射为 **409**，而不是 500
 *
 * ## 背景（架构评审 R2 候选 R10）
 *
 * 五个实体的「唯一性冲突 → 409」兑现率只有 **3/5**：
 * `users` / `roles` / `permissions` 在事务内查重并抛 `DuplicateEntityError` → 409；
 * `departments` 直接 insert，PG 唯一约束违例经 `mapDomainError` 落到
 * **500「服务器内部错误」**（`/api/departments` POST 亦然）。
 *
 * ## 为什么用真实 PG 违例
 *
 * Drizzle 抛的是**包装后**的 `DrizzleQueryError`（`cause` 才是 `PostgresError`），
 * 所以"识别 23505"必须走 cause 链——手写一个 `{ code: '23505' }` 的错误对象
 * **测不出**这一点。本文件让真实约束违例发生，再把**真实错误对象**喂进**真实映射链**。
 *
 * ## 两条不变量
 *
 * 1. 状态码是 409（不是 500）；
 * 2. 消息**不得回显冲突值**——PG 的 `detail` 形如
 *    `Key (email)=(secret@x.com) already exists.`，直接透传即泄露**他人**邮箱/手机号/用户名。
 *
 * @req H-ACL-002, F-DEP-C, F-USR-C, F-ROL-C, F-PRM-C
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import {
  seedRootDept,
  seedAdminUser,
  seedSuperAdminRole,
  seedTestPermission,
} from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';
import type * as permModule from '@/lib/auth/check-permission';

const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));

// @allow-module-mock @/lib/auth/check-permission auth-bypass: 只为进入 handler 伪造"已授权"上下文；错误映射链（withPermission → mapServerError → mapDomainError）全程真实（依赖它的断言：db-unique-violation.test.ts 的「经真实 withPermission」用例）
vi.mock(import('@/lib/auth/check-permission'), async (importOriginal): Promise<Partial<typeof permModule>> => {
  const actual = await importOriginal();
  return { ...actual,
  checkPermission: async () => ({ authorized: true, userId: '00000000-0000-4000-8000-000000000101' }),
  requirePermission: async () => ({ userId: '00000000-0000-4000-8000-000000000101' }),
};
});;

import { mapServerError } from '@/lib/server-error';

const ADMIN_USER_ID = '00000000-0000-4000-8000-000000000101';
const SECRET_EMAIL = 'secret-target@example.com';
const SECRET_MOBILE = '13800000000';

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => { await td.cleanup(); });

/** 触发真实违例并返回**真实**错误对象 */
async function caught(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error('预期触发唯一约束违例，但写入成功了——本用例失去意义');
}

describe('唯一约束冲突 → 409（真实 PG 违例 + 真实映射链）', () => {
  it('departments.code 重复 → 409', async () => {
    await seedTestData(td.db, { departments: seedRootDept() });
    const [dup] = seedRootDept();
    const err = await caught(() =>
      td.db.insert(schema.departments).values({ ...dup!, id: 'aabbccdd-0001-4000-8000-000000000001' }),
    );

    const mapped = mapServerError(err);
    expect(mapped.status).toBe(409);
    expect(mapped.message).not.toContain('ROOT');
  });

  it('users.username 重复 → 409', async () => {
    await seedTestData(td.db, { departments: seedRootDept(), users: seedAdminUser() });
    const [dup] = seedAdminUser();
    const err = await caught(() =>
      td.db.insert(schema.users).values({ ...dup!, id: 'aabbccdd-0002-4000-8000-000000000002' }),
    );

    expect(mapServerError(err).status).toBe(409);
  });

  it('users.email 重复（部分唯一索引 ux_users_email）→ 409，且不回显邮箱', async () => {
    await seedTestData(td.db, { departments: seedRootDept(), users: seedAdminUser({ email: SECRET_EMAIL }) });
    const [dup] = seedAdminUser({ email: SECRET_EMAIL });
    const err = await caught(() =>
      td.db.insert(schema.users).values({ ...dup!, id: 'aabbccdd-0003-4000-8000-000000000003', username: 'other-name' }),
    );

    const mapped = mapServerError(err);
    expect(mapped.status).toBe(409);
    // PostgreSQL 的 detail 里带值；透传就是泄露他人邮箱
    expect(mapped.message).not.toContain(SECRET_EMAIL);
  });

  it('users.mobile 重复（部分唯一索引 ux_users_mobile）→ 409，且不回显手机号', async () => {
    await seedTestData(td.db, { departments: seedRootDept(), users: seedAdminUser({ mobile: SECRET_MOBILE }) });
    const [dup] = seedAdminUser({ mobile: SECRET_MOBILE });
    const err = await caught(() =>
      td.db.insert(schema.users).values({ ...dup!, id: 'aabbccdd-0004-4000-8000-000000000004', username: 'other-name-2' }),
    );

    const mapped = mapServerError(err);
    expect(mapped.status).toBe(409);
    expect(mapped.message).not.toContain(SECRET_MOBILE);
  });

  it('roles.code 重复 → 409', async () => {
    await seedTestData(td.db, { departments: seedRootDept(), roles: seedSuperAdminRole() });
    const [dup] = seedSuperAdminRole();
    const err = await caught(() =>
      td.db.insert(schema.roles).values({ ...dup!, id: 'aabbccdd-0005-4000-8000-000000000005' }),
    );

    expect(mapServerError(err).status).toBe(409);
  });

  it('permissions.code 重复 → 409', async () => {
    await seedTestData(td.db, { permissions: seedTestPermission() });
    const [dup] = seedTestPermission();
    const err = await caught(() =>
      td.db.insert(schema.permissions).values({ ...dup!, id: 'aabbccdd-0006-4000-8000-000000000006' }),
    );

    expect(mapServerError(err).status).toBe(409);
  });

  it('经**真实** withPermission 包装的 REST 路径返回 HTTP 409', async () => {
    await seedTestData(td.db, { departments: seedRootDept() });
    const { withPermission } = await import('@/lib/auth/guard');
    const { restSuccess } = await import('@/lib/response');

    const res = await withPermission({ permissions: [] }, async () => {
      const [dup] = seedRootDept();
      await td.db.insert(schema.departments).values({
        ...dup!,
        id: 'aabbccdd-0007-4000-8000-000000000007',
      });
      return restSuccess({ ok: true });
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.message).not.toContain('ROOT');
    expect(ADMIN_USER_ID).toBeTruthy();
  });

  it('非唯一约束的数据库错误仍映射为 500（不得把一切 DB 错误都说成冲突）', async () => {
    // 23502 = not-null 违例：真发生，但语义不是唯一冲突
    await seedTestData(td.db, { departments: seedRootDept(), users: seedAdminUser() });
    const [dup] = seedAdminUser();
    const err = await caught(() =>
      td.db.insert(schema.users).values({
        ...dup!,
        id: 'aabbccdd-0008-4000-8000-000000000008',
        name: null as unknown as string,
        username: 'nn-user',
      }),
    );

    expect(mapServerError(err).status).toBe(500);
  });
});
