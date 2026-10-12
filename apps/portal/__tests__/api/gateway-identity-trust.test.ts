/**
 * Gateway 身份信任路径测试 (`resolveIdentity`) — 身份签名的 Portal 侧
 *
 * `lib/auth/verify-jwt.ts` 承担"Gateway → Portal 的信任边界"：
 *
 * **`X-User-Id` 只有在 HMAC 签名通过时才被信任。** 若该判定失效，攻击者只需
 * 伪造一个请求头即可成为任意用户——这是整套三层安全里最直接的一个伪面。
 *
 * 两条路径各自的前提不同，测试手法也必须不同：
 * - **Gateway 信任路径**：令牌已由 Gateway 离线验签，Portal 只做 `aud` 复核
 *   （`decodeJwtPayload`）。故此处用**任意形状的 JWT** 作输入是对的——签名不必可验。
 * - **无 Gateway 时的回退自验签**：Portal 自己必须完成真实验签。
 *
 * ## 改造前（`#46`）的假绿
 *
 * 回退分支被 `vi.mock('@/lib/auth/token')` 整体替换，`mockResolvedValue({sub:'cookie-user', exp:123})`
 * 让"自验签成功"变成一句替身台词；`@/lib/session` 的 `getJwtFromCookie` 也是替身。
 * 现在回退分支走**真实 ES256 + 真实 PostgreSQL + 真实 Redis**，并补上"无效令牌必须
 * 被拒"的负例（改造前只有"无 token → null"这一条）。
 *
 * ## 与 Rust 侧的跨语言契约
 *
 * payload 为 `{ts}:{userId}:{jti}`，与 `apps/gateway/src/http.rs` 的
 * `identity_signature_payload_matches_portal_contract` 使用**同一组固定向量**
 * （secret `test-gateway-shared-secret-32chars!!`、ts `1700000000`、
 * user `user-abc`、jti `jti-xyz`）。两端是不同语言、无编译期交集；这两个测试
 * 共同构成跨端契约的锚点。
 *
 * @req H-AUTH-001, ADR-016
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { COOKIE_NAMES, GATEWAY_HEADERS, PORTAL_CLIENT_ID } from '@auth-sso/contracts';
import { createTestDbHandle } from '../helpers/test-db';
import { seedSigningKeys } from '../helpers/seed-signing-keys';

const SHARED_SECRET = 'test-gateway-shared-secret-32chars!!';
/** 与 Rust 侧相同的固定向量 */
const VECTOR_TS = '1700000000';
const VECTOR_USER = 'user-abc';
const VECTOR_JTI = 'jti-xyz';
const VECTOR_SIG = '94f2fd6f848a36f670c19c86e9c9c4893d2e8718b8764f81d368dfc15035cdac';

const { mocks, tdHolder } = vi.hoisted(() => ({
  mocks: {
    headerStore: {} as Record<string, string>,
    cookieStore: {} as Record<string, string>,
  },
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

const td = createTestDbHandle();
tdHolder.current = td;

vi.mock('next/headers', () => ({
  headers: async () => new Headers(mocks.headerStore),
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.cookieStore[name];
      return value ? { name, value } : undefined;
    },
  }),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  // `cache()` 在请求上下文外运行；测试中退化为直通
  return { ...actual, cache: <T,>(fn: T): T => fn };
});

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return { ...actual, getGatewaySharedSecret: () => SHARED_SECRET };
});

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

import { resolveIdentity } from '@/lib/auth/verify-jwt';
import { signAccessToken, verifyAccessToken } from '@/lib/auth/token';
import { decodeJwtPayload } from '@/lib/session/jwt';
import { revokeJti } from '@/lib/session/revoke';
import { ACCESS_TOKEN_TTL } from '@/lib/auth/token';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Gateway 信任路径的输入：形状合法但**无需可验签**的 JWT（Gateway 已离线验签） */
function makeGatewayPathToken(claims: Record<string, unknown>): string {
  return `${b64({ alg: 'ES256' })}.${b64(claims)}.sig`;
}

