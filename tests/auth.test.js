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

  // 2.1 登录流程测试

  // AUTH-001: 首次登录跳转
  await runner.run('AUTH-001', '未登录访问受保护页面重定向到IdP', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/me`);
    assert.status(response.status, 401, 'API访问应返回401');
  });

  // AUTH-002/003/004: OAuth 完整流程
  let appCookies;
  await runner.run('AUTH-OAUTH-FLOW', 'OAuth 完整认证流程验证', async () => {
    appCookies = await runner.performOAuthFlow(config.PORTAL_URL, 'portal');
    const hasSession = Object.keys(appCookies.cookies).some(name => 
      name.includes('session') || name.includes('auth') || name.includes('token')
    );
    assert.equal(hasSession, true, '应成功建立Session');
  });

  // AUTH-011: State 验证-错误
  await runner.run('AUTH-011', '错误State验证', async () => {
    // 模拟一个带错误state的回调
    const response = await http.get(`${config.PORTAL_URL}/api/auth/callback?code=fake_code&state=wrong_state`);
    // 无论是400, 401还是跳转回登录页，都不应该是200成功
    assert.equal(response.status !== 200, true, '错误State不应返回200');
  });

  // AUTH-013: PKCE 验证 (验证登录入口参数)
  await runner.run('AUTH-013', 'PKCE参数验证', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/auth/login`);
    const location = response.headers['location'];
    if (location) {
      assert.includes(location, 'code_challenge=', '应包含code_challenge');
      assert.includes(location, 'code_challenge_method=S256', '应使用S256');
    }
  });

  // 2.3 登出流程测试

  // AUTH-020/021: 登出流程
  await runner.run('AUTH-020/021', 'Portal与IdP登出同步', async () => {
    if (!appCookies) {
      appCookies = await runner.performOAuthFlow(config.PORTAL_URL, 'portal');
    }
    
    const response = await http.post(`${config.PORTAL_URL}/api/auth/logout`, {}, {
      Cookie: appCookies.getHeader()
    });
    assert.equal(response.status === 200 || response.status === 302 || response.status === 307, true, '登出应成功');
    
    // 检查Portal Session已清除
    const checkRes = await http.get(`${config.PORTAL_URL}/api/me`, {
      Cookie: appCookies.getHeader()
    });
    assert.status(checkRes.status, 401, '登出后Session应失效');
  });
}

module.exports = { run };
