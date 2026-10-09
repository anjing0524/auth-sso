/**
 * OAuth 2.1 Authorize 端点测试（GET /api/auth/oauth2/authorize）— mock 编排依赖
 *
 * 覆盖决策 D1（RFC 6749 §4.1.2.1）：redirect_uri 已通过白名单校验后的授权拒绝
 * 重定向回 RP（error/state/iss）；未通过校验的失败走本地错误页，不向未验证
 * 地址重定向。
 *
 * @req H-AUTH-003
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  mockGetClientByClientId: vi.fn(),
  mockGetUserWithRoleClients: vi.fn(),
  mockVerifyAccessToken: vi.fn(),
}));

vi.mock('@/infrastructure/db', () => ({
  db: {},
  schema: {},
}));

vi.mock('@/app/(dashboard)/clients/data', () => ({
  getClientByClientId: mocks.mockGetClientByClientId,
}));

vi.mock('@/app/api/auth/oauth2/authorize/data', () => ({
  getUserWithRoleClients: mocks.mockGetUserWithRoleClients,
}));

vi.mock('@/lib/session/auth-request-store', () => ({
  storeAuthRequest: vi.fn(async () => {}),
  getStoredAuthRequest: vi.fn(async () => null),
  generateSessionId: vi.fn(() => 'sess-test'),
}));

vi.mock('@/lib/auth/token', () => ({
  verifyAccessToken: mocks.mockVerifyAccessToken,
}));

import { GET } from '@/app/api/auth/oauth2/authorize/route';
import { NextRequest } from 'next/server';

const REDIRECT_URI = 'https://rp.example.com/cb';
const ISSUER = 'https://sso.example.com';
const USER_ID = '00000000-0000-4000-8000-000000000201';

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return { ...actual, getIssuer: () => ISSUER, getAppBaseURL: () => 'http://localhost:4100' };
});

function buildAuthorizeRequest(overrides: Record<string, string> = {}): NextRequest {
  const params = new URLSearchParams({
    client_id: 'portal',
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid profile',
    state: 'st-123',
    code_challenge: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    code_challenge_method: 'S256',
    ...overrides,
  });
  // 携带 login_session Cookie 以命中分支 B 的 SSO 免登路径（verifyAccessToken 已 mock）
  return new NextRequest(`http://localhost:4100/api/auth/oauth2/authorize?${params.toString()}`, {
    headers: { cookie: 'login_session=stub-session-jwt' },
  });
}

function makeClient(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientId: 'portal',
    status: 'ACTIVE',
    redirectUris: [REDIRECT_URI],
    scopes: 'openid profile',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // 分支 B SSO 免登路径：有效会话直签授权码（进入 issueCodeAndRedirect 的前置条件）
  mocks.mockVerifyAccessToken.mockResolvedValue({ sub: USER_ID });
});

describe('GET /api/auth/oauth2/authorize — 错误重定向语义（D1, RFC 6749 §4.1.2.1）', () => {
  it('redirect_uri 已过白名单后用户不存在 → 重定向回 RP（error/state/iss）', async () => {
    mocks.mockGetClientByClientId.mockResolvedValue(makeClient());
    mocks.mockGetUserWithRoleClients.mockResolvedValue(null);

    const res = await GET(buildAuthorizeRequest());
    const location = new URL(res.headers.get('location')!);

    expect(res.status).toBe(307); // NextResponse.redirect 默认 307，语义为临时重定向
    expect(`${location.protocol}//${location.host}${location.pathname}`).toBe(REDIRECT_URI);
    expect(location.searchParams.get('error')).toBe('user_inactive');
    expect(location.searchParams.get('state')).toBe('st-123');
    expect(location.searchParams.get('iss')).toBe(ISSUER);
  });

  it('scope 越界 → 重定向回 RP invalid_scope', async () => {
    mocks.mockGetClientByClientId.mockResolvedValue(makeClient({ scopes: 'openid' }));

    const res = await GET(buildAuthorizeRequest({ scope: 'openid profile email' }));
    const location = new URL(res.headers.get('location')!);

    expect(res.status).toBe(307); // NextResponse.redirect 默认 307，语义为临时重定向
    expect(`${location.protocol}//${location.host}${location.pathname}`).toBe(REDIRECT_URI);
    expect(location.searchParams.get('error')).toBe('invalid_scope');
    expect(location.searchParams.get('state')).toBe('st-123');
  });

  it('准入拒绝（用户停用）→ 重定向回 RP 携带 error', async () => {
    mocks.mockGetClientByClientId.mockResolvedValue(makeClient());
    mocks.mockGetUserWithRoleClients.mockResolvedValue({
      id: USER_ID,
      status: 'DISABLED',
      roles: [],
    });

    const res = await GET(buildAuthorizeRequest());
    const location = new URL(res.headers.get('location')!);

    expect(res.status).toBe(307); // NextResponse.redirect 默认 307，语义为临时重定向
    expect(`${location.protocol}//${location.host}${location.pathname}`).toBe(REDIRECT_URI);
    expect(location.searchParams.get('error')).toBe('user_inactive');
    expect(location.searchParams.get('iss')).toBe(ISSUER);
  });

  it('redirect_uri 不在白名单 → 本地错误页，绝不向未验证地址重定向', async () => {
    mocks.mockGetClientByClientId.mockResolvedValue(makeClient({ redirectUris: ['https://rp.example.com/other'] }));

    const res = await GET(buildAuthorizeRequest());
    const location = res.headers.get('location')!;

    expect(res.status).toBe(307); // NextResponse.redirect 默认 307，语义为临时重定向
    expect(location).toContain('/oauth/error');
    expect(location).not.toContain(REDIRECT_URI);
  });

  describe('redirect_uri 必须精确匹配（禁止前缀匹配 → 开放重定向）', () => {
    // `validateRedirectUri` 的注释记录过这一漏洞类别：前缀匹配会让已注册的
    // `https://app/cb` 错误接受 `https://app/cb.evil.com/...`。该分支此前只有
    // 「完全不同主机」一个用例，前缀形态零覆盖——而这正是开放重定向的入口。

    it('**注册串为裸 origin + 攻击串是其子域 → 本地错误页，绝不重定向**', async () => {
      // 这是 `includes`（精确）与 `startsWith`（前缀）**行为分叉且跳到外域**的形态。
      // 真前缀必然同主机（多出的部分只能是 path/query/fragment），故"前缀匹配导致
      // 跳外域"需要注册串本身缺 path——即下面这种裸 origin 注册。
      const registered = 'https://app.example.com';
      const attack = 'https://app.example.com.evil.com/cb';

      expect(attack.startsWith(registered)).toBe(true); // 攻击串确以注册串为前缀
      expect(new URL(attack).host).toBe('app.example.com.evil.com'); // 但主机是外域

      mocks.mockGetClientByClientId.mockResolvedValue(
        makeClient({ redirectUris: [registered] }),
      );

      const res = await GET(buildAuthorizeRequest({ redirect_uri: attack }));
      const location = res.headers.get('location')!;

      expect(res.status).toBe(307);
      expect(location).toContain('/oauth/error');
      expect(location).not.toContain('evil.com');
    });

    it('注册串 + 额外路径段 → 本地错误页（不得前缀放行）', async () => {
      mocks.mockGetClientByClientId.mockResolvedValue(makeClient());

      const res = await GET(
        buildAuthorizeRequest({ redirect_uri: `${REDIRECT_URI}/extra` }),
      );
      const location = res.headers.get('location')!;

      expect(location).toContain('/oauth/error');
      expect(location).not.toContain(`${REDIRECT_URI}/extra`);
    });

    it('注册串 + 路径穿越（/cb/../evil）→ 本地错误页', async () => {
      mocks.mockGetClientByClientId.mockResolvedValue(makeClient());

      const res = await GET(
        buildAuthorizeRequest({ redirect_uri: `${REDIRECT_URI}/../evil` }),
      );
      const location = res.headers.get('location')!;

      expect(location).toContain('/oauth/error');
      expect(location).not.toContain('/../evil');
    });

    it('注册串 + 查询串 → 本地错误页（查询参数不构成匹配）', async () => {
      mocks.mockGetClientByClientId.mockResolvedValue(makeClient());

      const res = await GET(
        buildAuthorizeRequest({ redirect_uri: `${REDIRECT_URI}?x=1` }),
      );
      const location = res.headers.get('location')!;

      expect(location).toContain('/oauth/error');
      expect(location).not.toContain('x=1');
    });
  });

  it('client_id 未知 → 本地错误页', async () => {
    mocks.mockGetClientByClientId.mockResolvedValue(null);

    const res = await GET(buildAuthorizeRequest());
    const location = res.headers.get('location')!;

    expect(res.status).toBe(307); // NextResponse.redirect 默认 307，语义为临时重定向
    expect(location).toContain('/oauth/error');
  });
});
