/**
 * 开发环境全量 Seed 脚本
 *
 * 职责：清空数据库 → 创建管理员用户 + Better Auth 账号 + OAuth 客户端 + 部门
 * RBAC 初始化委托给 seed-rbac.ts（幂等，从 @auth-sso/contracts 读取权限定义）
 *
 * 运行: cd apps/portal && DATABASE_URL=<url> tsx scripts/seed.ts
 */
import './load-env';

import { db, schema } from '../src/lib/db';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

function generateId(length: number = 20): string {
  return randomBytes(length).toString('hex').slice(0, length);
}

/**
 * 解析逗号分隔的 redirect URL 列表，并序列化为 JSON 字符串
 */
function parseRedirectUrls(envValue: string | undefined, defaults: string[]): string {
  if (envValue) {
    return JSON.stringify(envValue.split(',').map(u => u.trim()));
  }
  return JSON.stringify(defaults);
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
    await db.delete(schema.oauthConsent);
    await db.delete(schema.oauthRefreshTokens);
    await db.delete(schema.oauthAccessTokens);
    await db.delete(schema.authorizationCodes);
    await db.delete(schema.clients);
    await db.delete(schema.accounts);
    await db.delete(schema.sessions);
    await db.delete(schema.users);
    await db.delete(schema.departments);

    // 1. 创建管理员用户
    console.log('Creating admin user...');
    const adminPassword = await bcrypt.hash('Admin@123456', 10);
    const adminId = 'usr_admin_fixed_001';

    await db.insert(schema.users).values({
      id: adminId,
      publicId: 'usr_admin',
      username: 'admin',
      email: 'admin@example.com',
      name: '系统管理员',
      status: 'ACTIVE',
    });

    // 2. 创建管理员账号 (Better Auth 登录必备)
    await db.insert(schema.accounts).values({
      id: generateId(),
      userId: adminId,
      accountId: 'admin@example.com',
      providerId: 'credential',
      password: adminPassword,
    });

    // 3. 创建 OAuth 客户端（secret 优先从 env 读取，fallback 开发默认值）
    console.log('Creating clients...');
    const portalRedirectUrls = parseRedirectUrls(
      process.env.PORTAL_REDIRECT_URL,
      ['http://localhost:4100/auth/callback', 'http://localhost:4100/api/auth/callback'],
    );
    await db.insert(schema.clients).values({
      id: generateId(),
      publicId: 'cli_portal',
      name: 'Auth-SSO Portal',
      clientId: 'portal',
      clientSecret: process.env.PORTAL_CLIENT_SECRET || 'portal-secret',
      redirectUrls: portalRedirectUrls,
      grantTypes: '["authorization_code","refresh_token"]',
      scopes: 'openid profile email offline_access',
      status: 'ACTIVE',
      skipConsent: true,
    });

    const demoRedirectUrls = parseRedirectUrls(
      process.env.DEMO_APP_REDIRECT_URL,
      ['http://localhost:4102/auth/callback', 'http://localhost:4102/api/auth/callback'],
    );
    await db.insert(schema.clients).values({
      id: generateId(),
      publicId: 'cli_demo',
      name: 'Demo SSO App',
      clientId: 'demo-app',
      clientSecret: process.env.DEMO_APP_CLIENT_SECRET || 'demo-app-secret',
      redirectUrls: demoRedirectUrls,
      grantTypes: '["authorization_code","refresh_token"]',
      scopes: 'openid profile email offline_access',
      status: 'ACTIVE',
      skipConsent: true,
    });

    // 4. 创建默认部门
    await db.insert(schema.departments).values({
      id: generateId(),
      publicId: 'dept_root',
      name: '总公司',
      code: 'ROOT',
      status: 'ACTIVE',
    });

    // 5. 委托 seed-rbac 完成 RBAC 初始化（幂等，从 contracts 读取）
    console.log('\n🛡️  Delegating RBAC initialization to seed-rbac...');
    const { main: seedRbac } = await import('./seed-rbac');
    await seedRbac();

    console.log('\n✅ Seeding completed.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

main();
