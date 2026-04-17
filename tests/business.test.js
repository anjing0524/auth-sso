/**
 * 业务功能测试 - Business Function Tests
 * 验证用户管理、角色管理、应用管理等核心业务逻辑
 */

const { TestReporter, TestRunner, config } = require('./utils');

/**
 * 运行业务测试 - Run business tests
 * @param {TestReporter} reporter - 测试报告器
 */
async function run(reporter) {
  const runner = new TestRunner(reporter);
  const http = runner.http;
  const assert = runner.assert;

  let sessionCookies;
  
  // 前置条件：管理员登录
  await runner.run('BUS-PRE', '管理员登录获取Session', async () => {
    sessionCookies = await runner.performOAuthFlow(config.PORTAL_URL, 'portal');
    assert.exists(sessionCookies.get('portal_session_id') || sessionCookies.get('better-auth.session_token'), '登录应成功');
  });

  if (!sessionCookies) {
    console.error('❌ 无法进行业务测试：登录失败');
    return;
  }

  // 1. 用户管理测试 (User Management)
  
  let testUserId;
  await runner.run('BUS-USER-001', '获取用户列表', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/users`, {
      Cookie: sessionCookies.getHeader()
    });
    assert.status(response.status, 200, '获取用户列表应成功');
    assert.type(response.body.data, 'array', '应返回用户数据数组');
    assert.exists(response.body.pagination, '应包含分页信息');
  });

  await runner.run('BUS-USER-002', '创建新用户', async () => {
    const timestamp = Date.now();
    const newUser = {
      username: `testuser_${timestamp}`,
      email: `test_${timestamp}@example.com`,
      name: `测试用户_${timestamp}`,
      password: 'Password123!',
      status: 'ACTIVE'
    };

    const response = await http.post(`${config.PORTAL_URL}/api/users`, newUser, {
      Cookie: sessionCookies.getHeader()
    });
    
    assert.status(response.status, 200, '创建用户应成功');
    assert.exists(response.body.data.id, '返回结果应包含新用户ID');
    testUserId = response.body.data.id;
  });

  // 2. 角色管理测试 (Role Management)

  let testRoleId;
  await runner.run('BUS-ROLE-001', '获取角色列表', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/roles`, {
      Cookie: sessionCookies.getHeader()
    });
    assert.status(response.status, 200, '获取角色列表应成功');
    assert.type(response.body.data, 'array', '应返回角色数据数组');
  });

  await runner.run('BUS-ROLE-002', '创建新角色', async () => {
    const timestamp = Date.now();
    const newRole = {
      name: `测试角色_${timestamp}`,
      code: `TEST_ROLE_${timestamp}`,
      description: '自动化测试创建的角色'
    };

    const response = await http.post(`${config.PORTAL_URL}/api/roles`, newRole, {
      Cookie: sessionCookies.getHeader()
    });
    
    assert.status(response.status, 200, '创建角色应成功');
    assert.exists(response.body.data.id, '返回结果应包含新角色ID');
    testRoleId = response.body.data.id;
  });

  // 3. 应用管理测试 (Application/Client Management)

  await runner.run('BUS-APP-001', '获取应用列表', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/clients`, {
      Cookie: sessionCookies.getHeader()
    });
    assert.status(response.status, 200, '获取应用列表应成功');
    assert.type(response.body.data, 'array', '应返回应用数据数组');
  });

  await runner.run('BUS-APP-002', '注册新SSO应用', async () => {
    const timestamp = Date.now();
    const newApp = {
      name: `测试应用_${timestamp}`,
      clientId: `client_${timestamp}`,
      clientSecret: `secret_${timestamp}`,
      redirectUris: [`http://localhost:5000/callback`],
      type: 'web'
    };

    const response = await http.post(`${config.PORTAL_URL}/api/clients`, newApp, {
      Cookie: sessionCookies.getHeader()
    });
    
    assert.status(response.status, 200, '注册应用应成功');
  });

  // 4. 审计日志测试 (Audit Logs)

  await runner.run('BUS-AUDIT-001', '查询登录日志', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/audit/login-logs`, {
      Cookie: sessionCookies.getHeader()
    });
    assert.status(response.status, 200, '查询登录日志应成功');
    assert.exists(response.body.data, '应返回日志数据');
  });

  await runner.run('BUS-AUDIT-002', '查询操作日志', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/audit/logs`, {
      Cookie: sessionCookies.getHeader()
    });
    assert.status(response.status, 200, '查询操作日志应成功');
  });
}

module.exports = { run };
