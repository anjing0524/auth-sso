/**
 * Token 刷新端点测试 (POST /api/auth/refresh) — RT Rotation
 *
 * 该端点此前**零测试覆盖**（架构评审候选 ⑩），而它是 token 续期的唯一入口，
 * 承载一条核心安全不变量：
 *
 * **token 明文只回传给受信任的 Gateway。** 浏览器同源脚本没有共享密钥，因此
 * 在此端点只能看到 `{ expiresIn }` + `Set-Cookie`，无法从 JSON body 读到
 * HttpOnly 保护的令牌。若这条判定失效，双 HttpOnly Cookie 的防护被直接绕过。
 *
 * 本测试**不 mock `verifySignature`**——那会让"受信任"的断言变成自证
 * （我说它可信它就可信）。只用 `node:crypto` 独立计算真实 HMAC 签名，
 * 与实现所用的 WebCrypto 分属不同库，构成真正的独立验证。
 *
 * @req H-SESS-003, H-SESS-005
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedPortalClient, seedRootDept } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';
import { hashToken } from '@/lib/crypto';
import { COOKIE_NAMES, JWT_TYP, PORTAL_CLIENT_ID, TOKEN_TTL } from '@auth-sso/contracts';

const SHARED_SECRET = 'test-gateway-shared-secret-32chars!!';

const { mocks, tdHolder } = vi.hoisted(() => {
  const cookieStore: Record<string, string> = {};
  return {
    mocks: {
      cookieStore,
      getCookies: () => ({ ...cookieStore }),
      setCookies: (v: Record<string, string | undefined>) => {
        for (const k of Object.keys(cookieStore)) delete cookieStore[k];
        for (const [k, val] of Object.entries(v)) if (val !== undefined) cookieStore[k] = val;
      },
      mockWriteLoginLog: vi.fn(),
    },
    tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
  };
});

vi.mock('next/headers', () => ({
  cookies: async () => {
    const store = mocks.getCookies();
    return {
      get: (name: string) => {
        const val = store[name];
        return val ? { name, value: val } : undefined;
      },
    };
  },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

// 只 mock 密钥来源，不 mock verifySignature 本身
vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return { ...actual, getGatewaySharedSecret: () => SHARED_SECRET };
});

// @allow-module-mock @/lib/audit infra-boundary: 审计写入是旁路副作用（fire-and-forget 写库），本文件测的是端点/动作语义
vi.mock(import('@/lib/audit'), async (importOriginal): Promise<Partial<typeof auditModule>> => {
  const actual = await importOriginal<typeof import('@/lib/audit')>();
  return { ...actual, writeLoginLog: mocks.mockWriteLoginLog };
});

import { POST as refreshPost } from '@/app/api/auth/refresh/route';
import { getActiveSigningKey } from '@/lib/auth/token';
import { getIssuer } from '@/lib/env';
import { SignJWT } from 'jose';
import type * as auditModule from '@/lib/audit';


const td = createTestDbHandle();
tdHolder.current = td;

const USER_ID = '00000000-0000-4000-8000-000000000101';
const CLIENT_ID = 'portal';
const RT = 'rt_for_refresh_endpoint_test_value';

/** 伪造示例 */
function makeAtWithExp(expOffsetSec: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + expOffsetSec;
  return `${b64({ alg: 'ES256' })}.${b64({ sub: USER_ID, exp })}.sig`;
}

/**
 * 真实 ES256 签发的 AT（H-08 修复后 skip 判定基于验签通过的 claims）。
 *
 * 用生产签发密钥直接构造任意 exp 的令牌（生产 signAccessToken 固定 1h），
 * 覆盖"剩余 >5min / <5min / 已过期"三档。
 */
async function makeSignedAtWithExp(expOffsetSec: number): Promise<string> {
  const { privateKey, keyId } = await getActiveSigningKey();
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: USER_ID, client_id: PORTAL_CLIENT_ID })
    .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: JWT_TYP.ACCESS_TOKEN })
    .setIssuedAt(nowSec)
    .setIssuer(getIssuer())
    .setAudience(PORTAL_CLIENT_ID)
    .setJti(`jti_refresh_test_${Math.random().toString(16).slice(2, 10)}`)
    .setExpirationTime(nowSec + expOffsetSec)
    .sign(privateKey);
}

/** 用 node:crypto 独立计算 Gateway 签名（与实现的 WebCrypto 不同库） */
function gatewayHeaders(payload: string, secret = SHARED_SECRET, tsOffsetSec = 0): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000) + tsOffsetSec);
  const sig = createHmac('sha256', secret).update(`refresh:${ts}`).digest('hex');
  void payload;
  return { 'x-gateway-timestamp': ts, 'x-gateway-signature': sig };
}

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:4100/api/auth/refresh', { method: 'POST', headers });
}

