# Permission Management Full Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复权限管理系统的 8 个已知缺陷，使 RBAC 体系从数据模型到前端展示完整打通。

**Architecture:** 分四个阶段实施：① 修复权限码不一致 + 初始化种子数据（P0，解除阻断）；② 补全菜单类型字段 + 动态侧边栏（P1/P2，核心功能）；③ 补全部门成员管理（P2）；④ 前端权限守卫（P3）。两个 schema 文件（`apps/idp/src/db/schema/index.ts` 和 `apps/portal/src/db/schema.ts`）共享同一数据库，迁移从 idp 运行。

**Tech Stack:** Next.js 16, Drizzle ORM, PostgreSQL, TypeScript, React 19, tsx（脚本运行器）

---

## 文件变更清单

**修改：**
- `packages/contracts/src/permissions.ts` — 为所有资源补充 `LIST` 权限码
- `apps/idp/src/db/schema/index.ts` — 添加 `menuTypeEnum` + `menus.menuType` 字段
- `apps/portal/src/db/schema.ts` — 与 idp schema 同步上述变更
- `apps/portal/src/app/api/menus/route.ts` — GET 使用 `menu:list`（已正确，确认）
- `apps/portal/src/components/layout/DashboardLayout.tsx` — 额外获取 `/api/me/menus`
- `apps/portal/src/components/layout/app-sidebar.tsx` — 第 102 行使用 `displayMenus`
- `apps/portal/src/app/menus/page.tsx` — 表单增加 `menuType` 选择
- `apps/portal/src/app/departments/page.tsx` — 成员 tab 改为真实请求

**新增：**
- `apps/portal/scripts/seed-rbac.ts` — RBAC 初始化脚本
- `apps/portal/src/app/api/me/menus/route.ts` — 当前用户可见菜单
- `apps/portal/src/app/api/departments/[id]/members/route.ts` — 部门成员列表
- `apps/portal/src/hooks/use-permissions.ts` — 权限 hook
- `apps/portal/src/components/ui/permission-guard.tsx` — 权限守卫组件

---

## Phase 1：基础修复（P0）

---

### Task 1：为 contracts 补充 LIST 权限码

**目标：** 消除路由使用的 `user:list` / `role:list` / `menu:list` 等与 contracts 定义不匹配的问题。

**Files:**
- Modify: `packages/contracts/src/permissions.ts`

- [ ] **Step 1：编辑 permissions.ts，为所有资源添加 LIST 码**

将文件内容完整替换为：

