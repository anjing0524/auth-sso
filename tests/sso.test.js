/**
 * SSO测试 - SSO Integration Tests
 * 验证单点登录和单点登出功能
 */

const { TestReporter, TestRunner, config } = require('./utils');

/**
 * 运行SSO测试 - Run SSO tests
 * @param {TestReporter} reporter - 测试报告器
 */
async function run(reporter) {
  const runner = new TestRunner(reporter);
  const http = runner.http;
  const assert = runner.assert;

  // SSO-001: Demo App启动验证
  await runner.run('SSO-001', 'Demo App启动验证', async () => {
    const response = await http.get(config.DEMO_APP_URL);
    assert.status(response.status, 200, 'Demo App应正常启动');
    assert.includes(response.body, 'SSO', 'Demo App应显示SSO测试界面');
  });

  // SSO-002: Demo App登录入口
  await runner.run('SSO-002', 'Demo App登录入口', async () => {
    const response = await http.get(`${config.DEMO_APP_URL}/api/auth/login`);
    // Next.js 使用 307 临时重定向
    assert.equal(response.status === 302 || response.status === 307, true, 'Demo App登录入口应返回重定向');

    const location = response.headers['location'];
    // 应重定向到IdP
    assert.includes(location, config.IDP_URL, '应重定向到IdP');
    assert.includes(location, 'client_id=demo-app', '应使用demo-app client_id');
  });

  // SSO-003: Demo App使用正确的redirect_uri
  await runner.run('SSO-003', 'Demo App redirect_uri验证', async () => {
    const response = await http.get(`${config.DEMO_APP_URL}/api/auth/login`);
    const location = response.headers['location'];

    // redirect_uri应为注册的地址（URL编码后的）
    assert.includes(location, 'redirect_uri', '应包含redirect_uri参数');
    // 验证redirect_uri值（URL编码）
    assert.includes(decodeURIComponent(location), 'localhost:4002', 'redirect_uri应包含localhost:4002');
  });

  // SSO-004: Demo App PKCE验证
  await runner.run('SSO-004', 'Demo App PKCE验证', async () => {
    const response = await http.get(`${config.DEMO_APP_URL}/api/auth/login`);
    const location = response.headers['location'];

    assert.includes(location, 'code_challenge=', '应包含PKCE code_challenge');
    assert.includes(location, 'code_challenge_method=S256', '应使用S256方法');
  });

  // SSO-005: Demo App State参数
  await runner.run('SSO-005', 'Demo App State参数验证', async () => {
    const response = await http.get(`${config.DEMO_APP_URL}/api/auth/login`);
    const location = response.headers['location'];

    assert.includes(location, 'state=', '应包含state参数');

    const stateMatch = location.match(/state=([^&]+)/);
    if (stateMatch) {
      assert.equal(stateMatch[1].length >= 32, true, 'State长度应足够');
    }
  });

  // SSO-006: Demo App未登录访问/api/me
  await runner.run('SSO-006', 'Demo App未登录访问/api/me', async () => {
    const response = await http.get(`${config.DEMO_APP_URL}/api/me`);
    assert.status(response.status, 401, '未登录应返回401');
  });

  // SSO-007: Demo App登出功能
  await runner.run('SSO-007', 'Demo App登出功能', async () => {
    const response = await http.post(`${config.DEMO_APP_URL}/api/auth/logout`);
    assert.equal(
      response.status === 200 || response.status === 302,
      true,
      '登出应返回成功响应'
    );
  });

  // SSO-008: Portal和Demo App使用不同Client
  await runner.run('SSO-008', 'Portal和Demo App使用不同Client', async () => {
    const portalResponse = await http.get(`${config.PORTAL_URL}/api/auth/login`);
    const demoResponse = await http.get(`${config.DEMO_APP_URL}/api/auth/login`);

    const portalLocation = portalResponse.headers['location'];
    const demoLocation = demoResponse.headers['location'];

    // 验证使用不同的client_id
    assert.includes(portalLocation, 'client_id=portal', 'Portal应使用portal client_id');
    assert.includes(demoLocation, 'client_id=demo-app', 'Demo应使用demo-app client_id');
  });

  // SSO-009: IdP支持多个Client
  await runner.run('SSO-009', 'IdP支持多Client验证', async () => {
    // 验证OIDC发现文档包含支持的scope
    const response = await http.get(`${config.IDP_URL}/api/auth/.well-known/openid-configuration`);
    assert.status(response.status, 200, 'OIDC发现文档应可用');

    // 验证支持的response_types
    assert.exists(response.body.response_types_supported, '应包含response_types_supported');
  });

  // SSO-010: SSO登录流程完整性
  await runner.run('SSO-010', 'SSO登录流程完整性', async () => {
    // 发起Portal登录
    const portalLogin = await http.get(`${config.PORTAL_URL}/api/auth/login`);
    assert.equal(portalLogin.status === 302 || portalLogin.status === 307, true, 'Portal登录入口应返回重定向');

    // 发起Demo App登录
    const demoLogin = await http.get(`${config.DEMO_APP_URL}/api/auth/login`);
    assert.equal(demoLogin.status === 302 || demoLogin.status === 307, true, 'Demo登录入口应返回重定向');

    // 两个应用都应重定向到同一个IdP
    const portalLocation = portalLogin.headers['location'];
    const demoLocation = demoLogin.headers['location'];

    // 验证都指向同一个IdP
    assert.includes(portalLocation, config.IDP_URL, 'Portal应重定向到IdP');
    assert.includes(demoLocation, config.IDP_URL, 'Demo应重定向到IdP');
  });
}

module.exports = { run };