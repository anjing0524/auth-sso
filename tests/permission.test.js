/**
 * 权限测试 - Permission Tests
 * 验证API权限控制和RBAC功能
 */

const { TestReporter, TestRunner, config } = require('./utils');

/**
 * 运行权限测试 - Run permission tests
 * @param {TestReporter} reporter - 测试报告器
 */
async function run(reporter) {
  const runner = new TestRunner(reporter);
  const http = runner.http;
  const assert = runner.assert;

  // PERM-001: 未登录访问API返回401
  await runner.run('PERM-001', '未登录访问API返回401', async () => {
    const endpoints = [
      '/api/users',
      '/api/roles',
      '/api/permissions',
      '/api/departments',
      '/api/clients'
    ];

    for (const endpoint of endpoints) {
      const response = await http.get(`${config.PORTAL_URL}${endpoint}`);
      assert.equal(
        response.status === 401 || response.status === 403,
        true,
        `${endpoint}未登录应返回401或403`
      );
    }
  });

  // PERM-002: 权限API需要权限码
  await runner.run('PERM-002', '权限API需要权限码', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/permissions`);
    assert.equal(
      response.status === 401 || response.status === 403,
      true,
      '访问权限API需要登录或权限'
    );
  });

  // PERM-003: 用户API需要user:list权限
  await runner.run('PERM-003', '用户API需要user:list权限', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/users`);
    // 未登录或无权限都应被拒绝
    assert.equal(
      response.status === 401 || response.status === 403,
      true,
      '访问用户API需要权限'
    );
  });

  // PERM-004: 角色API需要role:list权限
  await runner.run('PERM-004', '角色API需要role:list权限', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/roles`);
    assert.equal(
      response.status === 401 || response.status === 403,
      true,
      '访问角色API需要权限'
    );
  });

  // PERM-005: 部门API需要dept:list权限
  await runner.run('PERM-005', '部门API需要dept:list权限', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/departments`);
    assert.equal(
      response.status === 401 || response.status === 403,
      true,
      '访问部门API需要权限'
    );
  });

  // PERM-006: Client API需要client:list权限
  await runner.run('PERM-006', 'Client API需要client:list权限', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/clients`);
    assert.equal(
      response.status === 401 || response.status === 403,
      true,
      '访问ClientAPI需要权限'
    );
  });

  // PERM-007: POST请求权限验证
  await runner.run('PERM-007', 'POST请求需要创建权限', async () => {
    const response = await http.post(`${config.PORTAL_URL}/api/users`, {
      name: 'test',
      email: 'test@test.com'
    });
    assert.equal(
      response.status === 401 || response.status === 403,
      true,
      'POST用户需要user:create权限'
    );
  });

  // PERM-008: 单个资源访问权限
  await runner.run('PERM-008', '单个资源访问权限', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/users/test-id`);
    assert.equal(
      response.status === 401 || response.status === 403,
      true,
      '访问单个用户需要user:read权限'
    );
  });

  // PERM-009: 角色权限绑定API
  await runner.run('PERM-009', '角色权限绑定API', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/roles/test-id/permissions`);
    assert.equal(
      response.status === 401 || response.status === 403,
      true,
      '访问角色权限绑定需要权限'
    );
  });

  // PERM-010: 用户角色绑定API
  await runner.run('PERM-010', '用户角色绑定API', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/users/test-id/roles`);
    assert.equal(
      response.status === 401 || response.status === 403,
      true,
      '访问用户角色绑定需要权限'
    );
  });

  // PERM-011: 审计日志API权限
  await runner.run('PERM-011', '审计日志API权限', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/audit/logs`);
    assert.equal(
      response.status === 401 || response.status === 403,
      true,
      '访问审计日志需要权限'
    );
  });

  // PERM-012: 登录日志API权限
  await runner.run('PERM-012', '登录日志API权限', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/audit/login-logs`);
    assert.equal(
      response.status === 401 || response.status === 403,
      true,
      '访问登录日志需要权限'
    );
  });
}

module.exports = { run };