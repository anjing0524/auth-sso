/**
 * OAuth 2.1 Authorization Code Flow with PKCE 自动化测试
 *
 * 测试范围：
 * 1. IdP 端点：健康检查、登录、授权、Token交换、UserInfo、JWKS、Discovery
 * 2. Portal 客户端：登录入口、OAuth回调
 * 3. 完整流程：PKCE验证、State验证
 */

import http from 'http';

const IDP_URL = 'http://localhost:4001';
const PORTAL_URL = 'http://localhost:4000';
const TEST_USER = { email: 'admin@example.com', password: 'test123456' };
const OAUTH_CLIENT = {
  clientId: 'portal',
  clientSecret: 'portal-secret',
  redirectUri: 'http://localhost:4000/api/auth/callback',
};

// 测试结果收集
interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  duration: number;
  error?: string;
  details?: Record<string, unknown>;
}

const results: TestResult[] = [];

// 使用 Node.js http 模块进行请求，支持自定义 Cookie header
interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: unknown;
  cookies: string[];
}

function httpRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {}
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const defaultOrigin = parsedUrl.port === '4001' ? IDP_URL : PORTAL_URL;

    const reqOptions: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        ...options.headers,
        'Origin': defaultOrigin,
      },
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const cookies: string[] = [];
        const setCookie = res.headers['set-cookie'];
        if (setCookie) {
          cookies.push(...setCookie);
        }

        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          body: data ? safeJsonParse(data) : null,
          cookies,
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseCookie(cookies: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const cookie of cookies) {
    const match = cookie.match(/^([^=]+)=([^;]+)/);
    if (match) {
      result[match[1]] = match[2];
    }
  }
  return result;
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// PKCE 工具
function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// 测试用例
async function testHealthCheck(): Promise<TestResult> {
  const start = Date.now();
  const name = '1.1 健康检查端点';

  try {
    const res = await httpRequest(`${IDP_URL}/api/auth/ok`);

    if (res.status !== 200) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: `Expected 200, got ${res.status}` };
    }

    const body = res.body as { ok?: boolean };
    if (!body.ok) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: 'Response body missing "ok: true"' };
    }

    return { name, status: 'PASS', duration: Date.now() - start };
  } catch (e) {
    return { name, status: 'FAIL', duration: Date.now() - start, error: String(e) };
  }
}

