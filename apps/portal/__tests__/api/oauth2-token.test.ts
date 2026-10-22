/**
 * OAuth 2.1 Token 端点集成测试 (POST /api/auth/oauth2/token) — 真实 DB + 真实签发
 *
 * 覆盖修复规划 F1/F2/F7 的端点语义：
 * - F1（RFC 6749 §4.1.3）：authorization_code grant 的 redirect_uri 必填且强制比对
 * - F2（RFC 6749 §2.3.1）：client_secret_basic / client_secret_post 双通道凭证
 * - F7（RFC 9700 §4.2.4）：已消费授权码重放 → 撤销同授权家族 Refresh Token
 *
 * ## 真实驱动（本文件不再 mock `@/lib/auth/token`）
 *
 * 改造前把 `signAccessToken` / `signIdToken` / `issueRefreshToken` /
 * `rotateRefreshToken` / `revokeRefreshTokenFamily` 整体替换成替身，于是：
 * 签发是否真的落库、轮换是否真的撤销旧行，本文件一概看不见——断言的全是
 * 「某个 mock 被以什么参数调用」。现在：
 *
 * - AT / ID Token 用真实 ES256（`seedSigningKeys` 种入真密钥对）签发，并用**生产**
 *   `verifyAccessToken` 验回，逐项断言 ADR-013 的 aud / client_id / scope；
 * - RT 落**真实 `refresh_tokens` 行**（按哈希存储），门控断言"库中有没有行"；
 * - refresh_token grant 走真实轮换：旧行 `revoked` 被置位 + 新行落库；
 * - 重放检测的家族撤销断言**真实行被标记 `revoked`**。
 *
 * 仍保留的替身只有一处（有注解）：`@/lib/audit`（旁路副作用 + ip/ua 输入；把审计断言
 * 改为真实 `login_logs` 行的债记在 #50——`writeLoginLog` 是 fire-and-forget，直接断言
 * 行会有竞态）。`@/lib/permissions` 的替身已移除：分级判定搬进 `resolveIssuancePermission`
 * 后，那个"输入替身"不再影响任何断言（真身读真实 DB 得到同样的空上下文），
 * 留着会谎称自己还在驱动被测语义。
 *
 * @req H-AUTH-003, H-AUTH-004, H-AUTH-011
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { JWT_TYP, type LoginEventType } from '@auth-sso/contracts';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { hashToken } from '@/lib/crypto';
import { seedPortalClient, seedRootDept, seedTestUser } from '../helpers/seed-fixtures';
import { seedSigningKeys } from '../helpers/seed-signing-keys';
import type * as auditModule from '@/lib/audit';

const { tdHolder } = vi.hoisted(() => ({
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

// @allow-module-mock @/lib/audit input-fixture: 只替换 ip/ua 两个**输入**helper（测试请求没有真实来源信息）；`writeLoginLog` 走真身，审计断言落在真实 `login_logs` 行上（#50）
vi.mock(import('@/lib/audit'), async (importOriginal): Promise<Partial<typeof auditModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    extractClientIP: () => null,
    extractUserAgent: () => null,
  };
});

import { POST } from '@/app/api/auth/oauth2/token/route';
import { NextRequest } from 'next/server';
import { verifyAccessToken } from '@/lib/auth/token';

const td = createTestDbHandle();
tdHolder.current = td;

const now = new Date();
const REDIRECT_URI = 'https://rp.example.com/cb';
const VERIFIER = 'test-verifier-43-chars-abcdefghijklmnopqrstuvwxyz';
const CHALLENGE = crypto.createHash('sha256').update(VERIFIER).digest('base64url');
const USER_ID = '00000000-0000-4000-8000-000000000201';
const CLIENT = seedPortalClient({
  clientId: 'portal',
  redirectUris: [REDIRECT_URI],
})[0]!;

/** 种一个授权码行（与生产一致：库中存哈希），可指定 used / scope / 归属 client / 过期时刻 */
async function seedAuthCode(
  code: string,
  used: boolean,
  options: { scope?: string; clientId?: string; expiresAt?: Date } = {},
): Promise<void> {
  await td.db.insert(td.schema.authorizationCodes).values({
    id: crypto.randomUUID(),
    code: hashToken(code),
    clientId: options.clientId ?? 'portal',
    userId: USER_ID,
    redirectUri: REDIRECT_URI,
    scope: options.scope ?? 'openid profile email offline_access',
    state: 'st-' + code.slice(-6),
    nonce: null,
    codeChallenge: CHALLENGE,
    codeChallengeMethod: 'S256',
    expiresAt: options.expiresAt ?? new Date(now.getTime() + 5 * 60 * 1000),
    used,
    createdAt: now,
  });
}

