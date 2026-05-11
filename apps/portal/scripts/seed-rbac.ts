/**
 * RBAC 数据初始化脚本
 * 运行: cd apps/portal && DATABASE_URL=<your_db_url> tsx scripts/seed-rbac.ts
 *
 * 幂等性：可重复执行，已存在的记录跳过，不会重复创建。
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import { ALL_PERMISSIONS, PERMISSION_LABELS } from '@auth-sso/contracts';
import crypto from 'crypto';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ 缺少环境变量 DATABASE_URL');
  process.exit(1);
}

const client = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(client, { schema });

async function seedPermissions(): Promise<Record<string, string>> {
  console.log('\n📋 初始化权限项...');
  const permIds: Record<string, string> = {};

  for (let i = 0; i < ALL_PERMISSIONS.length; i++) {
    const code = ALL_PERMISSIONS[i];
    const existing = await db.select({ id: schema.permissions.id })
      .from(schema.permissions)
      .where(eq(schema.permissions.code, code));

    if (existing.length > 0) {
      permIds[code] = existing[0]!.id;
      process.stdout.write(`  ↩ 已存在: ${code}\n`);
      continue;
    }

    const id = crypto.randomUUID();
    await db.insert(schema.permissions).values({
      id,
      publicId: `perm_${i.toString().padStart(3, '0')}_${Date.now().toString(36)}`,
      name: PERMISSION_LABELS[code] ?? code,
      code,
      type: 'API',
      sort: i,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    permIds[code] = id;
    process.stdout.write(`  ✅ 创建: ${code}\n`);
  }

  return permIds;
}

async function seedRole(
  code: string,
  name: string,
  description: string,
  dataScopeType: 'ALL' | 'SELF',
  sort: number,
): Promise<string> {
  const existing = await db.select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.code, code));

  if (existing.length > 0) {
    process.stdout.write(`  ↩ 角色已存在: ${code}\n`);
    return existing[0]!.id;
  }

  const id = crypto.randomUUID();
  await db.insert(schema.roles).values({
    id,
    publicId: `role_${code.toLowerCase()}`,
    name,
    code,
    description,
    dataScopeType,
    isSystem: true,
    status: 'ACTIVE',
    sort,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  process.stdout.write(`  ✅ 创建角色: ${code}\n`);
  return id;
}

async function bindPermissions(roleId: string, permIds: Record<string, string>): Promise<void> {
  // 清空旧绑定后重建，保持幂等
  await db.delete(schema.rolePermissions)
    .where(eq(schema.rolePermissions.roleId, roleId));

  const rows = Object.values(permIds).map(permissionId => ({
    id: crypto.randomUUID(),
    roleId,
    permissionId,
    createdAt: new Date(),
  }));

  if (rows.length > 0) {
    await db.insert(schema.rolePermissions).values(rows);
  }
}

async function main() {
  console.log('🌱 开始 RBAC 数据初始化...');

  // 1. 初始化所有权限
  const permIds = await seedPermissions();

  // 2. 初始化系统角色
  console.log('\n🛡️  初始化角色...');
  const superAdminId = await seedRole(
    'SUPER_ADMIN',
    '超级管理员',
    '拥有所有权限，不受数据范围限制',
    'ALL',
    0,
  );
  const adminId = await seedRole(
    'ADMIN',
    '系统管理员',
    '拥有所有权限，数据范围为全量',
    'ALL',
    1,
  );

  // 3. 为 SUPER_ADMIN 和 ADMIN 绑定全部权限
  console.log('\n🔗 绑定权限...');
  await bindPermissions(superAdminId, permIds);
  process.stdout.write(`  ✅ SUPER_ADMIN ← ${Object.keys(permIds).length} 个权限\n`);
  await bindPermissions(adminId, permIds);
  process.stdout.write(`  ✅ ADMIN ← ${Object.keys(permIds).length} 个权限\n`);

  console.log('\n✅ RBAC 初始化完成！');
  console.log('   提示：用已有超级管理员账号登录，或手工执行以下 SQL 为指定用户分配 SUPER_ADMIN 角色：');
  console.log(`   INSERT INTO user_roles (id, user_id, role_id, created_at)`);
  console.log(`   VALUES (gen_random_uuid(), '<your_user_id>', '${superAdminId}', now());`);

  await client.end();
}

main().catch(err => {
  console.error('\n❌ 初始化失败:', err.message);
  process.exit(1);
});
