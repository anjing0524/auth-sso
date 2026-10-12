/**
 * 授权码兑换 module 接口测试（真实 DB + 真实签发 + 真实权限缓存）
 *
 * 本文件直接测 `exchangeAuthorizationCode` 的 **interface**，不经过 token 路由，
 * 也不需要 HTTP 请求。这正是把编排从路由抽出的收益：真正的复杂度（原子领取、
 * 重放识别、PKCE、条件签发）现在有一个可断言的 seam。
 *
 * 关键在于失败**可判别**：重放返回 `reason: 'authorization_code_replayed'`
 * 而非被压成 `null`——重放是安全事件，调用方需要据此留审计痕迹。
 *
 * ## 真实驱动（本文件不再 mock `@/lib/auth/token`）
 *
 * 改造前这里把 `signAccessToken` / `signIdToken` / `issueRefreshToken` /
 * `revokeRefreshTokenFamily` 整体替换成替身，于是"删掉刷新令牌签发的唯一 DB
 * 写入"这一变异下 4 个文件 / 44 个用例**全绿**——签发的安全语义没有任何信号
 * 通路。现在：
 *
 * - AT / ID Token 用真实 ES256（`seedSigningKeys` 种入真密钥对）签发，并**用
 *   生产验签函数**验回，声明（sub / aud / client_id / jti / 寿命）逐项断言；
 * - RT 落**真实 `refresh_tokens` 行**，断言按哈希存储、家族字段与撤销位；
 * - 权限上下文预填充落**真实 Redis 键**；
 * - 家族撤销断言的是**真实行被标记 `revoked`**，而不是"某个 mock 被调用"。
 *
 * 唯一的替身是 `getUserPermissionContext`（见该处理由注解）：它在本文件里是
 * **输入**，不是被测语义——但要断言的三支（ok / denied / unavailable）都真被执行。
 *
 * @req H-AUTH-003, H-AUTH-004, H-AUTH-011
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { JWT_TYP, REDIS_KEY_PREFIX } from '@auth-sso/contracts';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedPortalClient, seedRootDept } from '../helpers/seed-fixtures';
import { seedSigningKeys } from '../helpers/seed-signing-keys';
import * as schema from '@/db/schema';
import { hashToken } from '@/lib/crypto';
// 显式返回类型需要模块类型；仓库的 consistent-type-imports 禁止 inline `import()`
// 类型标注，故用顶层 type-only 命名空间别名（ADR-022 §4(a) 的合规形态）
import type * as permissionsModule from '@/lib/permissions';

const { mocks, tdHolder } = vi.hoisted(() => ({
  mocks: {
    getUserPermissionContext: vi.fn(),
  },
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

// @allow-module-mock @/lib/permissions input-fixture: 权限上下文在本文件里是授权码兑换的**输入**（被测语义是兑换/重放/PKCE/条件签发）；真实 PG 驱动的权限分级由 permission-enforcement、rt-permission-failure 覆盖
vi.mock(import('@/lib/permissions'), async (importOriginal): Promise<Partial<typeof permissionsModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    // 只替换"输入"那一半：`cacheUserPermissionContext` 保持真实，它写的是真实 Redis 键
    getUserPermissionContext: mocks.getUserPermissionContext,
  };
});

import { exchangeAuthorizationCode } from '@/lib/auth/oauth-grant';
import { verifyAccessToken } from '@/lib/auth/token';
import { getRedis } from '@/infrastructure/redis';

const td = createTestDbHandle();
tdHolder.current = td;

const CLIENT_ID = 'portal';
const USER_ID = '00000000-0000-4000-8000-000000000101';
const REDIRECT_URI = 'https://app.example.com/cb';
const CODE_VERIFIER = 'v'.repeat(43);
const CHALLENGE = crypto.createHash('sha256').update(CODE_VERIFIER).digest('base64url');

const client = { clientId: CLIENT_ID };
const PERMISSION_CACHE_KEY = `${REDIS_KEY_PREFIX.USER_PERMS}${USER_ID}`;

async function seedAuthCode(overrides: Partial<typeof schema.authorizationCodes.$inferInsert> = {}) {
  await td.db.insert(schema.authorizationCodes).values({
    id: crypto.randomUUID(),
    // 与生产一致：库中存哈希（明文仅在兑换时传入）
    code: hashToken('code-1'),
    clientId: CLIENT_ID,
    userId: USER_ID,
    redirectUri: REDIRECT_URI,
    scope: 'openid offline_access',
    state: 'st',
    nonce: 'nonce-1',
    codeChallenge: CHALLENGE,
    codeChallengeMethod: 'S256',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    used: false,
    createdAt: new Date(),
    ...overrides,
  });
}

function exchange(overrides: Partial<Parameters<typeof exchangeAuthorizationCode>[0]> = {}) {
  return exchangeAuthorizationCode({
    code: 'code-1',
    client,
    redirectUri: REDIRECT_URI,
    codeVerifier: CODE_VERIFIER,
    ...overrides,
  });
}

/** 真实 `refresh_tokens` 行（断言落库形态用，不经过任何替身） */
function selectRefreshTokens() {
  return td.db
    .select({
      tokenHash: schema.refreshTokens.tokenHash,
      userId: schema.refreshTokens.userId,
      clientId: schema.refreshTokens.clientId,
      scopes: schema.refreshTokens.scopes,
      revoked: schema.refreshTokens.revoked,
    })
    .from(schema.refreshTokens);
}