/** 种一个真实的 Refresh Token 行（按哈希），用于轮换 / 家族撤销的真实状态断言 */
async function seedRefreshTokenRow(clientId: string, token: string): Promise<void> {
  await td.db.insert(td.schema.refreshTokens).values({
    id: crypto.randomUUID(),
    tokenHash: hashToken(token),
    userId: USER_ID,
    clientId,
    scopes: 'openid profile email offline_access',
    createdAt: now,
    expiresAt: new Date(now.getTime() + 7 * 24 * 3600 * 1000),
  });
}

/**
 * 等待 `login_logs` 里出现指定事件类型的真实行。
 *
 * `writeLoginLog` 是 **fire-and-forget**（内部最多 3 次重试、首次失败退避 1s），
 * 因此调用返回时行可能还没落库——直接断言行会有竞态，故轮询等待。
 */
async function waitForLoginLog(eventType: LoginEventType, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await td.db
      .select({ id: td.schema.loginLogs.id, username: td.schema.loginLogs.username })
      .from(td.schema.loginLogs)
      .where(eq(td.schema.loginLogs.eventType, eventType));
    if (rows.length > 0 || Date.now() > deadline) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** 真实 `refresh_tokens` 行（不经过任何替身） */
function selectRefreshTokens() {
  return td.db
    .select({
      tokenHash: td.schema.refreshTokens.tokenHash,
      userId: td.schema.refreshTokens.userId,
      clientId: td.schema.refreshTokens.clientId,
      scopes: td.schema.refreshTokens.scopes,
      revoked: td.schema.refreshTokens.revoked,
    })
    .from(td.schema.refreshTokens);
}

function buildRequest(body: Record<string, unknown>, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:4100/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function codeGrantBody(code: string): Record<string, unknown> {
  return {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
    client_id: 'portal',
    client_secret: 'portal-secret',
  };
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  await td.cleanup();
  // authorization_codes.user_id → users → departments 外键链，按依赖顺序种齐；
  // 另种 other-app 供跨 client 隔离用例满足 authorization_codes.client_id 外键
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedTestUser(),
    clients: [CLIENT, seedPortalClient({ clientId: 'other-app' })[0]!],
  });
  vi.clearAllMocks();
  // 真实 ES256：种入密钥对（TRUNCATE 之后，故必须在 cleanup 之后）
  await seedSigningKeys(td);
});

