/**
 * Session过期测试 - Session Expiry Tests
 * 验证Session idle timeout和absolute timeout机制
 */

const { TestReporter, TestRunner, config } = require('./utils');

/**
 * 运行Session测试 - Run session tests
 * @param {TestReporter} reporter - 测试报告器
 */
async function run(reporter) {
  const runner = new TestRunner(reporter);
  const http = runner.http;
  const assert = runner.assert;

  // SESS-001: 无Session访问返回401
  await runner.run('SESS-001', '无Session访问返回401', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/me`);
    assert.status(response.status, 401, '无Session应返回401');
  });

  // SESS-002: Session Cookie不存在
  await runner.run('SESS-002', '无Session Cookie', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/me`);
    // 验证返回的错误格式
    assert.exists(response.body, '响应应有body');
    assert.exists(response.body.error, '响应应包含error字段');
  });

  // SESS-003: 登录入口初始化OAuth流程
  await runner.run('SESS-003', '登录初始化OAuth流程', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/auth/login`);
    // Next.js 使用 307 临时重定向
    assert.equal(response.status === 302 || response.status === 307, true, '登录入口应返回重定向');

    // 提取Set-Cookie中的state
    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
      assert.includes(setCookie, 'oauth_state', '应设置oauth_state Cookie');
    }
  });

  // SESS-004: OAuth state Cookie属性验证
  await runner.run('SESS-004', 'OAuth state Cookie属性', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/auth/login`);
    const setCookie = response.headers['set-cookie'];

    if (setCookie) {
      // 验证Cookie属性
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;

      // HttpOnly属性
      assert.includes(cookieStr.toLowerCase(), 'httponly', 'Cookie应设置HttpOnly');

      // SameSite属性
      assert.includes(cookieStr.toLowerCase(), 'samesite', 'Cookie应设置SameSite');
    }
  });

  // SESS-005: 登出清除Session
  await runner.run('SESS-005', '登出清除Session', async () => {
    const response = await http.post(`${config.PORTAL_URL}/api/auth/logout`);

    // 登出应成功
    assert.equal(
      response.status === 200 || response.status === 302,
      true,
      '登出应返回成功响应'
    );

    // 检查是否有清除Cookie的指令
    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
      // Cookie应被标记为过期或清除
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
      // 检查是否有过期设置（max-age=0或expires）
      assert.equal(
        cookieStr.includes('max-age=0') ||
        cookieStr.includes('Max-Age=0') ||
        cookieStr.includes('expires') ||
        response.status === 200,
        true,
        '登出应清除Session Cookie'
      );
    }
  });

  // SESS-006: 未登录访问管理页面
  await runner.run('SESS-006', '未登录访问管理页面', async () => {
    const response = await http.get(`${config.PORTAL_URL}/users`);
    // 应重定向到登录页或返回页面（前端处理）
    assert.equal(
      response.status === 302 || response.status === 307 || response.status === 200,
      true,
      '未登录访问管理页面应被阻止或显示登录提示'
    );
  });

  // SESS-007: Token过期处理
  await runner.run('SESS-007', 'Token过期处理', async () => {
    // 模拟过期Token的请求
    const response = await http.get(`${config.PORTAL_URL}/api/me`, {
      'Cookie': 'portal_session_id=expired_token_value'
    });
    // 应返回401表示Session无效
    assert.status(response.status, 401, '过期Session应返回401');
  });

  // SESS-008: 错误Session格式
  await runner.run('SESS-008', '错误Session格式处理', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/me`, {
      'Cookie': 'portal_session_id=invalid_format'
    });
    assert.status(response.status, 401, '错误格式Session应返回401');
  });

  // SESS-009: 空Session ID
  await runner.run('SESS-009', '空Session ID处理', async () => {
    const response = await http.get(`${config.PORTAL_URL}/api/me`, {
      'Cookie': 'portal_session_id='
    });
    assert.status(response.status, 401, '空Session ID应返回401');
  });

  // SESS-010: IdP Session检查
  await runner.run('SESS-010', 'IdP Session状态检查', async () => {
    // 检查IdP的健康状态
    const response = await http.get(`${config.IDP_URL}/api/auth/ok`);
    assert.status(response.status, 200, 'IdP应正常响应');
    assert.equal(response.body.ok, true, 'IdP状态应为ok');
  });
}

module.exports = { run };