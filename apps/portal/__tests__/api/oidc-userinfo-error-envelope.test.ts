/**
 * OIDC UserInfo 端点的**错误信封**必须符合 RFC 6750 §3（架构巡检候选 4）
 *
 * ## 为什么需要它
 *
 * `/api/auth/oauth2/userinfo` 是**对外 OIDC 契约**：消费方是第三方 RP 的 OIDC 客户端库，
 * 只认 RFC 6750 的错误名（`invalid_request` / `invalid_token` / `insufficient_scope` …）。
 *
 * 但它的**兜底** catch 曾直接把内部码回给客户端：
 *
 * ```ts
 * const mapped = mapServerError(err);
 * return NextResponse.json({ error: mapped.error }, { status: mapped.status });
 * ```
 *
 * 即 `{ "error": "AUTH_SSO_1006" }` —— 一个 RP 无从识别的内部码，且 401 时还漏了
 * RFC 6750 §3 要求 MUST 携带的 `WWW-Authenticate`。显式失败路径（无 token / 验签失败 /
 * 用户不存在）本来就是对的，**只有兜底**漏了 ⇒ 本文件锁住兜底。
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { generateKeyPair, exportJWK } from 'jose';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedRootDept, seedAdminUser, seedPortalClient } from '../helpers/seed-fixtures';

const { mocks, tdHolder } = vi.hoisted(() => ({
  mocks: { mockGetUserProfile: vi.fn() },
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

// @allow-module-mock @/app/(dashboard)/users/data full-replacement: 本文件只测 userinfo 的错误信封，不需要真实读模型；整体替换以便注入抛错。不用 Partial+importOriginal 的原因是该模块在加载期就经 user-queries 读 schema，而 mock 工厂早于测试模块执行（那时句柄还没建）
vi.mock(import('@/app/(dashboard)/users/data'), (): Partial<typeof usersDataModule> => ({
  getUserProfile: mocks.mockGetUserProfile,
}));

import { GET as userinfoGet } from '@/app/api/auth/oauth2/userinfo/route';
import type * as usersDataModule from '@/app/(dashboard)/users/data';
import { signAccessToken } from '@/lib/auth/token';
import { ForbiddenError } from '@/domain/shared/errors';

const td = createTestDbHandle();
tdHolder.current = td;

const USER_ID = '00000000-0000-4000-8000-000000000101';
const KID = 'userinfo-error-envelope-kid';

let jwksRow: { publicKey: string; privateKey: string };

beforeAll(async () => {
  await td.connect();
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  jwksRow = {
    privateKey: JSON.stringify(await exportJWK(privateKey)),
    publicKey: JSON.stringify(await exportJWK(publicKey)),
  };
});
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser(),
    jwks: [{
      id: crypto.randomUUID(),
      kid: KID,
      algorithm: 'ES256',
      publicKey: jwksRow.publicKey,
      privateKey: jwksRow.privateKey,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 90 * 24 * 3600 * 1000),
    }],
    clients: seedPortalClient(),
  });
});

/** 带一个**真实签发**的 Access Token 调 userinfo（验签不 mock，ADR-022） */
async function callUserinfo() {
  const { token } = await signAccessToken(USER_ID, 'portal', 'openid profile');
  const request = new Request('https://sso.example.com/api/auth/oauth2/userinfo', {
    headers: { authorization: `Bearer ${token}` },
  });
  return userinfoGet(request as never);
}

describe('OIDC UserInfo 的错误信封（RFC 6750 §3）', () => {
  it('兜底错误绝不回内部码：5xx ⇒ { error: "server_error" }，响应体里不含 AUTH_SSO_', async () => {
    mocks.mockGetUserProfile.mockRejectedValueOnce(new Error('数据库连接断了'));

    const response = await callUserinfo();
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(body.error).toBe('server_error');
    // 核心断言：内部码（AUTH_SSO_xxxx）不得出现在对外 OIDC 响应体里
    expect(JSON.stringify(body)).not.toContain('AUTH_SSO_');
  });

  it('领域错误按状态映射到 OAuth 错误名：403 ⇒ insufficient_scope + WWW-Authenticate', async () => {
    mocks.mockGetUserProfile.mockRejectedValueOnce(new ForbiddenError('越权读取'));

    const response = await callUserinfo();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'insufficient_scope' });
    expect(response.headers.get('WWW-Authenticate')).toBe('Bearer error="insufficient_scope"');
  });

  it('回归对照：凭证无效仍是 401 + invalid_token（原本就正确的路径）', async () => {
    const response = await userinfoGet(new Request('https://sso.example.com/api/auth/oauth2/userinfo') as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_token' });
    expect(response.headers.get('WWW-Authenticate')).toContain('Bearer');
  });
});