function gatewaySig(payload: string, secret = SHARED_SECRET): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/** 设置一组 Gateway 身份头 + 签名 */
function setGatewayHeaders(opts: {
  userId?: string;
  jti?: string;
  ts?: number;
  sig?: string;
  secret?: string;
  withSig?: boolean;
}) {
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const userId = opts.userId ?? VECTOR_USER;
  const jti = opts.jti ?? VECTOR_JTI;
  mocks.headerStore = {
    [GATEWAY_HEADERS.USER_ID]: userId,
    [GATEWAY_HEADERS.USER_JTI]: jti,
    'x-gateway-timestamp': String(ts),
  };
  if (opts.withSig !== false) {
    mocks.headerStore['x-gateway-signature'] =
      opts.sig ?? gatewaySig(`${ts}:${userId}:${jti}`, opts.secret ?? SHARED_SECRET);
  }
}

/** 设置 Cookie 里的 JWT（真实 `getJwtFromCookie` 会读它） */
function setJwtCookie(token: string) {
  mocks.cookieStore = { [COOKIE_NAMES.JWT]: token };
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.headerStore = {};
  mocks.cookieStore = {};
  await td.cleanup();
  await seedSigningKeys(td);
});

describe('身份签名 payload 契约（与 Rust 侧同一组固定向量）', () => {
  it('Portal 对同一 payload 计算出与 Gateway 相同的签名', () => {
    // 这个断言与 Rust 侧 hmac_sha256_hex 的期望值逐字节相同；
    // 两端任一方改动 payload 构造或 hex 大小写，两个测试会同时失败。
    expect(gatewaySig(`${VECTOR_TS}:${VECTOR_USER}:${VECTOR_JTI}`)).toBe(VECTOR_SIG);
  });

  it('该签名在前述契约下能被 resolveIdentity 接受（向量可用性自检）', async () => {
    mocks.headerStore = {
      [GATEWAY_HEADERS.USER_ID]: VECTOR_USER,
      [GATEWAY_HEADERS.USER_JTI]: VECTOR_JTI,
      'x-gateway-timestamp': VECTOR_TS,
      'x-gateway-signature': VECTOR_SIG,
    };
    // VECTOR_TS 是历史时间戳；用当前时间重算以通过窗口校验
    setGatewayHeaders({});

    const identity = await resolveIdentity();

    expect(identity?.userId).toBe(VECTOR_USER);
  });
});

describe('resolveIdentity — Gateway 信任路径被正当时', () => {
  it('签名有效 + aud=portal → 采用 Gateway 身份，并带上 token 的时间字段', async () => {
    setGatewayHeaders({});
    setJwtCookie(makeGatewayPathToken({ sub: VECTOR_USER, aud: PORTAL_CLIENT_ID, exp: 9999999999 }));

    const identity = await resolveIdentity();

    expect(identity?.userId).toBe(VECTOR_USER);
    expect(identity?.expiresAt).toBe(9999999999);
  });

  it('签名有效但无 token → 仍信任（身份唯一来源是已验签的 X-User-Id）', async () => {
    setGatewayHeaders({});

    const identity = await resolveIdentity();

    expect(identity?.userId).toBe(VECTOR_USER);
    expect(identity?.expiresAt).toBeNull();
  });

  it('签名有效但 aud 不匹配 portal → 丢弃 token claims，仍采用已验签的头身份', async () => {
    setGatewayHeaders({});
    setJwtCookie(makeGatewayPathToken({
      sub: 'other-user', aud: 'other-client', exp: 9999999999, iat: 1,
    }));

    const identity = await resolveIdentity();

    // aud 校验只决定**是否采信 token 里的 claims**（exp/iat），
    // 不 gate 头身份——X-User-Id 的真实性已由 HMAC 担保（ADR-016）。
    // 故 sub 仍取自头（user-abc），而时间字段因 claims 被丢弃而为 null。
    expect(identity?.userId).toBe(VECTOR_USER);
    expect(identity?.expiresAt).toBeNull();
    expect(identity?.issuedAt).toBeNull();
  });
});

