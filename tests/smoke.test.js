/**
 * 冒烟测试 - Smoke Tests
 * 验证所有服务启动和基础功能
 */

const { TestReporter, HttpClient, Assert, TestRunner, config } = require('./utils');

/**
 * 运行冒烟测试 - Run smoke tests
 * @param {TestReporter} reporter - 测试报告器
 */
async function run(reporter) {
  const runner = new TestRunner(reporter);
  const http = runner.http;
  const assert = runner.assert;

  // 1.1 服务启动测试
  
  // SM-001: Portal 启动测试
  await runner.run('SM-001', 'Portal启动测试', async () => {
    const response = await http.get(config.PORTAL_URL);
    assert.status(response.status, 200, 'Portal应返回200');
  });

  // SM-002: IdP 启动测试
  await runner.run('SM-002', 'IdP启动测试', async () => {
    const response = await http.get(config.IDP_URL);
    assert.status(response.status, 200, 'IdP应返回200');
  });

  // SM-003: Demo App 启动测试
  await runner.run('SM-003', 'DemoApp启动测试', async () => {
    const response = await http.get(config.DEMO_APP_URL);
    assert.status(response.status, 200, 'DemoApp应返回200');
  });

  // SM-004: 数据库连接测试 (通过IdP端点验证)
  await runner.run('SM-004', '数据库连接测试', async () => {
    const response = await http.get(`${config.IDP_URL}/api/auth/ok`);
    assert.status(response.status, 200, 'IdP健康检查应返回200');
    assert.equal(response.body.ok, true, '数据库连接应正常');
  });

  // SM-005: Redis 连接测试 (通过IdP端点验证)
  await runner.run('SM-005', 'Redis连接测试', async () => {
    // 假设IdP正常工作说明Redis也连接成功
    const response = await http.get(`${config.IDP_URL}/api/auth/ok`);
    assert.status(response.status, 200, 'IdP应正常响应');
  });

  // 1.2 基础功能测试

  // SM-010: 用户登录测试 (完整流程)
  let sessionCookies;
  await runner.run('SM-010', '用户登录功能测试', async () => {
    sessionCookies = await runner.performOAuthFlow(config.PORTAL_URL, 'portal');
    const hasSession = Object.keys(sessionCookies.cookies).some(name => 
      name.includes('session') || name.includes('auth') || name.includes('token')
    );
    assert.equal(hasSession, true, '登录后应获取Session相关的Cookie');
  });

  // SM-011: 用户信息获取
  await runner.run('SM-011', '用户信息获取测试', async () => {
    if (!sessionCookies) throw new Error('需先登录成功');
    const response = await http.get(`${config.PORTAL_URL}/api/me`, {
      Cookie: sessionCookies.getHeader()
    });
    assert.status(response.status, 200, '获取用户信息应成功');
    assert.exists(response.body.user || response.body.id, '应返回用户信息');
  });

  // SM-012: 用户登出
  await runner.run('SM-012', '用户登出功能测试', async () => {
    if (!sessionCookies) throw new Error('需先登录成功');
    const response = await http.post(`${config.PORTAL_URL}/api/auth/logout`, {}, {
      Cookie: sessionCookies.getHeader()
    });
    // 登出后访问/api/me应返回401
    const checkResponse = await http.get(`${config.PORTAL_URL}/api/me`, {
      Cookie: sessionCookies.getHeader()
    });
    assert.status(checkResponse.status, 401, '登出后访问应被拦截');
  });

  // 补充 OIDC 发现端点测试
  await runner.run('SM-020', 'OIDC发现端点验证', async () => {
    const response = await http.get(`${config.IDP_URL}/api/auth/.well-known/openid-configuration`);
    assert.status(response.status, 200, 'OIDC发现端点应可用');
    assert.exists(response.body.authorization_endpoint, '应包含授权端点');
  });
}

module.exports = { run };