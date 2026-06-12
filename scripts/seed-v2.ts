import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../apps/portal/src/db/schema';
import crypto from 'crypto';

async function main() {
  console.log('🚀 开始注入工业级测试数据...');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is missing');
  const client = postgres(url);
  const db = drizzle(client, { schema });

  // 1. 清理
  console.log('🧹 清理旧数据...');
  await db.delete(schema.rolePermissions);
  await db.delete(schema.userRoles);
  await db.delete(schema.menus);
  await db.delete(schema.roles);
  await db.delete(schema.users);
  await db.delete(schema.departments);

  // 2. 部门
  console.log('🏢 创建部门树...');
  const [root] = await db.insert(schema.departments).values({
    id: crypto.randomUUID(),
    name: '干了科技总公司',
    code: 'ROOT',
    sort: 1,
    status: 'ACTIVE',
  }).returning();

  const [tech] = await db.insert(schema.departments).values({
    id: crypto.randomUUID(),
    parentId: root.id,
    name: '技术研发中心',
    code: 'DEPT_TECH',
    sort: 1,
    status: 'ACTIVE',
  }).returning();

  const [finance] = await db.insert(schema.departments).values({
    id: crypto.randomUUID(),
    parentId: root.id,
    name: '财务管理部',
    code: 'DEPT_FIN',
    sort: 2,
    status: 'ACTIVE',
  }).returning();

  // 3. 角色 (涵盖所有 Data Scope 类型)
  console.log('🛡️ 创建多级角色...');
  const [adminRole] = await db.insert(schema.roles).values({
    id: crypto.randomUUID(),
    name: '超级管理员',
    code: 'admin',
    dataScopeType: 'ALL',
    isSystem: true,
  }).returning();

  const [managerRole] = await db.insert(schema.roles).values({
    id: crypto.randomUUID(),
    name: '部门主管',
    code: 'manager',
    dataScopeType: 'DEPT_AND_SUB',
  }).returning();

  const [staffRole] = await db.insert(schema.roles).values({
    id: crypto.randomUUID(),
    name: '普通员工',
    code: 'employee',
    dataScopeType: 'SELF',
  }).returning();

  // 4. 用户
  console.log('👥 创建测试用户...');
  const [adminUser] = await db.insert(schema.users).values({
    id: crypto.randomUUID(),
    name: '系统管理员',
    email: 'admin@example.com',
    username: 'admin',
    password: 'password_hash', // 测试环境，由 Portal (Better Auth) 处理密码哈希
    status: 'ACTIVE',
    deptId: root.id,
  }).returning();

  const [staffUser] = await db.insert(schema.users).values({
    id: crypto.randomUUID(),
    name: '张技术',
    email: 'zhang@example.com',
    username: 'zhang',
    status: 'ACTIVE',
    deptId: tech.id,
  }).returning();

  // 5. 绑定角色
  await db.insert(schema.userRoles).values([
    { userId: adminUser.id, roleId: adminRole.id },
    { userId: staffUser.id, roleId: staffRole.id },
  ]);

  // 6. 菜单 (关键：确保侧边栏可见)
  console.log('🗺️ 注入动态菜单...');
  const menuData = [
    { name: '工作台', path: '/dashboard', icon: 'LayoutDashboard', sort: 1 },
    { name: '用户管理', path: '/users', icon: 'Users', sort: 2 },
    { name: '组织架构', path: '/departments', icon: 'Building2', sort: 3 },
    { name: '权限配置', path: '/roles', icon: 'ShieldCheck', sort: 4 },
    { name: '应用管理', path: '/clients', icon: 'AppWindow', sort: 5 },
    { name: '菜单管理', path: '/menus', icon: 'Menu', sort: 6 },
    { name: '安全审计', path: '/audit-logs', icon: 'ShieldAlert', sort: 7 },
  ];

  for (const m of menuData) {
    await db.insert(schema.menus).values({
      id: crypto.randomUUID(),
      name: m.name,
      path: m.path,
      icon: m.icon,
      sort: m.sort,
      visible: true,
      status: 'ACTIVE',
    });
  }

  console.log('✅ 测试数据注入完成！');
  await client.end();
}

main().catch(console.error);