```ts
/**
 * Auth-SSO 权限码定义
 * @module @auth-sso/contracts/permissions
 */

// 权限码命名规范：
// - 格式：{资源}:{动作}
// - 资源：小写，使用下划线分隔
// - 动作：list | create | read | update | delete | manage
// - list = 查询列表；read = 查询单条详情

// ========== 用户管理权限 ==========
export const USER_PERMISSIONS = {
  LIST: 'user:list',
  CREATE: 'user:create',
  READ: 'user:read',
  UPDATE: 'user:update',
  DELETE: 'user:delete',
  MANAGE: 'user:manage',
  RESET_PASSWORD: 'user:reset_password',
  ASSIGN_ROLE: 'user:assign_role',
} as const;

// ========== 部门管理权限 ==========
export const DEPARTMENT_PERMISSIONS = {
  LIST: 'department:list',
  CREATE: 'department:create',
  READ: 'department:read',
  UPDATE: 'department:update',
  DELETE: 'department:delete',
  MANAGE: 'department:manage',
} as const;

// ========== 角色管理权限 ==========
export const ROLE_PERMISSIONS = {
  LIST: 'role:list',
  CREATE: 'role:create',
  READ: 'role:read',
  UPDATE: 'role:update',
  DELETE: 'role:delete',
  MANAGE: 'role:manage',
  ASSIGN_PERMISSION: 'role:assign_permission',
} as const;

// ========== 权限管理权限 ==========
export const PERMISSION_PERMISSIONS = {
  LIST: 'permission:list',
  CREATE: 'permission:create',
  READ: 'permission:read',
  UPDATE: 'permission:update',
  DELETE: 'permission:delete',
  MANAGE: 'permission:manage',
} as const;

// ========== 菜单管理权限 ==========
export const MENU_PERMISSIONS = {
  LIST: 'menu:list',
  CREATE: 'menu:create',
  READ: 'menu:read',
  UPDATE: 'menu:update',
  DELETE: 'menu:delete',
  MANAGE: 'menu:manage',
} as const;

// ========== Client 管理权限 ==========
export const CLIENT_PERMISSIONS = {
  LIST: 'client:list',
  CREATE: 'client:create',
  READ: 'client:read',
  UPDATE: 'client:update',
  DELETE: 'client:delete',
  MANAGE: 'client:manage',
  ROTATE_SECRET: 'client:rotate_secret',
} as const;

// ========== 审计日志权限 ==========
export const AUDIT_PERMISSIONS = {
  READ: 'audit:read',
  EXPORT: 'audit:export',
} as const;

// ========== 登录日志权限 ==========
export const LOGIN_LOG_PERMISSIONS = {
  READ: 'login_log:read',
  EXPORT: 'login_log:export',
} as const;

// ========== 系统管理权限 ==========
export const SYSTEM_PERMISSIONS = {
  MANAGE: 'system:manage',
  VIEW_DASHBOARD: 'system:view_dashboard',
} as const;

// ========== 客户关系图权限 ==========
export const CUSTOMER_GRAPH_PERMISSIONS = {
  VIEW: 'customer_graph:view',
  EXPORT: 'customer_graph:export',
} as const;

// 所有权限码列表（用于 seed 脚本遍历）
export const ALL_PERMISSIONS = [
  ...Object.values(USER_PERMISSIONS),
  ...Object.values(DEPARTMENT_PERMISSIONS),
  ...Object.values(ROLE_PERMISSIONS),
  ...Object.values(PERMISSION_PERMISSIONS),
  ...Object.values(MENU_PERMISSIONS),
  ...Object.values(CLIENT_PERMISSIONS),
  ...Object.values(AUDIT_PERMISSIONS),
  ...Object.values(LOGIN_LOG_PERMISSIONS),
  ...Object.values(SYSTEM_PERMISSIONS),
  ...Object.values(CUSTOMER_GRAPH_PERMISSIONS),
] as const;

// 权限分组（用于 UI 展示）
export const PERMISSION_GROUPS = {
  USER: { name: '用户管理', permissions: Object.values(USER_PERMISSIONS) },
  DEPARTMENT: { name: '部门管理', permissions: Object.values(DEPARTMENT_PERMISSIONS) },
  ROLE: { name: '角色管理', permissions: Object.values(ROLE_PERMISSIONS) },
  PERMISSION: { name: '权限管理', permissions: Object.values(PERMISSION_PERMISSIONS) },
  MENU: { name: '菜单管理', permissions: Object.values(MENU_PERMISSIONS) },
  CLIENT: { name: 'Client 管理', permissions: Object.values(CLIENT_PERMISSIONS) },
  AUDIT: { name: '审计日志', permissions: Object.values(AUDIT_PERMISSIONS) },
  LOGIN_LOG: { name: '登录日志', permissions: Object.values(LOGIN_LOG_PERMISSIONS) },
  SYSTEM: { name: '系统管理', permissions: Object.values(SYSTEM_PERMISSIONS) },
  CUSTOMER_GRAPH: { name: '客户关系图', permissions: Object.values(CUSTOMER_GRAPH_PERMISSIONS) },
} as const;

// 权限中文名映射（seed 脚本使用）
export const PERMISSION_LABELS: Record<string, string> = {
  'user:list': '查看用户列表',
  'user:create': '创建用户',
  'user:read': '查看用户详情',
  'user:update': '修改用户',
  'user:delete': '删除用户',
  'user:manage': '用户管理',
  'user:reset_password': '重置密码',
  'user:assign_role': '分配角色',
  'department:list': '查看部门列表',
  'department:create': '创建部门',
  'department:read': '查看部门详情',
  'department:update': '修改部门',
  'department:delete': '删除部门',
  'department:manage': '部门管理',
  'role:list': '查看角色列表',
  'role:create': '创建角色',
  'role:read': '查看角色详情',
  'role:update': '修改角色',
  'role:delete': '删除角色',
  'role:manage': '角色管理',
  'role:assign_permission': '分配权限',
  'permission:list': '查看权限列表',
  'permission:create': '创建权限',
  'permission:read': '查看权限详情',
  'permission:update': '修改权限',
  'permission:delete': '删除权限',
  'permission:manage': '权限管理',
  'menu:list': '查看菜单列表',
  'menu:create': '创建菜单',
  'menu:read': '查看菜单详情',
  'menu:update': '修改菜单',
  'menu:delete': '删除菜单',
  'menu:manage': '菜单管理',
  'client:list': '查看应用列表',
  'client:create': '创建应用',
  'client:read': '查看应用详情',
  'client:update': '修改应用',
  'client:delete': '删除应用',
  'client:manage': '应用管理',
  'client:rotate_secret': '轮换密钥',
  'audit:read': '查看审计日志',
  'audit:export': '导出审计日志',
  'login_log:read': '查看登录日志',
  'login_log:export': '导出登录日志',
  'system:manage': '系统管理',
  'system:view_dashboard': '查看仪表盘',
  'customer_graph:view': '查看客户关系图',
  'customer_graph:export': '导出客户关系图',
};
```

- [ ] **Step 2：验证 TypeScript 编译无报错**

