import { db, schema } from '../apps/portal/src/lib/db';
import { eq, and } from 'drizzle-orm';

/**
 * 验证角色数据范围管理 API (直接验证数据库操作，因为在本地运行 API 比较麻烦)
 */
async function verify() {
  console.log('--- 正在验证角色数据范围管理逻辑 ---');

  const testRoleId = 'role_test_mgmt';
  const testDeptId1 = 'dept_test_mgmt_1';
  const testDeptId2 = 'dept_test_mgmt_2';

  try {
    // 1. 清理
    await db.delete(schema.roleDataScopes).where(eq(schema.roleDataScopes.roleId, testRoleId));
    await db.delete(schema.roles).where(eq(schema.roles.id, testRoleId));
    await db.delete(schema.departments).where(eq(schema.departments.id, testDeptId1));
    await db.delete(schema.departments).where(eq(schema.departments.id, testDeptId2));

    // 2. 准备数据
    await db.insert(schema.departments).values([
      { id: testDeptId1, publicId: 'pub_dept_1', name: 'Dept 1' },
      { id: testDeptId2, publicId: 'pub_dept_2', name: 'Dept 2' },
    ]);
    await db.insert(schema.roles).values({
      id: testRoleId,
      publicId: 'pub_role_mgmt',
      name: 'Mgmt Role',
      code: 'MGMT_ROLE',
      dataScopeType: 'CUSTOM',
    });

    // 3. 模拟 POST (批量更新)
    console.log('正在验证批量更新 (POST)...');
    const deptIds = [testDeptId1, testDeptId2];
    await db.transaction(async (tx) => {
      await tx.delete(schema.roleDataScopes).where(eq(schema.roleDataScopes.roleId, testRoleId));
      const values = deptIds.map(deptId => ({
        id: crypto.randomUUID(),
        roleId: testRoleId,
        deptId,
        createdAt: new Date(),
      }));
      await tx.insert(schema.roleDataScopes).values(values);
    });

    const resultPost = await db.select().from(schema.roleDataScopes).where(eq(schema.roleDataScopes.roleId, testRoleId));
    console.log(`- 插入记录数: ${resultPost.length === 2 ? '✅ 通过' : `❌ 失败 (期望 2, 实际 ${resultPost.length})`}`);

    // 4. 模拟 DELETE (移除特定关联)
    console.log('\n正在验证移除特定关联 (DELETE)...');
    await db.delete(schema.roleDataScopes)
      .where(
        and(
          eq(schema.roleDataScopes.roleId, testRoleId),
          eq(schema.roleDataScopes.deptId, testDeptId1)
        )
      );

    const resultDelete = await db.select().from(schema.roleDataScopes).where(eq(schema.roleDataScopes.roleId, testRoleId));
    console.log(`- 剩余记录数: ${resultDelete.length === 1 ? '✅ 通过' : `❌ 失败 (期望 1, 实际 ${resultDelete.length})`}`);
    console.log(`- 剩余部门 ID: ${resultDelete[0].deptId === testDeptId2 ? '✅ 通过' : '❌ 失败'}`);

    console.log('\n--- 验证结束 ---');

    // 5. 清理
    await db.delete(schema.roleDataScopes).where(eq(schema.roleDataScopes.roleId, testRoleId));
    await db.delete(schema.roles).where(eq(schema.roles.id, testRoleId));
    await db.delete(schema.departments).where(eq(schema.departments.id, testDeptId1));
    await db.delete(schema.departments).where(eq(schema.departments.id, testDeptId2));

  } catch (error) {
    console.error('验证过程中出错:', error);
  } finally {
    process.exit(0);
  }
}

verify();
