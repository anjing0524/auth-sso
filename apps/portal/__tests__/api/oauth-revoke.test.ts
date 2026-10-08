/**
 * Token Revocation 端点测试 (POST /api/auth/oauth2/revoke) — RFC 7009
 *
 * 该端点此前**零测试覆盖**（架构评审候选 ⑩），而它承载两条安全不变量：
 *
 * 1. **跨 client 撤销必须被阻断**（RFC 7009 §2.1）：AT 按 `client_id` claim 判定归属，
 *    RT 按 `clientId` 限定查询；他人 token 一律静默忽略。若不测，任何对该判断的
 *    改动都可能把撤销端点变成"撤销任意他人令牌"的 DoS 通道。
 * 2. **即使不该撤销也必须返回 200**（RFC 7009 §2.2）：客户端不应能通过响应码探测
 *    token 是否存在或是否属于自己（防枚举）。
 *
 * @req H-SESS-006, ADR-013
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedPortalClient, seedRootDept } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';
import { hashToken } from '@/lib/crypto';
import { exportJWK, generateKeyPair } from 'jose';

const { tdHolder } = vi.hoisted(() => ({
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

import { POST as revokePost } from '@/app/api/auth/oauth2/revoke/route';
import { signAccessToken } from '@/lib/auth/token';

const td = createTestDbHandle();
tdHolder.current = td;

let jwksRow: { kid: string; privateKey: string; publicKey: string };

const USER_ID = '00000000-0000-4000-8000-000000000101';
const CLIENT_A = 'client-a';
const CLIENT_B = 'client-b';
const SECRET_A = 'secret-a';
const SECRET_B = 'secret-b';

const RT_A = 'rt_for_client_a_aaaaaaaaaaaa';
const RT_B = 'rt_for_client_b_bbbbbbbbbbbb';

function makeRequest(body: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost:4100/api/auth/oauth2/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function seedRefreshToken(token: string, clientId: string) {
  await td.db.insert(schema.refreshTokens).values({
    id: crypto.randomUUID(),
    tokenHash: hashToken(token),
    userId: USER_ID,
    clientId,
    scopes: 'openid offline_access',
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    createdAt: new Date(),
  });
}

async function isRefreshTokenRevoked(token: string): Promise<boolean> {
  const [row] = await td.db.select({ revoked: schema.refreshTokens.revoked })
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.tokenHash, hashToken(token)));
  return !!row?.revoked;
}

/** jti 是否已进黑名单（revokeJti 写 Redis） */
async function isJtiRevoked(jti: string): Promise<boolean> {
  const { isJtiRevoked: check } = await import('@/lib/session');
  return check(jti);
}

/**
 * 真实 ES256 密钥对。
 *
 * 刻意不用 `seedJwks()`：那组硬编码 JWK 无法被 jose 用于验签，且既有签发类测试都
 * 整体 mock 了 `@/lib/auth/token`，导致**真实验签路径从未被覆盖**。此处生成可用密钥，
 * 使本测试真正穿过 `verifyAccessToken` 的 JWK 解析与 ES256 验签。
 */
beforeAll(async () => {
  await td.connect();
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  jwksRow = {
    kid: 'revoke-test-kid',
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
      kid: jwksRow.kid,
      algorithm: 'ES256',
      publicKey: jwksRow.publicKey,
      privateKey: jwksRow.privateKey,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 90 * 24 * 3600 * 1000),
    }],
    clients: [
      ...seedPortalClient({
        clientId: CLIENT_A,
        clientSecret: hashToken(SECRET_A),
      }),
      ...seedPortalClient({
        clientId: CLIENT_B,
        clientSecret: hashToken(SECRET_B),
      }),
    ],
  });
});