```bash
cd packages/contracts && pnpm typecheck 2>/dev/null || npx tsc --noEmit
```

预期：无错误输出

- [ ] **Step 3：提交**

```bash
git add packages/contracts/src/permissions.ts
git commit -m "feat(contracts): add LIST permission codes for all resources"
```

---

### Task 2：创建 RBAC 种子数据脚本

**目标：** 新部署的系统执行一次脚本即可获得完整的角色、权限、角色-权限绑定数据，使所有 API 鉴权正常工作。

**Files:**
- Create: `apps/portal/scripts/seed-rbac.ts`

- [ ] **Step 1：创建 seed-rbac.ts**

```ts
// apps/portal/scripts/seed-rbac.ts
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
```

- [ ] **Step 2：在 portal package.json 中添加 seed 脚本命令**

在 `apps/portal/package.json` 的 `"scripts"` 块中添加：

```json
"seed": "tsx scripts/seed-rbac.ts",
"seed:local": "dotenv -e .env.local -- tsx scripts/seed-rbac.ts"
```

最终 scripts 块：
```json
"scripts": {
  "dev": "next dev -p 4100",
  "build": "next build",
  "start": "next start -p 3000",
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "seed": "tsx scripts/seed-rbac.ts",
  "seed:local": "dotenv -e .env.local -- tsx scripts/seed-rbac.ts"
}
```

注意：`dotenv` CLI 需要安装，若无则直接运行：
```bash
cd apps/portal && DATABASE_URL=$(grep DATABASE_URL .env.local | cut -d= -f2-) tsx scripts/seed-rbac.ts
```

- [ ] **Step 3：本地运行脚本验证**

```bash
cd apps/portal && DATABASE_URL=$(grep DATABASE_URL .env.local | cut -d= -f2-) tsx scripts/seed-rbac.ts
```

预期输出：
```
🌱 开始 RBAC 数据初始化...

📋 初始化权限项...
  ✅ 创建: user:list
  ...（共 46 行）

🛡️  初始化角色...
  ✅ 创建角色: SUPER_ADMIN
  ✅ 创建角色: ADMIN

🔗 绑定权限...
  ✅ SUPER_ADMIN ← 46 个权限
  ✅ ADMIN ← 46 个权限

✅ RBAC 初始化完成！
```

- [ ] **Step 4：提交**

```bash
git add apps/portal/scripts/seed-rbac.ts apps/portal/package.json
git commit -m "feat(portal): add RBAC seed script for roles and permissions initialization"
```

---

## Phase 2：菜单系统（P1 + P2）

---

### Task 3：为菜单添加 menuType 字段 + 数据库迁移

**目标：** 区分"目录（DIRECTORY）"、"菜单（MENU）"、"按钮（BUTTON）"三种类型，为三级菜单模型奠定数据基础。迁移从 idp 运行（两个 schema 共享同一数据库）。

**Files:**
- Modify: `apps/idp/src/db/schema/index.ts`
- Modify: `apps/portal/src/db/schema.ts`

- [ ] **Step 1：在 idp schema 中添加 menuTypeEnum 和 menuType 字段**

在 `apps/idp/src/db/schema/index.ts` 中：

在枚举定义区块（约第 24 行 `permissionTypeEnum` 后面）添加：

```ts
export const menuTypeEnum = pgEnum('menu_type', ['DIRECTORY', 'MENU', 'BUTTON']);
```

在 `menus` 表定义中（约第 285 行附近），在 `sort` 字段后添加 `menuType` 字段：

