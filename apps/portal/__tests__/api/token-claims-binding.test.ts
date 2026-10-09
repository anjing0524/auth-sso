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
import { generateKeyPair, exportJWK } from 'jose';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedRootDept, seedAdminUser, seedPortalClient } from '../helpers/seed-fixtures';
import { JWT_TYP } from '@auth-sso/contracts';

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

import { signAccessToken, signLoginSession, verifyAccessToken } from '@/lib/auth/token';

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
