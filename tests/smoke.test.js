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

  // SM-001: Portal 启动测试
  await runner.run('SM-001', 'Portal启动测试', async () => {
    const response = await http.get(config.PORTAL_URL);
    assert.status(response.status, 200, 'Portal应返回200');
    assert.responseTime(response.duration, 5000, 'Portal启动时间');
  });

  // SM-002: IdP 启动测试
  await runner.run('SM-002', 'IdP启动测试', async () => {
    const response = await http.get(config.IDP_URL);
    assert.status(response.status, 200, 'IdP应返回200');
    assert.responseTime(response.duration, 5000, 'IdP启动时间');
  });

  // SM-003: Demo App 启动测试
  await runner.run('SM-003', 'DemoApp启动测试', async () => {
    const response = await http.get(config.DEMO_APP_URL);
    assert.status(response.status, 200, 'DemoApp应返回200');
    assert.responseTime(response.duration, 5000, 'DemoApp启动时间');
  });

  // SM-004: IdP 健康检查端点
  await runner.run('SM-004', 'IdP健康检查端点', async () => {
    const response = await http.get(`${config.IDP_URL}/api/auth/ok`);
    assert.status(response.status, 200, 'IdP健康检查应返回200');
    assert.exists(response.body.ok, '响应应包含ok字段');
    assert.equal(response.body.ok, true, 'ok应为true');
  });

  // SM-005: Portal API 端点可用性
  await runner.run('SM-005', 'Portal API端点可用性', async () => {
    // 未登录访问应返回401
    const response = await http.get(`${config.PORTAL_URL}/api/me`);
    assert.status(response.status, 401, '未登录访问/api/me应返回401');
  });

  // SM-006: OIDC 发现端点
  await runner.run('SM-006', 'OIDC发现端点', async () => {
    const response = await http.get(`${config.IDP_URL}/api/auth/.well-known/openid-configuration`);
    assert.status(response.status, 200, 'OIDC发现端点应返回200');

    // 验证必要字段
    assert.exists(response.body.authorization_endpoint, '应包含authorization_endpoint');
    assert.exists(response.body.token_endpoint, '应包含token_endpoint');
    assert.exists(response.body.userinfo_endpoint, '应包含userinfo_endpoint');
    assert.exists(response.body.jwks_uri, '应包含jwks_uri');
  });

  // SM-007: JWKS 端点
  await runner.run('SM-007', 'JWKS端点', async () => {
    const response = await http.get(`${config.IDP_URL}/api/auth/jwks`);
    assert.status(response.status, 200, 'JWKS端点应返回200');
    assert.exists(response.body.keys, '应包含keys数组');
    assert.type(response.body.keys, 'object', 'keys应为数组');
  });

  // SM-008: 用户管理API端点
  await runner.run('SM-008', '用户管理API端点', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/users`);
    // 未登录应返回401或403
    assert.equal(
      response.status === 401 || response.status === 403,
      true,
      '未登录访问用户API应返回401或403'
    );
  });

  // SM-009: 角色管理API端点
  await runner.run('SM-009', '角色管理API端点', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/roles`);
    assert.equal(
      response.status === 401 || response.status === 403,
      true,
      '未登录访问角色API应返回401或403'
    );
  });

  // SM-010: 部门管理API端点
  await runner.run('SM-010', '部门管理API端点', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/departments`);
    assert.equal(
      response.status === 401 || response.status === 403,
      true,
      '未登录访问部门API应返回401或403'
    );
  });

  // SM-011: Client管理API端点
  await runner.run('SM-011', 'Client管理API端点', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/clients`);
    assert.equal(
      response.status === 401 || response.status === 403,
      true,
      '未登录访问ClientAPI应返回401或403'
    );
  });

  // SM-012: 权限管理API端点
  await runner.run('SM-012', '权限管理API端点', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/permissions`);
    assert.equal(
      response.status === 401 || response.status === 403,
      true,
      '未登录访问权限API应返回401或403'
    );
  });
}

module.exports = { run };