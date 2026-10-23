/**
 * 登出 API 集成测试 (POST /api/auth/logout) — 真实 DB + 真实 Redis + 真实验签
 *
 * 登出是**四层撤销闭环**（见 route 头注释）：
 * 1. Access Token jti → Redis 黑名单
 * 2. Login Session jti → Redis 黑名单
 * 3. 当前 Refresh Token → DB `revoked` 标记
 * 4. 按用户 ID 批量撤销全部 Refresh Token + 批量撤销 AT jti
 *
 * ## 改造前的两处致命假绿（`#44`）
 *
 * - **第 3 层零覆盖**：`beforeEach` 里一行 `mockGetRefreshTokenFromCookie
 *   .mockResolvedValue(null)` 让"按 Cookie 撤销 RT"永久不成立；变异（删掉
 *   `logout/route.ts` 的第 3 层）下 6 例全绿。
 * - **第 1/2 层只断言 mock 调用**：`revokeJti` 是替身，于是"jti 真的进了黑名单"
 *   从未被验证，更没验证"该令牌随后真的被拒"。
 *
 * 现在本文件全换真实驱动：真实 ES256 签发（`seedSigningKeys`）+ 真实 Redis
 * 黑名单 + 真实 `refresh_tokens` 行 + 真实 Cookie 读取（`next/headers` 仍是
 * 框架边界替身）。断言落在真实状态（黑名单键、DB 行）与真实效果（生产
 * `verifyAccessToken` 拒绝该令牌）上。
 *
 * 仍保留的替身只有两处：`next/headers`（框架边界，豁免）与 `@/lib/audit`
 * （审计写入是旁路副作用，注解见下）。
 *
 * @req H-SSO-003, H-SSO-004
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { SignJWT } from 'jose';
import { COOKIE_NAMES, JWT_TYP, PORTAL_CLIENT_ID } from '@auth-sso/contracts';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedPortalClient } from '../helpers/seed-fixtures';
import { seedSigningKeys } from '../helpers/seed-signing-keys';
import { hashToken } from '@/lib/crypto';
import type * as auditModule from '@/lib/audit';
import type * as redisModule from '@/infrastructure/redis';

const { faultHolder, getCookieValues, setCookieValues, tdHolder } = vi.hoisted(() => {
  const cookieStore: Record<string, string> = {};

  return {
    /** 故障注入开关：只影响写黑名单那一步（ADR-022 §3 要求可抛错的 fake） */
    faultHolder: { failBlacklistWrite: false },
    tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
    getCookieValues() {
      return { ...cookieStore };
    },
    setCookieValues(vals: Record<string, string>) {
      Object.keys(cookieStore).forEach((k) => delete cookieStore[k]);
      Object.assign(cookieStore, vals);
    },
  };
});

const td = createTestDbHandle();
tdHolder.current = td;

vi.mock('next/headers', () => ({
  cookies: async () => {
    const store = getCookieValues();
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

// 故障注入落在**基础设施边界**（豁免清单内）而不是业务模块：
// 这样 `@/lib/session/revoke` 与 `@/lib/auth/token` 都能保持真实。
// 说明：`getRedis()` 返回的是对象字面量（17 个自有可枚举属性），
// 故浅拷贝会**完整保留** exists/get/setex/incr 等方法——注入只影响 setex 这一条路径，
// 读路径（isJtiRevoked → exists）照常工作，于是"写入抛错"能被真正走到。
vi.mock(import('@/infrastructure/redis'), async (importOriginal): Promise<Partial<typeof redisModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    getRedis: () => {
      const real = actual.getRedis();
      if (!faultHolder.failBlacklistWrite) return real;
      return {
        ...real,
        setex: async () => { throw new Error('Redis down (injected)'); },
      };
    },
  };
});

// @allow-module-mock @/lib/audit infra-boundary: 审计写入是旁路副作用（本文件测登出撤销闭环），同时提供 ip/ua 输入；把断言改为真实 login_logs 行由 #50 负责
vi.mock(import('@/lib/audit'), async (importOriginal): Promise<Partial<typeof auditModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    writeLoginLog: () => {},
    extractClientIP: () => null,
    extractUserAgent: () => null,
  };
});

import { GET, POST } from '@/app/api/auth/logout/route';
import { signAccessToken, signLoginSession, verifyAccessToken, getActiveSigningKey, rotateRefreshToken } from '@/lib/auth/token';
import { decodeJwtPayload } from '@/lib/session/jwt';
import { isJtiRevoked } from '@/lib/session/revoke';
import { getRedis } from '@/infrastructure/redis';
import { getIssuer } from '@/lib/env';

