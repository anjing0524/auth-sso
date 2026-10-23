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
import { createHash } from 'node:crypto';
import { hashToken } from '@/lib/crypto';
import { seedSigningKeys } from '../helpers/seed-signing-keys';
import type * as tokenModule from '@/lib/auth/token';

const { tdHolder } = vi.hoisted(() => ({
  tdHolder: { current: null as ReturnType<typeof createTestDbHandle> | null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return tdHolder.current!.db; },
  get schema() { return tdHolder.current!.schema; },
}));

// @allow-module-mock @/app/api/auth/oauth2/authorize/data input-fixture: 只提供"当前登录用户及其角色"这一输入；本文件不测该查询实现
vi.mock(import('@/app/api/auth/oauth2/authorize/data'), async (importOriginal): Promise<Partial<typeof authorizeDataModule>> => {
  const actual = await importOriginal();
  return { ...actual,
    getUserWithRoleClients: async () => ({
    id: '00000000-0000-4000-8000-000000000101',
    status: 'ACTIVE',
    username: 'admin',
    name: '超管',
    roles: [{ id: 'r1', code: 'ADMIN', status: 'ACTIVE', clientIds: ['portal'] }],
    }),
};
});

// @allow-module-mock @/lib/session/auth-request-store input-fixture: 只提供"回跳时能取回授权参数"这一输入；本文件不测暂存实现
vi.mock(import('@/lib/session/auth-request-store'), async (importOriginal): Promise<Partial<typeof authRequestStoreModule>> => {
    const actual = await importOriginal();
    return { ...actual,
    storeAuthRequest: vi.fn(async () => {}),
    getStoredAuthRequest: vi.fn(async () => null),
    generateSessionId: vi.fn(() => 'sess-test'),
};
});

// @allow-module-mock @/lib/auth/token input-fixture: 签发/撤销类导出只提供输入；本文件依赖它们的断言：无（本文件不触达签发路径，主题是**授权码写入形态**）。`verifyAccessToken` 走 `importOriginal()` 真身——登录态必须真实验签，否则 authorize 端点会接受伪造会话
vi.mock(import('@/lib/auth/token'), async (importOriginal): Promise<Partial<typeof tokenModule>> => {
    const actual = await importOriginal();
    return {
    ...actual,
    signAccessToken: vi.fn(async () => ({ token: 'at-mock', jti: 'jti-mock', expiresIn: 3600 })),
    signIdToken: vi.fn(async () => 'id-mock'),
    issueRefreshToken: vi.fn(async () => 'rt-mock'),
    revokeRefreshTokenFamily: vi.fn(async () => {}),
  };
});

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return { ...actual, getIssuer: () => 'https://sso.example.com', getAppBaseURL: () => 'http://localhost:4100' };
});

import { GET } from '@/app/api/auth/oauth2/authorize/route';
import { NextRequest } from 'next/server';
import { exchangeAuthorizationCode } from '@/lib/auth/oauth-grant';
import { signLoginSession } from '@/lib/auth/token';
import type * as authorizeDataModule from '@/app/api/auth/oauth2/authorize/data';
import type * as authRequestStoreModule from '@/lib/session/auth-request-store';


/** 当前用例的真实登录态令牌（authorize 端点会用真身 verifyAccessToken 验它） */
let loginSessionToken = '';

const td = createTestDbHandle();
tdHolder.current = td;

const REDIRECT_URI = 'https://rp.example.com/cb';
const CLIENT_ID = 'portal';
// verifier 与其 challenge 必须成对：challenge 由 verifier 派生出，
// 不手抄字面量（此前从别处借用导致二者不匹配，测试当场抓出）
const CODE_VERIFIER = 'test-verifier-43-chars-abcdefghijklmnopqrstuvwxyz';
const CHALLENGE = createHash('sha256').update(CODE_VERIFIER).digest('base64url');

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
    { headers: { cookie: `login_session=${loginSessionToken}` } },
  );
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser(),
    clients: seedPortalClient({ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI] }),
  });
  // 真实 ES256：种入密钥对，并签一枚**真实**登录态令牌放进 Cookie——
  // 伪造的 stub 会被真身 verifyAccessToken 拒绝（这正是我们要的边界）。
  await seedSigningKeys(td);
  loginSessionToken = await signLoginSession('00000000-0000-4000-8000-000000000101');
});

describe('authorize 端点的登录态边界（真实验签）', () => {
  it('**伪造的 login_session 被真实验签拒绝**：不签发授权码，跳回登录页', async () => {
    // 结构合法但**签名被篡改**：这样才能区分"真验签"与"只解码"——
    // 用一个结构上就不是 JWT 的串会被解码阶段先拒掉，从而掩盖"跳过验签"的变异（实测）。
    loginSessionToken = `${loginSessionToken.slice(0, -3)}xxx`;

    const res = await GET(authorizeRequest());

    expect(new URL(res.headers.get('location')!).pathname).toContain('login');
    // 真实状态：库里不得出现任何授权码
    const rows = await td.db
      .select({ id: td.schema.authorizationCodes.id })
      .from(td.schema.authorizationCodes);
    expect(rows).toHaveLength(0);
  });
});

describe('端到端：真实 authorize 签发的 code 能被真实 exchange 兑换', () => {
  it('**同一份明文走完整链**（写入侧存哈希、读取侧按哈希查，两侧不得分叉）', async () => {
    const res = await GET(authorizeRequest());
    const plainCode = new URL(res.headers.get('location')!).searchParams.get('code')!;
    expect(plainCode).toBeTruthy();

    const result = await exchangeAuthorizationCode({
      code: plainCode,
      client: { clientId: CLIENT_ID },
      redirectUri: REDIRECT_URI,
      codeVerifier: CODE_VERIFIER,
    });

    // 修复前必然在此失败：写入侧存明文、读取侧按明文查虽自洽，
    // 但一旦只有一侧改为哈希，整链即断——本用例正是锁住"两侧同源"。
    expect(result.ok).toBe(true);

    // 且可兑换的码在库中只以哈希存在
    const rows = await td.db.select().from((await import('@/db/schema')).authorizationCodes);
    expect(JSON.stringify(rows)).not.toContain(plainCode);
    expect(rows[0]!.code).toBe(hashToken(plainCode));
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