/**
 * 前置：真实兑换一次，制造一个同家族的真实 RT 行。
 * "撤销 / 未撤销"两类断言都要先有这样一个可被误撤销的真实行。
 */
async function exchangeOnceToGetRealRefreshToken(): Promise<void> {
  await seedAuthCode();
  const first = await exchange();
  expect(first.ok).toBe(true);
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  // ADR-018 的分级联合：`kind` 是判别式，缺了它 `oauth-grant.ts:165` 的真实
  // 成功分支永远不会被执行（改造前正是这种旧形状）。
  mocks.getUserPermissionContext.mockResolvedValue({
    kind: 'ok',
    context: { roles: [], permissions: [], deptIds: [] },
  });
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser(),
    clients: seedPortalClient({ clientId: CLIENT_ID }),
  });
  // 真实 ES256：种入密钥对（TRUNCATE 之后，故必须在 cleanup 之后）
  await seedSigningKeys(td);
});

describe('授权码的存储形态（不得明文入库）', () => {
  /**
   * RT 以 `hashToken` 存储（DB 泄露不可直接使用）；授权码此前却是**明文**。
   * 授权码同样是可换取令牌的凭证，且 PKCE 的 code_challenge 与 code_verifier
   * 都不保护"码本身被读到即可使用"这一面——拿到明文码即可发起兑换，
   * 只差用户自己的 verifier。故其存储形态应与 RT 一致。
   */
  it('**库中不存明文授权码，只存其哈希**', async () => {
    const plainCode = 'auth_code_plaintext_must_not_be_stored';
    await seedAuthCode({ code: hashToken(plainCode) });

    const rows = await td.db
      .select({ code: schema.authorizationCodes.code })
      .from(schema.authorizationCodes);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.code).not.toBe(plainCode);
    expect(rows[0]!.code).toBe(hashToken(plainCode));
  });

  it('**以明文 code 兑换一个按哈希存储的码可以成功**（读写两侧同源）', async () => {
    const plainCode = 'auth_code_roundtrip';
    await seedAuthCode({ code: hashToken(plainCode) });

    const result = await exchange({ code: plainCode });

    // 修复前：查询按明文比对 ⇒ 找不到行 ⇒ invalid_grant
    expect(result.ok).toBe(true);
  });
});