```ts
export const menus = pgTable('menus', {
  id: text('id').primaryKey(),
  publicId: text('public_id').notNull().unique(),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  path: text('path'),
  permissionCode: text('permission_code'),
  icon: text('icon'),
  component: text('component'),
  visible: boolean('visible').default(true),
  sort: integer('sort').default(0),
  menuType: menuTypeEnum('menu_type').notNull().default('MENU'), // 新增
  status: text('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

- [ ] **Step 2：在 portal schema 中做相同修改**

在 `apps/portal/src/db/schema.ts` 中：

在枚举定义区块（约第 24 行后面）添加：

```ts
export const menuTypeEnum = pgEnum('menu_type', ['DIRECTORY', 'MENU', 'BUTTON']);
```

在 `menus` 表定义中（约第 286 行），在 `sort` 字段后添加：

```ts
menuType: menuTypeEnum('menu_type').notNull().default('MENU'), // 新增
```

- [ ] **Step 3：生成 Drizzle 迁移文件**

```bash
cd apps/idp && DATABASE_URL=$(grep DATABASE_URL .env.local | cut -d= -f2-) pnpm drizzle-kit generate --name=add_menu_type
```

预期：在 `apps/idp/drizzle/` 下生成 `XXXX_add_menu_type.sql`，内容包含：
```sql
CREATE TYPE "public"."menu_type" AS ENUM('DIRECTORY', 'MENU', 'BUTTON');
ALTER TABLE "menus" ADD COLUMN "menu_type" "menu_type" DEFAULT 'MENU' NOT NULL;
```

- [ ] **Step 4：推送迁移到数据库**

```bash
cd apps/idp && DATABASE_URL=$(grep DATABASE_URL .env.local | cut -d= -f2-) pnpm drizzle-kit push
```

预期：`All migrations applied successfully` 或类似输出。

- [ ] **Step 5：TypeScript 编译验证**

```bash
cd apps/portal && pnpm typecheck
cd apps/idp && pnpm typecheck
```

预期：无错误。

- [ ] **Step 6：更新菜单管理 API，接受 menuType 字段**

修改 `apps/portal/src/app/api/menus/route.ts` 的 POST handler，在解构 body 时加入 `menuType`：

```ts
const { name, path, permissionCode, parentId, icon, sort = 0, visible = true, status = 'ACTIVE', menuType = 'MENU' } = body;
```

在 `db.insert(schema.menus).values({...})` 中加入：

```ts
menuType: menuType as 'DIRECTORY' | 'MENU' | 'BUTTON',
```

修改 `apps/portal/src/app/api/menus/[id]/route.ts` 的 PATCH handler，允许更新 `menuType`（`...body` 已包含，无需额外改动，但需要确认 body spread 不会引入非法字段。如果需要白名单，改为）：

```ts
const { name, path, permissionCode, icon, sort, visible, status, menuType, parentId } = body;
const updateData: Record<string, any> = { updatedAt: new Date() };
if (name !== undefined) updateData.name = name;
if (path !== undefined) updateData.path = path;
if (permissionCode !== undefined) updateData.permissionCode = permissionCode;
if (icon !== undefined) updateData.icon = icon;
if (sort !== undefined) updateData.sort = sort;
if (visible !== undefined) updateData.visible = visible;
if (status !== undefined) updateData.status = status;
if (menuType !== undefined) updateData.menuType = menuType;
if (parentId !== undefined) updateData.parentId = parentId;

await db.update(schema.menus)
  .set(updateData)
  .where(or(eq(schema.menus.id, id), eq(schema.menus.publicId, id)));
```

- [ ] **Step 7：更新菜单管理前端，添加 menuType 选择**

在 `apps/portal/src/app/menus/page.tsx` 中：

在 `MenuItem` 接口加入：
```ts
menuType: 'DIRECTORY' | 'MENU' | 'BUTTON';
```

在 `formMenu` state 初始值加入：
```ts
menuType: 'MENU' as 'DIRECTORY' | 'MENU' | 'BUTTON'
```

在创建/编辑表单对话框中（`DialogContent` 内的 `grid gap-6` 区块末尾）加入：

```tsx
<div className="space-y-2">
  <Label className="font-bold">菜单类型</Label>
  <Select
    value={formMenu.menuType}
    onValueChange={(v: any) => setFormMenu({ ...formMenu, menuType: v })}
  >
    <SelectTrigger className="rounded-xl h-10">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="DIRECTORY">目录（一级分组，无路由）</SelectItem>
      <SelectItem value="MENU">菜单（含路由的页面入口）</SelectItem>
      <SelectItem value="BUTTON">按钮（功能操作，不展示在侧边栏）</SelectItem>
    </SelectContent>
  </Select>
