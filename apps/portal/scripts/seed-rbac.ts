/**
 * RBAC 数据初始化脚本
 * 供 `seed.ts` 委托调用；如需单独执行：
 *   cd apps/portal && DATABASE_URL=<your_db_url> tsx scripts/seed-rbac.ts
 *
 * 职责：
 * - 从 `@auth-sso/contracts` 写入 API 权限常量
 * - 写入 Portal 侧边栏所需的 PAGE 菜单节点
 * - 幂等创建 SUPER_ADMIN / ADMIN 系统角色
 * - 用 role_permissions 复合主键表为系统角色重建 API 权限绑定
 *
 * 幂等性：可重复执行；已存在记录跳过，角色权限绑定采用先删后建。
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import * as schema from '../src/db/schema';
import { ALL_PERMISSIONS, PERMISSION_LABELS } from '@auth-sso/contracts';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ 缺少环境变量 DATABASE_URL');
  process.exit(1);
}

const client = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(client, { schema });

const ROLE_DEFINITIONS = [
  {
    code: 'org_admin',
    name: '组织管理员',
    description: '管理所属部门及其子部门的用户和基础配置',
    departmentCode: 'TECH',
    permissionCodes: [
      'portal:user:list', 'portal:user:create', 'portal:user:read',
      'portal:user:update', 'portal:user:reset_password', 'portal:user:assign_role',
      'portal:department:list', 'portal:department:read',
      'portal:role:list', 'portal:role:read',
      'portal:system:view_dashboard',
    ],
  },
  {
    code: 'dept_manager',
    name: '部门经理',
    description: '管理所属部门内的用户',
    departmentCode: 'PRODUCT',
    permissionCodes: [
      'portal:user:list', 'portal:user:read', 'portal:user:update',
      'portal:department:list', 'portal:department:read',
      'portal:role:list', 'portal:role:read',
      'portal:system:view_dashboard',
    ],
  },
  {
    code: 'employee',
    name: '普通员工',
    description: '仅访问个人工作台',
    departmentCode: 'BE',
    permissionCodes: ['portal:system:view_dashboard'],
  },
  {
    code: 'app_admin',
    name: '应用管理员',
    description: '管理 OAuth 客户端及密钥',
    departmentCode: 'ROOT',
    permissionCodes: [
      'portal:client:list', 'portal:client:create', 'portal:client:read',
      'portal:client:update', 'portal:client:delete', 'portal:client:manage',
      'portal:client:rotate_secret',
    ],
  },
  {
    code: 'audit_viewer',
    name: '审计员',
    description: '查看并导出登录与操作审计',
    departmentCode: 'OPS',
    permissionCodes: ['portal:audit:read', 'portal:audit:export'],
  },
] as const;

const ACTOR_DEFINITIONS = [
  { username: 'actor_org_admin', name: '组织管理员验收账号', roleCode: 'org_admin', departmentCode: 'TECH' },
  { username: 'actor_dept_manager', name: '部门经理验收账号', roleCode: 'dept_manager', departmentCode: 'PRODUCT' },
  { username: 'actor_employee', name: '普通员工验收账号', roleCode: 'employee', departmentCode: 'BE' },
  { username: 'actor_app_admin', name: '应用管理员验收账号', roleCode: 'app_admin', departmentCode: 'ROOT' },
  { username: 'actor_audit_viewer', name: '审计员验收账号', roleCode: 'audit_viewer', departmentCode: 'OPS' },
] as const;

/** Portal 菜单种子（PAGE 类型，驱动侧边栏动态渲染） */
const PORTAL_MENUS = [
  { code: 'menu:portal:dashboard', legacyCodes: ['portal:menu:dashboard'], name: '工作台', path: '/dashboard', icon: 'LayoutDashboard', requiredCode: 'portal:system:view_dashboard', sort: 0 },
  { code: 'menu:portal:users', legacyCodes: ['portal:menu:users'], name: '用户管理', path: '/users', icon: 'Users', requiredCode: 'portal:user:list', sort: 1 },
  { code: 'menu:portal:roles', legacyCodes: ['portal:menu:roles'], name: '角色管理', path: '/roles', icon: 'ShieldCheck', requiredCode: 'portal:role:list', sort: 2 },
  { code: 'menu:portal:permissions', legacyCodes: ['portal:menu:permissions'], name: '权限管理', path: '/permissions', icon: 'Key', requiredCode: 'portal:permission:list', sort: 3 },
  { code: 'menu:portal:menus', legacyCodes: [], name: '菜单管理', path: '/menus', icon: 'Menu', requiredCode: 'portal:menu:list', sort: 4 },
  { code: 'menu:portal:departments', legacyCodes: ['portal:menu:departments'], name: '部门管理', path: '/departments', icon: 'Building2', requiredCode: 'portal:department:list', sort: 5 },
  { code: 'menu:portal:clients', legacyCodes: ['portal:menu:clients'], name: '应用管理', path: '/clients', icon: 'AppWindow', requiredCode: 'portal:client:list', sort: 6 },
  { code: 'menu:portal:audit-logs', legacyCodes: ['portal:menu:audit-logs'], name: '审计日志', path: '/audit-logs', icon: 'FileText', requiredCode: 'portal:audit:read', sort: 7 },
];

