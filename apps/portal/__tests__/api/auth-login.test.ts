/**
 * 登录 API 集成测试 (POST /api/auth/login) — 真实 DB + 真实 bcrypt + 真实 Redis + 真实签发
 *
 * ## 改造前（`#45`）
 *
 * 三处安全语义全是替身：`verifyPassword`（bcrypt）、`checkBruteForce` /
 * `incrementBruteForce` / `clearBruteForceCounter`（Redis 计数）、
 * `signLoginSession`（ES256 会话签发）。于是：
 * - "密码错误"用例里密码是否正确由 `mockResolvedValueOnce(false)` 决定——
 *   bcrypt 从没被跑过；
 * - "暴力破解计数"断言的是"某个 mock 被调用"，而不是 Redis 里真有多少次失败；
 * - 登录成功时写入的会话令牌是一串常量 `'mock-login-session-jwt'`，
 *   谁也没验证过它真的能签发、能被验签。
 *
 * 现在三者全部真实驱动，断言落在**真实 Redis 计数键**、**真实可验签的会话
 * 令牌**与真实状态码上。仍保留的替身：`@/infrastructure/db`（基础设施边界）、
 * `@/lib/audit`（审计写入是旁路副作用）。
 *
 * @req H-AUTH-002, H-AUTH-006, DC-AUTH-001
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import {
  COMMON_ERRORS, JWT_TYP, PORTAL_AUD, REDIS_KEY_PREFIX, USER_LOCKED, USER_DELETED,
} from '@auth-sso/contracts';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedSigningKeys } from '../helpers/seed-signing-keys';
import type * as auditModule from '@/lib/audit';

const holder = vi.hoisted<{
  tdHolder: { current: ReturnType<typeof createTestDbHandle> | null };
}>(() => ({
  tdHolder: { current: null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return holder.tdHolder.current!.db; },
  get schema() { return holder.tdHolder.current!.schema; },
}));

// @allow-module-mock @/lib/audit infra-boundary: 审计写入是旁路副作用（本文件测登录认证语义），同时提供 ip/ua 输入；把断言改为真实 login_logs 行由 #50 负责
vi.mock(import('@/lib/audit'), async (importOriginal): Promise<Partial<typeof auditModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    writeLoginLog: () => {},
    // ADR-025 用例需要真实反映请求头（mock 仍只提供输入，不改变被测语义）
    extractClientIP: (headers: Headers) => headers.get('x-forwarded-for'),
    extractUserAgent: () => null,
  };
});

import { POST } from '@/app/api/auth/login/route';
import { storeAuthRequest } from '@/lib/session/auth-request-store';
import { NextRequest } from 'next/server';
import { hashPassword } from '@/domain/auth/password';
import { incrementBruteForce } from '@/lib/auth/brute-force';
import { verifyAccessToken } from '@/lib/auth/token';
import { getRedis } from '@/infrastructure/redis';

const now = new Date();
const U1 = '00000000-0000-4000-8000-000000000301';
const U2 = '00000000-0000-4000-8000-000000000302';
const U3 = '00000000-0000-4000-8000-000000000303';

/** 真实 bcrypt 哈希（成本 12，与生产一致）；本文件只算一次以省时 */
const CORRECT_PASSWORD = 'login-test-correct-password';
let passwordHash: string;

const bruteForceKey = (userId: string, ip = 'unknown') => `${REDIS_KEY_PREFIX.LOGIN_FAIL}${userId}:${ip}`;

function seedTestUsers() {
  return [
    {
      id: U1, username: 'user', email: 'user@example.com', name: 'User',
      passwordHash, status: 'ACTIVE' as const,
      emailVerified: true, mobileVerified: false,
      passwordHistory: null, avatarUrl: null, mobile: null, deptId: null,
      lastLoginAt: null, deletedAt: null, passwordChangedAt: null,
      createdAt: now, updatedAt: now,
    },
    {
      id: U2, username: 'locked-user', email: 'locked-user@example.com', name: 'Locked',
      passwordHash, status: USER_LOCKED as typeof USER_LOCKED,
      emailVerified: true, mobileVerified: false,
      passwordHistory: null, avatarUrl: null, mobile: null, deptId: null,
      lastLoginAt: null, deletedAt: null, passwordChangedAt: null,
      createdAt: now, updatedAt: now,
    },
    {
      id: U3, username: 'deleted-user', email: 'deleted-user@example.com', name: 'Deleted',
      passwordHash, status: USER_DELETED as typeof USER_DELETED,
      emailVerified: true, mobileVerified: false,
      passwordHistory: null, avatarUrl: null, mobile: null, deptId: null,
      lastLoginAt: null, deletedAt: now, passwordChangedAt: null,
      createdAt: now, updatedAt: now,
    },
  ];
}

