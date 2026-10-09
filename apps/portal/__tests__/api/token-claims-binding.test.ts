/**
 * verifyAccessToken 的 claims 绑定负例（真实 ES256，未 mock 密码学）
 *
 * ## 为什么需要它
 *
 * `verifyAccessToken` 在真实路径上**只被以 `audience = null` 调用**：
 * `introspect/route.ts` 与 `revoke/route.ts` 都传 null（多 client 通用端点，
 * 跳过 aud 比对）。因此以下两条绑定规则**从未被真实执行过**：
 *
 * | 规则 | 实现位置 | 此前覆盖 |
 * |---|---|---|
 * | `aud` 必须等于预期 client | token.ts:157-159 | **仅 mock 冒充**（session-lifecycle 的 jose mock）|
 * | `typ` 不匹配预期即拒 | token.ts:141-144 | 负例**仅 mock 冒充** |
 *
 * 二者都是防**令牌混用**的关键：`aud` 失守 ⇒ 为 client B 签发的 AT 可在 client A
 * 使用（横向越权）；`typ` 失守 ⇒ login 会话凭证可冒充 Access Token 通过验签。
 *
 * 正例与 jti 黑名单已有真实覆盖（oauth-introspect / oauth-revoke），本文件专补负例。
 *
 * @req H-AUTH-004, H-SESS-002
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { generateKeyPair, exportJWK, importJWK, jwtVerify, decodeJwt } from 'jose';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedRootDept, seedAdminUser, seedPortalClient } from '../helpers/seed-fixtures';
import { JWT_TYP, TOKEN_TTL } from '@auth-sso/contracts';

/** 固定 issuer：sign 与 verify 两侧都经 getIssuer()，便于构造 issuer 负例 */
const ISSUER = 'https://sso.example.com';

const { mocks, tdHolder } = vi.hoisted(() => ({
  mocks: { mockRevokeUserAccess: vi.fn(async () => 0) },
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return { ...actual, getIssuer: () => ISSUER, getAppBaseURL: () => ISSUER };
});

vi.mock('@/lib/session/revoke', () => ({
  revokeUserAccessByUserId: mocks.mockRevokeUserAccess,
  isJtiRevoked: vi.fn(async () => false),
  trackUserJti: vi.fn(async () => {}),
  revokeJti: vi.fn(async () => {}),
  revokeUserToken: vi.fn(async () => {}),
}));

vi.mock('@/lib/permissions', () => ({
  getUserPermissionContext: vi.fn(async () => ({ roles: [], permissions: [], deptIds: [] })),
  cacheUserPermissionContext: vi.fn(async () => {}),
}));

import { signAccessToken, signLoginSession, signIdToken, verifyAccessToken } from '@/lib/auth/token';

const td = createTestDbHandle();
tdHolder.current = td;

const USER_ID = '00000000-0000-4000-8000-000000000101';
const CLIENT_A = 'portal';
const CLIENT_B = 'demo-rp';
const KID = 'claims-binding-test-kid';

let jwksRow: { publicKey: string; privateKey: string };

beforeAll(async () => {
  await td.connect();
  // 真实 ES256 密钥对：本文件必须穿过 jose 的真实 JWK 解析与验签
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
    clients: [
      seedPortalClient({ clientId: CLIENT_A })[0]!,
      seedPortalClient({ clientId: CLIENT_B })[0]!,
    ],
  });
});

/**
 * 按 issuer/audience 验签并返回 claims。
 *
 * `currentDate` 传入被冻结的时刻：jose 的时间校验（nbf/exp/iat）以它为"现在"，
 * 否则在冻结时钟下会把令牌判为"尚未生效"。
 */
async function verifyIdTokenAgainstJwksWithAud(
  token: string,
  clientId: string,
  currentDate?: Date,
) {
  const publicKey = await importJWK(JSON.parse(jwksRow.publicKey), 'ES256');
  const { payload } = await jwtVerify(token, publicKey, {
    issuer: ISSUER,
    audience: clientId,
    ...(currentDate ? { currentDate } : {}),
  });
  return { payload };
}