const now = new Date();
const TEST_USER_ID = '00000000-0000-4000-8000-000000000301';

function seedTestUsers() {
  return [{
    id: TEST_USER_ID, username: 'testuser', email: 'test@example.com', name: 'Test',
    passwordHash: '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe',
    status: 'ACTIVE' as const,
    emailVerified: true, mobileVerified: false,
    passwordHistory: null, avatarUrl: null, mobile: null, deptId: null,
    lastLoginAt: null, deletedAt: null, passwordChangedAt: null,
    createdAt: now, updatedAt: now,
  }];
}

function buildPostRequest(): any {
  return new Request('http://localhost/api/auth/logout', { method: 'POST' });
}

/** 真实 Refresh Token 行（按哈希） */
async function seedRefreshTokenRow(clientId: string, token: string): Promise<void> {  await td.db.insert(td.schema.refreshTokens).values({
    id: crypto.randomUUID(),
    tokenHash: hashToken(token),
    userId: TEST_USER_ID,
    clientId,
    scopes: 'openid offline_access',
    createdAt: now,
    expiresAt: new Date(now.getTime() + 7 * 24 * 3600 * 1000),
  });
}

async function selectRefreshTokens() {
  return td.db
    .select({ tokenHash: td.schema.refreshTokens.tokenHash, revoked: td.schema.refreshTokens.revoked })
    .from(td.schema.refreshTokens);
}

/**
 * 手工签一枚**未被 `trackUserJti` 记录**的 AT。
 *
 * 用于隔离第 1 层：若用 `signAccessToken` 签，它会同时写入 `user_jti` 哈希，
 * 于是第 4 层的批量撤销会替第 1 层兜底——此时"第 1 层失效"在测试里不可见
 * （实测：单独把第 1 层的 `revokeJti` 改坏，用 `signAccessToken` 的用例仍绿）。
 */
async function signUntrackedAccessToken(): Promise<{ token: string; jti: string }> {
  const { privateKey, keyId } = await getActiveSigningKey();
  const issuedAt = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();

  const token = await new SignJWT({ sub: TEST_USER_ID, client_id: PORTAL_CLIENT_ID })
    .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: JWT_TYP.ACCESS_TOKEN })
    .setIssuedAt(issuedAt)
    .setIssuer(getIssuer())
    .setAudience(PORTAL_CLIENT_ID)
    .setJti(jti)
    .setExpirationTime(issuedAt + 3600)
    .sign(privateKey);

  return { token, jti };
}

/** 真实签名但**不带 jti** 的 login_session（用于"无 jti 不写黑名单"用例） */
async function signSessionWithoutJti(): Promise<string> {
  const { privateKey, keyId } = await getActiveSigningKey();
  return new SignJWT({ sub: TEST_USER_ID })
    .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: JWT_TYP.LOGIN_SESSION })
    .setExpirationTime('5m')
    .sign(privateKey);
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, {
    users: seedTestUsers(),
    // refresh_tokens.client_id → clients.clientId 有外键，需先种 client
    clients: seedPortalClient({ clientId: PORTAL_CLIENT_ID }),
  });
  await seedSigningKeys(td);

  vi.clearAllMocks();
  faultHolder.failBlacklistWrite = false;
  setCookieValues({});
});