const td = createTestDbHandle();
holder.tdHolder.current = td;

function buildLoginRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:4100/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** 带自定义请求头的登录请求（ADR-025：IP 维度来自 X-Forwarded-For） */
function buildLoginRequestWithHeaders(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest('http://localhost:4100/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** H-02：带 Cookie 的登录请求（登录会话 ↔ 授权请求绑定需要读取绑定 Cookie） */
function buildLoginRequestWithCookies(
  body: Record<string, unknown>,
  cookies: Record<string, string> = {},
): NextRequest {
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return new NextRequest('http://localhost:4100/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** 目标行为：`oauth_request_binding` Cookie 由 authorize 分支 B 下发、login 校验 */
const BINDING_COOKIE = 'oauth_request_binding';
const BOUND_SESSION_ID = 'sess-binding-test-1';

function storedAuthRequest(binding: string) {
  return {
    client_id: 'portal',
    redirect_uri: 'https://rp.example.com/cb',
    code_challenge: 'challenge-value',
    code_challenge_method: 'S256',
    scope: 'openid',
    state: 'st-binding',
    nonce: null,
    binding,
  };
}

beforeAll(async () => {
  await td.connect();
  passwordHash = await hashPassword(CORRECT_PASSWORD);
});
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, { users: seedTestUsers() });
  vi.clearAllMocks();
  // 真实 ES256：种入密钥对（TRUNCATE 之后）；Redis 计数由全局钩子 FLUSHDB 清零
  await seedSigningKeys(td);
});

describe('POST /api/auth/login', () => {
  it('缺少 email 字段时返回 400', async () => {
    const res = await POST(buildLoginRequest({ password: 'test123' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe(COMMON_ERRORS.VALIDATION_ERROR);
  });

  it('无效 email 格式时返回 400', async () => {
    const res = await POST(buildLoginRequest({ email: 'not-an-email', password: 'test123' }));
    expect(res.status).toBe(400);
  });

  it('用户不存在时返回 401（防枚举，不泄露用户存在性）', async () => {
    const res = await POST(buildLoginRequest({ email: 'notfound@example.com', password: 'test123' }));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.message).not.toMatch(/不存在/i);
  });

  it('密码错误（真实 bcrypt 比对失败）时返回 401，并把失败计数写进**真实 Redis 键**', async () => {
    const res = await POST(buildLoginRequest({ email: 'user@example.com', password: 'wrong-password' }));

    expect(res.status).toBe(401);
    // 真实状态：不是"某个函数被调用过"，而是 Redis 里的失败次数确实是 1
    await expect(getRedis().get(bruteForceKey(U1))).resolves.toBe('1');
  });

  it('登录成功时返回 200、写入**真实可验签**的会话令牌、并清除真实失败计数', async () => {
    // 先制造真实的失败计数，成功登录后它必须消失
    await incrementBruteForce(U1, 'unknown');
    await expect(getRedis().get(bruteForceKey(U1))).resolves.toBe('1');

    const res = await POST(buildLoginRequest({ email: 'user@example.com', password: CORRECT_PASSWORD }));

    expect(res.status).toBe(200);

    const sessionToken = res.cookies.get('login_session')?.value;
    expect(sessionToken).toBeTruthy();

    // 会话令牌必须真的是 ES256 签出来的：用生产验签函数验回，并核对 typ 与 sub
    const claims = await verifyAccessToken(sessionToken!, PORTAL_AUD, JWT_TYP.LOGIN_SESSION);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe(U1);
    expect(claims!.jti).toBeTruthy();

    await expect(getRedis().get(bruteForceKey(U1))).resolves.toBeNull();
  });

  it('邮箱大小写/前后空白归一化后仍可登录（H-18）', async () => {
    // 库里存的是 user@example.com；登录输入带大写与首尾空格，必须归一化后命中
    const res = await POST(buildLoginRequest({ email: '  User@Example.COM  ', password: CORRECT_PASSWORD }));

    expect(res.status).toBe(200);
    expect(res.cookies.get('login_session')?.value).toBeTruthy();
  });

  it('真实累计 5 次失败后返回 423（阈值来自真实计数，不是替身返回值）', async () => {
    // 阈值 5：直接写真实的失败计数，而不是让 checkBruteForce 返回 locked
    for (let i = 0; i < 5; i += 1) {
      await incrementBruteForce(U1, 'unknown');
    }

    // 刻意用**错误密码**：若实现把验密放在锁定判定之前，这次失败会把计数推到 6，
    // 下面"计数仍是 5"就会失败——这条反向断言才是"锁定后不再验密"的有效表达。
    const res = await POST(buildLoginRequest({ email: 'user@example.com', password: 'wrong-password' }));

    expect(res.status).toBe(423);
    await expect(getRedis().get(bruteForceKey(U1))).resolves.toBe('5');
  });

  it('LOCKED 状态用户登录时返回 403，且不做密码校验（错误密码也不增计数）', async () => {
    const res = await POST(
      buildLoginRequest({ email: 'locked-user@example.com', password: 'wrong-password' }),
    );

    expect(res.status).toBe(403);
    // 若实现先验密再判状态，错误密码会写入失败计数 ⇒ 这里会变成 '1' 而失败
    await expect(getRedis().get(bruteForceKey(U2))).resolves.toBeNull();
  });

  it('DELETED 状态用户登录时返回 403，且不做密码校验（错误密码也不增计数）', async () => {
    const res = await POST(
      buildLoginRequest({ email: 'deleted-user@example.com', password: 'wrong-password' }),
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.message).toMatch(/注销|锁定/);
    await expect(getRedis().get(bruteForceKey(U3))).resolves.toBeNull();
  });
});


describe('POST /api/auth/login — 登录会话与授权请求的绑定（H-02）', () => {
  it('带 session_id 但 Redis 无暂存授权请求 → 普通登录（不回跳 authorize）', async () => {
    const res = await POST(
      buildLoginRequestWithCookies(
        { email: 'user@example.com', password: CORRECT_PASSWORD, session_id: 'sess-never-stored' },
        {},
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.redirect).toBeUndefined();
  });

  it('**浏览器缺少绑定 Cookie → 不进入 OAuth 回跳**（授权请求注入的核心防线）', async () => {
    await storeAuthRequest(BOUND_SESSION_ID, storedAuthRequest('binding-abc') as never);

    const res = await POST(
      buildLoginRequestWithCookies(
        { email: 'user@example.com', password: CORRECT_PASSWORD, session_id: BOUND_SESSION_ID },
        {}, // 受害者浏览器没有攻击者发起授权时获得的绑定 Cookie
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.redirect).toBeUndefined();
  });

  it('绑定 Cookie 不匹配 → 不进入 OAuth 回跳', async () => {
    await storeAuthRequest(BOUND_SESSION_ID, storedAuthRequest('binding-abc') as never);

    const res = await POST(
      buildLoginRequestWithCookies(
        { email: 'user@example.com', password: CORRECT_PASSWORD, session_id: BOUND_SESSION_ID },
        { [BINDING_COOKIE]: 'binding-wrong' },
      ),
    );
    expect((await res.json()).redirect).toBeUndefined();
  });

  it('绑定 Cookie 匹配 → 回跳 authorize，且 login_session 携带 sid 绑定', async () => {
    await storeAuthRequest(BOUND_SESSION_ID, storedAuthRequest('binding-abc') as never);

    const res = await POST(
      buildLoginRequestWithCookies(
        { email: 'user@example.com', password: CORRECT_PASSWORD, session_id: BOUND_SESSION_ID },
        { [BINDING_COOKIE]: 'binding-abc' },
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.redirect).toContain('/api/auth/oauth2/authorize?session_id=');
    expect(json.redirect).toContain(BOUND_SESSION_ID);

    const sessionToken = res.cookies.get('login_session')?.value;
    expect(sessionToken).toBeTruthy();
    const claims = await verifyAccessToken(sessionToken!, PORTAL_AUD, JWT_TYP.LOGIN_SESSION);
    expect(claims!.sub).toBe(U1);
    // 登录凭证必须绑定到本次授权请求（authorize 分支 A 据此拒绝被注入的 session_id）
    expect((claims as unknown as { sid?: string }).sid).toBe(BOUND_SESSION_ID);
  });

  it('无 session_id 的普通登录不携带 sid claim（不改变既有链路）', async () => {
    const res = await POST(buildLoginRequest({ email: 'user@example.com', password: CORRECT_PASSWORD }));
    const sessionToken = res.cookies.get('login_session')?.value;
    const claims = await verifyAccessToken(sessionToken!, PORTAL_AUD, JWT_TYP.LOGIN_SESSION);
    expect((claims as unknown as { sid?: string }).sid).toBeUndefined();
  });
});

describe('POST /api/auth/login — 用户枚举时延侧信道（H-04，行为变化记录）', () => {
  it('不存在邮箱与存在用户密码错误的响应耗时处于同一数量级（假 bcrypt 抹平）', async () => {
    const measure = async (email: string): Promise<number> => {
      const t0 = performance.now();
      await POST(buildLoginRequest({ email, password: 'wrong-password' }));
      return performance.now() - t0;
    };
    const fake: number[] = [];
    const real: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      fake.push(await measure('notfound@example.com'));
      real.push(await measure('user@example.com'));
    }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // 修复前实测约 4ms vs 300ms（≈1%）；修复后两者都应包含真实 bcrypt 成本
    expect(avg(fake)).toBeGreaterThan(avg(real) * 0.4);
  });
});

describe('POST /api/auth/login — malformed JSON 契约（H-31）', () => {
  it('非法 JSON body → 400 VALIDATION_ERROR（此前落 500 INTERNAL）', async () => {
    const req = new NextRequest('http://localhost:4100/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json',
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe(COMMON_ERRORS.VALIDATION_ERROR);
  });

  it('非 JSON 文本 body → 400 VALIDATION_ERROR', async () => {
    const req = new NextRequest('http://localhost:4100/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not-json-at-all',
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(COMMON_ERRORS.VALIDATION_ERROR);
  });
});

describe('POST /api/auth/login — ADR-025 双维度暴力破解防护', () => {
  it('攻击者单 IP 打满 5 次后，受害者从其他 IP 仍可正常登录', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await POST(buildLoginRequestWithHeaders(
        { email: 'user@example.com', password: 'wrong-password' },
        { 'X-Forwarded-For': '203.0.113.9' },
      ));
      expect(res.status).toBe(401);
    }
    // 攻击者本 IP 下一次尝试 → 423
    const attacker = await POST(buildLoginRequestWithHeaders(
      { email: 'user@example.com', password: CORRECT_PASSWORD },
      { 'X-Forwarded-For': '203.0.113.9' },
    ));
    expect(attacker.status).toBe(423);

    // 受害者从另一个 IP 用正确密码 → 200（修复前会被锁死 15 分钟）
    const victim = await POST(buildLoginRequestWithHeaders(
      { email: 'user@example.com', password: CORRECT_PASSWORD },
      { 'X-Forwarded-For': '198.51.100.7' },
    ));
    expect(victim.status).toBe(200);
  });

  it('同一 IP 跨账户累计失败 20 次 → 429 RATE_LIMITED（枚举/撞库有成本）', async () => {
    for (let i = 0; i < 20; i += 1) {
      await incrementBruteForce(null, '203.0.113.77');
    }
    const res = await POST(buildLoginRequestWithHeaders(
      { email: 'nobody@example.com', password: 'whatever' },
      { 'X-Forwarded-For': '203.0.113.77' },
    ));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe(COMMON_ERRORS.RATE_LIMITED);
  });
});
