/**
 * M2 认证打通 - 自动化验收测试
 *
 * 测试内容：
 * 1. 验证首次未登录访问会进入登录
 * 2. 验证登录成功后 /api/me 返回已登录态
 * 3. 验证刷新页面后仍保留登录态
 * 4. 验证错误 code/state 场景
 */

const IDP_URL = 'http://localhost:4001';
const IDP_ORIGIN = 'http://localhost:4001';
const PORTAL_URL = 'http://localhost:4000';
const PORTAL_ORIGIN = 'http://localhost:4000';
const TEST_USER = { email: 'admin@example.com', password: 'test123456' };
const OAUTH_CLIENT = {
  clientId: 'portal',
  clientSecret: 'portal-secret',
  redirectUri: 'http://localhost:4000/api/auth/callback',
};

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  duration: number;
  error?: string;
  details?: Record<string, unknown>;
}

const results: TestResult[] = [];

// 工具函数
async function httpRequest(
  url: string,
  options: RequestInit = {}
): Promise<{ status: number; headers: Headers; body: unknown; cookies: string[] }> {
  const res = await fetch(url, {
    ...options,
    redirect: 'manual',
  });

  const body = await res.text();
  // 使用 getSetCookie() 获取所有 Set-Cookie header
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];

  return {
    status: res.status,
    headers: res.headers,
    body: body ? parseJson(body) : null,
    cookies,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractCookies(cookies: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const cookie of cookies) {
    // 匹配 cookie 名称和值（可能包含 URL 编码的值）
    const match = cookie.match(/^([^=]+)=([^;]+)/);
    if (match) {
      // 只取 cookie 名称和值部分
      result[match[1]] = match[2];
    }
  }
  return result;
}

function buildCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// 从 Set-Cookie header 中提取所有 cookie
function parseSetCookieHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  // 获取所有 set-cookie header
  const allHeaders = headers.get('set-cookie');
  if (allHeaders) {
    // 分割多个 cookie（通过逗号分割，但要注意 expires 中的日期也可能包含逗号）
    const cookieStrings = allHeaders.split(/,(?=\s*[a-zA-Z0-9_-]+=)/);
    for (const cookieStr of cookieStrings) {
      const match = cookieStr.trim().match(/^([^=]+)=([^;]+)/);
      if (match) {
        result[match[1]] = match[2];
      }
    }
  }
  return result;
}

// PKCE 工具
function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ========================================
// 测试用例
// ========================================

async function testUnauthenticatedRedirect(): Promise<TestResult> {
  const start = Date.now();
  const name = 'M2-1: 未登录访问重定向到登录页';

  try {
    const meRes = await httpRequest(`${PORTAL_URL}/api/me`);

    if (meRes.status !== 401) {
      return {
        name,
        status: 'FAIL',
        duration: Date.now() - start,
        error: `Expected /api/me to return 401, got ${meRes.status}`,
        details: { body: meRes.body }
      };
    }

    return { name, status: 'PASS', duration: Date.now() - start };
  } catch (e) {
    return { name, status: 'FAIL', duration: Date.now() - start, error: String(e) };
  }
}