async function seedApiPermissions(): Promise<Map<string, string>> {
  console.log('\n📋 初始化 API 权限项...');
  const permissionIds = new Map<string, string>();

  for (let i = 0; i < ALL_PERMISSIONS.length; i++) {
    const code = ALL_PERMISSIONS[i];
    const existing = await db.select({ id: schema.permissions.id })
      .from(schema.permissions)
      .where(eq(schema.permissions.code, code));

    if (existing.length > 0) {
      permissionIds.set(code, existing[0]!.id);
      process.stdout.write(`  ↩ 已存在: ${code}\n`);
      continue;
    }

    const id = crypto.randomUUID();
    await db.insert(schema.permissions).values({
      id,
      name: PERMISSION_LABELS[code] ?? code,
      code,
      type: 'API',
      sort: i,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    permissionIds.set(code, id);
    process.stdout.write(`  ✅ 创建: ${code}\n`);
  }

  return permissionIds;
}

async function seedPortalMenus(permissionIds: ReadonlyMap<string, string>): Promise<string[]> {
  console.log('\n📱 初始化 Portal 菜单节点...');
  const menuIds: string[] = [];

  for (const menu of PORTAL_MENUS) {
    const requiredPermissionId = permissionIds.get(menu.requiredCode);
    if (!requiredPermissionId) {
      throw new Error(`菜单 ${menu.code} 缺少绑定权限 ${menu.requiredCode}`);
    }
    const menuId = await db.transaction(async (tx) => {
      const canonical = await tx.select({ id: schema.permissions.id })
        .from(schema.permissions)
        .where(eq(schema.permissions.code, menu.code))
        .limit(1);
      const legacyRows: Array<{ id: string }> = [];
      for (const legacyCode of menu.legacyCodes) {
        const rows = await tx.select({ id: schema.permissions.id })
          .from(schema.permissions)
          .where(eq(schema.permissions.code, legacyCode))
          .limit(1);
        if (rows[0]) legacyRows.push(rows[0]);
      }

      const reusable = canonical[0] ?? legacyRows[0];
      const id = reusable?.id ?? crypto.randomUUID();
      const values = {
        name: menu.name,
        code: menu.code,
        type: 'PAGE',
        path: menu.path,
        icon: menu.icon,
        visible: true,
        requiredPermissionId,
        sort: menu.sort,
        status: 'ACTIVE',
        updatedAt: new Date(),
      } as const;
      if (reusable) {
        await tx.update(schema.permissions)
          .set(values)
          .where(eq(schema.permissions.id, id));
      } else {
        await tx.insert(schema.permissions).values({
          id,
          ...values,
          createdAt: new Date(),
        });
      }

      for (const legacy of legacyRows) {
        const bindings = await tx.select({ roleId: schema.rolePermissions.roleId })
          .from(schema.rolePermissions)
          .where(eq(schema.rolePermissions.permissionId, legacy.id));
        if (bindings.length > 0) {
          await tx.insert(schema.rolePermissions).values(
            bindings.map(({ roleId }) => ({ roleId, permissionId: requiredPermissionId })),
          ).onConflictDoNothing();
        }
        if (legacy.id === id) continue;

        await tx.update(schema.permissions)
          .set({ parentId: id })
          .where(eq(schema.permissions.parentId, legacy.id));
        await tx.update(schema.permissions)
          .set({ requiredPermissionId })
          .where(eq(schema.permissions.requiredPermissionId, legacy.id));
        await tx.delete(schema.permissions)
          .where(eq(schema.permissions.id, legacy.id));
      }

      return id;
    });
    menuIds.push(menuId);
    process.stdout.write(`  ✅ 对齐: ${menu.code} → ${menu.path}\n`);
  }

  return menuIds;
}

async function seedDepartment(params: {
  code: string;
  name: string;
  parentId: string | null;
  ancestors: string | null;
  sort: number;
}): Promise<string> {
  const existing = await db.select({ id: schema.departments.id })
    .from(schema.departments)
    .where(eq(schema.departments.code, params.code))
    .limit(1);
  if (existing[0]) {
    await db.update(schema.departments).set({
      name: params.name,
      parentId: params.parentId,
      ancestors: params.ancestors,
      sort: params.sort,
      status: 'ACTIVE',
      updatedAt: new Date(),
    }).where(eq(schema.departments.id, existing[0].id));
    return existing[0].id;
  }
  const id = crypto.randomUUID();
  await db.insert(schema.departments).values({
    id,
    ...params,
    status: 'ACTIVE',
  });
  return id;
}

async function seedOrganization(): Promise<Map<string, string>> {
  console.log('\n🏢 初始化组织结构...');
  const ids = new Map<string, string>();
  const rootId = await seedDepartment({
    code: 'ROOT', name: '干了科技', parentId: null, ancestors: null, sort: 0,
  });
  ids.set('ROOT', rootId);
  const techId = await seedDepartment({
    code: 'TECH', name: '技术部', parentId: rootId, ancestors: rootId, sort: 1,
  });
  ids.set('TECH', techId);
  ids.set('FE', await seedDepartment({
    code: 'FE', name: '前端组', parentId: techId, ancestors: `${rootId}/${techId}`, sort: 1,
  }));
  ids.set('BE', await seedDepartment({
    code: 'BE', name: '后端组', parentId: techId, ancestors: `${rootId}/${techId}`, sort: 2,
  }));
  ids.set('PRODUCT', await seedDepartment({
    code: 'PRODUCT', name: '产品部', parentId: rootId, ancestors: rootId, sort: 2,
  }));
  ids.set('OPS', await seedDepartment({
    code: 'OPS', name: '运营部', parentId: rootId, ancestors: rootId, sort: 3,
  }));
  console.log(`  ✅ 组织结构已对齐（${ids.size} 个部门）`);
  return ids;
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
    await db.update(schema.roles).set({
      name,
      description,
      deptId,
      isSystem: true,
      status: 'ACTIVE',
      sort,
      updatedAt: new Date(),
    }).where(eq(schema.roles.id, existing[0]!.id));
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

async function seedActorMatrix(
  departmentIds: ReadonlyMap<string, string>,
  roleIds: ReadonlyMap<string, string>,
): Promise<void> {
  if (process.env.SEED_ACTOR_MATRIX !== 'true') {
    console.log('\n👥 跳过 Actor Matrix 账号（设置 SEED_ACTOR_MATRIX=true 可显式启用）');
    return;
  }
  const password = process.env.SEED_ACTOR_PASSWORD;
  if (!password) {
    throw new Error('启用 Actor Matrix 时必须设置 SEED_ACTOR_PASSWORD');
  }
  const passwordHash = await bcrypt.hash(password, 10);
  console.log('\n👥 初始化 Actor Matrix 验收账号...');

  for (const actor of ACTOR_DEFINITIONS) {
    const roleId = roleIds.get(actor.roleCode);
    const deptId = departmentIds.get(actor.departmentCode);
    if (!roleId || !deptId) throw new Error(`Actor Matrix 引用了不存在的角色或部门: ${actor.username}`);

    const existing = await db.select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, actor.username))
      .limit(1);
    const userId = existing[0]?.id ?? crypto.randomUUID();
    if (!existing[0]) {
      await db.insert(schema.users).values({
        id: userId,
        username: actor.username,
        email: `${actor.username}@example.invalid`,
        name: actor.name,
        status: 'ACTIVE',
        passwordHash,
        deptId,
      });
    }
    await db.insert(schema.userRoles).values({ userId, roleId }).onConflictDoNothing();
    process.stdout.write(`  ✅ ${actor.username} ← ${actor.roleCode}\n`);
  }
}

export async function main() {
  console.log('🌱 开始 RBAC 数据初始化...');

  // 1. 幂等对齐组织结构（生产安全：不清空现有业务数据）
  const departmentIds = await seedOrganization();

  // 2. 初始化 API 权限（鉴权用）
  const apiPermissionIds = await seedApiPermissions();

  // 3. 初始化 Portal 菜单节点（侧边栏数据驱动）
  const menuPermIds = await seedPortalMenus(apiPermissionIds);

  // 4. 初始化系统角色
  console.log('\n🛡️  初始化角色...');
  const rootDeptId = departmentIds.get('ROOT')!;

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

  const matrixRoles: Array<{ id: string; code: string; permissionCodes: readonly string[] }> = [];
  for (let index = 0; index < ROLE_DEFINITIONS.length; index += 1) {
    const definition = ROLE_DEFINITIONS[index]!;
    const roleId = await seedRole(
      definition.code,
      definition.name,
      definition.description,
      departmentIds.get(definition.departmentCode)!,
      index + 2,
    );
    matrixRoles.push({ id: roleId, code: definition.code, permissionCodes: definition.permissionCodes });
  }

  // 5. 为基线角色绑定权限
  //    菜单节点不绑定到角色（管理员 isAdmin 绕过 menu-tree 可见性检查）
  console.log('\n🔗 绑定权限...');
  const apiPermIds = [...apiPermissionIds.values()];
  await bindPermissions(superAdminId, apiPermIds);
  process.stdout.write(`  ✅ SUPER_ADMIN ← ${apiPermIds.length} 个 API 权限\n`);
  await bindPermissions(adminId, apiPermIds);
  process.stdout.write(`  ✅ ADMIN ← ${apiPermIds.length} 个 API 权限\n`);
  for (const role of matrixRoles) {
    const permissionIds = role.permissionCodes.map((code) => {
      const permissionId = apiPermissionIds.get(code);
      if (!permissionId) throw new Error(`角色基线引用了不存在的权限: ${code}`);
      return permissionId;
    });
    await bindPermissions(role.id, permissionIds);
  }

  await seedActorMatrix(
    departmentIds,
    new Map(matrixRoles.map((role) => [role.code, role.id])),
  );

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