</div>
```

在菜单列表表格中，在"显示状态"列前加入"类型"列表头和对应的 `TableCell`：

表头：
```tsx
<TableHead>类型</TableHead>
```

表格行（在 `visible` badge 所在 `TableCell` 前插入）：
```tsx
<TableCell>
  {item.menuType === 'DIRECTORY' && <Badge variant="outline" className="text-[10px] bg-indigo-50 text-indigo-600 border-indigo-100">目录</Badge>}
  {item.menuType === 'MENU' && <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-600 border-blue-100">菜单</Badge>}
  {item.menuType === 'BUTTON' && <Badge variant="outline" className="text-[10px] bg-orange-50 text-orange-600 border-orange-100">按钮</Badge>}
</TableCell>
```

- [ ] **Step 8：提交**

```bash
git add apps/idp/src/db/schema/index.ts apps/portal/src/db/schema.ts \
  apps/idp/drizzle/ \
  apps/portal/src/app/api/menus/ \
  apps/portal/src/app/menus/page.tsx
git commit -m "feat(schema): add menuType field (DIRECTORY/MENU/BUTTON) to menus table"
```

---

### Task 4：创建 /api/me/menus 端点

**目标：** 返回当前用户有权访问的菜单树（按权限过滤，按钮类型不返回）。超级管理员返回全部。

**Files:**
- Create: `apps/portal/src/app/api/me/menus/route.ts`

- [ ] **Step 1：创建文件**

```ts
/**
 * 当前用户可见菜单 API
 * GET /api/me/menus - 返回权限过滤后的菜单树（供侧边栏使用）
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionIdFromCookie, getSession } from '@/lib/session';
import { getUserPermissionContext } from '@/lib/permissions';
import { db, schema } from '@/lib/db';
import { asc, eq } from 'drizzle-orm';

export const runtime = 'nodejs';

/** 将平铺列表构建为树形结构 */
function buildTree(items: SidebarMenuItem[], parentId: string | null = null): SidebarMenuItem[] {
  return items
    .filter(item => item.parentId === parentId)
    .map(item => ({ ...item, children: buildTree(items, item.id) }))
    .sort((a, b) => a.sort - b.sort);
}

interface SidebarMenuItem {
  id: string;
  parentId: string | null;
  title: string;
  url: string;
  icon: string;
  sort: number;
  children?: SidebarMenuItem[];
}

export async function GET(_request: NextRequest) {
  // 1. 验证 session
  const sessionId = await getSessionIdFromCookie();
  if (!sessionId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const session = await getSession(sessionId);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // 2. 获取用户权限上下文
  const ctx = await getUserPermissionContext(session.userId);
  if (!ctx) return NextResponse.json({ error: 'internal_error' }, { status: 500 });

  const isAdmin = ctx.roles.some(r => r.code === 'SUPER_ADMIN' || r.code === 'ADMIN');

  // 3. 查询所有启用且可见的非按钮菜单
  const allMenus = await db.select()
    .from(schema.menus)
    .where(eq(schema.menus.status, 'ACTIVE'))
    .orderBy(asc(schema.menus.sort));

  // 4. 过滤：按钮不显示在侧边栏；无权限码的目录/菜单总是显示
  const visible = allMenus.filter(m => {
    if ((m as any).menuType === 'BUTTON') return false;
    if (!m.visible) return false;
    if (!m.permissionCode) return true;
    if (isAdmin) return true;
    return ctx.permissions.includes(m.permissionCode);
  });

  // 5. 转换为侧边栏所需格式
  const mapped: SidebarMenuItem[] = visible.map(m => ({
    id: m.id,
    parentId: m.parentId,
    title: m.name,
    url: m.path || '#',
    icon: m.icon || 'LayoutGrid',
    sort: m.sort,
  }));

  return NextResponse.json({ data: buildTree(mapped) });
}
```

- [ ] **Step 2：手动测试接口**

确保已登录（portal 有 session cookie），运行：

```bash
curl -s http://localhost:4100/api/me/menus \
  -H "Cookie: $(grep 'portal_session' ~/.portal_cookies 2>/dev/null || echo 'your_cookie_here')"
```

预期：返回 `{ "data": [...] }` 数组（若 menus 表为空则 `[]`，无 401）。

- [ ] **Step 3：提交**

```bash
git add apps/portal/src/app/api/me/menus/route.ts
git commit -m "feat(portal): add /api/me/menus endpoint for permission-filtered sidebar menus"
```

---

### Task 5：修复 AppSidebar 动态菜单加载

**目标：** 侧边栏从后端获取当前用户可见菜单，不再使用硬编码数组；菜单数据库为空时回退到内置导航。

**Files:**
- Modify: `apps/portal/src/components/layout/DashboardLayout.tsx`
- Modify: `apps/portal/src/components/layout/app-sidebar.tsx`

- [ ] **Step 1：修改 DashboardLayout.tsx，额外获取 /api/me/menus**

将 `DashboardLayout.tsx` 完整替换为：

```tsx
'use client';

import React, { useState, useEffect } from 'react';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from './app-sidebar';
import { Separator } from '@/components/ui/separator';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { usePathname } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [userInfo, setUserInfo] = useState<any>(null);
  const [dynamicMenus, setDynamicMenus] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();

  useEffect(() => {
    async function fetchData() {
      try {
        const [meRes, menusRes] = await Promise.all([
          fetch('/api/me'),
          fetch('/api/me/menus'),
        ]);
        if (meRes.ok) {
          const data = await meRes.json();
          setUserInfo(data);
        }
        if (menusRes.ok) {
          const data = await menusRes.json();
          setDynamicMenus(data.data || []);
        }
      } catch (error) {
        console.error('Failed to fetch layout data:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const getBreadcrumbs = () => {
    const segments = pathname.split('/').filter(Boolean);
    const crumbs = [{ title: '工作台', url: '/dashboard' }];
    if (segments[0] !== 'dashboard') {
      const titleMap: Record<string, string> = {
        users: '用户管理',
        roles: '角色权限',
        departments: '组织架构',
        clients: '应用管理',
        'audit-logs': '审计日志',
        permissions: '权限管理',
        menus: '菜单配置',
      };
      const title = titleMap[segments[0]] || segments[0];
      crumbs.push({ title, url: `/${segments[0]}` });
    }
    return crumbs;
  };

  const breadcrumbs = getBreadcrumbs();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider defaultOpen={true}>
      <AppSidebar user={userInfo} dynamicMenus={dynamicMenus} />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-background px-6 sticky top-0 z-10">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.map((crumb, index) => (
                <React.Fragment key={crumb.url}>
                  <BreadcrumbItem className="hidden md:block">
                    {index === breadcrumbs.length - 1 ? (
                      <BreadcrumbPage>{crumb.title}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink href={crumb.url}>{crumb.title}</BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {index < breadcrumbs.length - 1 && (
                    <BreadcrumbSeparator className="hidden md:block" />
                  )}
                </React.Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <main className="flex-1 overflow-auto bg-slate-50/50 dark:bg-transparent p-4 lg:p-6">
          <div className="space-y-6 animate-in fade-in duration-500">
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

- [ ] **Step 2：修改 app-sidebar.tsx，接受 dynamicMenus 并使用它**

修改 `AppSidebar` 组件签名，加入 `dynamicMenus` prop，并修正第 102 行：

将文件头部的 prop 定义改为：

```tsx
export function AppSidebar({ user, dynamicMenus = [] }: { user: any; dynamicMenus?: any[] }) {
```

将内置菜单数组改名为 `fallbackMenus`（替换原 `menus` 常量定义）：

```tsx
const fallbackMenus = [
  { id: 'dash', title: '工作台', url: '/dashboard', icon: 'LayoutDashboard' },
  { id: 'user', title: '用户管理', url: '/users', icon: 'Users' },
  { id: 'dept', title: '组织架构', url: '/departments', icon: 'Building2' },
  { id: 'role', title: '权限配置', url: '/roles', icon: 'ShieldCheck' },
  { id: 'app', title: '应用管理', url: '/clients', icon: 'AppWindow' },
  { id: 'menu', title: '菜单配置', url: '/menus', icon: 'Menu' },
  { id: 'audit', title: '安全审计', url: '/audit-logs', icon: 'ShieldAlert' },
];
```

将 `displayMenus` 逻辑改为优先使用 `dynamicMenus`：

```tsx
// dynamicMenus 来自 /api/me/menus，已按权限过滤；为空则用内置菜单兜底
const displayMenus = dynamicMenus.length > 0 ? dynamicMenus : fallbackMenus;
```

将第 102 行（原 `{menus.map(...)}`) 改为：

```tsx
{displayMenus.map((item: any) => {
```

删除原有的 `rawMenus` 和原 `menus` 常量以及 `displayMenus` 的旧逻辑（共约 12 行）。

- [ ] **Step 3：验证侧边栏正确显示**

1. 启动开发服务器：`cd apps/portal && pnpm dev`
2. 登录后，观察侧边栏：
   - 若 menus 表为空 → 显示内置 7 个菜单（兜底）
   - 若已有菜单数据 → 显示来自数据库的菜单
3. 检查浏览器 Network 面板，确认 `/api/me/menus` 返回 200 而非 401

- [ ] **Step 4：提交**

```bash
git add apps/portal/src/components/layout/DashboardLayout.tsx \
  apps/portal/src/components/layout/app-sidebar.tsx
git commit -m "feat(portal): sidebar now loads dynamic menus from /api/me/menus with permission filtering"
```

---

## Phase 3：部门成员管理（P2）

---

### Task 6：部门成员 API + 前端

**目标：** 点击部门后，"该部成员"标签页显示真实的部门成员列表，而非"正在拉取成员..."占位符；同时新增根据部门 ID 查询成员的 API。

**Files:**
- Create: `apps/portal/src/app/api/departments/[id]/members/route.ts`
- Modify: `apps/portal/src/app/departments/page.tsx`

- [ ] **Step 1：创建部门成员 API**

```ts
/**
 * 部门成员列表 API
 * GET /api/departments/[id]/members - 获取指定部门的成员列表
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, or } from 'drizzle-orm';
import { withPermission } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withPermission(request, { permissions: ['user:list'] }, async () => {
    const { id } = await params;

    // 通过 publicId 或 id 查找部门
    const dept = await db.select({ id: schema.departments.id })
      .from(schema.departments)
      .where(or(
        eq(schema.departments.id, id),
        eq(schema.departments.publicId, id),
      ));

    if (dept.length === 0) {
      return NextResponse.json({ error: 'not_found', message: '部门不存在' }, { status: 404 });
    }

    const deptId = dept[0]!.id;

    const members = await db.select({
      id: schema.users.id,
      publicId: schema.users.publicId,
      name: schema.users.name,
      username: schema.users.username,
      email: schema.users.email,
      avatarUrl: schema.users.avatarUrl,
      status: schema.users.status,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.deptId, deptId));

    return NextResponse.json({ data: members });
  });
}
```

- [ ] **Step 2：修改 departments/page.tsx — 成员 tab 改为真实请求**

在 `DepartmentsPage` 组件内，添加成员列表状态：

```ts
const [members, setMembers] = useState<any[]>([]);
const [membersLoading, setMembersLoading] = useState(false);
```

在 `handleSelect` 函数中，选中部门后同时获取成员：

```ts
const handleSelect = async (dept: Department) => {
  setSelectedDept(dept);
  setIsSheetOpen(true);
  setIsEditMode(false);
  // 拉取成员
  setMembersLoading(true);
  try {
    const res = await fetch(`/api/departments/${dept.id}/members`);
    if (res.ok) {
      const data = await res.json();
      setMembers(data.data || []);
    }
  } catch {
    setMembers([]);
  } finally {
    setMembersLoading(false);
  }
};
```

将"该部成员" `TabsContent` 替换为：

```tsx
<TabsContent value="members" className="space-y-3 pt-2">
  {membersLoading ? (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="space-y-1 flex-1">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      ))}
    </div>
  ) : members.length === 0 ? (
    <div className="py-12 text-center text-slate-400 text-sm italic">
      该部门暂无成员
    </div>
  ) : (
    <div className="space-y-2">
      {members.map(m => (
        <div key={m.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
          <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
            {m.name?.charAt(0) || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-slate-800 truncate">{m.name}</p>
            <p className="text-[11px] text-slate-400 truncate">{m.email}</p>
          </div>
          <Badge
            variant={m.status === 'ACTIVE' ? 'default' : 'secondary'}
            className="text-[10px] flex-shrink-0"
          >
            {m.status === 'ACTIVE' ? '在职' : '停用'}
          </Badge>
        </div>
      ))}
    </div>
  )}
</TabsContent>
```

在 `departments/page.tsx` 顶部导入新增用到的组件（已有 `Skeleton`，确认导入；确认 `Badge` 已导入）。

- [ ] **Step 3：验证**

1. 启动开发服务器
2. 进入组织架构页，点击任意部门
3. 切换到"该部成员"标签：
   - 有成员时：显示成员卡片
   - 无成员时：显示"该部门暂无成员"
   - 成员加载中：显示骨架屏

- [ ] **Step 4：提交**

```bash
git add apps/portal/src/app/api/departments/ apps/portal/src/app/departments/page.tsx
git commit -m "feat(portal): implement department members API and UI"
```

---

## Phase 4：前端权限守卫（P3）

---

### Task 7：usePermissions Hook + PermissionGuard 组件

**目标：** 提供可在任意客户端组件使用的权限检查能力，实现按钮级、区块级的权限控制，无权限用户不显示敏感操作按钮。

**Files:**
- Create: `apps/portal/src/hooks/use-permissions.ts`
- Create: `apps/portal/src/components/ui/permission-guard.tsx`

- [ ] **Step 1：创建 usePermissions hook**

```ts
// apps/portal/src/hooks/use-permissions.ts
'use client';

import { useState, useEffect } from 'react';

export interface PermissionContext {
  roles: Array<{ id: string; code: string; name: string }>;
  permissions: string[];
  loading: boolean;
}

// 模块级缓存，同一页面生命周期内只请求一次
let _cache: PermissionContext | null = null;
let _promise: Promise<void> | null = null;

async function fetchPermissions() {
  if (_promise) return _promise;
  _promise = fetch('/api/me/permissions')
    .then(r => r.json())
    .then(data => {
      _cache = {
        roles: data.data?.roles ?? [],
        permissions: data.data?.permissions ?? [],
        loading: false,
      };
    })
    .catch(() => {
      _cache = { roles: [], permissions: [], loading: false };
    });
  return _promise;
}

export function usePermissions() {
  const [ctx, setCtx] = useState<PermissionContext>(
    _cache ?? { roles: [], permissions: [], loading: true }
  );

  useEffect(() => {
    if (_cache && !_cache.loading) {
      setCtx(_cache);
      return;
    }
    fetchPermissions().then(() => {
      if (_cache) setCtx({ ..._cache });
    });
  }, []);

  const hasPermission = (code: string) =>
    isAdmin() || ctx.permissions.includes(code);

  const hasRole = (code: string) =>
    ctx.roles.some(r => r.code === code);

  const isAdmin = () =>
    ctx.roles.some(r => r.code === 'SUPER_ADMIN' || r.code === 'ADMIN');

  return { ...ctx, hasPermission, hasRole, isAdmin };
}
```

- [ ] **Step 2：创建 PermissionGuard 组件**

```tsx
// apps/portal/src/components/ui/permission-guard.tsx
'use client';

import { usePermissions } from '@/hooks/use-permissions';

interface PermissionGuardProps {
  /** 需要的权限码，管理员自动通过 */
  permission?: string;
  /** 需要的角色码，管理员自动通过 */
  role?: string;
  /** 仅管理员可见 */
  adminOnly?: boolean;
  children: React.ReactNode;
  /** 无权限时的备用渲染，默认不渲染 */
  fallback?: React.ReactNode;
}

/**
 * 按钮/区块级权限守卫
 *
 * @example
 * <PermissionGuard permission="user:delete">
 *   <Button>删除</Button>
 * </PermissionGuard>
 */
export function PermissionGuard({
  permission,
  role,
  adminOnly,
  children,
  fallback = null,
}: PermissionGuardProps) {
  const { hasPermission, hasRole, isAdmin, loading } = usePermissions();

  // 加载中不渲染（避免权限闪烁）
  if (loading) return null;

  if (adminOnly && !isAdmin()) return <>{fallback}</>;
  if (permission && !hasPermission(permission)) return <>{fallback}</>;
  if (role && !hasRole(role)) return <>{fallback}</>;

  return <>{children}</>;
}
```

- [ ] **Step 3：在用户管理页面应用 PermissionGuard**

在 `apps/portal/src/app/users/page.tsx` 中（假设有"新增用户"按钮和"删除"操作），在文件顶部增加导入：

```ts
import { PermissionGuard } from '@/components/ui/permission-guard';
```

将"新增用户"按钮包裹：

```tsx
<PermissionGuard permission="user:create">
  <Button onClick={...} className="...">
    <Plus className="mr-2 h-4 w-4" /> 新增用户
  </Button>
</PermissionGuard>
```

将用户行的"删除"菜单项包裹：

```tsx
<PermissionGuard permission="user:delete">
  <DropdownMenuItem onClick={() => handleDelete(user)} className="text-destructive ...">
    <Trash2 className="h-4 w-4 mr-2" /> 删除
  </DropdownMenuItem>
</PermissionGuard>
```

- [ ] **Step 4：在角色管理页面应用 PermissionGuard**

在 `apps/portal/src/app/roles/page.tsx` 顶部增加导入：

```ts
import { PermissionGuard } from '@/components/ui/permission-guard';
```

将"新增角色"按钮包裹：

```tsx
<PermissionGuard permission="role:create">
  <Button ...>新增角色</Button>
</PermissionGuard>
```

将"分配权限"等操作包裹：

```tsx
<PermissionGuard permission="role:update">
  <DropdownMenuItem ...>分配权限</DropdownMenuItem>
</PermissionGuard>
```

- [ ] **Step 5：在权限管理页面应用 PermissionGuard**

在 `apps/portal/src/app/permissions/page.tsx` 中：

```tsx
import { PermissionGuard } from '@/components/ui/permission-guard';

// 新增按钮
<PermissionGuard permission="permission:create">
  <Button ...>新增权限</Button>
</PermissionGuard>

// 删除菜单项
<PermissionGuard permission="permission:delete">
  <DropdownMenuItem ...>删除权限</DropdownMenuItem>
</PermissionGuard>
```

- [ ] **Step 6：验证权限守卫行为**

1. 使用普通用户（无 `user:delete` 权限）登录
2. 进入用户管理页 → 操作下拉菜单中"删除"按钮应消失
3. 使用 SUPER_ADMIN 登录 → 所有按钮正常显示
4. 检查浏览器控制台无权限相关报错

- [ ] **Step 7：提交**

```bash
git add apps/portal/src/hooks/use-permissions.ts \
  apps/portal/src/components/ui/permission-guard.tsx \
  apps/portal/src/app/users/page.tsx \
  apps/portal/src/app/roles/page.tsx \
  apps/portal/src/app/permissions/page.tsx
git commit -m "feat(portal): add usePermissions hook and PermissionGuard component for button-level RBAC"
```

---

## 验收清单

完成所有 Task 后，逐条验证：

- [ ] 运行 seed 脚本后，`permissions` 表有 46 条记录，`roles` 表有 `SUPER_ADMIN` 和 `ADMIN`
- [ ] SUPER_ADMIN 账号登录后，所有 API 列表接口返回 200（不再因权限码不匹配而 403）
- [ ] 普通账号无任何角色时，列表接口返回 403（鉴权生效）
- [ ] 菜单管理页可创建"目录 / 菜单 / 按钮"三种类型，表格有类型列
- [ ] 侧边栏显示来自数据库的菜单（menus 表为空时回退内置菜单）
- [ ] 无权限的菜单（permissionCode 不在用户权限列表）不出现在侧边栏
- [ ] 部门详情面板的"该部成员"标签页显示真实成员
- [ ] 无 `user:delete` 权限的用户在用户管理页看不到"删除"按钮