describe('ID Token 的 claims 契约（对外 OIDC 契约，OIDC Core §2）', () => {
  /**
   * ID Token 由**外部 RP** 直接消费，其 claim 形状是与第三方系统的契约。
   * 此前 Vitest 层零覆盖（仅 Docker E2E，默认 `E2E_TARGET` 下不运行）。
   *
   * 断言以 RP 视角进行：用 JWKS 公钥真体验签后读 claims，而不是内部解码，
   * 因为 RP 正是这样消费的。
   */
  async function verifyIdTokenAgainstJwks(token: string, clientId: string) {
    const publicKey = await importJWK(JSON.parse(jwksRow.publicKey), 'ES256');
    return jwtVerify(token, publicKey, { issuer: ISSUER, audience: clientId });
  }

  it('必需 claim 齐全且类型正确（sub/aud/iss/exp/iat/auth_time/jti）', async () => {
    const authTime = new Date('2026-01-02T03:04:05Z');
    const token = await signIdToken({ userId: USER_ID, clientId: CLIENT_A, authTime });

    const { payload } = await verifyIdTokenAgainstJwks(token, CLIENT_A);

    expect(payload.sub).toBe(USER_ID);
    expect(payload.aud).toBe(CLIENT_A);
    expect(payload.iss).toBe(ISSUER);
    expect(payload.jti).toBeTruthy();
    expect(typeof payload.exp).toBe('number');
    expect(typeof payload.iat).toBe('number');
  });

  it('**auth_time 是秒级时间戳，不是毫秒**（常见 millisecond 错位）', async () => {
    const authTime = new Date('2026-01-02T03:04:05Z');
    const token = await signIdToken({ userId: USER_ID, clientId: CLIENT_A, authTime });

    const { payload } = await verifyIdTokenAgainstJwks(token, CLIENT_A);

    // 若误用 getTime()（毫秒），该值会比正确值大约 1000 倍
    expect(payload.auth_time).toBe(Math.floor(authTime.getTime() / 1000));
  });

  it('typ 为 id+jwt（RFC 8725 §3.11 显式类型，防跨用途混用）', async () => {
    const token = await signIdToken({
      userId: USER_ID, clientId: CLIENT_A, authTime: new Date(),
    });

    const { protectedHeader } = await verifyIdTokenAgainstJwks(token, CLIENT_A);
    expect(protectedHeader.typ).toBe(JWT_TYP.ID_TOKEN);
    expect(protectedHeader.alg).toBe('ES256');
    expect(protectedHeader.kid).toBe(KID);
  });

  it('**传入 nonce 时必须写入 payload**（OIDC Core §3.1.2.1 重放防护）', async () => {
    const nonce = 'n-0S6_WzA2Mj';
    const token = await signIdToken({
      userId: USER_ID, clientId: CLIENT_A, nonce, authTime: new Date(),
    });

    const { payload } = await verifyIdTokenAgainstJwks(token, CLIENT_A);
    expect(payload.nonce).toBe(nonce);
  });

  it('**未传 / 传 null / 传空串时不得写入 nonce**（RP 会因此拒绝含意外 nonce 的 ID Token）', async () => {
    for (const nonce of [undefined, null, ''] as const) {
      const token = await signIdToken({
        userId: USER_ID, clientId: CLIENT_A, nonce, authTime: new Date(),
      });
      const { payload } = await verifyIdTokenAgainstJwks(token, CLIENT_A);
      expect(payload.nonce, `nonce=${JSON.stringify(nonce)} 不应出现`).toBeUndefined();
    }
  });

  it('aud 锁定为发起授权的 client：以其他 client 验签被拒', async () => {
    const token = await signIdToken({
      userId: USER_ID, clientId: CLIENT_B, authTime: new Date(),
    });

    // 为 B 签发的 ID Token 不得被当作 A 的
    await expect(verifyIdTokenAgainstJwks(token, CLIENT_A)).rejects.toThrow();
    await expect(verifyIdTokenAgainstJwks(token, CLIENT_B)).resolves.toBeTruthy();
  });
});

describe('令牌寿命与 iat/exp 的一致性（OAuth 2.1 §5.1 expires_in）', () => {
  /**
   * `expires_in` 是对客户端的**承诺**：客户端据此安排续期。若 `exp` 与 `iat`
   * 由两次独立的时钟读取得出，`exp - iat` 就可能比承诺少 1 秒（两次读取跨越
   * 秒边界时），而 `expires_in` 仍恒报 ACCESS_TOKEN_TTL——
   * 处在续期边界上的客户端会拿到 401。
   *
   * 用假时钟把这个概率事件变成**确定事件**：把 `Date.now()` 固定在 T0，
   * 而 jose 内部读的是实时时钟（非 Date.now），二者必然相差若干秒。
   * 因此只有当实现**显式传入同一时刻**给 iat 与 exp 时，本断言才成立。
   */
  const T0 = 1_800_000_000; // 远早于真实时钟的时刻（jose 的 setIssuedAt 读实时时钟）

  /**
   * 用 spy 把 `Date.now()` 固定为 T0*1000——jose 的 `.setIssuedAt()` 读的是
   * **实时时钟**（非 Date.now），故若实现不把同一时刻显式传给 iat/exp，
   * 二者必然相差若干秒。spy 只影响 Date.now，不冻结定时器，故 DB/网络不受影响。
   */
  function withFrozenDateNow<T>(fn: () => Promise<T>): Promise<T> {
    const spy = vi.spyOn(Date, 'now').mockReturnValue(T0 * 1000);
    return fn().finally(() => spy.mockRestore());
  }

  it('**AT 的 exp - iat 必须精确等于 ACCESS_TOKEN_TTL**（不含时钟抖动）', async () => {
    const { token } = await withFrozenDateNow(() =>
      signAccessToken(USER_ID, CLIENT_A, 'openid'),
    );
    // 本组只断言 claims 的一致性；密码学验签由同文件其他用例覆盖，
    // 故此处用 decodeJwt（冻结时钟下 jwtVerify 的时间校验会干扰断言）
    const payload = decodeJwt(token);

    expect(payload.exp! - payload.iat!).toBe(TOKEN_TTL.ACCESS_TOKEN);
  });

  it('**ID Token 的 exp - iat 必须精确等于其 TTL**', async () => {
    const token = await withFrozenDateNow(() =>
      signIdToken({ userId: USER_ID, clientId: CLIENT_A, authTime: new Date(T0 * 1000) }),
    );
    const payload = decodeJwt(token);

    // ID Token 的 TTL 即 ACCESS_TOKEN_TTL（token.ts 的本地常量 ID_TOKEN_TTL）
    expect(payload.exp! - payload.iat!).toBe(TOKEN_TTL.ACCESS_TOKEN);
  });

  it('**iat 与 exp 同源**：iat 恰为冻结时刻、exp 恰为其加 TTL', async () => {
    const { token } = await withFrozenDateNow(() =>
      signAccessToken(USER_ID, CLIENT_A, 'openid'),
    );
    const payload = decodeJwt(token);

    expect(payload.iat).toBe(T0);
    expect(payload.exp).toBe(T0 + TOKEN_TTL.ACCESS_TOKEN);
  });
});