async function seedRefreshToken(token = RT, clientId = CLIENT_ID) {
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

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser(),
    clients: seedPortalClient({ clientId: CLIENT_ID }),
  });
  mocks.setCookies({});
});

describe('POST /api/auth/refresh — 入参前置条件', () => {
  it('缺少 Refresh Token Cookie → 401', async () => {
    const res = await refreshPost(makeRequest());

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBeDefined();
  });
});

describe('POST /api/auth/refresh — 跳过优化（H-SESS-003）', () => {
  it('当前 AT 剩余 > 5 分钟 → 跳过轮换，返回 skipped 与剩余秒数', async () => {
    mocks.setCookies({
      [COOKIE_NAMES.JWT]: await makeSignedAtWithExp(20 * 60),
      [COOKIE_NAMES.REFRESH]: RT,
    });

    const res = await refreshPost(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.skipped).toBe(true);
    expect(body.remaining).toBeGreaterThan(5 * 60);
    // 未发生轮换：RT 仍未被撤销
    const [row] = await td.db.select({ revoked: schema.refreshTokens.revoked })
      .from(schema.refreshTokens).where(eq(schema.refreshTokens.tokenHash, hashToken(RT)));
    expect(row).toBeUndefined();
  });

  it('当前 AT 剩余 < 5 分钟 → 不跳过，执行轮换', async () => {
    await seedRefreshToken();
    mocks.setCookies({
      [COOKIE_NAMES.JWT]: await makeSignedAtWithExp(60),
      [COOKIE_NAMES.REFRESH]: RT,
    });

    const res = await refreshPost(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.skipped).toBeUndefined();
  });

  it('AT 已过期（remaining < 0）→ 不跳过', async () => {
    await seedRefreshToken();
    mocks.setCookies({
      [COOKIE_NAMES.JWT]: await makeSignedAtWithExp(-3600),
      [COOKIE_NAMES.REFRESH]: RT,
    });

    const res = await refreshPost(makeRequest());

    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBeUndefined();
  });

  it('**未验签/伪造的 AT payload（exp 在未来）不得驱动"跳过刷新"**（H-08）', async () => {
    await seedRefreshToken();
    mocks.setCookies({
      [COOKIE_NAMES.JWT]: makeAtWithExp(20 * 60), // 伪造：签名无效，仅 payload 声称剩余 20min
      [COOKIE_NAMES.REFRESH]: RT,
    });

    const res = await refreshPost(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    // 修复前：未验签 decode 直接信 exp → skipped:true（RT 永不轮换）
    expect(body.skipped).toBeUndefined();
    expect(body.expiresIn).toBeGreaterThan(0);

    // 真实轮换发生：旧 RT 行被撤销
    const [row] = await td.db.select({ revoked: schema.refreshTokens.revoked })
      .from(schema.refreshTokens).where(eq(schema.refreshTokens.tokenHash, hashToken(RT)));
    expect(row!.revoked).not.toBeNull();
  });
});

describe('POST /api/auth/refresh — 轮换与 Cookie 写入', () => {
  beforeEach(async () => { await seedRefreshToken(); });

  it('有效 RT → 新 AT/RT 写入 HttpOnly Cookie，body 只含 expiresIn', async () => {
    mocks.setCookies({
      [COOKIE_NAMES.JWT]: await makeSignedAtWithExp(60),
      [COOKIE_NAMES.REFRESH]: RT,
    });

    const res = await refreshPost(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.expiresIn).toBeGreaterThan(0);
    // 不受信任的调用方（无 Gateway 签名）**不得**拿到 token 明文
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();

    const setCookie = res.headers.getSetCookie().join(';');
    expect(setCookie).toContain(COOKIE_NAMES.JWT);
    expect(setCookie).toContain(COOKIE_NAMES.REFRESH);
    expect(setCookie).toContain('HttpOnly');
  });

  it('旧 RT 被撤销、新 RT 入库（rotation 语义完整）', async () => {
    mocks.setCookies({
      [COOKIE_NAMES.JWT]: await makeSignedAtWithExp(60),
      [COOKIE_NAMES.REFRESH]: RT,
    });

    await refreshPost(makeRequest());

    const [old] = await td.db.select({ revoked: schema.refreshTokens.revoked })
      .from(schema.refreshTokens).where(eq(schema.refreshTokens.tokenHash, hashToken(RT)));
    expect(old?.revoked).not.toBeNull();

    const all = await td.db.select({ revoked: schema.refreshTokens.revoked })
      .from(schema.refreshTokens);
    expect(all.filter((r) => r.revoked === null)).toHaveLength(1);
  });

  it('无效 RT → 401 且清除两个 Cookie', async () => {
    mocks.setCookies({
      [COOKIE_NAMES.JWT]: await makeSignedAtWithExp(60),
      [COOKIE_NAMES.REFRESH]: 'not-a-valid-refresh-token',
    });

    const res = await refreshPost(makeRequest());

    expect(res.status).toBe(401);
    const setCookie = res.headers.getSetCookie().join(';');
    expect(setCookie).toContain('Max-Age=0');
  });
});

describe('POST /api/auth/refresh — Gateway 信任边界（核心安全不变量）', () => {
  beforeEach(async () => { await seedRefreshToken(); });

  it('**浏览器（无 Gateway 签名）不得从 body 读到 token 明文**', async () => {
    mocks.setCookies({
      [COOKIE_NAMES.JWT]: await makeSignedAtWithExp(60),
      [COOKIE_NAMES.REFRESH]: RT,
    });

    const body = await (await refreshPost(makeRequest())).json();

    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
  });

  it('正确签名的 Gateway 调用 → body 回传 token 明文', async () => {
    mocks.setCookies({
      [COOKIE_NAMES.JWT]: await makeSignedAtWithExp(60),
      [COOKIE_NAMES.REFRESH]: RT,
    });

    const body = await (await refreshPost(makeRequest(gatewayHeaders('refresh')))).json();

    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
  });

  it('**签错（密钥不对）不得被当作受信任**', async () => {
    mocks.setCookies({
      [COOKIE_NAMES.JWT]: await makeSignedAtWithExp(60),
      [COOKIE_NAMES.REFRESH]: RT,
    });

    const body = await (await refreshPost(
      makeRequest(gatewayHeaders('refresh', 'wrong-secret-wrong-secret-wrong!')),
    )).json();

    expect(body.accessToken).toBeUndefined();
  });

  it('**时间戳超出容忍窗口 → 拒绝（防重放）**', async () => {
    mocks.setCookies({
      [COOKIE_NAMES.JWT]: await makeSignedAtWithExp(60),
      [COOKIE_NAMES.REFRESH]: RT,
    });

    const body = await (await refreshPost(
      makeRequest(gatewayHeaders('refresh', SHARED_SECRET, -3600)),
    )).json();

    expect(body.accessToken).toBeUndefined();
  });

  it('签名头残缺（只有 timestamp）→ 拒绝', async () => {
    mocks.setCookies({
      [COOKIE_NAMES.JWT]: await makeSignedAtWithExp(60),
      [COOKIE_NAMES.REFRESH]: RT,
    });

    const body = await (await refreshPost(makeRequest({
      'x-gateway-timestamp': String(Math.floor(Date.now() / 1000)),
    }))).json();

    expect(body.accessToken).toBeUndefined();
  });
});

describe('POST /api/auth/refresh — sender 绑定（RFC 9700）', () => {
  it('**属于其他 client 的 RT 不得被轮换**（且视同重放、撤销该家族）', async () => {
    // 该 RT 绑定到 'other-client'，却出现在 Portal 的 Cookie 里。
    // 需先播种该 client：refresh_tokens.client_id 有外键约束。
    await seedTestData(td.db, { clients: seedPortalClient({ clientId: 'other-client' }) });
    await seedRefreshToken(RT, 'other-client');
    mocks.setCookies({
      [COOKIE_NAMES.JWT]: await makeSignedAtWithExp(60),
      [COOKIE_NAMES.REFRESH]: RT,
    });

    const res = await refreshPost(makeRequest());

    expect(res.status).toBe(401);
    // 归属不符 → 视同重放：该家族的 RT 应被撤销
    const [row] = await td.db.select({ revoked: schema.refreshTokens.revoked })
      .from(schema.refreshTokens).where(eq(schema.refreshTokens.tokenHash, hashToken(RT)));
    expect(row?.revoked).not.toBeNull();
  });

  it('属于 Portal 自身的 RT 正常轮换（对照，证明上一条不是拒绝一切）', async () => {
    await seedRefreshToken(RT, CLIENT_ID);
    mocks.setCookies({
      [COOKIE_NAMES.JWT]: await makeSignedAtWithExp(60),
      [COOKIE_NAMES.REFRESH]: RT,
    });

    const res = await refreshPost(makeRequest());

    expect(res.status).toBe(200);
  });
});
