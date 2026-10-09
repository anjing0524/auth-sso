/**
 * 授权码的**写入形态**契约 —— 真实 DB（不是 mock 的 db）
 *
 * ## 为什么需要独立文件
 *
 * `oauth2-authorize.test.ts` 把 `@/infrastructure/db` mock 成 `{ db: {}, schema: {} }`，
 * 因此它**看不到**路由究竟往库里写了什么。而 `oauth-grant.test.ts` 直接播种
 * `authorization_codes`，也无法证明**写入侧**的形态。
 *
 * 缺口正在于此：授权码此前是**明文入库**（`authorizationCodes.code` 直存
 * `auth_code_<...>`），而 RT 存 `hashToken`。两者都是可换取令牌的凭证，
 * 存储形态却不同——DB 泄露 / 备份被读时，明文授权码可直接被使用（PKCE 只保护
 * "兑换者是否持有 verifier"，不保护"码本身被读到"）。
 *
 * 更隐蔽的是：**测试与生产都按明文比对，所以这个差异在测试里完全隐形**。
 * 本文件用真实 DB 调真实路由，断言库中的实际值。
 *
 * @req H-AUTH-003, H-AUTH-011
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedPortalClient, seedRootDept } from '../helpers/seed-fixtures';
import { hashToken } from '@/lib/crypto';

const { mocks, tdHolder } = vi.hoisted(() => ({
  mocks: { mockVerifyAccessToken: vi.fn(async () => ({ sub: '00000000-0000-4000-8000-000000000101' })) },
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

vi.mock('@/app/(dashboard)/clients/data', () => ({
  getClientByClientId: async (clientId: string) => {
    const { db, schema } = tdHolder.current!;
    const { eq } = await import('drizzle-orm');
    return (await db.query.clients.findFirst({ where: eq(schema.clients.clientId, clientId) })) ?? null;
  },
}));

vi.mock('@/app/api/auth/oauth2/authorize/data', () => ({
  getUserWithRoleClients: async () => ({
    id: '00000000-0000-4000-8000-000000000101',
    status: 'ACTIVE',
    username: 'admin',
    name: '超管',
    roles: [{ id: 'r1', code: 'ADMIN', status: 'ACTIVE', clientIds: ['portal'] }],
  }),
}));

vi.mock('@/lib/session/auth-request-store', () => ({
  storeAuthRequest: vi.fn(async () => {}),
  getStoredAuthRequest: vi.fn(async () => null),
  generateSessionId: vi.fn(() => 'sess-test'),
}));

vi.mock('@/lib/auth/token', () => ({
  verifyAccessToken: mocks.mockVerifyAccessToken,
}));

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return { ...actual, getIssuer: () => 'https://sso.example.com', getAppBaseURL: () => 'http://localhost:4100' };
});

import { GET } from '@/app/api/auth/oauth2/authorize/route';
import { NextRequest } from 'next/server';

const td = createTestDbHandle();
tdHolder.current = td;

const REDIRECT_URI = 'https://rp.example.com/cb';
const CLIENT_ID = 'portal';
const CHALLENGE = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

function authorizeRequest(): NextRequest {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid profile',
    state: 'st-123',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return new NextRequest(
    `http://localhost:4100/api/auth/oauth2/authorize?${params.toString()}`,
    { headers: { cookie: 'login_session=stub-session-jwt' } },
  );
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.mockVerifyAccessToken.mockResolvedValue({ sub: '00000000-0000-4000-8000-000000000101' });
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser(),
    clients: seedPortalClient({ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI] }),
  });
});

describe('授权码写入形态（DB 泄露时不得可直接使用）', () => {
  it('**库中存哈希，不存明文**；且明文可从重定向得到、能对上该哈希', async () => {
    const res = await GET(authorizeRequest());
    const location = new URL(res.headers.get('location')!);
    const issuedCode = location.searchParams.get('code');

    // 路由确实签发了授权码
    expect(issuedCode).toBeTruthy();
    expect(issuedCode!.startsWith('auth_code_')).toBe(true);

    const rows = await td.db
      .select({ code: (await import('@/db/schema')).authorizationCodes.code })
      .from((await import('@/db/schema')).authorizationCodes);

    expect(rows).toHaveLength(1);
    // 库里是哈希，不是明文
    expect(rows[0]!.code).not.toBe(issuedCode);
    // 且正是这个明文的哈希（证明哈希用的就是交给 RP 的那个 code）
    expect(rows[0]!.code).toBe(hashToken(issuedCode!));
  });

  it('明文授权码不出现在库中任何一行（防止只在某一列漏了哈希）', async () => {
    const res = await GET(authorizeRequest());
    const issuedCode = new URL(res.headers.get('location')!).searchParams.get('code')!;

    const rows = await td.db.select().from((await import('@/db/schema')).authorizationCodes);
    const serialized = JSON.stringify(rows);

    expect(serialized).not.toContain(issuedCode);
  });
});
