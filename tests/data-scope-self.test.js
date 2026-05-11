/**
 * TDD: Data Scope 'SELF' 验证测试
 * 验证 PRD 需求: 拥有 SELF 数据范围的角色只能查看自己的数据。
 */

const { TestRunner, config } = require('./utils');

async function run(reporter) {
  const runner = new TestRunner(reporter);
  const http = runner.http;
  const assert = runner.assert;

  console.log('--- 开始执行 TDD: Data Scope SELF 验证测试 ---');

  let adminCookies, alphaCookies;
  let deptId, roleId, userAlphaId, userBetaId;
  let adminHeaders = {};
  const timestamp = Date.now();

  try {
    // 1. 管理员登录
    await runner.run('DS-SELF-001', '管理员登录', async () => {
      adminCookies = await runner.loginIdP();
      const portalRes = await runner.performOAuthFlow(config.PORTAL_URL, 'portal', adminCookies);
      adminCookies = portalRes; // 获取 Portal Session
      adminHeaders = { Cookie: adminCookies.getHeader() };
    });

    // 2. 环境准备: 创建部门和两个用户
    await runner.run('DS-SELF-002', '准备测试环境 (部门与双用户)', async () => {
      // 创建部门
      const deptRes = await http.post(`${config.PORTAL_URL}/api/departments`, {
        name: `TDD_DEPT_SELF_${timestamp}`, 
        code: `DEPT_SELF_${timestamp}`, 
        sort: 1, 
        parentId: null
      }, adminHeaders);
      assert.status(deptRes.status, 200, '创建部门成功');
      deptId = deptRes.body.data.id;

      // 创建角色 (SELF 数据范围)
      const roleRes = await http.post(`${config.PORTAL_URL}/api/roles`, {
        name: `TDD_ROLE_SELF_${timestamp}`,
        code: `ROLE_SELF_${timestamp}`,
        description: 'Only self data',
        dataScopeType: 'SELF'
      }, adminHeaders);
      assert.status(roleRes.status, 200, '创建角色成功');
      roleId = roleRes.body.data.id;

      // 创建 User Alpha
      const alphaRes = await http.post(`${config.PORTAL_URL}/api/users`, {
        username: `alpha_${timestamp}`,
        email: `alpha_${timestamp}@example.com`,
        name: 'User Alpha (Self)',
        password: 'Password123!',
        deptId: deptId
      }, adminHeaders);
      assert.status(alphaRes.status, 200, '创建 Alpha 成功');
      userAlphaId = alphaRes.body.data.id;

      // 为 Alpha 分配角色
      await http.post(`${config.PORTAL_URL}/api/users/${userAlphaId}/roles`, {
        roleIds: [roleId]
      }, adminHeaders);

      // 创建 User Beta (同部门)
      const betaRes = await http.post(`${config.PORTAL_URL}/api/users`, {
        username: `beta_${timestamp}`,
        email: `beta_${timestamp}@example.com`,
        name: 'User Beta (Colleague)',
        password: 'Password123!',
        deptId: deptId
      }, adminHeaders);
      assert.status(betaRes.status, 200, '创建 Beta 成功');
      userBetaId = betaRes.body.data.id;
    });

    // 3. User Alpha 登录
    await runner.run('DS-SELF-003', 'User Alpha (SELF 权限) 登录', async () => {
      const alphaIdpCookies = await runner.loginIdP(`alpha_${timestamp}@example.com`, 'Password123!');
      alphaCookies = await runner.performOAuthFlow(config.PORTAL_URL, 'portal', alphaIdpCookies);
      
      const hasSession = Object.keys(alphaCookies.cookies).some(name => 
        name.includes('session') || name.includes('auth') || name.includes('token')
      );
      assert.equal(hasSession, true, 'Alpha 登录后应获得 Session Cookie');
    });

    // 4. 验证数据过滤逻辑 (核心 TDD 断言)
    await runner.run('DS-SELF-004', '验证 SELF 数据范围过滤', async () => {
      const listRes = await http.get(`${config.PORTAL_URL}/api/users?pageSize=100`, { 
        Cookie: alphaCookies.getHeader() 
      });
      assert.status(listRes.status, 200, '获取列表请求成功');
      
      const userList = listRes.body.data;
      const alphaInList = userList.find(u => u.id === userAlphaId);
      const betaInList = userList.find(u => u.id === userBetaId);

      assert.exists(alphaInList, '列表中应包含自己');
      assert.equal(betaInList, undefined, '列表中不应包含同部门的其他人 (SELF 过滤失效)');
      assert.equal(userList.length, 1, '列表总数应仅为 1');
    });

  } finally {
    // 清理
    console.log('清理测试数据...');
    try {
      if (userAlphaId) await http.delete(`${config.PORTAL_URL}/api/users/${userAlphaId}`, adminHeaders);
      if (userBetaId) await http.delete(`${config.PORTAL_URL}/api/users/${userBetaId}`, adminHeaders);
      if (roleId) await http.delete(`${config.PORTAL_URL}/api/roles/${roleId}`, adminHeaders);
      if (deptId) await http.delete(`${config.PORTAL_URL}/api/departments/${deptId}`, adminHeaders);
    } catch (e) {
      console.error('清理失败:', e.message);
    }
  }
}

module.exports = { run };
