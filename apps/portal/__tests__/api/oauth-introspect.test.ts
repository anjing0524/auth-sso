/**
 * Token Introspection 端点测试 (POST /api/auth/oauth2/introspect) — RFC 7662
 *
 * 该端点此前**零测试覆盖**（架构评审候选 ⑩）。它的核心安全职责是：
 * **已撤销或已过期的 token 必须返回 `active: false`**。若这条不成立，
 * 资源服务器会把已撤销的凭据当作有效，撤销机制等于失效。
 *
 * 另一条 RFC 要求：无法识别的 token 返回 `{ active: false }` 而**不是错误**，
 * 否则调用方可借响应码枚举 token 是否存在（RFC 7662 §2.2）。
 *
 * @req H-SESS-006, ADR-013
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedPortalClient, seedRootDept } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';
import { hashToken } from '@/lib/crypto';
import { TOKEN_TTL } from '@auth-sso/contracts';
import { exportJWK, generateKeyPair } from 'jose';

const { tdHolder } = vi.hoisted(() => ({
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

import { POST as introspectPost } from '@/app/api/auth/oauth2/introspect/route';
import { signAccessToken } from '@/lib/auth/token';
import { revokeJti } from '@/lib/session/revoke';

const td = createTestDbHandle();
tdHolder.current = td;

const USER_ID = '00000000-0000-4000-8000-000000000101';
const CLIENT_ID = 'portal';
const SECRET = 'portal-secret';
const RT = 'rt_introspect_test_token_value';

let jwksRow: { publicKey: string; privateKey: string };

function makeRequest(body: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost:4100/api/auth/oauth2/introspect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function introspect(token: string) {
  return introspectPost(makeRequest({ token, client_id: CLIENT_ID, client_secret: SECRET }));
}

async function seedRefreshToken(overrides: { revoked?: Date; expiresAt?: Date } = {}) {
  await td.db.insert(schema.refreshTokens).values({
    id: crypto.randomUUID(),
    tokenHash: hashToken(RT),
    userId: USER_ID,
    clientId: CLIENT_ID,
    scopes: 'openid offline_access',
    revoked: overrides.revoked ?? null,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000),
    createdAt: new Date(),
  });
}

beforeAll(async () => {
  await td.connect();
  // 真实 ES256 密钥对：既有签发类测试都整体 mock 了 @/lib/auth/token，
  // 真实验签路径从未被覆盖；此处让本测试真正穿过 jose 的 JWK 解析与验签。
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  jwksRow = {
    privateKey: JSON.stringify(await exportJWK(privateKey)),
    publicKey: JSON.stringify(await exportJWK(publicKey)),
  };
});
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser(),
    jwks: [{
      id: crypto.randomUUID(),
      kid: 'introspect-test-kid',
      algorithm: 'ES256',
      publicKey: jwksRow.publicKey,
      privateKey: jwksRow.privateKey,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 90 * 24 * 3600 * 1000),
    }],
    clients: seedPortalClient({ clientSecret: hashToken(SECRET) }),
  });
});

describe('POST /api/auth/oauth2/introspect — 客户端认证', () => {
  it('凭证缺失 → 401 invalid_client（RFC 7662 §2.1）', async () => {
    const res = await introspectPost(makeRequest({ token: 'x' }));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('invalid_client');
  });

  it('凭证错误 → 401', async () => {
    const res = await introspectPost(makeRequest({
      token: 'x', client_id: CLIENT_ID, client_secret: 'wrong',
    }));

    expect(res.status).toBe(401);
  });

  it('凭证有效但 token 缺失 → 200 { active: false }', async () => {
    const res = await introspectPost(makeRequest({
      client_id: CLIENT_ID, client_secret: SECRET,
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ active: false });
  });
});

describe('POST /api/auth/oauth2/introspect — Access Token', () => {
  it('有效 AT → active:true 且透传 sub / client_id / jti 等（RFC 7662 §2.2）', async () => {
    const { token, jti } = await signAccessToken(USER_ID, CLIENT_ID, 'openid profile');

    const body = await (await introspect(token)).json();

    expect(body.active).toBe(true);
    expect(body.sub).toBe(USER_ID);
    expect(body.client_id).toBe(CLIENT_ID);
    expect(body.jti).toBe(jti);
    expect(body.token_type).toBe('Bearer');
    expect(body.scope).toBe('openid profile');
    expect(typeof body.exp).toBe('number');
  });

  it('**已被撤销（jti 进黑名单）的 AT → active:false**（撤销机制的有效性）', async () => {
    const { token, jti } = await signAccessToken(USER_ID, CLIENT_ID, 'openid');
    // signAccessToken 以 ACCESS_TOKEN_TTL 设 exp，直接据此撤销（无需再验签一次）
    await revokeJti(jti, Math.floor(Date.now() / 1000) + TOKEN_TTL.ACCESS_TOKEN);

    const body = await (await introspect(token)).json();

    expect(body.active).toBe(false);
  });

  it('不可识别的 token → { active: false } 而非错误（RFC 7662 §2.2）', async () => {
    const res = await introspect('completely-unknown-token');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ active: false });
  });
});

describe('POST /api/auth/oauth2/introspect — Refresh Token', () => {
  it('有效 RT → active:true 且返回 scope / client_id / sub', async () => {
    await seedRefreshToken();

    const body = await (await introspect(RT)).json();

    expect(body.active).toBe(true);
    expect(body.token_type).toBe('refresh_token');
    expect(body.client_id).toBe(CLIENT_ID);
    expect(body.sub).toBe(USER_ID);
    expect(body.scope).toBe('openid offline_access');
  });

  it('**已撤销的 RT → active:false**', async () => {
    await seedRefreshToken({ revoked: new Date() });

    const body = await (await introspect(RT)).json();

    expect(body.active).toBe(false);
    expect(body.token_type).toBe('refresh_token');
  });

  it('**已过期的 RT → active:false**（时间判定不可缺失）', async () => {
    await seedRefreshToken({ expiresAt: new Date(Date.now() - 60_000) });

    const body = await (await introspect(RT)).json();

    expect(body.active).toBe(false);
  });
});
