import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/db/schema';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

async function seed() {
  console.log('🌱 Seeding production database with fixed IDs...');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is missing');
  const client = postgres(connectionString, { ssl: 'require' });
  const db = drizzle(client, { schema });

  try {
    // 1. 创建管理员 (admin) - 使用固定 ID
    const adminId = 'usr_admin_fixed_001';
    const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'v8Z-k9X_m2Q!p5W@';
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    // 先清理
    await db.delete(schema.oauthConsent).where(eq(schema.oauthConsent.userId, adminId));
    await db.delete(schema.accounts).where(eq(schema.accounts.userId, adminId));
    await db.delete(schema.users).where(eq(schema.users.id, adminId));
    
    await db.insert(schema.users).values({
      id: adminId,
      publicId: `usr_${nanoid(12)}`,
      username: 'admin',
      email: 'admin@example.com',
      name: '系统管理员',
      status: 'ACTIVE',
    });

    await db.insert(schema.accounts).values({
      id: nanoid(),
      userId: adminId,
      accountId: 'admin',
      providerId: 'credential',
      password: hashedPassword,
    });
    console.log('✅ Admin user created with ID:', adminId);

    // 2. 固定 Portal 客户端
    const portalClientId = 'cl_portal_lIDC8OXe';
    const portalSecret = 'W_Lnyg-04WzYx2Ecy6Dg0jiURz33XAs1';
    
    await db.delete(schema.clients).where(eq(schema.clients.clientId, portalClientId));
    
    await db.insert(schema.clients).values({
      id: 'cli_portal_internal_id',
      publicId: `cli_portal_${nanoid(12)}`,
      name: 'Auth-SSO Portal',
      clientId: portalClientId,
      clientSecret: portalSecret,
      redirectUrls: 'https://auth-sso-portal.vercel.app/api/auth/callback,http://localhost:4000/api/auth/callback',
      skipConsent: true,
      status: 'ACTIVE',
    });
    console.log(`✅ Portal client created. ID: ${portalClientId}`);

    // 3. 固定 Demo App 客户端
    const demoClientId = 'cl_demo_h_-Tat_G';
    const demoSecret = 'Atyaa_cK0I2IWzvZwn02ScaidBfUhNod';
    
    await db.delete(schema.clients).where(eq(schema.clients.clientId, demoClientId));
    
    await db.insert(schema.clients).values({
      id: 'cli_demo_internal_id',
      publicId: `cli_demo_${nanoid(12)}`,
      name: 'Demo Application',
      clientId: demoClientId,
      clientSecret: demoSecret,
      redirectUrls: 'https://auth-sso-demo-tau.vercel.app/api/auth/callback,http://localhost:4002/api/auth/callback',
      skipConsent: true,
      status: 'ACTIVE',
    });
    console.log(`✅ Demo App client created. ID: ${demoClientId}`);

    // 4. 预置 RBAC 数据 (核心修复：解决 Forbidden 报错)
    console.log('🛡️  Seeding RBAC data...');
    
    // 创建超级管理员角色
    const adminRoleId = nanoid();
    await db.delete(schema.roles).where(eq(schema.roles.code, 'SUPER_ADMIN'));
    await db.insert(schema.roles).values({
      id: adminRoleId,
      publicId: `role_${nanoid(12)}`,
      name: '超级管理员',
      code: 'SUPER_ADMIN',
      description: '拥有系统所有权限',
      dataScopeType: 'ALL',
      isSystem: true,
      status: 'ACTIVE',
    });

    // 关联用户到角色
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, adminId));
    await db.insert(schema.userRoles).values({
      id: nanoid(),
      userId: adminId,
      roleId: adminRoleId, // 修复：使用 roleId 而非 role_id
    });

    // 创建核心权限
    const permissions = [
      { name: '用户管理', code: 'system:user:list' },
      { name: '角色管理', code: 'system:role:list' },
      { name: '权限管理', code: 'system:permission:list' },
      { name: '应用管理', code: 'system:client:list' },
    ];

    for (const p of permissions) {
      const permId = nanoid();
      await db.delete(schema.permissions).where(eq(schema.permissions.code, p.code));
      await db.insert(schema.permissions).values({
        id: permId,
        publicId: `perm_${nanoid(12)}`,
        name: p.name,
        code: p.code,
        type: 'API',
        status: 'ACTIVE',
      });

      // 授权给管理员角色
      await db.insert(schema.rolePermissions).values({
        id: nanoid(),
        roleId: adminRoleId, // 修复：使用 roleId 而非 role_id
        permissionId: permId, // 修复：使用 permissionId 而非 permission_id
      });
    }
    console.log('✅ RBAC data seeded successfully.');

    // 5. 预置授权记录 (静默授权核心)
    const scopes = 'openid profile email offline_access';
    
    await db.insert(schema.oauthConsent).values({
      id: nanoid(),
      userId: adminId,
      clientId: portalClientId, 
      scopes: scopes,
      consentGiven: true,
    });

    await db.insert(schema.oauthConsent).values({
      id: nanoid(),
      userId: adminId,
      clientId: demoClientId,
      scopes: scopes,
      consentGiven: true,
    });
    console.log('✅ Pre-authorized consent records created.');

    console.log('✨ Seed complete!');
  } finally {
    await client.end();
  }
}

seed().catch(console.error);