describe('POST /api/auth/oauth2/token — redirect_uri 强制比对（F1, RFC 6749 §4.1.3）', () => {
  it('authorization_code grant 缺少 redirect_uri 返回 400', async () => {
    await seedAuthCode('code-no-redirect', false);
    const body = codeGrantBody('code-no-redirect');
    delete body['redirect_uri'];

    const res = await POST(buildRequest(body));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('invalid_request');
  });

  it('redirect_uri 与授权请求不一致返回 invalid_grant', async () => {
    await seedAuthCode('code-mismatch', false);
    const body = { ...codeGrantBody('code-mismatch'), redirect_uri: 'https://evil.example.com/cb' };

    const res = await POST(buildRequest(body));
    const json = await res.json();

    expect(json.error).toBe('invalid_grant');
  });

  it('redirect_uri 一致且 PKCE 通过时签发**真实** AT / RT / ID Token', async () => {
    await seedAuthCode('code-ok', false);

    const res = await POST(buildRequest(codeGrantBody('code-ok')));
    const json = await res.json();

    expect(res.status).toBe(200);

    // AT：真实 JWT，用生产验签函数验回；ADR-013 的 aud / client_id claim 逐项断言
    const atClaims = await verifyAccessToken(json.access_token, 'portal', JWT_TYP.ACCESS_TOKEN);
    expect(atClaims).not.toBeNull();
    expect(atClaims!.sub).toBe(USER_ID);
    expect(atClaims!.aud).toBe('portal');
    expect(atClaims!.client_id).toBe('portal');
    expect(atClaims!.scope).toBe('openid profile email offline_access');

    // RT：真实落库行（按哈希，库中无明文）
    expect(json.refresh_token).toMatch(/^rt_/);
    const rows = await selectRefreshTokens();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashToken(json.refresh_token));
    expect(rows[0]!.tokenHash).not.toBe(json.refresh_token);
    expect(rows[0]!.userId).toBe(USER_ID);
    expect(rows[0]!.clientId).toBe('portal');
    expect(rows[0]!.revoked).toBeNull();

    // ID Token：真实 JWT
    const idClaims = await verifyAccessToken(json.id_token, 'portal', JWT_TYP.ID_TOKEN);
    expect(idClaims).not.toBeNull();
    expect(idClaims!.sub).toBe(USER_ID);
  });

  it('refresh_token grant 不要求 redirect_uri，且**轮换真实落库**（旧行撤销 + 新行签发）', async () => {
    const oldRefreshToken = 'rt_old_for_rotation_test_value';
    await seedRefreshTokenRow('portal', oldRefreshToken);

    const res = await POST(buildRequest({
      grant_type: 'refresh_token', refresh_token: oldRefreshToken,
      client_id: 'portal', client_secret: 'portal-secret',
    }));
    const json = await res.json();

    expect(res.status).toBe(200);

    // 新 AT 真实可验
    const atClaims = await verifyAccessToken(json.access_token, 'portal', JWT_TYP.ACCESS_TOKEN);
    expect(atClaims).not.toBeNull();
    expect(atClaims!.sub).toBe(USER_ID);

    // 真实轮换：旧行被标记撤销、新行落库且与新返回的 RT 哈希一致
    // RFC 6749 §5.1：**授予的 scope 必须回报**。
    // 授权码分支一直带 `scope`，而本分支此前手拼响应体时漏了它
    //（轮换当时手里就有 rt.scopes，只是 RefreshTokenResult 没返回）——
    // 2026-10-13 修复，架构评审 R2 次级候选「token 签发族统一返回形状」。
    expect(json.token_type).toBe('Bearer');
    expect(typeof json.expires_in).toBe('number');
    expect(json.scope).toBe('openid profile email offline_access');
    // 新 AT 的 scope claim 与响应体一致（同一来源 rt.scopes）
    expect(atClaims!.scope).toBe(json.scope);

    const rows = await selectRefreshTokens();
    expect(rows).toHaveLength(2);
    const oldRow = rows.find(r => r.tokenHash === hashToken(oldRefreshToken));
    const newRow = rows.find(r => r.tokenHash === hashToken(json.refresh_token));
    expect(oldRow).toBeDefined();
    expect(newRow).toBeDefined();
    expect(oldRow!.revoked).not.toBeNull();
    expect(newRow!.revoked).toBeNull();
    expect(newRow!.tokenHash).not.toBe(oldRow!.tokenHash);
  });
});

describe('POST /api/auth/oauth2/token — client_secret_basic（F2, RFC 6749 §2.3.1）', () => {
  it('Basic 头凭证可完成认证（body 无 client_id/client_secret）', async () => {
    await seedAuthCode('code-basic', false);
    const basic = Buffer.from('portal:portal-secret').toString('base64');
    const body = codeGrantBody('code-basic');
    delete body['client_id'];
    delete body['client_secret'];

    const res = await POST(buildRequest(body, { authorization: `Basic ${basic}` }));

    expect(res.status).toBe(200);
  });

  it('Basic 凭证错误返回 invalid_client', async () => {
    await seedAuthCode('code-basic-bad', false);
    const basic = Buffer.from('portal:wrong-secret').toString('base64');
    const body = codeGrantBody('code-basic-bad');
    delete body['client_id'];
    delete body['client_secret'];

    const res = await POST(buildRequest(body, { authorization: `Basic ${basic}` }));
    const json = await res.json();

    expect(json.error).toBe('invalid_client');
  });
});

describe('POST /api/auth/oauth2/token — 凭证校验契约（RFC 6749 §5.2）', () => {
  it('client_secret 缺失 → 401 invalid_client（confidential client 必须凭密钥）', async () => {
    await seedAuthCode('code-no-secret', false);
    const body = codeGrantBody('code-no-secret');
    delete body['client_secret'];

    const res = await POST(buildRequest(body));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('invalid_client');
  });

  it('**client 已停用 → 401 invalid_client，不得凭正确密钥放行**', async () => {
    // 覆盖 validateClientActive 的停用分支。该分支此前对 token 端点**零覆盖**：
    // 变异「跳过 validateClientActive」后 14 个测试全绿——即停用一个应用后，
    // 它仍能凭正确密钥换取令牌（停用形同虚设）。
    await seedTestData(td.db, {
      clients: [seedPortalClient({ clientId: 'disabled-app', status: 'DISABLED' })[0]!],
    });
    await seedAuthCode('code-disabled', false);
    const body = codeGrantBody('code-disabled');
    body['client_id'] = 'disabled-app';
    body['client_secret'] = 'portal-secret';

    const res = await POST(buildRequest(body));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('invalid_client');
  });

  it('**client 未配置密钥（DB client_secret 为 NULL）→ 401，不得放行**', async () => {
    // 覆盖 validateClientSecret 的「客户端密钥未配置」分支——此前零测试。
    // 安全含义：密钥未配置的 client 若无条件放行，等于一个无凭据即可认证的后门。
    await seedTestData(td.db, {
      clients: [seedPortalClient({ clientId: 'no-secret-app', clientSecret: null })[0]!],
    });
    await seedAuthCode('code-null-secret', false);
    const body = codeGrantBody('code-null-secret');
    body['client_id'] = 'no-secret-app';

    const res = await POST(buildRequest(body));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('invalid_client');
  });
});

