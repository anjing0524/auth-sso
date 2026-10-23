/**
 * H-13（重置密码 RT 撤销 fail-close）+ H-31（reset-password malformed JSON → 400）
 *
 * ## 为什么需要它
 *
 * H-13 的缺陷形态：密码写入在事务内，RT 撤销在事务外且失败被 `catch` 吞掉，响应仍
 * 返回「密码已重置，该用户所有会话已失效」。账号疑似失陷时这条承诺可能为假。
 * 修复后 RT 撤销与密码写入**同一事务**：撤销失败 → 事务回滚（密码也不写）→ 失败响应。
 *
 * 本文件用**数据库触发器**在基础设施边界注入故障（不 mock 生产模块）：
 * BEFORE UPDATE ON refresh_tokens 抛异常 ⇒ 断言密码未被写入 + 响应 5xx。
 *
 * @req B-USR-PW, NFR-SEC-13
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { eq, sql } from 'drizzle-orm';
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

// @allow-module-mock @/lib/auth/check-permission auth-bypass: 只为进入 handler 伪造"已授权"上下文；真实 withPermission（含错误映射）、真实 withScopedRow 事务与真实 DB 全程参与（依赖它的断言：crud-h13-reset-failclose.test.ts 全部用例）
vi.mock(import('@/lib/auth/check-permission'), async (importOriginal): Promise<Partial<typeof permModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    checkPermission: async () => ({ authorized: true, userId: '00000000-0000-4000-8000-000000000101' }),
    requirePermission: async () => ({ userId: '00000000-0000-4000-8000-000000000101' }),
  };
});

import { POST } from '@/app/api/users/[id]/reset-password/route';
import { hashPassword } from '@/domain/auth/password';
import { hashToken } from '@/lib/crypto';

const ADMIN_ID = '00000000-0000-4000-8000-000000000101';
const TARGET_ID = '00000000-0000-4000-8000-000000000201';
const ROOT_DEPT_ID = '00000000-0000-4000-8000-000000000001';
const ROLE_ID = '00000000-0000-4000-8000-000000000301';

const OLD_PASSWORD = 'OldPassw0rd!1';
const NEW_PASSWORD = 'NewPassw0rd!23';

const req = (body: string | Buffer) => new NextRequest(`http://localhost:4100/api/users/${TARGET_ID}/reset-password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: body as never,
});
const call = (body: string | Buffer) => POST(req(body), { params: Promise.resolve({ id: TARGET_ID }) });

async function passwordOf(id: string) {
  const [row] = await td.db.select({
    passwordHash: schema.users.passwordHash,
    passwordHistory: schema.users.passwordHistory,
  }).from(schema.users).where(eq(schema.users.id, id));
  return row;
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: [
      ...seedAdminUser({ passwordHash: await hashPassword(OLD_PASSWORD) }),
      ...seedTestUser({ passwordHash: await hashPassword(OLD_PASSWORD) }),
    ],
    roles: seedSuperAdminRole({ deptId: ROOT_DEPT_ID }),
    userRoles: seedUserRoleBinding(ADMIN_ID, ROLE_ID),
    clients: seedPortalClient(),
  });
});

describe('H-13 — 重置密码的 RT 撤销与密码写入同事务（fail-close）', () => {
  it('成功路径：密码更新且目标用户的 RT 被撤销（真实 DB 行）', async () => {
    const token = 'rt_h13_happy';
    await td.db.insert(schema.refreshTokens).values({
      id: crypto.randomUUID(),
      tokenHash: hashToken(token),
      userId: TARGET_ID,
      clientId: 'portal',
      scopes: 'openid offline_access',
      revoked: null,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      createdAt: new Date(),
    });

    const res = await call(JSON.stringify({ password: NEW_PASSWORD }));

    expect(res.status).toBe(200);
    const after = await passwordOf(TARGET_ID);
    expect(after!.passwordHash).not.toBe(await hashPassword(OLD_PASSWORD));
    const [rt] = await td.db.select({ revoked: schema.refreshTokens.revoked })
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, hashToken(token)));
    expect(rt!.revoked).not.toBeNull();
  });

  it('**RT 撤销失败 ⇒ 整体失败且密码不被写入**（此前是"成功 + 会话未撤销"）', async () => {
    const before = await passwordOf(TARGET_ID);
    // 触发器是 FOR EACH ROW：必须存在待撤销的 RT 行，撤销语句才会真的执行 UPDATE
    await td.db.insert(schema.refreshTokens).values({
      id: crypto.randomUUID(),
      tokenHash: hashToken('rt_h13_fail'),
      userId: TARGET_ID,
      clientId: 'portal',
      scopes: 'openid offline_access',
      revoked: null,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      createdAt: new Date(),
    });
    await td.db.execute(sql`
      CREATE OR REPLACE FUNCTION vitest_fail_rt_update() RETURNS trigger AS $fn$
      BEGIN RAISE EXCEPTION 'injected rt update failure'; END;
      $fn$ LANGUAGE plpgsql;
    `);
    await td.db.execute(sql`
      CREATE TRIGGER vitest_fail_rt_update BEFORE UPDATE ON refresh_tokens
      FOR EACH ROW EXECUTE FUNCTION vitest_fail_rt_update();
    `);
    try {
      const res = await call(JSON.stringify({ password: NEW_PASSWORD }));

      // 失败即失败：不能是 200「所有会话已失效」
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('AUTH_SSO_1006');

      // 同事务回滚：密码一个字都没写
      const after = await passwordOf(TARGET_ID);
      expect(after!.passwordHash).toBe(before!.passwordHash);
    } finally {
      await td.db.execute(sql`DROP TRIGGER IF EXISTS vitest_fail_rt_update ON refresh_tokens;`);
      await td.db.execute(sql`DROP FUNCTION IF EXISTS vitest_fail_rt_update();`);
    }
  });
});

describe('H-31 — malformed JSON / 非 JSON Content-Type → 400（而非 500）', () => {
  it('malformed JSON → 400 VALIDATION_ERROR', async () => {
    const res = await call('{bad json');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('AUTH_SSO_1005');
  });

  it('text/plain 请求体 → 400', async () => {
    const res = await POST(
      new NextRequest(`http://localhost:4100/api/users/${TARGET_ID}/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'password=whatever',
      }),
      { params: Promise.resolve({ id: TARGET_ID }) },
    );
    expect(res.status).toBe(400);
  });

  it('空 body → 400（而非 500 或 422）', async () => {
    const res = await POST(
      new NextRequest(`http://localhost:4100/api/users/${TARGET_ID}/reset-password`, { method: 'POST' }),
      { params: Promise.resolve({ id: TARGET_ID }) },
    );
    expect(res.status).toBe(400);
  });
});
