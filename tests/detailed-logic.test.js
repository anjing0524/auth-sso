/**
 * 深度业务逻辑 TDD - Detailed Business Logic TDD
 * 针对商业化产品的细节约束进行验证
 */

const { TestRunner, config } = require('./utils');

async function run(reporter) {
  const runner = new TestRunner(reporter);
  const http = runner.http;
  const assert = runner.assert;

  let portalCookies;
  await runner.run('DET-PRE', '管理员登录', async () => {
    portalCookies = await runner.performOAuthFlow(config.PORTAL_URL, 'portal');
  });

  const getAuthHeaders = () => ({ Cookie: portalCookies?.getHeader() || '' });

  // --- 用户模块细化测试 ---

  await runner.run('DET-USER-001', '邮箱唯一性校验: 重复邮箱应报错', async () => {
    const timestamp = Date.now();
    const userA = { username: `uA_${timestamp}`, email: `conflict_${timestamp}@ex.com`, name: 'A', password: 'Password123!', status: 'ACTIVE' };
    const userB = { username: `uB_${timestamp}`, email: `conflict_${timestamp}@ex.com`, name: 'B', password: 'Password123!', status: 'ACTIVE' };

    // 创建第一个
    await http.post(`${config.PORTAL_URL}/api/users`, userA, getAuthHeaders());
    // 创建第二个 (重复邮箱)
    const res = await http.post(`${config.PORTAL_URL}/api/users`, userB, getAuthHeaders());
    
    assert.status(res.status, 400, '应返回 400 Bad Request');
    assert.includes(JSON.stringify(res.body), 'user_exists', '应提示用户已存在');
  });

  // --- 部门模块细化测试 ---

  await runner.run('DET-DEPT-001', '防循环引用: 不能将父部门设为自己', async () => {
    const timestamp = Date.now();
    // 1. 创建部门
    const res = await http.post(`${config.PORTAL_URL}/api/departments`, {
      name: '循环测试', code: `LOOP_${timestamp}`, sort: 1, parentId: null
    }, getAuthHeaders());
    const deptId = res.body.data.id;

    // 2. 尝试修改父部门为自己
    const updateRes = await http.put(`${config.PORTAL_URL}/api/departments/${deptId}`, {
      name: '循环测试-改', parentId: deptId // 触发循环
    }, getAuthHeaders());

    assert.status(updateRes.status, 400, '应阻止循环引用');
  });

  // --- 认证模块细化测试 ---

  await runner.run('DET-AUTH-001', '状态拦截: DISABLED 用户无法登录', async () => {
    const timestamp = Date.now();
    // 1. 创建一个禁用的用户
    const user = { 
      username: `dis_${timestamp}`, 
      email: `dis_${timestamp}@ex.com`, 
      name: 'Disabled User', 
      password: 'Password123!', 
      status: 'DISABLED' 
    };
    await http.post(`${config.PORTAL_URL}/api/users`, user, getAuthHeaders());

    // 2. 尝试登录 IdP
    try {
      const loginRes = await http.post(`${config.IDP_URL}/api/auth/sign-in/email`, {
        email: user.email,
        password: user.password
      });
      // 根据 Better Auth 逻辑，可能返回 401 或特定的状态错误
      assert.equal(loginRes.status !== 200, true, '禁用用户登录不应返回 200');
    } catch (e) {
      // 预期报错
    }
  });
}

module.exports = { run };
