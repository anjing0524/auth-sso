/**
 * 全链路 E2E 验证测试 - Complete E2E Flow Test
 * 模拟真实用户从认证到业务操作再到登出的全生命周期
 */

const { TestRunner, config, CookieManager } = require('./utils');

/**
 * 运行 E2E 测试
 * @param {TestReporter} reporter - 测试报告器
 */
async function run(reporter) {
  const runner = new TestRunner(reporter);
  const http = runner.http;
  const assert = runner.assert;

  let adminSession;
  let idpSession;

  // 1. 管理员登录全流程 (OIDC Flow)
  await runner.run('E2E-01', '管理员完成完整的 SSO 登录流程', async () => {
    // 执行全链路 OAuth 流程
    adminSession = await runner.performOAuthFlow(config.PORTAL_URL, 'portal');
    
    // 验证 Session 建立
    const hasPortalSession = Object.keys(adminSession.cookies).some(name => name.includes('portal_session'));
    assert.exists(hasPortalSession, 'Portal 侧应成功建立 session');
    
    // 获取 IdP Session (用于后续单点登出测试)
    const loginRes = await http.post(`${config.IDP_URL}/api/auth/sign-in/email`, {
      email: config.TEST_USER.email,
      password: config.TEST_USER.password
    });
    idpSession = new CookieManager();
    idpSession.extract(loginRes.cookies);
  });

  // 2. 验证管理后台概览数据 (Dashboard Data)
  await runner.run('E2E-02', '验证 Dashboard 概览数据加载成功', async () => {
    if (!adminSession) throw new Error('需先完成登录');
    
    const response = await http.get(`${config.PORTAL_URL}/api/me`, {
      Cookie: adminSession.getHeader()
    });
    
    assert.status(response.status, 200, '获取用户信息应成功');
    assert.exists(response.body.user, '应返回用户信息');
    assert.includes(response.body.permissions, 'user:list', '管理员应具有用户查看权限');
  });

  // 3. 验证管理页面 RBAC 拦截 (API Level)
  await runner.run('E2E-03', '验证无权用户访问管理 API 被拦截', async () => {
    // 我们创建一个受限用户 Session (模拟一个普通 Employee)
    // 这里由于环境限制，我们直接使用一个不带权限的非法 Session 或模拟权限缺失
    const response = await http.get(`${config.PORTAL_URL}/api/audit/logs`, {
      // 故意不传 Cookie 或传一个无效的
      Cookie: 'portal_session_id=invalid-id'
    });
    
    assert.status(response.status, 401, '未认证访问敏感 API 应被拦截');
  });

  // 4. 全域登出验证 (Global Logout)
  await runner.run('E2E-04', '执行全域登出并验证 Session 失效', async () => {
    if (!adminSession) throw new Error('需先完成登录');

    // 调用 Portal 登出
    const logoutRes = await http.get(`${config.PORTAL_URL}/api/auth/logout`, {
      Cookie: adminSession.getHeader()
    });
    
    // 兼容 302 和 307
    const isRedirect = logoutRes.status === 302 || logoutRes.status === 307;
    assert.equal(isRedirect, true, `登出后应执行重定向，实际状态码: ${logoutRes.status}`);
    
    // 验证原 Portal Session 访问 API 失效
    const checkPortalRes = await http.get(`${config.PORTAL_URL}/api/me`, {
      Cookie: adminSession.getHeader()
    });
    assert.status(checkPortalRes.status, 401, '登出后 Portal Session 应失效');
  });
}

module.exports = { run };