describe('exchangeAuthorizationCode — 成功路径（真实签发）', () => {
  it('offline_access + openid → 签发真实 AT / RT / ID Token，且都能被生产验签函数验回', async () => {
    await seedAuthCode();

    const result = await exchange();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens.token_type).toBe('Bearer');
    expect(result.tokens.scope).toBe('openid offline_access');

    // AT：真实 JWT，用生产验签函数验回（ADR-013：aud / client_id = 授权对象 client）
    const atClaims = await verifyAccessToken(
      result.tokens.access_token, CLIENT_ID, JWT_TYP.ACCESS_TOKEN,
    );
    expect(atClaims).not.toBeNull();
    expect(atClaims!.sub).toBe(USER_ID);
    expect(atClaims!.aud).toBe(CLIENT_ID);
    expect(atClaims!.client_id).toBe(CLIENT_ID);
    expect(atClaims!.scope).toBe('openid offline_access');
    expect(atClaims!.jti).toBeTruthy();
    // 寿命：响应承诺的 expires_in 必须等于令牌自身声明的 exp - iat
    // （不是拿同一个常量自证，见 signAccessToken 里"iat/exp 同源"的注释）
    expect(result.tokens.expires_in).toBe(atClaims!.exp! - atClaims!.iat!);
    expect(result.tokens.expires_in).toBeGreaterThan(0);

    // RT：真实落库行，且按哈希存储（库中不得出现明文 RT）
    const refreshToken = result.tokens.refresh_token;
    expect(refreshToken).toMatch(/^rt_/);
    const rtRows = await selectRefreshTokens();
    expect(rtRows).toHaveLength(1);
    expect(rtRows[0]!.tokenHash).toBe(hashToken(refreshToken!));
    expect(rtRows[0]!.tokenHash).not.toBe(refreshToken);
    expect(rtRows[0]!.userId).toBe(USER_ID);
    expect(rtRows[0]!.clientId).toBe(CLIENT_ID);
    expect(rtRows[0]!.scopes).toBe('openid offline_access');
    expect(rtRows[0]!.revoked).toBeNull();

    // ID Token：真实 JWT，nonce 与授权码行一致
    const idClaims = await verifyAccessToken(
      result.tokens.id_token!, CLIENT_ID, JWT_TYP.ID_TOKEN,
    );
    expect(idClaims).not.toBeNull();
    expect(idClaims!.sub).toBe(USER_ID);
    expect(idClaims!.aud).toBe(CLIENT_ID);
    expect(idClaims!['nonce']).toBe('nonce-1');
  });

  it('权限上下文被**真实回填到 Redis**（不是"某个 mock 被调用"）', async () => {
    await seedAuthCode();

    const result = await exchange();
    expect(result.ok).toBe(true);

    const cached = await getRedis().get(PERMISSION_CACHE_KEY);
    expect(cached).not.toBeNull();
    expect(JSON.parse(cached!)).toEqual({ roles: [], permissions: [], deptIds: [] });
  });

  it('缺少 offline_access → 不发放 refresh_token，且**库中没有任何 RT 行**', async () => {
    await seedAuthCode({ scope: 'openid' });

    const result = await exchange();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens.refresh_token).toBeUndefined();
    expect(result.tokens.id_token).toBeDefined();

    // 真实状态断言：不是"某个函数没被调用"，而是库中确实没有行
    await expect(selectRefreshTokens()).resolves.toHaveLength(0);
  });

  it('缺少 openid → 不签发 ID Token，但 AT / RT 仍然真实可用', async () => {
    await seedAuthCode({ scope: 'offline_access' });

    const result = await exchange();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens.id_token).toBeUndefined();

    const atClaims = await verifyAccessToken(
      result.tokens.access_token, CLIENT_ID, JWT_TYP.ACCESS_TOKEN,
    );
    expect(atClaims).not.toBeNull();
    expect(result.tokens.refresh_token).toBeTruthy();
    await expect(selectRefreshTokens()).resolves.toHaveLength(1);
  });

  it('授权码在成功兑换后被置为已消费（不可二次使用）', async () => {
    await seedAuthCode();
    await exchange();

    const [row] = await td.db.select({ used: schema.authorizationCodes.used })
      .from(schema.authorizationCodes);

    expect(row?.used).toBe(true);
  });
});

