/**
 * 开发环境全量 Seed 脚本
 *
 * 职责：清空数据库 → 创建管理员用户 + OAuth 客户端 + 部门
 * RBAC 初始化委托给 seed-rbac.ts（幂等，从 @auth-sso/contracts 读取权限定义）
 *
 * 默认入口：`pnpm --filter @auth-sso/portal db:seed`
 * 直接运行：cd apps/portal && DATABASE_URL=<url> tsx scripts/seed.ts
 */
import './load-env';

import { db, schema } from '@/infrastructure/db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { hashClientSecret } from '../src/lib/crypto';

/**
 * 解析逗号分隔的 redirect URL 列表，并序列化为 JSON 字符串
 */
function parseRedirectUrls(envValue: string | undefined, defaults: string[]): string[] {
  if (envValue) {
    return envValue.split(',').map(u => u.trim());
  }
  return defaults;
}

/**
 * E2E 专用夹具（E2E_SEED_QA=1 时启用）。
 *
 * 为什么需要：部分 E2E 用例依赖“部门无角色”“QA_TEST 基线 0”“已有审计/访问日志”
 * 这些人工验收时手工造的数据；干净 db:seed 不包含它们，发布门禁因此不可复现。
 * 生产/开发默认不设置该环境变量，故不会写入。
 */
async function seedE2eFixtures(defaultDeptId: string, adminId: string): Promise<void> {
  console.log('🧪 Seeding E2E-only fixtures...');
  const rdDeptId = crypto.randomUUID();
  await db.insert(schema.departments).values({
    id: rdDeptId,
    name: '研发部',
    code: 'E2E_RD',
    parentId: defaultDeptId,
    ancestors: defaultDeptId,
    status: 'ACTIVE',
  });

  // E2E 夹具不需要可登录凭据；随机密码避免已知口令进入任何环境
  const qaPassword = await bcrypt.hash(crypto.randomUUID(), 10);
  await db.insert(schema.users).values({
    id: crypto.randomUUID(),
    username: 'qa_lin',
    email: 'qa_lin@example.com',
    name: 'QA 林',
    status: 'ACTIVE',
    passwordHash: qaPassword,
    deptId: rdDeptId,
  });

  // 基线 0 权限，供角色权限保存 e2e 使用；非系统角色可修改
  await db.insert(schema.roles).values({
    id: crypto.randomUUID(),
    name: '质量测试角色',
    code: 'QA_TEST',
    description: 'E2E fixture，默认无权限',
    deptId: defaultDeptId,
    isSystem: false,
    status: 'ACTIVE',
    sort: 99,
  });

  const now = new Date();
  await db.insert(schema.auditLogs).values({
    id: crypto.randomUUID(), userId: adminId, username: 'admin',
    operation: 'USER_UPDATE', method: 'POST', url: '/users', ip: '127.0.0.1',
    userAgent: 'E2E', status: 200, duration: 12, createdAt: now,
  });
  await db.insert(schema.accessLogs).values({
    id: crypto.randomUUID(), userId: adminId, username: 'admin', method: 'GET',
    path: '/api/users', resourceType: 'user', resourceId: adminId,
    ip: '127.0.0.1', userAgent: 'E2E', status: 200, duration: 8, createdAt: now,
  });
  await db.insert(schema.loginLogs).values({
    id: crypto.randomUUID(), userId: adminId, username: 'admin',
    eventType: 'LOGIN_SUCCESS', ip: '127.0.0.1', userAgent: 'E2E', createdAt: now,
  });
}

async function main() {
  console.log('🌱 Seeding clean database...');

  try {
    // 0. 清空现有数据（按外键依赖顺序）
    console.log('Cleaning existing data...');
    await db.delete(schema.rolePermissions);
    await db.delete(schema.userRoles);
    await db.delete(schema.permissions);
    await db.delete(schema.roles);
    await db.delete(schema.refreshTokens);
    await db.delete(schema.authorizationCodes);
    await db.delete(schema.clients);
    await db.delete(schema.users);
    await db.delete(schema.departments);

    // 3. 创建默认部门
    const defaultDeptId = crypto.randomUUID();
    await db.insert(schema.departments).values({
      id: defaultDeptId,
      name: '总公司',
      code: 'ROOT',
      status: 'ACTIVE',
    });

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
      deptId: defaultDeptId,
    });

    // 2. 创建 OAuth 客户端
    console.log('Creating clients...');
    const portalRedirectUrls = parseRedirectUrls(
      process.env.PORTAL_REDIRECT_URL,
      ['http://localhost:4100/auth/callback', 'http://localhost:4100/api/auth/callback'],
    );
    const configuredPortalSecret = process.env.PORTAL_CLIENT_SECRET;
    const portalSecret = configuredPortalSecret || crypto.randomBytes(32).toString('hex');
    const portalSecretHash = await hashClientSecret(portalSecret);
    if (configuredPortalSecret) {
      console.log('\n🔑 Portal client_secret 已从环境变量加载，明文不写入日志。\n');
    } else {
      console.log(`\n🔑 Portal client_secret (明文，仅此一次输出，请复制到 gateway.toml): ${portalSecret}\n`);
    }
    await db.insert(schema.clients).values({
      clientId: 'portal',
      name: 'Auth-SSO Portal',
      clientSecret: portalSecretHash,
      redirectUris: portalRedirectUrls,
      scopes: 'openid profile email offline_access',
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

    // 6. E2E-only fixtures：仅测试栈启用；生产/默认 seed 不写 QA 数据
    if (process.env.E2E_SEED_QA === '1') {
      await seedE2eFixtures(defaultDeptId, adminId);
    }

    console.log('\n✅ Seeding completed.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

main();