describe('POST /api/auth/logout', () => {
  it('无 Cookie 时仍返回 200', async () => {
    const res = await POST(buildPostRequest());

    expect(res.status).toBe(200);
  });

  it('第 1 层：AT Cookie 的 jti **真实进入 Redis 黑名单**，且该令牌随即被拒', async () => {
    // 用未被 trackUserJti 记录的 AT，隔离第 1 层（见该 helper 的注释）
    const { token, jti } = await signUntrackedAccessToken();
    setCookieValues({ [COOKIE_NAMES.JWT]: token });

    // 前提：登出前该令牌有效且未撤销
    expect(await isJtiRevoked(jti)).toBe(false);
    await expect(verifyAccessToken(token, PORTAL_CLIENT_ID, JWT_TYP.ACCESS_TOKEN)).resolves.not.toBeNull();

    const res = await POST(buildPostRequest());

    expect(res.status).toBe(200);
    // 真实效果 1：黑名单里有这个 jti
    expect(await isJtiRevoked(jti)).toBe(true);
    // 真实效果 2：生产验签函数随即拒绝该令牌（登出闭环的判据）
    await expect(verifyAccessToken(token, PORTAL_CLIENT_ID, JWT_TYP.ACCESS_TOKEN)).resolves.toBeNull();

    expect(res.cookies.get(COOKIE_NAMES.JWT)?.value).toBe('');
    expect(res.cookies.get(COOKIE_NAMES.JWT)?.maxAge).toBe(0);
    expect(res.cookies.get(COOKIE_NAMES.LOGIN_SESSION)?.maxAge).toBe(0);
    expect(res.cookies.get(COOKIE_NAMES.REFRESH)?.maxAge).toBe(0);
  });

  it('第 2 层：login_session Cookie 的 jti **真实进入 Redis 黑名单**', async () => {
    const sessionToken = await signLoginSession(TEST_USER_ID);
    const sessionJti = decodeJwtPayload(sessionToken)!.jti as string;
    setCookieValues({ [COOKIE_NAMES.LOGIN_SESSION]: sessionToken });

    expect(await isJtiRevoked(sessionJti)).toBe(false);

    const res = await POST(buildPostRequest());

    expect(res.status).toBe(200);
    expect(await isJtiRevoked(sessionJti)).toBe(true);
  });

  it('第 3 层：**按 Cookie 撤销当前 Refresh Token**（真实行 revoked 置位）', async () => {
    // 改造前这一层被 beforeEach 的 `getRefreshTokenFromCookie → null` 永久绕过：
    // 删掉 route 的第 3 层后 6 例仍全绿。此处只放 RT Cookie（无 AT），
    // 于是唯一能撤销它的路径就是第 3 层。
    const plainRefreshToken = 'rt_logout_layer3_token_value';
    await seedRefreshTokenRow(PORTAL_CLIENT_ID, plainRefreshToken);
    setCookieValues({ [COOKIE_NAMES.REFRESH]: plainRefreshToken });

    const res = await POST(buildPostRequest());

    expect(res.status).toBe(200);
    const rows = await selectRefreshTokens();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revoked).not.toBeNull();

    // AC：该 RT **之后不能续期**——走真实轮换路径，必须被拒
    await expect(rotateRefreshToken(plainRefreshToken, PORTAL_CLIENT_ID)).resolves.toBeNull();
  });

  it('第 4 层：持有 AT 时按用户批量撤销**该用户全部** RT 与全部 AT jti', async () => {
    // 两个 RT：同用户不同 client。cookie 里只带其一的 AT，
    // 因此另一个只能由第 4 层（按 userId 批量）撤销。
    const plainRefreshTokenA = 'rt_layer4_client_a';
    const plainRefreshTokenB = 'rt_layer4_client_b';
    await seedTestData(td.db, { clients: seedPortalClient({ clientId: 'other-app' }) });
    await seedRefreshTokenRow(PORTAL_CLIENT_ID, plainRefreshTokenA);
    await seedRefreshTokenRow('other-app', plainRefreshTokenB);

    // 两个 AT：A 放进 cookie（第 1 层覆盖），B 不放（只能由第 4 层的 user_jti 批量撤销覆盖）
    const { token: atInCookie } = await signAccessToken(TEST_USER_ID, PORTAL_CLIENT_ID);
    const { token: atBatchOnly } = await signAccessToken(TEST_USER_ID, PORTAL_CLIENT_ID);
    const jtiBatchOnly = decodeJwtPayload(atBatchOnly)!.jti as string;
    setCookieValues({ [COOKIE_NAMES.JWT]: atInCookie });

    expect(await isJtiRevoked(jtiBatchOnly)).toBe(false);

    const res = await POST(buildPostRequest());

    expect(res.status).toBe(200);
    const rows = await selectRefreshTokens();
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.revoked !== null)).toBe(true);
    // 未随 Cookie 提交的那枚 AT 也被撤销 ⇒ 第 4 层的批量撤销真实生效
    expect(await isJtiRevoked(jtiBatchOnly)).toBe(true);
  });

  it('无法验签的 JWT Cookie 仍会清除 Cookie（不清干净就等于把用户留在半登录态）', async () => {
    setCookieValues({ [COOKIE_NAMES.JWT]: 'not-a-jwt' });

    const res = await POST(buildPostRequest());

    expect(res.status).toBe(200);
    expect(res.cookies.get(COOKIE_NAMES.JWT)?.maxAge).toBe(0);
  });

  it('黑名单写入抛错时仍然清除 Cookie（fail-open）——对照组证明故障确实被走到', async () => {
    // 对照组：不注入故障 ⇒ 同一请求会让 jti 进黑名单
    const control = await signUntrackedAccessToken();
    setCookieValues({ [COOKIE_NAMES.JWT]: control.token });
    await POST(buildPostRequest());
    await expect(isJtiRevoked(control.jti)).resolves.toBe(true);

    // 注入故障：setex 抛错被吞掉 ⇒ jti **没进**黑名单，但 Cookie 仍被清除。
    // "没进黑名单"这条反向断言是判别力所在：若故障没被走到，这里会变成 true 而失败。
    const injected = await signUntrackedAccessToken();
    setCookieValues({ [COOKIE_NAMES.JWT]: injected.token });
    faultHolder.failBlacklistWrite = true;

    const res = await POST(buildPostRequest());

    expect(res.status).toBe(200);
    expect(res.cookies.get(COOKIE_NAMES.JWT)?.maxAge).toBe(0);
    await expect(isJtiRevoked(injected.jti)).resolves.toBe(false);
  });

  it('login_session 无 jti 时**不写任何黑名单键**', async () => {
    setCookieValues({ [COOKIE_NAMES.LOGIN_SESSION]: await signSessionWithoutJti() });

    const res = await POST(buildPostRequest());

    expect(res.status).toBe(200);
    // 无 jti ⇒ 第 1/2/3 层都不该有写入（本用例既无 AT 也无 RT Cookie）
    await expect(getRedis().keys('*')).resolves.toHaveLength(0);
  });
});