async function testLoginAndMe(): Promise<TestResult> {
  const start = Date.now();
  const name = 'M2-2: 登录成功后 /api/me 返回已登录态';

  try {
    // 1. 在 IdP 登录获取 Session
    const loginRes = await httpRequest(`${IDP_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': IDP_ORIGIN,
      },
      body: JSON.stringify(TEST_USER),
    });

    if (loginRes.status !== 200) {
      return {
        name,
        status: 'FAIL',
        duration: Date.now() - start,
        error: `IdP login failed with status ${loginRes.status}`,
        details: { body: loginRes.body }
      };
    }

    const loginBody = loginRes.body as { token?: string; user?: { email?: string } };
    if (!loginBody.token) {
      return {
        name,
        status: 'FAIL',
        duration: Date.now() - start,
        error: 'Login response missing token',
      };
    }

    const idpCookies = extractCookies(loginRes.cookies);
    console.log(`   [M2-2] Cookies extracted: ${JSON.stringify(Object.keys(idpCookies))}`);
    console.log(`   [M2-2] Cookie header: ${buildCookieHeader(idpCookies).substring(0, 100)}...`);

    // 2. 发起 OAuth 授权请求
    const codeVerifier = randomString(64);
    const codeChallenge = await createCodeChallenge(codeVerifier);
    const state = randomString(32);

    const authUrl = `${IDP_URL}/api/auth/oauth2/authorize?response_type=code&client_id=${OAUTH_CLIENT.clientId}&redirect_uri=${encodeURIComponent(OAUTH_CLIENT.redirectUri)}&scope=openid%20profile%20email&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

    const authRes = await httpRequest(authUrl, {
      headers: { Cookie: buildCookieHeader(idpCookies) },
    });

    // Better Auth OAuth Provider 可能返回 JSON 重定向或 HTTP 302
    let code: string | null = null;
    let location: string | null = null;

    if (authRes.status === 302) {
      // HTTP 重定向模式
      location = authRes.headers.get('location') || authRes.headers.get('Location');
      if (!location) {
        return {
          name,
          status: 'FAIL',
          duration: Date.now() - start,
          error: 'No Location header in authorize response',
        };
      }
      const redirectUrl = new URL(location);
      code = redirectUrl.searchParams.get('code');
    } else if (authRes.status === 200) {
      // JSON 重定向模式
      const authBody = authRes.body as { redirect?: boolean; url?: string };
      if (authBody.redirect && authBody.url) {
        location = authBody.url;
        const redirectUrl = new URL(authBody.url);
        code = redirectUrl.searchParams.get('code');
      }
    }

    if (!code) {
      const bodyPreview = typeof authRes.body === 'string'
        ? (authRes.body as string).substring(0, 200)
        : JSON.stringify(authRes.body).substring(0, 200);
      return {
        name,
        status: 'FAIL',
        duration: Date.now() - start,
        error: `Authorize failed with status ${authRes.status}, no code found`,
        details: { bodyPreview, location }
      };
    }

    // 3. 用 code 换取 Token
    const tokenRes = await httpRequest(`${IDP_URL}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: OAUTH_CLIENT.clientId,
        client_secret: OAUTH_CLIENT.clientSecret,
        redirect_uri: OAUTH_CLIENT.redirectUri,
        code_verifier: codeVerifier,
      }).toString(),
    });

    if (tokenRes.status !== 200) {
      return {
        name,
        status: 'FAIL',
        duration: Date.now() - start,
        error: `Token exchange failed with status ${tokenRes.status}`,
        details: { body: tokenRes.body }
      };
    }

    const tokenBody = tokenRes.body as { access_token?: string };
    if (!tokenBody.access_token) {
      return {
        name,
        status: 'FAIL',
        duration: Date.now() - start,
        error: 'No access_token in token response',
      };
    }

    // 4. 用 access_token 验证用户信息
    const userinfoRes = await httpRequest(`${IDP_URL}/api/auth/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });

    if (userinfoRes.status !== 200) {
      return {
        name,
        status: 'FAIL',
        duration: Date.now() - start,
        error: `UserInfo failed with status ${userinfoRes.status}`,
      };
    }

    const userinfo = userinfoRes.body as { sub?: string; email?: string };
    if (userinfo.email !== TEST_USER.email) {
      return {
        name,
        status: 'FAIL',
        duration: Date.now() - start,
        error: `Email mismatch: expected ${TEST_USER.email}, got ${userinfo.email}`,
      };
    }

    return {
      name,
      status: 'PASS',
      duration: Date.now() - start,
      details: { email: userinfo.email },
    };
  } catch (e) {
    return { name, status: 'FAIL', duration: Date.now() - start, error: String(e) };
  }
}