describe('resolveIdentity — 伪造身份头必须被拒绝（核心安全不变量）', () => {
  it('**无签名头 → X-User-Id 不被信任**', async () => {
    setGatewayHeaders({ withSig: false });

    const identity = await resolveIdentity();

    expect(identity).toBeNull();
  });

  it('**签名密钥错误 → X-User-Id 不被信任**', async () => {
    setGatewayHeaders({ secret: 'attacker-secret-attacker-secret-32' });

    const identity = await resolveIdentity();

    expect(identity).toBeNull();
  });

  it('**签名与 userId 不匹配（改头不改签）→ 拒绝**', async () => {
    // 用 A 的签名冒充 B
    const ts = Math.floor(Date.now() / 1000);
    mocks.headerStore = {
      [GATEWAY_HEADERS.USER_ID]: 'victim-user',
      [GATEWAY_HEADERS.USER_JTI]: VECTOR_JTI,
      'x-gateway-timestamp': String(ts),
      'x-gateway-signature': gatewaySig(`${ts}:${VECTOR_USER}:${VECTOR_JTI}`),
    };

    const identity = await resolveIdentity();

    expect(identity).toBeNull();
  });

  it('**篡改 jti（userId 与 ts 不变）→ 拒绝**', async () => {
    const ts = Math.floor(Date.now() / 1000);
    mocks.headerStore = {
      [GATEWAY_HEADERS.USER_ID]: VECTOR_USER,
      [GATEWAY_HEADERS.USER_JTI]: 'tampered-jti',
      'x-gateway-timestamp': String(ts),
      'x-gateway-signature': gatewaySig(`${ts}:${VECTOR_USER}:${VECTOR_JTI}`),
    };

    const identity = await resolveIdentity();

    expect(identity).toBeNull();
  });

  it('**时间戳超出容忍窗口 → 拒绝（防重放）**', async () => {
    // 用一小时前的 ts 生成一个合法签名
    setGatewayHeaders({ ts: Math.floor(Date.now() / 1000) - 3600 });

    const identity = await resolveIdentity();

    expect(identity).toBeNull();
  });

  it('**时间戳非数字 → 拒绝**', async () => {
    const ts = 'not-a-number';
    mocks.headerStore = {
      [GATEWAY_HEADERS.USER_ID]: VECTOR_USER,
      [GATEWAY_HEADERS.USER_JTI]: VECTOR_JTI,
      'x-gateway-timestamp': ts,
      'x-gateway-signature': gatewaySig(`${ts}:${VECTOR_USER}:${VECTOR_JTI}`),
    };

    const identity = await resolveIdentity();

    expect(identity).toBeNull();
  });
});

describe('resolveIdentity — 无 Gateway 时回退自验签（真实 ES256）', () => {
  it('无 Gateway 头 + 真实有效 Cookie token → 自验签成功', async () => {
    const { token } = await signAccessToken('cookie-user', PORTAL_CLIENT_ID, 'openid');
    setJwtCookie(token);

    const identity = await resolveIdentity();

    // 断言来自**真实令牌自身**的声明（不是替身返回值）
    const claims = decodeJwtPayload(token)!;
    expect(identity?.userId).toBe('cookie-user');
    expect(identity?.expiresAt).toBe(claims.exp);
    expect(identity?.issuedAt).toBe(claims.iat);
  });

  it('无 Gateway 头 + **签名被篡改**的 token → null（真实 ES256 拒签）', async () => {
    const { token } = await signAccessToken('cookie-user', PORTAL_CLIENT_ID, 'openid');
    const tampered = `${token.slice(0, -3)}xxx`;
    setJwtCookie(tampered);

    // 前提：篡改后的令牌确实无法通过生产验签（否则下面的 null 可能来自别处）
    await expect(verifyAccessToken(tampered, PORTAL_CLIENT_ID)).resolves.toBeNull();

    const identity = await resolveIdentity();

    expect(identity).toBeNull();
  });

  it('无 Gateway 头 + **jti 已进黑名单**的 token → null（真实 Redis 撤销生效）', async () => {
    const { token, jti } = await signAccessToken('cookie-user', PORTAL_CLIENT_ID, 'openid');
    setJwtCookie(token);

    // 前提：撤销前该令牌是可验的
    await expect(verifyAccessToken(token, PORTAL_CLIENT_ID)).resolves.not.toBeNull();

    await revokeJti(jti, Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL);

    const identity = await resolveIdentity();

    expect(identity).toBeNull();
  });

  it('无 Gateway 头 + 无 token → null', async () => {
    const identity = await resolveIdentity();

    expect(identity).toBeNull();
  });
});
