/**
 * OIDC 机器端点经 Gateway 的凭证透传回归（H-D-01 / 修复批次 F1）
 *
 * 背景：Gateway `upstream_request_filter` 曾经**无条件**剥离客户端 `Authorization`，
 * 而 `/api/auth/*` 在 public_paths 中、Public 路径永不注入 Gateway 身份头 ⇒
 * `userinfo`（`Authorization: Bearer`）与 `token/introspect/revoke`
 * （`client_secret_basic`）经唯一部署入口全部不可用（直连 Portal 正常）。
 *
 * 修复后：Public 路径保留客户端 `Authorization`（其余身份头仍无条件剥离），
 * Protected 路径维持「剥离 + 验签后权威注入」。
 *
 * 本 spec 的机器端点断言全部使用**独立 APIRequestContext（不带浏览器 Cookie）**，
 * 确保验证的是 Authorization/Basic 凭证通道，而不是 Gateway 的 Cookie 信任路径
 * （userinfo 支持 Cookie 回退，复用 page.request 会掩盖剥离问题）。
 *
 * @req H-AUTH-003, H-AUTH-004
 */
import { expect, test, type Page } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'https://127.0.0.1:19443';
const ADMIN = { email: 'admin@example.com', password: 'Admin@123456' };
const CLIENT_ID = 'portal';
const CLIENT_SECRET = 'portal-secret';
const BASIC = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
/** 干净 API 上下文的创建参数：无 Cookie、忽略自签证书（与栈入口一致） */
const CLEAN_API_OPTIONS = { baseURL: BASE_URL, ignoreHTTPSErrors: true };

/** 走完整 Gateway 登录闭环，返回浏览器持有的 Access Token 明文 */
async function loginAndGetAccessToken(page: Page): Promise<string> {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?session_id=/);

  await page.getByLabel(/登录邮箱|账号.*邮箱/i).fill(ADMIN.email);
  await page.getByLabel('密码').fill(ADMIN.password);
  await page.getByRole('button', { name: '安全登录' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

  const accessToken = (await page.context().cookies()).find(
    (cookie) => cookie.name === 'portal_jwt_token',
  )?.value;
  expect(accessToken, '登录后必须由 Gateway OAuth 回调下发 portal_jwt_token').toBeTruthy();
  return accessToken!;
}

test.describe('OIDC 机器端点经 Gateway 的凭证透传（H-D-01）', () => {
  test('token 端点 client_secret_basic 经 Gateway 可用（假 code → 400 invalid_grant）', async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext(CLEAN_API_OPTIONS);
    try {
      const res = await api.post('/api/auth/oauth2/token', {
        headers: { Authorization: `Basic ${BASIC}` },
        form: {
          grant_type: 'authorization_code',
          code: 'e2e-invalid-code',
          redirect_uri: `${BASE_URL}/api/auth/callback`,
          code_verifier: 'e2e-code-verifier-'.padEnd(43, 'x'),
        },
      });
      const body = await res.json();
      // 401 invalid_client = Basic 被网关剥掉（回归信号）；400 invalid_grant = 客户端
      // 认证已通过、仅授权码无效（期望）。断言错误码比只看状态码更能定位根因。
      expect(res.status(), JSON.stringify(body)).toBe(400);
      expect(body.error).toBe('invalid_grant');
    } finally {
      await api.dispose();
    }
  });

  test('userinfo 端点无凭据 401、Authorization Bearer 经 Gateway 200', async ({
    page,
    playwright,
  }) => {
    const api = await playwright.request.newContext(CLEAN_API_OPTIONS);
    try {
      // 无凭据（且无 Cookie）必须 401：Gateway 不得凭 Public 路径放行的空身份注入
      const anonymous = await api.get('/api/auth/oauth2/userinfo');
      expect(anonymous.status()).toBe(401);

      const accessToken = await loginAndGetAccessToken(page);
      const res = await api.get('/api/auth/oauth2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = await res.json();
      expect(res.status(), JSON.stringify(body)).toBe(200);
      expect(body.sub).toBeTruthy();
    } finally {
      await api.dispose();
    }
  });

  test('introspect 端点 client_secret_basic 经 Gateway 可用（active:true）', async ({
    page,
    playwright,
  }) => {
    const api = await playwright.request.newContext(CLEAN_API_OPTIONS);
    try {
      const accessToken = await loginAndGetAccessToken(page);
      const res = await api.post('/api/auth/oauth2/introspect', {
        headers: { Authorization: `Basic ${BASIC}` },
        form: { token: accessToken },
      });
      const body = await res.json();
      expect(res.status(), JSON.stringify(body)).toBe(200);
      expect(body.active).toBe(true);
      expect(body.sub).toBeTruthy();
    } finally {
      await api.dispose();
    }
  });

  test('Protected 路径伪造身份头仍被 Gateway 拒绝（401，H-D-01 反向守卫）', async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext(CLEAN_API_OPTIONS);
    try {
      const res = await api.get('/api/users', {
        headers: {
          'X-User-Id': '00000000-0000-0000-0000-000000000001',
          'X-User-Jti': 'forged-jti',
          'X-Gateway-Timestamp': '1700000000',
          'X-Gateway-Signature': 'deadbeef',
        },
      });
      // Protected 路径必须剥离伪造身份头且无 Cookie 即 401（不能因修 H-D-01 而放宽）
      expect(res.status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });
});