describe('GET /api/auth/logout — CSRF 面（H-09）', () => {
  function buildGetRequest(headers: Record<string, string> = {}): any {
    return new Request('http://localhost:4100/api/auth/logout', { method: 'GET', headers });
  }

  it('**跨站顶级导航（Sec-Fetch-Site: cross-site）→ 返回确认页，不执行任何撤销/清 Cookie**', async () => {
    const plainRefreshToken = 'rt_get_csrf_cross_site';
    await seedRefreshTokenRow(PORTAL_CLIENT_ID, plainRefreshToken);
    setCookieValues({ [COOKIE_NAMES.REFRESH]: plainRefreshToken });

    const res = await GET(buildGetRequest({ 'sec-fetch-site': 'cross-site' }));
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('method="post"');
    // 未发生状态变更：RT 未被撤销、也未下发清除 Cookie
    const rows = await selectRefreshTokens();
    expect(rows[0]!.revoked).toBeNull();
    expect(res.cookies.get(COOKIE_NAMES.REFRESH)).toBeUndefined();
  });

  it('无 Sec-Fetch-Site 且无 Referer（可疑来源）→ 同样只返回确认页', async () => {
    const plainRefreshToken = 'rt_get_csrf_no_header';
    await seedRefreshTokenRow(PORTAL_CLIENT_ID, plainRefreshToken);
    setCookieValues({ [COOKIE_NAMES.REFRESH]: plainRefreshToken });

    const res = await GET(buildGetRequest());

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('method="post"');
    const rows = await selectRefreshTokens();
    expect(rows[0]!.revoked).toBeNull();
  });

  it('同源顶级导航（side-bar 链接，Sec-Fetch-Site: same-origin）→ 保留 H-SSO-004 四层撤销并 302 /login', async () => {
    const plainRefreshToken = 'rt_get_same_origin';
    await seedRefreshTokenRow(PORTAL_CLIENT_ID, plainRefreshToken);
    setCookieValues({ [COOKIE_NAMES.REFRESH]: plainRefreshToken });

    const res = await GET(buildGetRequest({ 'sec-fetch-site': 'same-origin' }));
    const location = res.headers.get('location')!;

    expect(res.status).toBe(307);
    expect(location).toContain('/login');
    const rows = await selectRefreshTokens();
    expect(rows[0]!.revoked).not.toBeNull();
    expect(res.cookies.get(COOKIE_NAMES.REFRESH)?.maxAge).toBe(0);
  });

  it('地址栏直接访问（Sec-Fetch-Site: none）→ 视为可信导航，执行登出', async () => {
    const plainRefreshToken = 'rt_get_direct_nav';
    await seedRefreshTokenRow(PORTAL_CLIENT_ID, plainRefreshToken);
    setCookieValues({ [COOKIE_NAMES.REFRESH]: plainRefreshToken });

    const res = await GET(buildGetRequest({ 'sec-fetch-site': 'none' }));

    expect(res.status).toBe(307);
    const rows = await selectRefreshTokens();
    expect(rows[0]!.revoked).not.toBeNull();
  });
});
