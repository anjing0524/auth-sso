import { db, schema } from '../apps/portal/src/lib/db';
import { eq, inArray } from 'drizzle-orm';
import { getDataScopeFilter, checkDataScope } from '../apps/portal/src/lib/auth-middleware';

/**
 * 验证用户管理 API 的数据范围过滤逻辑
 */
async function verify() {
  console.log('--- 正在验证用户管理数据范围过滤逻辑 ---');

  const rootDeptId = 'dept_root_v';
  const subDeptId = 'dept_sub_v';
  const otherDeptId = 'dept_other_v';
  const adminUserId = 'user_admin_v';
  const subUserId = 'user_sub_v';
  const otherUserId = 'user_other_v';
  const roleId = 'role_admin_v';

  try {
    // 1. 清理
    console.log('正在清理测试数据...');
    await db.delete(schema.userRoles).where(inArray(schema.userRoles.userId, [adminUserId, subUserId, otherUserId]));
    await db.delete(schema.users).where(inArray(schema.users.id, [adminUserId, subUserId, otherUserId]));
    await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    await db.delete(schema.departments).where(inArray(schema.departments.id, [rootDeptId, subDeptId, otherDeptId]));

    // 2. 准备数据
    console.log('正在准备测试数据...');
    await db.insert(schema.departments).values([
      { id: rootDeptId, publicId: 'pub_root', name: 'Root Dept' },
      { id: subDeptId, publicId: 'pub_sub', name: 'Sub Dept', parentId: rootDeptId },
      { id: otherDeptId, publicId: 'pub_other', name: 'Other Dept' },
    ]);

    await db.insert(schema.users).values([
      { id: adminUserId, publicId: 'pub_admin', username: 'admin_v', name: 'Admin', deptId: rootDeptId },
      { id: subUserId, publicId: 'pub_sub_user', username: 'sub_v', name: 'Sub User', deptId: subDeptId },
      { id: otherUserId, publicId: 'pub_other_user', username: 'other_v', name: 'Other User', deptId: otherDeptId },
    ]);

    await db.insert(schema.roles).values({
      id: roleId,
      publicId: 'pub_role',
      name: 'Dept Admin',
      code: 'DEPT_ADMIN_V',
      dataScopeType: 'DEPT_AND_SUB',
    });

    await db.insert(schema.userRoles).values({
      id: 'ur_admin',
      userId: adminUserId,
      roleId: roleId,
    });

    // 3. 验证 getDataScopeFilter
    console.log('\n验证 getDataScopeFilter...');
    const filter = await getDataScopeFilter(adminUserId);
    console.log(`- Filter type: ${filter.type === 'LIST' ? '✅ 通过' : '❌ 失败'}`);
    console.log(`- Dept IDs: ${filter.deptIds?.length === 2 ? '✅ 通过' : `❌ 失败 (期望 2, 实际 ${filter.deptIds?.length})`}`);
    console.log(`- 包含 Root: ${filter.deptIds?.includes(rootDeptId) ? '✅ 通过' : '❌ 失败'}`);
    console.log(`- 包含 Sub: ${filter.deptIds?.includes(subDeptId) ? '✅ 通过' : '❌ 失败'}`);
    console.log(`- 不包含 Other: ${!filter.deptIds?.includes(otherDeptId) ? '✅ 通过' : '❌ 失败'}`);

    // 4. 验证 checkDataScope
    console.log('\n验证 checkDataScope...');
    const canSeeSub = await checkDataScope(adminUserId, subDeptId);
    console.log(`- 访问子部门: ${canSeeSub ? '✅ 通过' : '❌ 失败'}`);

    const canSeeOther = await checkDataScope(adminUserId, otherDeptId);
    console.log(`- 访问无关部门: ${!canSeeOther ? '✅ 通过' : '❌ 失败'}`);

    console.log('\n--- 验证结束 ---');

    // 5. 清理
    await db.delete(schema.userRoles).where(inArray(schema.userRoles.userId, [adminUserId, subUserId, otherUserId]));
    await db.delete(schema.users).where(inArray(schema.users.id, [adminUserId, subUserId, otherUserId]));
    await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    await db.delete(schema.departments).where(inArray(schema.departments.id, [rootDeptId, subDeptId, otherDeptId]));

  } catch (error) {
    console.error('验证过程中出错:', error);
  } finally {
    process.exit(0);
  }
}

verify();