describe('exchangeAuthorizationCode — ADR-018 权限上下文分级', () => {
  it('kind=denied（用户不存在/停用）→ 不签发任何令牌，且不写权限缓存', async () => {
    mocks.getUserPermissionContext.mockResolvedValue({ kind: 'denied', reason: 'inactive' });
    await seedAuthCode();

    const result = await exchange();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_grant');
    // 否决性数据：真实状态上必须没有任何令牌落库
    await expect(selectRefreshTokens()).resolves.toHaveLength(0);
    await expect(getRedis().get(PERMISSION_CACHE_KEY)).resolves.toBeNull();
  });

  it('kind=unavailable（数据库不可用）→ **不阻断签发**，只跳过缓存预填充（ADR-011 fail-open）', async () => {
    mocks.getUserPermissionContext.mockResolvedValue({ kind: 'unavailable' });
    await seedAuthCode();

    const result = await exchange();

    // 原实现把 DB 抖动也 fail-close，使一次抖动变成用户被登出；此断言钉住降级语义
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens.access_token).toBeTruthy();
    await expect(selectRefreshTokens()).resolves.toHaveLength(1);
    await expect(getRedis().get(PERMISSION_CACHE_KEY)).resolves.toBeNull();
  });
});

describe('exchangeAuthorizationCode — 失败可判别', () => {
  it('已消费的授权码 → reason=authorization_code_replayed 且**真实撤销**同家族 RT', async () => {
    await exchangeOnceToGetRealRefreshToken();
    const [beforeReplay] = await selectRefreshTokens();
    expect(beforeReplay!.revoked).toBeNull();

    const result = await exchange();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 关键：不是笼统的 invalid_grant，而是可被判别的安全事件
    expect(result.reason).toBe('authorization_code_replayed');

    // 真实效果：该家族（userId + clientId）的 RT 行被标记撤销
    const [afterReplay] = await selectRefreshTokens();
    expect(afterReplay!.revoked).not.toBeNull();
  });

  it('不存在的授权码 → invalid_grant 且**不**触发家族撤销（防随机 code DoS 放大）', async () => {
    // 先制造一个真实 RT：若错误的 code 也能触发撤销，它会被标记
    await exchangeOnceToGetRealRefreshToken();

    const result = await exchange({ code: 'never-existed' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_grant');

    const rows = await selectRefreshTokens();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revoked).toBeNull();
  });

  it('过期未消费的授权码 → invalid_grant 且不触发家族撤销', async () => {
    await exchangeOnceToGetRealRefreshToken();
    await seedAuthCode({ code: hashToken('code-expired'), expiresAt: new Date(Date.now() - 60_000) });

    const result = await exchange({ code: 'code-expired' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_grant');

    const rows = await selectRefreshTokens();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revoked).toBeNull();
  });

  it('redirect_uri 不匹配 → invalid_grant（RFC 6749 §4.1.3）', async () => {
    await seedAuthCode();

    const result = await exchange({ redirectUri: 'https://evil.example.com/cb' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_grant');
  });

  it('PKCE code_verifier 错误 → 被拒，且授权码保持已消费（防离线穷举 verifier）', async () => {
    await seedAuthCode();

    await expect(exchange({ codeVerifier: 'w'.repeat(43) })).rejects.toThrow();

    const [row] = await td.db.select({ used: schema.authorizationCodes.used })
      .from(schema.authorizationCodes);
    expect(row?.used).toBe(true);
  });

  it('授权码缺少 code_challenge → invalid_grant（OAuth 2.1 强制 PKCE）', async () => {
    await seedAuthCode({ codeChallenge: null });

    const result = await exchange();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_grant');
    if (result.reason !== 'invalid_grant') return;   // 类型收窄
    expect(result.detail).toContain('PKCE');
  });
});