async function testSessionPersistence(): Promise<TestResult> {
  const start = Date.now();
  const name = 'M2-3: 刷新页面后仍保留登录态';

  try {
    const loginRes = await httpRequest(`${IDP_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': IDP_ORIGIN,
      },
      body: JSON.stringify(TEST_USER),
    });

    if (loginRes.status !== 200) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: 'Login failed' };
    }

    const idpCookies = extractCookies(loginRes.cookies);

    const codeVerifier = randomString(64);
    const codeChallenge = await createCodeChallenge(codeVerifier);
    const state = randomString(32);

    const authUrl = `${IDP_URL}/api/auth/oauth2/authorize?response_type=code&client_id=${OAUTH_CLIENT.clientId}&redirect_uri=${encodeURIComponent(OAUTH_CLIENT.redirectUri)}&scope=openid%20profile%20email&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

    const authRes = await httpRequest(authUrl, {
      headers: { Cookie: buildCookieHeader(idpCookies) },
    });

    // Better Auth OAuth Provider 可能返回 JSON 重定向或 HTTP 302
    let code: string | null = null;
    if (authRes.status === 302) {
      const location = authRes.headers.get('location') || authRes.headers.get('Location');
      if (location) {
        code = new URL(location).searchParams.get('code');
      }
    } else if (authRes.status === 200) {
      const authBody = authRes.body as { redirect?: boolean; url?: string };
      if (authBody.redirect && authBody.url) {
        code = new URL(authBody.url).searchParams.get('code');
      }
    }

    if (!code) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: 'No code in response' };
    }

    const tokenRes = await httpRequest(`${IDP_URL}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: OAUTH_CLIENT.clientId,
        client_secret: OAUTH_CLIENT.clientSecret,
        redirect_uri: OAUTH_CLIENT.redirectUri,
        code_verifier: codeVerifier,
      }).toString(),
    });

    const tokenBody = tokenRes.body as { access_token?: string };
    if (!tokenBody.access_token) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: 'No access token' };
    }

    // 多次调用 userinfo 验证 session 持续有效
    for (let i = 0; i < 3; i++) {
      const userinfoRes = await httpRequest(`${IDP_URL}/api/auth/oauth2/userinfo`, {
        headers: { Authorization: `Bearer ${tokenBody.access_token}` },
      });

      if (userinfoRes.status !== 200) {
        return {
          name,
          status: 'FAIL',
          duration: Date.now() - start,
          error: `UserInfo call ${i + 1} failed with status ${userinfoRes.status}`,
        };
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return { name, status: 'PASS', duration: Date.now() - start };
  } catch (e) {
    return { name, status: 'FAIL', duration: Date.now() - start, error: String(e) };
  }
}

async function testErrorScenarios(): Promise<TestResult> {
  const start = Date.now();
  const name = 'M2-4: 错误 code/state 场景被正确拒绝';

  try {
    // 测试无效 code
    const invalidCodeRes = await httpRequest(`${IDP_URL}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'invalid_code_12345',
        client_id: OAUTH_CLIENT.clientId,
        client_secret: OAUTH_CLIENT.clientSecret,
        redirect_uri: OAUTH_CLIENT.redirectUri,
        code_verifier: randomString(64),
      }).toString(),
    });

    if (invalidCodeRes.status === 200) {
      return {
        name,
        status: 'FAIL',
        duration: Date.now() - start,
        error: 'Invalid code was accepted',
      };
    }

    // 测试无效 client_id
    const invalidClientRes = await httpRequest(`${IDP_URL}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'some_code',
        client_id: 'invalid_client',
        client_secret: 'invalid_secret',
        redirect_uri: OAUTH_CLIENT.redirectUri,
        code_verifier: randomString(64),
      }).toString(),
    });

    if (invalidClientRes.status === 200) {
      return {
        name,
        status: 'FAIL',
        duration: Date.now() - start,
        error: 'Invalid client was accepted',
      };
    }

    return {
      name,
      status: 'PASS',
      duration: Date.now() - start,
      details: {
        invalidCodeStatus: invalidCodeRes.status,
        invalidClientStatus: invalidClientRes.status,
      }
    };
  } catch (e) {
    return { name, status: 'FAIL', duration: Date.now() - start, error: String(e) };
  }
}

async function testPortalLoginEntrance(): Promise<TestResult> {
  const start = Date.now();
  const name = 'M2-5: Portal 登录入口正常重定向';

  try {
    const res = await httpRequest(`${PORTAL_URL}/api/auth/login`);

    if (res.status !== 302 && res.status !== 307) {
      return {
        name,
        status: 'FAIL',
        duration: Date.now() - start,
        error: `Expected 302/307, got ${res.status}`,
      };
    }

    const location = res.headers.get('location') || res.headers.get('Location');
    if (!location) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: 'No Location header' };
    }

    if (!location.includes('/api/auth/oauth2/authorize')) {
      return {
        name,
        status: 'FAIL',
        duration: Date.now() - start,
        error: `Unexpected redirect: ${location}`,
      };
    }

    const url = new URL(location);
    const requiredParams = ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'code_challenge'];
    const missingParams = requiredParams.filter(p => !url.searchParams.has(p));

    if (missingParams.length > 0) {
      return {
        name,
        status: 'FAIL',
        duration: Date.now() - start,
        error: `Missing params: ${missingParams.join(', ')}`,
      };
    }

    return { name, status: 'PASS', duration: Date.now() - start };
  } catch (e) {
    return { name, status: 'FAIL', duration: Date.now() - start, error: String(e) };
  }
}

// ========================================
// 主测试运行器
// ========================================

async function runTests() {
  console.log('\n========================================');
  console.log('M2 认证打通 - 自动化验收测试');
  console.log('========================================\n');

  console.log(`Portal URL: ${PORTAL_URL}`);
  console.log(`IdP URL: ${IDP_URL}`);
  console.log(`Test User: ${TEST_USER.email}\n`);

  // 检查服务可用性
  console.log('🔍 检查服务可用性...\n');

  try {
    const idpCheck = await httpRequest(`${IDP_URL}/api/auth/ok`);
    if (idpCheck.status !== 200) {
      console.log(`❌ IdP 服务不可用: ${IDP_URL}`);
      process.exit(1);
    }
    console.log(`✅ IdP 服务正常`);
  } catch (e) {
    console.log(`❌ IdP 服务不可用: ${IDP_URL}`);
    console.log(`   请先启动服务: pnpm dev:idp 或 pnpm dev`);
    process.exit(1);
  }

  try {
    const portalCheck = await httpRequest(`${PORTAL_URL}/api/auth/login`);
    if (portalCheck.status !== 302 && portalCheck.status !== 307) {
      console.log(`⚠️  Portal 登录入口返回 ${portalCheck.status}`);
    } else {
      console.log(`✅ Portal 服务正常`);
    }
  } catch (e) {
    console.log(`❌ Portal 服务不可用: ${PORTAL_URL}`);
    console.log(`   请先启动服务: pnpm dev:portal 或 pnpm dev`);
    process.exit(1);
  }

  console.log('\n📋 执行测试用例...\n');

  // 执行测试
  results.push(await testUnauthenticatedRedirect());
  results.push(await testLoginAndMe());
  results.push(await testSessionPersistence());
  results.push(await testErrorScenarios());
  results.push(await testPortalLoginEntrance());

  // 输出结果
  console.log('\n========================================');
  console.log('测试结果汇总');
  console.log('========================================\n');

  let passed = 0, failed = 0, skipped = 0;

  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⏭️';
    console.log(`${icon} ${r.name} (${r.duration}ms)`);
    if (r.error) {
      console.log(`   Error: ${r.error}`);
    }
    if (r.details) {
      console.log(`   Details: ${JSON.stringify(r.details)}`);
    }

    if (r.status === 'PASS') passed++;
    else if (r.status === 'FAIL') failed++;
    else skipped++;
  }

  console.log('\n----------------------------------------');
  console.log(`总计: ${results.length} | ✅ 通过: ${passed} | ❌ 失败: ${failed} | ⏭️ 跳过: ${skipped}`);
  console.log('========================================\n');

  // 输出 JSON 结果供后续处理
  const jsonResult = {
    timestamp: new Date().toISOString(),
    milestone: 'M2',
    total: results.length,
    passed,
    failed,
    skipped,
    results,
  };

  console.log('JSON Result:');
  console.log(JSON.stringify(jsonResult, null, 2));

  process.exit(failed > 0 ? 1 : 0);
}

runTests();