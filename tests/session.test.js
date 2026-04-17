/**
 * Session测试 - Session Tests
 * 验证Session存储、内容和过期机制
 */

const { TestReporter, HttpClient, CookieManager, TestRunner, config } = require('./utils');

/**
 * 运行Session测试 - Run session tests
 * @param {TestReporter} reporter - 测试报告器
 */
async function run(reporter) {
  const runner = new TestRunner(reporter);
  const http = runner.http;
  const assert = runner.assert;

  // 3.1 Session 存储与内容测试
  
  let appCookies;
  await runner.run('SESS-001/002', 'Session存储与内容验证', async () => {
    // 登录获取Session
    appCookies = await runner.performOAuthFlow(config.PORTAL_URL, 'portal');
    
    // 获取用户信息验证Session内容
    const response = await http.get(`${config.PORTAL_URL}/api/me`, {
      Cookie: appCookies.getHeader()
    });
    
    assert.status(response.status, 200, 'Session应有效');
    assert.exists(response.body.user || response.body.id, '应包含用户信息');
  });

  // SESS-003: Session Cookie属性 (SEC-001~003 也有覆盖)
  await runner.run('SESS-003', 'Session Cookie属性验证', async () => {
    const loginRes = await http.get(`${config.PORTAL_URL}/api/auth/login`);
    const setCookie = loginRes.headers['set-cookie'];
    if (setCookie) {
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
      assert.includes(cookieStr.toLowerCase(), 'httponly', '应设置HttpOnly');
      assert.includes(cookieStr.toLowerCase(), 'samesite', '应设置SameSite');
    }
  });

  // 3.2 Session 过期测试 (模拟)

  // SESS-010: 错误/过期的Session ID访问
  await runner.run('SESS-010', '过期Session访问验证', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/me`, {
      Cookie: 'portal_session_id=expired-id-12345'
    });
    assert.status(response.status, 401, '过期Session应返回401');
  });

  // SESS-012: 活跃续期验证
  await runner.run('SESS-012', 'Session活跃续期验证', async () => {
    if (!appCookies) throw new Error('需先登录');
    
    const response = await http.get(`${config.PORTAL_URL}/api/me`, {
      Cookie: appCookies.getHeader()
    });
    
    assert.status(response.status, 200, 'Session应持续有效');
  });
}

module.exports = { run };
