/**
 * RBAC 数据初始化脚本 (v2 重构)
 * 运行: cd apps/portal && DATABASE_URL=<your_db_url> tsx scripts/seed-rbac.ts
 *
 * 幂等性：可重复执行，已存在的记录跳过，不会重复创建。
 *
 * v2 变更：
 * - 权限插入补 resource/action（API 类型 CHECK 约束要求）
 * - 角色插入去除重复 id 键
 * - 绑定权限去除 id 列（复合主键无独立 id）
 * - 新增 Portal 菜单种子（PAGE 类型，支持数据驱动侧边栏）
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, isNull } from 'drizzle-orm';
import crypto from 'crypto';
import * as schema from '../src/db/schema';
import { ALL_PERMISSIONS, PERMISSION_LABELS } from '@auth-sso/contracts';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ 缺少环境变量 DATABASE_URL');
  process.exit(1);
}

const client = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(client, { schema });

/**
 * 从权限 code 解析 resource 和 action
 * 约定格式：{resource}:{action}，如 user:list → resource='user', action='list'
 */
function parseResourceAction(code: string): { resource: string; action: string } {
  const idx = code.indexOf(':');
  if (idx === -1) {
    return { resource: code, action: 'manage' };
  }
  return {
    resource: code.slice(0, idx),
    action: code.slice(idx + 1),
  };
}

/** Portal 菜单种子（PAGE 类型，驱动侧边栏动态渲染） */
const PORTAL_MENUS = [
  { code: 'menu:dashboard', name: '首页', path: '/dashboard', icon: 'LayoutDashboard', sort: 0 },
  { code: 'menu:users', name: '用户管理', path: '/dashboard/users', icon: 'Users', sort: 1 },
  { code: 'menu:roles', name: '角色管理', path: '/dashboard/roles', icon: 'Shield', sort: 2 },
  { code: 'menu:permissions', name: '权限管理', path: '/dashboard/permissions', icon: 'Key', sort: 3 },
  { code: 'menu:departments', name: '部门管理', path: '/dashboard/departments', icon: 'Building2', sort: 4 },
  { code: 'menu:clients', name: '客户端管理', path: '/dashboard/clients', icon: 'Server', sort: 5 },
  { code: 'menu:audit-logs', name: '审计日志', path: '/dashboard/audit-logs', icon: 'FileText', sort: 6 },
];

