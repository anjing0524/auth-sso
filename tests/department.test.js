/**
 * 部门管理 TDD 测试 - Department Management TDD
 * 验证树形结构、关联关系及业务约束
 */

const { TestRunner, config } = require('./utils');

async function run(reporter) {
  const runner = new TestRunner(reporter);
  const http = runner.http;
  const assert = runner.assert;

  let sessionCookies;
  
  // 前置：登录
  await runner.run('DEP-PRE', '管理员登录', async () => {
    sessionCookies = await runner.performOAuthFlow(config.PORTAL_URL, 'portal');
    assert.exists(sessionCookies.get('portal_session_id'), '登录应成功');
  });

  if (!sessionCookies) return;

  const headers = { Cookie: sessionCookies.getHeader() };
  let rootDeptId;
  let subDeptId;

  // 1. 创建根部门
  await runner.run('DEP-001', '创建根部门', async () => {
    const res = await http.post(`${config.PORTAL_URL}/api/departments`, {
      name: '总公司_TDD',
      code: 'ROOT_TDD',
      sort: 1,
      parentId: null
    }, headers);
    assert.status(res.status, 200, '创建根部门应成功');
    rootDeptId = res.body.data.id;
    assert.exists(rootDeptId, '应返回部门ID');
  });

  // 2. 创建子部门
  await runner.run('DEP-002', '创建子部门', async () => {
    const res = await http.post(`${config.PORTAL_URL}/api/departments`, {
      name: '技术部_TDD',
      code: 'TECH_TDD',
      sort: 1,
      parentId: rootDeptId
    }, headers);
    assert.status(res.status, 200, '创建子部门应成功');
    subDeptId = res.body.data.id;
  });

  // 3. 验证树形结构 (核心逻辑)
  await runner.run('DEP-003', '验证树形结构渲染', async () => {
    const res = await http.get(`${config.PORTAL_URL}/api/departments`, headers);
    assert.status(res.status, 200, '获取部门列表应成功');
    
    const root = res.body.data.find(d => d.id === rootDeptId);
    assert.exists(root, '根部门应在列表中');
    assert.exists(root.children, '根部门应包含 children 字段');
    
    const sub = root.children.find(d => d.id === subDeptId);
    assert.exists(sub, '子部门应在根部门的 children 中');
    console.log('✅ 验证到真实的树形嵌套结构');
  });

  // 4. 业务约束：删除检查
  await runner.run('DEP-004', '验证无法删除含有子部门的父部门', async () => {
    const res = await http.delete(`${config.PORTAL_URL}/api/departments/${rootDeptId}`, headers);
    // 这是一个业务约束点，预期失败或提示
    assert.equal(res.status === 400 || res.status === 403, true, '删除有子节点的部门应被阻止');
  });

  // 5. 清理数据
  await runner.run('DEP-005', '清理测试数据', async () => {
    await http.delete(`${config.PORTAL_URL}/api/departments/${subDeptId}`, headers);
    await http.delete(`${config.PORTAL_URL}/api/departments/${rootDeptId}`, headers);
  });
}

module.exports = { run };
