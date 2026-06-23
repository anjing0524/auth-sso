/**
 * 开发环境全量 Seed 脚本
 *
 * 职责：清空数据库 → 创建管理员用户 + OAuth 客户端 + 部门
 * RBAC 初始化委托给 seed-rbac.ts（幂等，从 @auth-sso/contracts 读取权限定义）
 *
 * 运行: cd apps/portal && DATABASE_URL=<url> tsx scripts/seed.ts
 */
import './load-env';

import { db, schema } from '@/infrastructure/db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';

/**
 * 解析逗号分隔的 redirect URL 列表，并序列化为 JSON 字符串
 */
function parseRedirectUrls(envValue: string | undefined, defaults: string[]): string[] {
  if (envValue) {
    return envValue.split(',').map(u => u.trim());
  }
  return defaults;
}

async function main() {
  console.log('🌱 Seeding clean database...');

  try {
    // 0. 清空现有数据（按外键依赖顺序）
    console.log('Cleaning existing data...');
    await db.delete(schema.rolePermissions);
    await db.delete(schema.roleDataScopes);
    await db.delete(schema.roleClients);
    await db.delete(schema.userRoles);
    await db.delete(schema.permissions);
    await db.delete(schema.roles);
    await db.delete(schema.refreshTokens);
    await db.delete(schema.accessTokens);
    await db.delete(schema.authorizationCodes);
    await db.delete(schema.clients);
    await db.delete(schema.users);
    await db.delete(schema.departments);

    // 1. 创建管理员用户
    console.log('Creating admin user...');
    const adminPassword = await bcrypt.hash('Admin@123456', 10);
    const adminId = '00000000-0000-0000-0000-000000000001';

    await db.insert(schema.users).values({
      id: adminId,
      username: 'admin',
      email: 'admin@example.com',
      name: '系统管理员',
      status: 'ACTIVE',
      passwordHash: adminPassword,
    });

    // 2. 创建 OAuth 客户端
    console.log('Creating clients...');
    const portalRedirectUrls = parseRedirectUrls(
      process.env.PORTAL_REDIRECT_URL,
      ['http://localhost:4100/auth/callback', 'http://localhost:4100/api/auth/callback'],
    );
    await db.insert(schema.clients).values({
      clientId: 'portal',
      name: 'Auth-SSO Portal',
      clientSecret: process.env.PORTAL_CLIENT_SECRET || 'portal-secret',
      redirectUris: portalRedirectUrls,
      scopes: 'openid profile email offline_access',
      status: 'ACTIVE',
    });

    // 3. 创建默认部门
    await db.insert(schema.departments).values({
      id: crypto.randomUUID(),
      name: '总公司',
      code: 'ROOT',
      status: 'ACTIVE',
    });

    // 4. 委托 seed-rbac 完成 RBAC 初始化（幂等，从 contracts 读取）
    console.log('\n🛡️  Delegating RBAC initialization to seed-rbac...');
    const { main: seedRbac } = await import('./seed-rbac');
    await seedRbac();

    // 5. 将系统管理员绑定到 SUPER_ADMIN 角色
    console.log('🔗 Binding admin user to SUPER_ADMIN role...');
    const superAdminRole = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.code, 'SUPER_ADMIN'))
      .limit(1);

    if (superAdminRole.length > 0) {
      await db.insert(schema.userRoles).values({
        userId: adminId,
        roleId: superAdminRole[0].id,
      });
      console.log('✅ Admin user successfully bound to SUPER_ADMIN role');
    } else {
      console.warn('⚠️  SUPER_ADMIN role not found, failed to bind admin user');
    }

    console.log('\n✅ Seeding completed.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

main();