async function testSignInEndpoint(): Promise<TestResult> {
  const start = Date.now();
  const name = '1.2 登录端点';

  try {
    const res = await httpRequest(`${IDP_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TEST_USER),
    });

    if (res.status !== 200) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: `Expected 200, got ${res.status}`, details: { body: res.body } };
    }

    const body = res.body as { token?: string; user?: { email?: string } };
    if (!body.token) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: 'Response missing token' };
    }

    if (body.user?.email !== TEST_USER.email) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: `User email mismatch: ${body.user?.email}` };
    }

    const hasSessionCookie = res.cookies.some((c: string) => c.includes('session_token') || c.includes('session_data'));
    if (!hasSessionCookie) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: 'No session cookie set' };
    }

    return { name, status: 'PASS', duration: Date.now() - start, details: { cookies: res.cookies.length } };
  } catch (e) {
    return { name, status: 'FAIL', duration: Date.now() - start, error: String(e) };
  }
}

async function testAuthorizeEndpoint(): Promise<{ result: TestResult; code?: string; sessionCookies?: Record<string, string> }> {
  const start = Date.now();
  const name = '1.3 授权端点';

  try {
    // 先登录
    const loginRes = await httpRequest(`${IDP_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TEST_USER),
    });

    if (loginRes.status !== 200) {
      return { result: { name, status: 'FAIL', duration: Date.now() - start, error: 'Login failed' } };
    }

    const sessionCookies = parseCookie(loginRes.cookies);

    // 生成 PKCE 参数
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateRandomString(32);

    // 请求授权
    const authUrl = `${IDP_URL}/api/auth/oauth2/authorize?response_type=code&client_id=${OAUTH_CLIENT.clientId}&redirect_uri=${encodeURIComponent(OAUTH_CLIENT.redirectUri)}&scope=openid%20profile%20email&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

    const authRes = await httpRequest(authUrl, {
      headers: { Cookie: cookieHeader(sessionCookies) },
    });

    if (authRes.status !== 302) {
      return { result: { name, status: 'FAIL', duration: Date.now() - start, error: `Expected 302, got ${authRes.status}` }, sessionCookies };
    }

    const location = authRes.headers['location'] as string | undefined;
    if (!location) {
      return { result: { name, status: 'FAIL', duration: Date.now() - start, error: 'No Location header in response' }, sessionCookies };
    }

    // 解析重定向 URL
    const redirectUrl = new URL(location);
    const code = redirectUrl.searchParams.get('code');
    const returnedState = redirectUrl.searchParams.get('state');

    if (!code) {
      return { result: { name, status: 'FAIL', duration: Date.now() - start, error: 'No code in redirect URL', details: { location } }, sessionCookies };
    }

    if (returnedState !== state) {
      return { result: { name, status: 'FAIL', duration: Date.now() - start, error: `State mismatch: expected ${state}, got ${returnedState}` }, sessionCookies };
    }

    return {
      result: { name, status: 'PASS', duration: Date.now() - start, details: { code: code.substring(0, 10) + '...', state: returnedState } },
      code,
      sessionCookies
    };
  } catch (e) {
    return { result: { name, status: 'FAIL', duration: Date.now() - start, error: String(e) } };
  }
}

async function testTokenEndpoint(authCode: string, codeVerifier: string): Promise<{ result: TestResult; tokens?: { access_token: string; id_token?: string; refresh_token?: string } }> {
  const start = Date.now();
  const name = '1.4 Token交换端点';

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: authCode,
      client_id: OAUTH_CLIENT.clientId,
      client_secret: OAUTH_CLIENT.clientSecret,
      redirect_uri: OAUTH_CLIENT.redirectUri,
      code_verifier: codeVerifier,
    });

    const res = await httpRequest(`${IDP_URL}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (res.status !== 200) {
      return { result: { name, status: 'FAIL', duration: Date.now() - start, error: `Expected 200, got ${res.status}`, details: { body: res.body } } };
    }

    const tokenResponse = res.body as { access_token?: string; token_type?: string; id_token?: string; refresh_token?: string };

    if (!tokenResponse.access_token) {
      return { result: { name, status: 'FAIL', duration: Date.now() - start, error: 'No access_token in response' } };
    }

    if (tokenResponse.token_type !== 'Bearer') {
      return { result: { name, status: 'FAIL', duration: Date.now() - start, error: `Token type mismatch: ${tokenResponse.token_type}` } };
    }

    return {
      result: {
        name,
        status: 'PASS',
        duration: Date.now() - start,
        details: {
          hasAccessToken: !!tokenResponse.access_token,
          hasIdToken: !!tokenResponse.id_token,
          hasRefreshToken: !!tokenResponse.refresh_token,
        }
      },
      tokens: {
        access_token: tokenResponse.access_token,
        id_token: tokenResponse.id_token,
        refresh_token: tokenResponse.refresh_token,
      }
    };
  } catch (e) {
    return { result: { name, status: 'FAIL', duration: Date.now() - start, error: String(e) } };
  }
}

