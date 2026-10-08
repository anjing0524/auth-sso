/**
 * 授权码兑换 module 接口测试（真实 DB）
 *
 * 本文件直接测 `exchangeAuthorizationCode` 的 **interface**，不经过 token 路由，
 * 也不需要 HTTP 请求或六个 module 的 mock。这正是把编排从路由抽出的收益：
 * 真正的复杂度（原子领取、重放识别、PKCE、条件签发）现在有一个可断言的 seam。
 *
 * 关键在于失败**可判别**：重放返回 `reason: 'authorization_code_replayed'`
 * 而非被压成 `null`——重放是安全事件，调用方需要据此留审计痕迹。
 *
 * @req H-AUTH-003, H-AUTH-004, H-AUTH-011
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedPortalClient, seedRootDept } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';

const { mocks, tdHolder } = vi.hoisted(() => ({
  mocks: {
    mockSignAccessToken: vi.fn(async () => ({ token: 'at-mock', jti: 'jti-mock' })),
    mockSignIdToken: vi.fn(async () => 'id-mock'),
    mockIssueRefreshToken: vi.fn(async () => 'rt-mock'),
    mockRevokeRefreshTokenFamily: vi.fn(async () => {}),
    mockGetUserPermissionContext: vi.fn(async () => ({ roles: [], permissions: [], deptIds: [] })),
    mockCacheUserPermissionContext: vi.fn(async () => {}),
  },
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

vi.mock('@/lib/auth/token', () => ({
  signAccessToken: mocks.mockSignAccessToken,
  signIdToken: mocks.mockSignIdToken,
  issueRefreshToken: mocks.mockIssueRefreshToken,
  revokeRefreshTokenFamily: mocks.mockRevokeRefreshTokenFamily,
  ACCESS_TOKEN_TTL: 3600,
}));

vi.mock('@/lib/permissions', () => ({
  getUserPermissionContext: mocks.mockGetUserPermissionContext,
  cacheUserPermissionContext: mocks.mockCacheUserPermissionContext,
}));

import { exchangeAuthorizationCode } from '@/lib/auth/oauth-grant';

const td = createTestDbHandle();
tdHolder.current = td;

const CLIENT_ID = 'portal';
const USER_ID = '00000000-0000-4000-8000-000000000101';
const REDIRECT_URI = 'https://app.example.com/cb';
const CODE_VERIFIER = 'v'.repeat(43);
const CHALLENGE = crypto.createHash('sha256').update(CODE_VERIFIER).digest('base64url');

const client = { clientId: CLIENT_ID };

async function seedAuthCode(overrides: Partial<typeof schema.authorizationCodes.$inferInsert> = {}) {
  await td.db.insert(schema.authorizationCodes).values({
    id: crypto.randomUUID(),
    code: 'code-1',
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

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.mockSignAccessToken.mockResolvedValue({ token: 'at-mock', jti: 'jti-mock' });
  mocks.mockSignIdToken.mockResolvedValue('id-mock');
  mocks.mockIssueRefreshToken.mockResolvedValue('rt-mock');
  mocks.mockGetUserPermissionContext.mockResolvedValue({ roles: [], permissions: [], deptIds: [] });
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser(),
    clients: seedPortalClient({ clientId: CLIENT_ID }),
  });
});

describe('exchangeAuthorizationCode — 成功路径', () => {
  it('offline_access + openid → 同时签发 AT / RT / ID Token', async () => {
    await seedAuthCode();

    const result = await exchange();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens.access_token).toBe('at-mock');
    expect(result.tokens.refresh_token).toBe('rt-mock');
    expect(result.tokens.id_token).toBe('id-mock');
    expect(result.tokens.token_type).toBe('Bearer');
    expect(result.tokens.scope).toBe('openid offline_access');
  });

  it('缺少 offline_access → 不发放 refresh_token（OIDC Core §11 门控）', async () => {
    await seedAuthCode({ scope: 'openid' });

    const result = await exchange();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens.refresh_token).toBeUndefined();
    expect(result.tokens.id_token).toBe('id-mock');
    expect(mocks.mockIssueRefreshToken).not.toHaveBeenCalled();
  });

  it('缺少 openid → 不签发 ID Token', async () => {
    await seedAuthCode({ scope: 'offline_access' });

    const result = await exchange();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens.id_token).toBeUndefined();
    expect(mocks.mockSignIdToken).not.toHaveBeenCalled();
  });

  it('授权码在成功兑换后被置为已消费（不可二次使用）', async () => {
    await seedAuthCode();
    await exchange();

    const [row] = await td.db.select({ used: schema.authorizationCodes.used })
      .from(schema.authorizationCodes);

    expect(row?.used).toBe(true);
  });
});

describe('exchangeAuthorizationCode — 失败可判别', () => {
  it('已消费的授权码 → reason=authorization_code_replayed 且撤销同家族 RT', async () => {
    await seedAuthCode({ used: true });

    const result = await exchange();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 关键：不是笼统的 invalid_grant，而是可被判别的安全事件
    expect(result.reason).toBe('authorization_code_replayed');
    expect(mocks.mockRevokeRefreshTokenFamily).toHaveBeenCalledWith(
      expect.anything(), USER_ID, CLIENT_ID,
    );
  });

  it('不存在的授权码 → invalid_grant 且**不**触发家族撤销（防随机 code DoS 放大）', async () => {
    const result = await exchange({ code: 'never-existed' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_grant');
    expect(mocks.mockRevokeRefreshTokenFamily).not.toHaveBeenCalled();
  });

  it('过期未消费的授权码 → invalid_grant 且不触发家族撤销', async () => {
    await seedAuthCode({ expiresAt: new Date(Date.now() - 60_000) });

    const result = await exchange();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_grant');
    expect(mocks.mockRevokeRefreshTokenFamily).not.toHaveBeenCalled();
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
