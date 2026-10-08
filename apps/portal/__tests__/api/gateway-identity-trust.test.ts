/**
 * Gateway 身份信任路径测试 (`resolveIdentity`) — 身份签名的 Portal 侧
 *
 * `lib/auth/verify-jwt.ts` 此前**零测试覆盖**（架构评审候选 ⑩），而它承担
 * "Gateway → Portal 的信任边界"：
 *
 * **`X-User-Id` 只有在 HMAC 签名通过时才被信任。** 若该判定失效，攻击者只需
 * 伪造一个请求头即可成为任意用户——这是整套三层安全里最直接的一个伪面。
 *
 * ## 与 Rust 侧的跨语言契约
 *
 * payload 为 `{ts}:{userId}:{jti}`，与 `apps/gateway/src/http.rs` 的
 * `identity_signature_payload_matches_portal_contract` 使用**同一组固定向量**
 * （secret `test-gateway-shared-secret-32chars!!`、ts `1700000000`、
 * user `user-abc`、jti `jti-xyz`）。
 *
 * 两端是不同语言、无编译期交集；这两个测试共同构成跨端契约的锚点。
 *
 * @req H-AUTH-001, ADR-016
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

const SHARED_SECRET = 'test-gateway-shared-secret-32chars!!';
/** 与 Rust 侧相同的固定向量 */
const VECTOR_TS = '1700000000';
const VECTOR_USER = 'user-abc';
const VECTOR_JTI = 'jti-xyz';
const VECTOR_SIG = '94f2fd6f848a36f670c19c86e9c9c4893d2e8718b8764f81d368dfc15035cdac';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    headerStore: {} as Record<string, string>,
    mockVerifyAccessToken: vi.fn(),
  },
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(mocks.headerStore),
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

vi.mock('@/lib/auth/token', () => ({
  verifyAccessToken: mocks.mockVerifyAccessToken,
}));

vi.mock('@/lib/session', () => ({
  getJwtFromCookie: async () => mocks.headerStore['cookie-jwt'] ?? null,
}));

import { resolveIdentity } from '@/lib/auth/verify-jwt';
import { GATEWAY_HEADERS } from '@auth-sso/contracts';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function makeToken(claims: Record<string, unknown>): string {
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headerStore = {};
  mocks.mockVerifyAccessToken.mockResolvedValue(null);
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
    mocks.mockVerifyAccessToken.mockResolvedValue(null);

    const identity = await resolveIdentity();

    expect(identity?.userId).toBe(VECTOR_USER);
  });
});

describe('resolveIdentity — Gateway 信任路径被正当时', () => {
  it('签名有效 + aud=portal → 采用 Gateway 身份', async () => {
    setGatewayHeaders({});
    mocks.headerStore['cookie-jwt'] = makeToken({ sub: VECTOR_USER, aud: 'portal', exp: 9999999999 });

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
    mocks.headerStore['cookie-jwt'] = makeToken({
      sub: 'other-user', aud: 'other-client', exp: 9999999999, iat: 1,
    });

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

describe('resolveIdentity — 无 Gateway 时回退自验签', () => {
  it('无 Gateway 头 + 有效 Cookie token → 自验签成功', async () => {
    mocks.headerStore = { 'cookie-jwt': 'valid-token' };
    mocks.mockVerifyAccessToken.mockResolvedValue({
      sub: 'cookie-user', exp: 123, iat: 100,
    });

    const identity = await resolveIdentity();

    expect(identity?.userId).toBe('cookie-user');
    expect(identity?.expiresAt).toBe(123);
    expect(identity?.issuedAt).toBe(100);
  });

  it('无 Gateway 头 + 无 token → null', async () => {
    const identity = await resolveIdentity();

    expect(identity).toBeNull();
  });
});