async function testUserInfoEndpoint(accessToken: string): Promise<TestResult> {
  const start = Date.now();
  const name = '1.5 用户信息端点';

  try {
    const res = await httpRequest(`${IDP_URL}/api/auth/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status !== 200) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: `Expected 200, got ${res.status}`, details: { body: res.body } };
    }

    const userInfo = res.body as { sub?: string; email?: string; name?: string };

    if (!userInfo.sub) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: 'No "sub" claim in UserInfo' };
    }

    return { name, status: 'PASS', duration: Date.now() - start, details: { sub: userInfo.sub, email: userInfo.email } };
  } catch (e) {
    return { name, status: 'FAIL', duration: Date.now() - start, error: String(e) };
  }
}

async function testJwksEndpoint(): Promise<TestResult> {
  const start = Date.now();
  const name = '1.6 JWKS端点';

  try {
    // Better Auth JWKS 端点在 /api/auth/jwks 下
    const res = await httpRequest(`${IDP_URL}/api/auth/jwks`);

    if (res.status !== 200) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: `Expected 200, got ${res.status}` };
    }

    const jwks = res.body as { keys?: Array<{ kid?: string; kty?: string }> };

    if (!jwks.keys || jwks.keys.length === 0) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: 'No keys in JWKS' };
    }

    if (!jwks.keys[0].kid || !jwks.keys[0].kty) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: 'Invalid key format' };
    }

    return { name, status: 'PASS', duration: Date.now() - start, details: { keysCount: jwks.keys.length } };
  } catch (e) {
    return { name, status: 'FAIL', duration: Date.now() - start, error: String(e) };
  }
}

async function testOidcDiscovery(): Promise<TestResult> {
  const start = Date.now();
  const name = '1.7 OIDC Discovery端点';

  try {
    // Better Auth OIDC Discovery 端点在 /api/auth/.well-known/openid-configuration 下
    const res = await httpRequest(`${IDP_URL}/api/auth/.well-known/openid-configuration`);

    if (res.status !== 200) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: `Expected 200, got ${res.status}` };
    }

    const config = res.body as {
      issuer?: string;
      authorization_endpoint?: string;
      token_endpoint?: string;
      userinfo_endpoint?: string;
      jwks_uri?: string;
    };

    const requiredEndpoints = ['authorization_endpoint', 'token_endpoint', 'userinfo_endpoint', 'jwks_uri'];
    const missingEndpoints = requiredEndpoints.filter(e => !config[e as keyof typeof config]);

    if (missingEndpoints.length > 0) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: `Missing endpoints: ${missingEndpoints.join(', ')}` };
    }

    return { name, status: 'PASS', duration: Date.now() - start, details: { issuer: config.issuer } };
  } catch (e) {
    return { name, status: 'FAIL', duration: Date.now() - start, error: String(e) };
  }
}

async function testPortalLoginEntrance(): Promise<TestResult> {
  const start = Date.now();
  const name = '2.1 Portal登录入口';

  try {
    const res = await httpRequest(`${PORTAL_URL}/api/auth/login`);

    if (res.status !== 302 && res.status !== 307) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: `Expected 302/307, got ${res.status}` };
    }

    const location = res.headers['location'] as string | undefined;
    if (!location) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: 'No Location header' };
    }

    // 验证重定向到 IdP authorize 端点
    if (!location.includes('/api/auth/oauth2/authorize')) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: `Unexpected redirect: ${location}` };
    }

    // 验证包含必要参数
    const url = new URL(location);
    const requiredParams = ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method'];
    const missingParams = requiredParams.filter(p => !url.searchParams.has(p));

    if (missingParams.length > 0) {
      return { name, status: 'FAIL', duration: Date.now() - start, error: `Missing params: ${missingParams.join(', ')}` };
    }

    return { name, status: 'PASS', duration: Date.now() - start, details: { redirectUrl: location.substring(0, 100) + '...' } };
  } catch (e) {
    return { name, status: 'FAIL', duration: Date.now() - start, error: String(e) };
  }
}

// 主测试运行器
async function runTests() {
  console.log('========================================');
  console.log('OAuth 2.1 Authorization Code Flow Test');
  console.log('========================================\n');

  // 1. IdP 端点测试
  console.log('📋 IdP 端点测试\n');

  results.push(await testHealthCheck());
  results.push(await testSignInEndpoint());

  const { result: authResult, code, sessionCookies } = await testAuthorizeEndpoint();
  results.push(authResult);

  let tokens: { access_token: string; id_token?: string; refresh_token?: string } | undefined;

  if (code && sessionCookies) {
    // 需要重新登录获取新的 code，因为每个 code 只能用一次
    const loginRes = await httpRequest(`${IDP_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TEST_USER),
    });
    const newSessionCookies = parseCookie(loginRes.cookies);

    const codeVerifier = generateRandomString(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateRandomString(32);

    const authUrl = `${IDP_URL}/api/auth/oauth2/authorize?response_type=code&client_id=${OAUTH_CLIENT.clientId}&redirect_uri=${encodeURIComponent(OAUTH_CLIENT.redirectUri)}&scope=openid%20profile%20email&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

    const authRes = await httpRequest(authUrl, {
      headers: { Cookie: cookieHeader(newSessionCookies) },
    });

    const location = authRes.headers['location'] as string | undefined;
    if (location) {
      const redirectUrl = new URL(location);
      const newCode = redirectUrl.searchParams.get('code');

      if (newCode) {
        const { result: tokenResult, tokens: t } = await testTokenEndpoint(newCode, codeVerifier);
        results.push(tokenResult);
        tokens = t;

        if (tokens) {
          results.push(await testUserInfoEndpoint(tokens.access_token));
        }
      }
    }
  } else {
    results.push({ name: '1.4 Token交换端点', status: 'SKIP', duration: 0, error: 'No authorization code available' });
    results.push({ name: '1.5 用户信息端点', status: 'SKIP', duration: 0, error: 'No access token available' });
  }

  results.push(await testJwksEndpoint());
  results.push(await testOidcDiscovery());

  // 2. Portal 客户端测试
  console.log('📋 Portal 客户端测试\n');
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

  // 返回退出码
  process.exit(failed > 0 ? 1 : 0);
}

runTests();