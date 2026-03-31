/**
 * 认证链路测试 - Authentication Flow Tests
 * 验证OAuth授权码流程、登录、登出功能
 */

const { TestReporter, HttpClient, CookieManager, TestRunner, config } = require('./utils');

/**
 * 运行认证测试 - Run authentication tests
 * @param {TestReporter} reporter - 测试报告器
 */
async function run(reporter) {
  const runner = new TestRunner(reporter);
  const http = runner.http;
  const assert = runner.assert;
  const cookies = new CookieManager();

  // AUTH-001: 登录入口返回重定向
  await runner.run('AUTH-001', '登录入口返回重定向到IdP', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/auth/login`);
    // Next.js 使用 307 临时重定向
    assert.equal(response.status === 302 || response.status === 307, true, '登录入口应返回重定向');

    const location = response.headers['location'];
    assert.exists(location, '应包含location header');
    assert.includes(location, config.IDP_URL, '应重定向到IdP');
    assert.includes(location, '/oauth2/authorize', '应跳转到authorize端点');
    assert.includes(location, 'client_id=portal', '应包含client_id参数');
    assert.includes(location, 'redirect_uri', '应包含redirect_uri参数');
    assert.includes(location, 'state=', '应包含state参数');
    assert.includes(location, 'code_challenge=', '应包含PKCE code_challenge');
  });

  // AUTH-002: State参数生成和存储
  await runner.run('AUTH-002', 'State参数生成验证', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/auth/login`);
    const location = response.headers['location'];
    const stateMatch = location.match(/state=([^&]+)/);
    assert.exists(stateMatch, 'State参数应存在');
    assert.equal(stateMatch[1].length >= 32, true, 'State长度应至少32字符');
  });

  // AUTH-003: PKCE code_challenge参数
  await runner.run('AUTH-003', 'PKCE参数验证', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/auth/login`);
    const location = response.headers['location'];

    // 验证code_challenge
    assert.includes(location, 'code_challenge=', '应包含code_challenge');
    assert.includes(location, 'code_challenge_method=S256', '应使用S256方法');

    // 验证nonce
    assert.includes(location, 'nonce=', '应包含nonce参数');
  });

  // AUTH-004: 登录页面可访问
  await runner.run('AUTH-004', 'IdP登录页面可访问', async () => {
    const response = await http.get(`${config.IDP_URL}/sign-in`);
    assert.status(response.status, 200, '登录页面应返回200');
    assert.includes(response.body, '<form', '应包含登录表单');
    assert.includes(response.body, 'email', '应包含email输入');
    assert.includes(response.body, 'password', '应包含password输入');
  });

  // AUTH-005: 错误的state被拒绝
  await runner.run('AUTH-005', '错误state被拒绝', async () => {
    // 模拟带错误state的回调
    const response = await http.get(
      `${config.PORTAL_URL}/api/auth/callback?code=test_code&state=invalid_state`
    );
    // 应返回错误页面或重定向到登录页
    assert.equal(
      response.status === 400 || response.status === 302 || response.status === 307 || response.status === 401,
      true,
      '错误state应被拒绝'
    );
  });

  // AUTH-006: 登出功能
  await runner.run('AUTH-006', '登出功能验证', async () => {
    const response = await http.post(`${config.PORTAL_URL}/api/auth/logout`);
    // 登出应成功，返回重定向或成功响应
    assert.equal(
      response.status === 200 || response.status === 302,
      true,
      '登出应返回成功响应'
    );
  });

  // AUTH-007: Token刷新失败处理
  await runner.run('AUTH-007', 'Token刷新失败处理', async () => {
    // 无有效session时访问需要刷新的接口
    const response = await http.get(`${config.PORTAL_URL}/api/me`);
    assert.status(response.status, 401, '无session时应返回401');
  });

  // AUTH-008: 权限上下文获取
  await runner.run('AUTH-008', '权限上下文API', async () => {
    // 未登录访问权限上下文
    const response = await http.get(`${config.PORTAL_URL}/api/me/permissions`);
    assert.status(response.status, 401, '未登录应返回401');
  });

  // AUTH-009: 登录性能测试
  await runner.run('AUTH-009', '登录响应时间', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/auth/login`);
    assert.responseTime(
      response.duration,
      config.PERFORMANCE_THRESHOLD.loginResponseTime,
      '登录响应时间应在阈值内'
    );
  });

  // AUTH-010: OIDC authorize端点响应
  await runner.run('AUTH-010', 'OIDC authorize端点', async () => {
    const response = await http.get(
      `${config.IDP_URL}/api/auth/oauth2/authorize?client_id=portal&redirect_uri=http://localhost:4000/auth/callback&response_type=code&scope=openid&state=test&nonce=test`
    );
    // 应重定向到登录页或返回登录页面
    assert.equal(
      response.status === 200 || response.status === 302 || response.status === 307,
      true,
      'authorize端点应正常响应'
    );
  });
}

module.exports = { run };