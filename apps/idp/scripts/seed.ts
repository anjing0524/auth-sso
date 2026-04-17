import { db } from '../src/db';
import * as schema from '../src/db/schema';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

function generateId(length: number = 20): string {
  return randomBytes(length).toString('hex').slice(0, length);
}

async function main() {
  console.log('🌱 Seeding clean database...');

  try {
    const adminPassword = await bcrypt.hash('Admin@123456', 10);
    const adminId = 'usr_admin_fixed_001';

    // 1. 创建管理员用户
    console.log('Creating admin user...');
    await db.insert(schema.users).values({
      id: adminId,
      publicId: 'usr_admin',
      username: 'admin',
      email: 'admin@example.com',
      name: '系统管理员',
      password: adminPassword,
      passwordHash: adminPassword,
      status: 'ACTIVE',
    });

    // 2. 创建管理员账号 (Better Auth 登录必备)
    await db.insert(schema.accounts).values({
      id: generateId(),
      userId: adminId,
      accountId: 'admin@example.com', // 使用 email 作为 accountId
      providerId: 'credential',
      password: adminPassword,
    });

    // 3. 创建 Portal Client
    console.log('Creating clients...');
    await db.insert(schema.clients).values({
      id: generateId(),
      publicId: 'cli_portal',
      name: 'Auth-SSO Portal',
      clientId: 'portal',
      clientSecret: 'portal-secret',
      redirectUrls: 'http://localhost:4100/auth/callback,http://localhost:4100/api/auth/callback,http://127.0.0.1:4100/auth/callback,http://127.0.0.1:4100/api/auth/callback',
      grantTypes: 'authorization_code,refresh_token',
      scopes: 'openid profile email offline_access',
      status: 'ACTIVE',
      skipConsent: true,
    });

    // 4. 创建 Demo App Client
    await db.insert(schema.clients).values({
      id: generateId(),
      publicId: 'cli_demo',
      name: 'Demo SSO App',
      clientId: 'demo-app',
      clientSecret: 'demo-app-secret',
      redirectUrls: 'http://localhost:4102/auth/callback,http://localhost:4102/api/auth/callback,http://127.0.0.1:4102/auth/callback,http://127.0.0.1:4102/api/auth/callback',
      grantTypes: 'authorization_code,refresh_token',
      scopes: 'openid profile email offline_access',
      status: 'ACTIVE',
      skipConsent: true,
    });

    // 5. 创建默认部门
    const deptId = generateId();
    await db.insert(schema.departments).values({
      id: deptId,
      publicId: 'dept_root',
      name: '总公司',
      code: 'ROOT',
      status: 'ACTIVE',
    });

    // 6. 创建管理员角色并赋予权限
    console.log('Creating roles and permissions...');
    const roleId = generateId();
    await db.insert(schema.roles).values({
      id: roleId,
      publicId: 'role_admin',
      name: '超级管理员',
      code: 'ADMIN',
      dataScopeType: 'ALL',
      isSystem: true,
      status: 'ACTIVE',
    });

    // 绑定用户到角色
    await db.insert(schema.userRoles).values({
      id: generateId(),
      userId: adminId,
      roleId: roleId,
    });

    // 定义所有必要的业务权限
    const perms = [
      { code: 'user:list', name: '用户列表' },
      { code: 'user:create', name: '用户创建' },
      { code: 'role:list', name: '角色列表' },
      { code: 'role:create', name: '角色创建' },
      { code: 'client:list', name: '应用列表' },
      { code: 'client:create', name: '应用创建' },
      { code: 'audit:read', name: '审计日志查询' },
    ];


    for (const p of perms) {
      const pId = generateId();
      await db.insert(schema.permissions).values({
        id: pId,
        publicId: `perm_${p.code.replace(':', '_')}`,
        name: p.name,
        code: p.code,
        type: 'API',
        status: 'ACTIVE',
      });

      await db.insert(schema.rolePermissions).values({
        id: generateId(),
        roleId: roleId,
        permissionId: pId,
      });
    }

    console.log('✅ Seeding completed.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

main();