describe('POST /api/auth/oauth2/token — RT 按 offline_access 门控（D3, OIDC Core §11）', () => {
  it('scope 含 offline_access 时发放 refresh_token（真实落库，scopes 与授权一致）', async () => {
    await seedAuthCode('code-rt-with', false);

    const res = await POST(buildRequest(codeGrantBody('code-rt-with')));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.refresh_token).toMatch(/^rt_/);
    const rows = await selectRefreshTokens();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashToken(json.refresh_token));
    expect(rows[0]!.scopes).toBe('openid profile email offline_access');
  });

  it('scope 不含 offline_access 时不发放 refresh_token，且**库中没有任何 RT 行**', async () => {
    await seedAuthCode('code-rt-without', false, { scope: 'openid profile' });

    const res = await POST(buildRequest(codeGrantBody('code-rt-without')));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.refresh_token).toBeUndefined();
    // 真实状态断言：不是"某个函数没被调用"，而是库中确实没有行
    await expect(selectRefreshTokens()).resolves.toHaveLength(0);
  });
});

describe('POST /api/auth/oauth2/token — 授权码重放检测（F7, RFC 9700 §4.2.4）', () => {
  it('已消费授权码被再次兑换时撤销同家族 Refresh Token（**真实行被标记 revoked**）', async () => {
    const familyRefreshToken = 'rt_portal_family_to_be_revoked';
    await seedRefreshTokenRow('portal', familyRefreshToken);
    await seedAuthCode('code-replayed', true);

    const res = await POST(buildRequest(codeGrantBody('code-replayed')));
    const json = await res.json();

    expect(json.error).toBe('invalid_grant');

    const rows = await selectRefreshTokens();
    const familyRow = rows.find(r => r.tokenHash === hashToken(familyRefreshToken));
    expect(familyRow).toBeDefined();
    expect(familyRow!.revoked).not.toBeNull();

    // 审计痕迹：断言**真实 `login_logs` 行**（不再是"某个函数被调用"）
    const auditRows = await waitForLoginLog('TOKEN_REFRESH_FAILED');
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[0]!.username).toBe('portal');
  });

  it('不存在的授权码不触发家族撤销（防随机 code DoS 放大）', async () => {
    await seedRefreshTokenRow('portal', 'rt_portal_untouched_by_unknown_code');

    const res = await POST(buildRequest(codeGrantBody('code-never-existed')));

    expect((await res.json()).error).toBe('invalid_grant');
    const rows = await selectRefreshTokens();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revoked).toBeNull();
  });

  it('过期未消费的授权码不触发家族撤销', async () => {
    await seedRefreshTokenRow('portal', 'rt_portal_untouched_by_expired_code');
    // 注意：必须走 helper（库中存哈希）。此前这里直接插入**明文** code，
    // 于是"过期"用例其实是在测"码不存在"——过了，但过得不对。
    await seedAuthCode('code-expired', false, { expiresAt: new Date(now.getTime() - 60 * 1000) });

    await POST(buildRequest(codeGrantBody('code-expired')));

    const rows = await selectRefreshTokens();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revoked).toBeNull();
  });

  it('其他 client 的已消费授权码不触发本 client 视角的家族撤销', async () => {
    await seedRefreshTokenRow('portal', 'rt_portal_untouched_by_other_client');
    await seedRefreshTokenRow('other-app', 'rt_other_app_family');
    // 同上：走 helper 以哈希入库，否则测的是"码不存在"
    await seedAuthCode('code-other-client', true, { clientId: 'other-app', scope: 'openid' });

    await POST(buildRequest(codeGrantBody('code-other-client')));

    const rows = await selectRefreshTokens();
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.revoked === null)).toBe(true);
  });
});