async function seedApiPermissions(): Promise<string[]> {
  console.log('\n📋 初始化 API 权限项...');
  const permIds: string[] = [];

  for (let i = 0; i < ALL_PERMISSIONS.length; i++) {
    const code = ALL_PERMISSIONS[i];
    const existing = await db.select({ id: schema.permissions.id })
      .from(schema.permissions)
      .where(eq(schema.permissions.code, code));

    if (existing.length > 0) {
      permIds.push(existing[0]!.id);
      process.stdout.write(`  ↩ 已存在: ${code}\n`);
      continue;
    }

    const { resource, action } = parseResourceAction(code);
    const id = crypto.randomUUID();
    await db.insert(schema.permissions).values({
      id,
      name: PERMISSION_LABELS[code] ?? code,
      code,
      type: 'API',
      resource,
      action,
      sort: i,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    permIds.push(id);
    process.stdout.write(`  ✅ 创建: ${code}\n`);
  }

  return permIds;
}

async function seedPortalMenus(): Promise<string[]> {
  console.log('\n📱 初始化 Portal 菜单节点...');
  const menuIds: string[] = [];

  for (const menu of PORTAL_MENUS) {
    const existing = await db.select({ id: schema.permissions.id })
      .from(schema.permissions)
      .where(eq(schema.permissions.code, menu.code));

    if (existing.length > 0) {
      menuIds.push(existing[0]!.id);
      process.stdout.write(`  ↩ 已存在: ${menu.code}\n`);
      continue;
    }

    const id = crypto.randomUUID();
    await db.insert(schema.permissions).values({
      id,
      name: menu.name,
      code: menu.code,
      type: 'PAGE',
      path: menu.path,
      icon: menu.icon,
      visible: true,
      sort: menu.sort,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    menuIds.push(id);
    process.stdout.write(`  ✅ 创建: ${menu.code} → ${menu.path}\n`);
  }

  return menuIds;
}

async function seedRole(
  code: string,
  name: string,
  description: string,
  deptId: string,
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
    name,
    code,
    description,
    deptId,
    isSystem: true,
    status: 'ACTIVE',
    sort,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  process.stdout.write(`  ✅ 创建角色: ${code}\n`);
  return id;
}

/**
 * 为角色绑定权限列表（幂等：先删后建）
 * @param roleId      角色 ID
 * @param permissionIds 权限 ID 数组
 */
async function bindPermissions(roleId: string, permissionIds: string[]): Promise<void> {
  await db.delete(schema.rolePermissions)
    .where(eq(schema.rolePermissions.roleId, roleId));

  if (permissionIds.length > 0) {
    await db.insert(schema.rolePermissions).values(
      permissionIds.map(permissionId => ({
        roleId,
        permissionId,
        createdAt: new Date(),
      })),
    );
  }
}

export async function main() {
  console.log('🌱 开始 RBAC 数据初始化...');

  // 1. 初始化 API 权限（鉴权用）
  const apiPermIds = await seedApiPermissions();

  // 2. 初始化 Portal 菜单节点（侧边栏数据驱动）
  const menuPermIds = await seedPortalMenus();

  // 3. 初始化系统角色
  console.log('\n🛡️  初始化角色...');

  // 查询根部门（顶层节点，parent_id IS NULL）
  const rootDept = await db.select({ id: schema.departments.id, name: schema.departments.name })
    .from(schema.departments)
    .where(eq(schema.departments.parentId, ''))
    .limit(1);

  // 如果查不到 parent_id='' 的根部门，尝试查询 parent_id IS NULL
  if (rootDept.length === 0) {
    const nullParentDept = await db.select({ id: schema.departments.id, name: schema.departments.name })
      .from(schema.departments)
      .where(isNull(schema.departments.parentId))
      .limit(1);
    if (nullParentDept.length === 0) {
      console.error('❌ 未找到任何部门。请先运行主 seed 脚本创建部门。');
      await client.end();
      return;
    }
    rootDept.push(nullParentDept[0]!);
  }

  const rootDeptId = rootDept[0]!.id;
  process.stdout.write(`  📍 根部门: ${rootDept[0]!.name} (${rootDeptId})\n`);

  const superAdminId = await seedRole(
    'SUPER_ADMIN',
    '超级管理员',
    '拥有所有权限，管理全平台',
    rootDeptId,
    0,
  );
  const adminId = await seedRole(
    'ADMIN',
    '系统管理员',
    '拥有所有权限，管理全平台',
    rootDeptId,
    1,
  );

  // 4. 为 SUPER_ADMIN 和 ADMIN 绑定全部 API 权限
  //    菜单节点不绑定到角色（管理员 isAdmin 绕过 menu-tree 可见性检查）
  console.log('\n🔗 绑定权限...');
  await bindPermissions(superAdminId, apiPermIds);
  process.stdout.write(`  ✅ SUPER_ADMIN ← ${apiPermIds.length} 个 API 权限\n`);
  await bindPermissions(adminId, apiPermIds);
  process.stdout.write(`  ✅ ADMIN ← ${apiPermIds.length} 个 API 权限\n`);

  console.log(`  📱 菜单节点: ${menuPermIds.length} 个 PAGE（管理员 isAdmin 绕过可见性检查）`);

  console.log('\n✅ RBAC 初始化完成！');
  console.log('   提示：用已有超级管理员账号登录，或手工执行以下 SQL 为指定用户分配 SUPER_ADMIN 角色：');
  console.log(`   INSERT INTO user_roles (user_id, role_id, created_at)`);
  console.log(`   VALUES ('<your_user_id>', '${superAdminId}', now());`);

  await client.end();
}

// 仅在直接执行时运行（被其他脚本 import 时不自动执行）
if (process.argv[1]?.includes('seed-rbac')) {
  main().catch(err => {
    console.error('\n❌ 初始化失败:', err.message);
    process.exit(1);
  });
}
