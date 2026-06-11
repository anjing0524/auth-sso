import './load-env';

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
    // 0. 清空现有数据
    console.log('Cleaning existing data...');
    await db.delete(schema.rolePermissions);
    await db.delete(schema.permissions);
    await db.delete(schema.userRoles);
    await db.delete(schema.roles);
    await db.delete(schema.departments);
    await db.delete(schema.clients);
    await db.delete(schema.accounts);
    await db.delete(schema.sessions);
    await db.delete(schema.users);

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
    const portalRedirectUri = process.env.PORTAL_REDIRECT_URL 
      ? JSON.stringify(process.env.PORTAL_REDIRECT_URL.split(',').map(u => u.trim()))
      : JSON.stringify([
          'http://localhost:4100/auth/callback',
          'http://localhost:4100/api/auth/callback',
          'http://127.0.0.1:4100/auth/callback',
          'http://127.0.0.1:4100/api/auth/callback'
        ]);
    await db.insert(schema.clients).values({
      id: generateId(),
      publicId: 'cli_portal',
      name: 'Auth-SSO Portal',
      clientId: 'portal',
      clientSecret: 'portal-secret',
      redirectUrls: portalRedirectUri,
      grantTypes: 'authorization_code,refresh_token',
      scopes: 'openid profile email offline_access',
      status: 'ACTIVE',
      skipConsent: true,
      requirePkce: true,
    });

    // 4. 创建 Demo App Client
    const demoRedirectUri = process.env.DEMO_APP_REDIRECT_URL 
      ? JSON.stringify(process.env.DEMO_APP_REDIRECT_URL.split(',').map(u => u.trim()))
      : JSON.stringify([
          'http://localhost:4102/auth/callback',
          'http://localhost:4102/api/auth/callback',
          'http://127.0.0.1:4102/auth/callback',
          'http://127.0.0.1:4102/api/auth/callback'
        ]);
    await db.insert(schema.clients).values({
      id: generateId(),
      publicId: 'cli_demo',
      name: 'Demo SSO App',
      clientId: 'demo-app',
      clientSecret: 'demo-app-secret',
      redirectUrls: demoRedirectUri,
      grantTypes: 'authorization_code,refresh_token',
      scopes: 'openid profile email offline_access',
      status: 'ACTIVE',
      skipConsent: true,
      requirePkce: true,
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
      { code: 'user:update', name: '用户更新' },
      { code: 'user:delete', name: '用户删除' },
      { code: 'role:list', name: '角色列表' },
      { code: 'role:create', name: '角色创建' },
      { code: 'role:update', name: '角色更新' },
      { code: 'role:delete', name: '角色删除' },
      { code: 'department:list', name: '部门列表' },
      { code: 'department:create', name: '部门创建' },
      { code: 'department:update', name: '部门更新' },
      { code: 'department:delete', name: '部门删除' },
      { code: 'client:list', name: '应用列表' },
      { code: 'client:create', name: '应用创建' },
      { code: 'client:update', name: '应用更新' },
      { code: 'client:delete', name: '应用删除' },
      { code: 'audit:read', name: '审计日志查询' },
      { code: 'menu:list', name: '菜单列表' },
      { code: 'menu:create', name: '菜单创建' },
      { code: 'menu:update', name: '菜单更新' },
      { code: 'menu:delete', name: '菜单删除' },
      { code: 'permission:list', name: '权限列表' },
      { code: 'permission:create', name: '权限创建' },
      { code: 'permission:update', name: '权限更新' },
      { code: 'permission:delete', name: '权限删除' },
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