describe('POST /api/auth/oauth2/revoke — 客户端认证', () => {
  it('client_id 与 secret 均缺失 → 401 invalid_client', async () => {
    const res = await revokePost(makeRequest({ token: 'whatever' }));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('invalid_client');
  });

  it('client_secret 错误 → 401 invalid_client', async () => {
    const res = await revokePost(makeRequest({
      token: 'whatever', client_id: CLIENT_A, client_secret: 'wrong',
    }));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('invalid_client');
  });

  it('未注册的 client_id → 401 invalid_client', async () => {
    const res = await revokePost(makeRequest({
      token: 'whatever', client_id: 'ghost', client_secret: 'x',
    }));

    expect(res.status).toBe(401);
  });

  it('凭证有效但 token 缺失 → 200（RFC 7009 §2.2）', async () => {
    const res = await revokePost(makeRequest({ client_id: CLIENT_A, client_secret: SECRET_A }));

    expect(res.status).toBe(200);
  });
});

describe('POST /api/auth/oauth2/revoke — Access Token 撤销', () => {
  it('本 client 的 AT → jti 进入黑名单', async () => {
    const { token, jti } = await signAccessToken(USER_ID, CLIENT_A);

    const res = await revokePost(makeRequest({
      token, client_id: CLIENT_A, client_secret: SECRET_A,
    }));

    expect(res.status).toBe(200);
    expect(await isJtiRevoked(jti)).toBe(true);
  });

  it('**他人 client 的 AT → 静默忽略，不得撤销**（跨 client DoS 阻断）', async () => {
    const { token, jti } = await signAccessToken(USER_ID, CLIENT_B);

    // 用 client A 的凭证尝试撤销 client B 的 token
    const res = await revokePost(makeRequest({
      token, client_id: CLIENT_A, client_secret: SECRET_A,
    }));

    // RFC 7009：不告知失败，但**绝不能真的撤销**
    expect(res.status).toBe(200);
    expect(await isJtiRevoked(jti)).toBe(false);
  });

  it('token_type_hint=refresh_token 时跳过 AT 分支', async () => {
    const { token, jti } = await signAccessToken(USER_ID, CLIENT_A);

    await revokePost(makeRequest({
      token, token_type_hint: 'refresh_token',
      client_id: CLIENT_A, client_secret: SECRET_A,
    }));

    expect(await isJtiRevoked(jti)).toBe(false);
  });
});

describe('POST /api/auth/oauth2/revoke — Refresh Token 撤销', () => {
  it('本 client 的 RT → DB revoked 被置位', async () => {
    await seedRefreshToken(RT_A, CLIENT_A);

    const res = await revokePost(makeRequest({
      token: RT_A, token_type_hint: 'refresh_token',
      client_id: CLIENT_A, client_secret: SECRET_A,
    }));

    expect(res.status).toBe(200);
    expect(await isRefreshTokenRevoked(RT_A)).toBe(true);
  });

  it('**他人 client 的 RT → 不得撤销**（查询按 clientId 限定）', async () => {
    await seedRefreshToken(RT_B, CLIENT_B);

    const res = await revokePost(makeRequest({
      token: RT_B, token_type_hint: 'refresh_token',
      client_id: CLIENT_A, client_secret: SECRET_A,
    }));

    expect(res.status).toBe(200);
    expect(await isRefreshTokenRevoked(RT_B)).toBe(false);
  });

  it('本 client 的 RT 被撤销后另一 client 的 RT 不受影响', async () => {
    await seedRefreshToken(RT_A, CLIENT_A);
    await seedRefreshToken(RT_B, CLIENT_B);

    await revokePost(makeRequest({
      token: RT_A, token_type_hint: 'refresh_token',
      client_id: CLIENT_A, client_secret: SECRET_A,
    }));

    expect(await isRefreshTokenRevoked(RT_A)).toBe(true);
    expect(await isRefreshTokenRevoked(RT_B)).toBe(false);
  });

  it('不存在的 token → 200 且不产生任何撤销（RFC 7009 §2.2）', async () => {
    const res = await revokePost(makeRequest({
      token: 'nonexistent-token-value',
      client_id: CLIENT_A, client_secret: SECRET_A,
    }));

    expect(res.status).toBe(200);
    const rows = await td.db.select({ revoked: schema.refreshTokens.revoked })
      .from(schema.refreshTokens);
    expect(rows.every((r) => r.revoked === null)).toBe(true);
  });
});
