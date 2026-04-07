import { checkDataScope } from '../apps/portal/src/lib/auth-middleware';
import { sql } from '../apps/portal/src/lib/db';

/**
 * 验证 RBAC 数据范围逻辑
 */
async function verify() {
  console.log('--- 正在验证 RBAC 数据范围逻辑 ---');

  try {
    // 1. 准备测试数据
    const testDeptId = 'dept_test_root';
    const subDeptId = 'dept_test_sub';
    const otherDeptId = 'dept_test_other';
    const testUserId = 'user_test_rbac';
    const testRoleId = 'role_test_custom';

    console.log('正在清理旧测试数据...');
    await sql`DELETE FROM role_data_scopes WHERE role_id = ${testRoleId}`;
    await sql`DELETE FROM user_roles WHERE user_id = ${testUserId}`;
    await sql`DELETE FROM roles WHERE id = ${testRoleId}`;
    await sql`DELETE FROM users WHERE id = ${testUserId}`;
    await sql`DELETE FROM departments WHERE id IN (${subDeptId}, ${otherDeptId}, ${testDeptId})`;

    console.log('正在创建测试部门...');
    await sql`INSERT INTO departments (id, public_id, name, parent_id) VALUES (${testDeptId}, 'pub_root', 'Root Dept', NULL)`;
    await sql`INSERT INTO departments (id, public_id, name, parent_id) VALUES (${subDeptId}, 'pub_sub', 'Sub Dept', ${testDeptId})`;
    await sql`INSERT INTO departments (id, public_id, name, parent_id) VALUES (${otherDeptId}, 'pub_other', 'Other Dept', NULL)`;

    console.log('正在创建测试用户与角色...');
    await sql`INSERT INTO users (id, public_id, username, name, dept_id) VALUES (${testUserId}, 'pub_user', 'test_rbac', 'Test RBAC', ${testDeptId})`;
    await sql`INSERT INTO roles (id, public_id, name, code, data_scope_type) VALUES (${testRoleId}, 'pub_role', 'Custom Role', 'CUSTOM_ROLE', 'DEPT_AND_SUB')`;
    await sql`INSERT INTO user_roles (id, user_id, role_id) VALUES ('ur_test', ${testUserId}, ${testRoleId})`;

    // 2. 验证 DEPT_AND_SUB
    console.log('\n[验证 DEPT_AND_SUB]');
    const isSubDeptValid = await checkDataScope(testUserId, subDeptId);
    console.log(`- 访问子部门: ${isSubDeptValid ? '✅ 通过' : '❌ 失败'}`);
    
    const isOtherDeptValid = await checkDataScope(testUserId, otherDeptId);
    console.log(`- 访问无关部门: ${!isOtherDeptValid ? '✅ 拦截成功' : '❌ 拦截失败'}`);

    // 3. 验证 CUSTOM
    console.log('\n[验证 CUSTOM]');
    await sql`UPDATE roles SET data_scope_type = 'CUSTOM' WHERE id = ${testRoleId}`;
    await sql`INSERT INTO role_data_scopes (id, role_id, dept_id) VALUES ('rds_test', ${testRoleId}, ${otherDeptId})`;

    const isCustomValid = await checkDataScope(testUserId, otherDeptId);
    console.log(`- 访问自定义授权部门: ${isCustomValid ? '✅ 通过' : '❌ 失败'}`);

    const isCustomInvalid = await checkDataScope(testUserId, subDeptId);
    console.log(`- 访问未授权部门: ${!isCustomInvalid ? '✅ 拦截成功' : '❌ 拦截失败'}`);

    console.log('\n--- 验证结束 ---');

    // 4. 清理
    console.log('正在清理测试数据...');
    await sql`DELETE FROM role_data_scopes WHERE role_id = ${testRoleId}`;
    await sql`DELETE FROM user_roles WHERE user_id = ${testUserId}`;
    await sql`DELETE FROM roles WHERE id = ${testRoleId}`;
    await sql`DELETE FROM users WHERE id = ${testUserId}`;
    await sql`DELETE FROM departments WHERE id IN (${subDeptId}, ${otherDeptId}, ${testDeptId})`;

  } catch (error) {
    console.error('验证过程中出错:', error);
  } finally {
    process.exit(0);
  }
}

verify();