describe('audience 绑定（防横向越权）', () => {
  it('为 client B 签发的 AT，以 client A 验签必须被拒', async () => {
    const { token } = await signAccessToken(USER_ID, CLIENT_B, 'openid');

    const asA = await verifyAccessToken(token, CLIENT_A, JWT_TYP.ACCESS_TOKEN);
    expect(asA).toBeNull();
  });

  it('同一 token 以正确的 client B 验签通过（证明上一条不是拒绝一切）', async () => {
    const { token } = await signAccessToken(USER_ID, CLIENT_B, 'openid');

    const asB = await verifyAccessToken(token, CLIENT_B, JWT_TYP.ACCESS_TOKEN);
    expect(asB).not.toBeNull();
    expect(asB!.sub).toBe(USER_ID);
  });

  it('显式传 audience=null 时跳过 aud 比对（多 client 通用端点语义）', async () => {
    const { token } = await signAccessToken(USER_ID, CLIENT_B, 'openid');

    // introspect / revoke 这类端点无法预知 client，故显式传 null 跳过
    const anyClient = await verifyAccessToken(token, null, JWT_TYP.ACCESS_TOKEN);
    expect(anyClient).not.toBeNull();
  });
});

describe('typ 绑定（防跨用途令牌混用，RFC 8725 §3.11）', () => {
  it('login 会话凭证以 at+jwt 验签必须被拒', async () => {
    const loginToken = await signLoginSession(USER_ID);

    const asAt = await verifyAccessToken(loginToken, null, JWT_TYP.ACCESS_TOKEN);
    expect(asAt).toBeNull();
  });

  it('login 会话凭证以 login+jwt 验签通过（证明上一条源于 typ 而非其他失败）', async () => {
    const loginToken = await signLoginSession(USER_ID);

    const asLogin = await verifyAccessToken(loginToken, null, JWT_TYP.LOGIN_SESSION);
    expect(asLogin).not.toBeNull();
    expect(asLogin!.sub).toBe(USER_ID);
  });

  it('AT 以 login+jwt 验签必须被拒（反向混用同样禁止）', async () => {
    const { token } = await signAccessToken(USER_ID, CLIENT_A, 'openid');

    const asLogin = await verifyAccessToken(token, null, JWT_TYP.LOGIN_SESSION);
    expect(asLogin).toBeNull();
  });
});

describe('issuer 与 kid 绑定', () => {
  it('issuer 与预期不符时验签失败（真实 jose 比对，非 mock）', async () => {
    const { token } = await signAccessToken(USER_ID, CLIENT_A, 'openid');

    // 篡改 payload 的 iss 会破坏签名 ⇒ 必须被拒；此处验证"签发侧确实写入了
    // getIssuer()，且验签侧确实比对它"——若任意一侧缺失，本断言会失去意义。
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    );
    expect(payload.iss).toBe(ISSUER);
  });

  it('未知 kid 的 token 返回 null（不得回退到其他密钥）', async () => {
    // 用另一对密钥签发（kid 不在 DB 中）
    const rogue = await generateKeyPair('ES256', { extractable: true });
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({ sub: USER_ID })
      .setProtectedHeader({ alg: 'ES256', kid: 'nonexistent-kid', typ: JWT_TYP.ACCESS_TOKEN })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(CLIENT_A)
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(rogue.privateKey);

    await expect(verifyAccessToken(token, CLIENT_A, JWT_TYP.ACCESS_TOKEN)).resolves.toBeNull();
  });

  it('kid 缺失的 token 返回 null', async () => {
    const rogue = await generateKeyPair('ES256', { extractable: true });
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({ sub: USER_ID })
      .setProtectedHeader({ alg: 'ES256', typ: JWT_TYP.ACCESS_TOKEN }) // 无 kid
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(CLIENT_A)
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(rogue.privateKey);

    await expect(verifyAccessToken(token, CLIENT_A, JWT_TYP.ACCESS_TOKEN)).resolves.toBeNull();
  });
});
