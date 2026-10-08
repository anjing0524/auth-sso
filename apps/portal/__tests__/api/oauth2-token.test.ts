/**
 * OAuth 2.1 Token 端点集成测试 (POST /api/auth/oauth2/token) — 真实 DB
 *
 * 覆盖修复规划 F1/F2/F7 的端点语义：
 * - F1（RFC 6749 §4.1.3）：authorization_code grant 的 redirect_uri 必填且强制比对
 * - F2（RFC 6749 §2.3.1）：client_secret_basic / client_secret_post 双通道凭证
 * - F7（RFC 9700 §4.2.4）：已消费授权码重放 → 撤销同授权家族 Refresh Token
 *
 * token 签发/轮换（@/lib/auth/token）mock；PKCE 验证与凭证解析走真实领域函数。
 *
 * @req H-AUTH-003, H-AUTH-004, H-AUTH-011
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedPortalClient, seedRootDept, seedTestUser } from '../helpers/seed-fixtures';

const { mocks, tdHolder } = vi.hoisted(() => ({
  mocks: {
    mockSignAccessToken: vi.fn(),
    mockSignIdToken: vi.fn(),
    mockIssueRefreshToken: vi.fn(),
    mockRotateRefreshToken: vi.fn(),
    mockRevokeRefreshTokenFamily: vi.fn(),
    mockGetUserPermissionContext: vi.fn(),
    mockCacheUserPermissionContext: vi.fn(),
    mockWriteLoginLog: vi.fn(),
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
  rotateRefreshToken: mocks.mockRotateRefreshToken,
  revokeRefreshTokenFamily: mocks.mockRevokeRefreshTokenFamily,
  ACCESS_TOKEN_TTL: 3600,
}));

vi.mock('@/lib/permissions', () => ({
  getUserPermissionContext: mocks.mockGetUserPermissionContext,
  cacheUserPermissionContext: mocks.mockCacheUserPermissionContext,
}));

vi.mock('@/lib/audit', () => ({
  writeLoginLog: mocks.mockWriteLoginLog,
  extractClientIP: () => null,
  extractUserAgent: () => null,
}));

import { POST } from '@/app/api/auth/oauth2/token/route';
import { NextRequest } from 'next/server';

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

/** 种一个授权码行，可指定 used 状态与 scope */
async function seedAuthCode(
  code: string,
  used: boolean,
  scope = 'openid profile email offline_access',
): Promise<void> {
  await td.db.insert(td.schema.authorizationCodes).values({
    id: crypto.randomUUID(),
    code,
    clientId: 'portal',
    userId: USER_ID,
    redirectUri: REDIRECT_URI,
    scope,
    state: 'st-' + code.slice(-6),
    nonce: null,
    codeChallenge: CHALLENGE,
    codeChallengeMethod: 'S256',
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    used,
    createdAt: now,
  });
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
  mocks.mockSignAccessToken.mockResolvedValue({ token: 'mock-at', jti: 'jti_x' });
  mocks.mockSignIdToken.mockResolvedValue('mock-id-token');
  mocks.mockIssueRefreshToken.mockResolvedValue('mock-rt');
  mocks.mockGetUserPermissionContext.mockResolvedValue({ roles: [], permissions: [], deptIds: [] });
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

  it('redirect_uri 一致且 PKCE 通过时成功签发', async () => {
    await seedAuthCode('code-ok', false);

    const res = await POST(buildRequest(codeGrantBody('code-ok')));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.access_token).toBe('mock-at');
    expect(json.refresh_token).toBe('mock-rt');
    expect(json.id_token).toBe('mock-id-token');
    // ADR-013：AT aud = 签发对象 client_id，payload 显式携带 client_id claim
    expect(mocks.mockSignAccessToken).toHaveBeenCalledWith(
      USER_ID,
      'portal',
      'openid profile email offline_access',
    );
  });

  it('refresh_token grant 不要求 redirect_uri', async () => {
    mocks.mockRotateRefreshToken.mockResolvedValue({
      accessToken: 'mock-at-2', refreshToken: 'mock-rt-2', expiresIn: 3600,
    });

    const res = await POST(buildRequest({
      grant_type: 'refresh_token', refresh_token: 'rt_x', client_id: 'portal', client_secret: 'portal-secret',
    }));

    expect(res.status).toBe(200);
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

describe('POST /api/auth/oauth2/token — RT 按 offline_access 门控（D3, OIDC Core §11）', () => {
  it('scope 含 offline_access 时发放 refresh_token', async () => {
    await seedAuthCode('code-rt-with', false);

    const res = await POST(buildRequest(codeGrantBody('code-rt-with')));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.refresh_token).toBe('mock-rt');
    expect(mocks.mockIssueRefreshToken).toHaveBeenCalledWith(
      USER_ID,
      'portal',
      'openid profile email offline_access',
    );
  });

  it('scope 不含 offline_access 时不发放 refresh_token', async () => {
    await seedAuthCode('code-rt-without', false, 'openid profile');

    const res = await POST(buildRequest(codeGrantBody('code-rt-without')));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.refresh_token).toBeUndefined();
    expect(mocks.mockIssueRefreshToken).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/oauth2/token — 授权码重放检测（F7, RFC 9700 §4.2.4）', () => {
  it('已消费授权码被再次兑换时撤销同家族 Refresh Token', async () => {
    await seedAuthCode('code-replayed', true);

    const res = await POST(buildRequest(codeGrantBody('code-replayed')));
    const json = await res.json();

    expect(json.error).toBe('invalid_grant');
    // executor 首参（db 直连，重放检测在事务外）+ (userId, clientId) 家族锚点
    expect(mocks.mockRevokeRefreshTokenFamily).toHaveBeenCalledWith(expect.anything(), USER_ID, 'portal');
    expect(mocks.mockWriteLoginLog).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'TOKEN_REFRESH_FAILED' }),
    );
  });

  it('不存在的授权码不触发家族撤销（防随机 code DoS 放大）', async () => {
    const res = await POST(buildRequest(codeGrantBody('code-never-existed')));
    const json = await res.json();

    expect(json.error).toBe('invalid_grant');
    expect(mocks.mockRevokeRefreshTokenFamily).not.toHaveBeenCalled();
  });

  it('过期未消费的授权码不触发家族撤销', async () => {
    await td.db.insert(td.schema.authorizationCodes).values({
      id: crypto.randomUUID(),
      code: 'code-expired',
      clientId: 'portal',
      userId: USER_ID,
      redirectUri: REDIRECT_URI,
      scope: 'openid',
      state: 'st',
      nonce: null,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      expiresAt: new Date(now.getTime() - 60 * 1000),
      used: false,
      createdAt: now,
    });

    await POST(buildRequest(codeGrantBody('code-expired')));

    expect(mocks.mockRevokeRefreshTokenFamily).not.toHaveBeenCalled();
  });

  it('其他 client 的已消费授权码不触发本 client 视角的家族撤销', async () => {
    await td.db.insert(td.schema.authorizationCodes).values({
      id: crypto.randomUUID(),
      code: 'code-other-client',
      clientId: 'other-app',
      userId: USER_ID,
      redirectUri: REDIRECT_URI,
      scope: 'openid',
      state: 'st',
      nonce: null,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
      used: true,
      createdAt: now,
    });

    await POST(buildRequest(codeGrantBody('code-other-client')));

    expect(mocks.mockRevokeRefreshTokenFamily).not.toHaveBeenCalled();
  });
});
