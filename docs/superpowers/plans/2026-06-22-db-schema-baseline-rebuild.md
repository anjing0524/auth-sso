# DB Schema Baseline 重建与多 type 权限模型对齐 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重建数据库迁移 baseline，使 drizzle 迁移与 v2 schema TS 完全对齐，并补齐 permissions 多 type 模型的链路断点（CHECK 约束、register 契约、seed 修复、Portal 菜单种子）。

**Architecture:** 以 schema TS 为单一真相源，删除漂移的旧迁移、`drizzle-kit generate` 重建单一 baseline；用 drizzle 原生 `check()` 落实类型鉴别约束；按已确认的 5 项决策（D-1 全局唯一+命名空间、D-2 数据驱动菜单种子、D-3 补全 register 字段、D-4 重建 baseline、D-5 ip→inet）逐项落地。所有 schema 变更后必须通过 `schema/index.ts` 中的编译期 Domain↔Drizzle 类型守卫。

**Tech Stack:** Drizzle ORM + drizzle-kit、PostgreSQL 15+（`uuid`/`inet`/`timestamptz`/`check`）、Vitest、pnpm monorepo。

**前置确认（已由用户拍板）：**
- D-1：`permissions.code` 保持全局 UK，code 必须命名空间化（如 `menu:users`、`erp:order:list`）。
- D-2：Portal 自身菜单走 PAGE/DIRECTORY 种子节点，侧边栏数据驱动。
- D-3：register 契约补 `path/icon/visible`。
- D-4：删除旧 3 个迁移文件重建 baseline（dev 环境，无生产数据保留需求）。
- D-5：`logs.ip` 遵 `DATABASE_REDESIGN.md` 改 `inet`。

**范围说明：** 本计划聚焦数据库层 + seed + register 契约。侧边栏前端从「按 API 权限渲染」改为「按 PAGE 权限渲染」属于前端改造，列为本计划的**显式后续依赖**（Task 9 描述，单独排期），不在本计划实现。

**全程工作目录：** `apps/portal`

---

## 文件结构（变更总览）

| 文件 | 责任 | 操作 |
|---|---|---|
| `src/db/schema/auth.ts` | OIDC 表 | 改：token `expiresAt`/`kid` NOT NULL |
| `src/db/schema/logs.ts` | 日志表 | 改：`ip` varchar(45) → inet |
| `src/db/schema/rbac.ts` | 权限/角色表 | 改：删 3 个冗余索引、加 CHECK 约束 |
| `drizzle/0000_*.sql` + `meta/` | 迁移产物 | 删后重建 |
| `src/app/api/permissions/register/route.ts` | 子应用权限注册 | 改：契约补 path/icon/visible |
| `scripts/seed-rbac.ts` | RBAC 种子 | 改：修复合合主键插入、补菜单种子 |
| `src/lib/audit.ts` | 审计写入 | 改：IP 落库前校验 |
| `__tests__/api/permission-api.test.ts` | 注册 API 测试 | 改：新增 path/icon/visible 用例 |
| `docs/spec/USER_STORIES.md`、`src/app/(dashboard)/permissions/page.tsx`、`data.ts` | 文档/文案 | 改：清漂移引用 |

---

## Task 1: 收紧令牌表与 JWKS 的非空约束

**Files:**
- Modify: `apps/portal/src/db/schema/auth.ts:78`, `auth.ts:97`, `auth.ts:110`

- [ ] **Step 1: 修改 access_tokens.expiresAt 为 NOT NULL**

`apps/portal/src/db/schema/auth.ts:78`，将：
```ts
  expiresAt: timestamp('expires_at', { withTimezone: true }),
```
改为：
```ts
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
```

- [ ] **Step 2: 修改 refresh_tokens.expiresAt 为 NOT NULL**

`apps/portal/src/db/schema/auth.ts:97`，将：
```ts
  expiresAt: timestamp('expires_at', { withTimezone: true }),
```
改为：
```ts
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
```

- [ ] **Step 3: 修改 jwks.kid 为 NOT NULL**

`apps/portal/src/db/schema/auth.ts:110`，将：
```ts
  kid: varchar('kid', { length: 50 }).unique(),
```
改为：
```ts
  kid: varchar('kid', { length: 50 }).notNull().unique(),
```

- [ ] **Step 4: 类型守卫编译验证**

Run: `cd apps/portal && pnpm exec tsc --noEmit`
Expected: 通过（本步仅收紧可空性，不破坏 Domain 类型兼容）。

- [ ] **Step 5: Commit**
```bash
git add apps/portal/src/db/schema/auth.ts
git commit -m "refactor(portal): 收紧 token.expiresAt 与 jwks.kid 非空约束"
```

---

## Task 2: logs.ip 改为 inet 并加固审计写入

**Files:**
- Modify: `apps/portal/src/db/schema/logs.ts:41`, `logs.ts:61`
- Modify: `apps/portal/src/lib/audit.ts:73`, `audit.ts:97`
- Test: `apps/portal/__tests__/unit/audit-ip.test.ts`（新建）

- [ ] **Step 1: 写失败测试 — IP 校验函数**

新建 `apps/portal/__tests__/unit/audit-ip.test.ts`：
```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { sanitizeIp } from '@/lib/audit';

describe('sanitizeIp', () => {
  it('合法 IPv4 原样返回', () => {
    expect(sanitizeIp('203.0.113.7')).toBe('203.0.113.7');
  });
  it('合法 IPv6 原样返回', () => {
    expect(sanitizeIp('2001:db8::1')).toBe('2001:db8::1');
  });
  it('非法字符串返回 null，避免 inet 列写入失败', () => {
    expect(sanitizeIp('unknown')).toBeNull();
    expect(sanitizeIp('')).toBeNull();
  });
  it('null/undefined 返回 null', () => {
    expect(sanitizeIp(null)).toBeNull();
    expect(sanitizeIp(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/portal && pnpm vitest run __tests__/unit/audit-ip.test.ts`
Expected: FAIL — `sanitizeIp is not exported`。

- [ ] **Step 3: 实现 sanitizeIp**

`apps/portal/src/lib/audit.ts` 顶部新增导出（保留现有内容）：
```ts
/**
 * 将请求 IP 规整为可写入 inet 列的合法值。
 * 非法/空值返回 null，避免 PG inet 类型写入异常。
 */
export function sanitizeIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  // 去除代理链取首个 IP，并做 IPv4/IPv6 粗校验
  const candidate = ip.split(',')[0].trim();
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^([0-9a-fA-F:]+)$/;
  if (ipv4.test(candidate) || (candidate.includes(':') && ipv6.test(candidate))) {
    return candidate;
  }
  return null;
}
```

- [ ] **Step 4: 审计写入处套用 sanitizeIp**

`apps/portal/src/lib/audit.ts:73` 与 `:97` 两处，将：
```ts
      ip: params.ip ?? null,
```
改为：
```ts
      ip: sanitizeIp(params.ip),
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd apps/portal && pnpm vitest run __tests__/unit/audit-ip.test.ts`
Expected: PASS（4 用例全过）。

- [ ] **Step 6: schema 列改 inet**

`apps/portal/src/db/schema/logs.ts`，import 行追加 `inet`：
```ts
import { pgTable, uuid, varchar, text, inet, jsonb, smallint, integer, index } from 'drizzle-orm/pg-core';
```
将两处（audit_logs `:41`、login_logs `:61`）：
```ts
  ip: varchar('ip', { length: 45 }),
```
改为：
```ts
  ip: inet('ip'),
```

- [ ] **Step 7: 类型守卫编译验证**

Run: `cd apps/portal && pnpm exec tsc --noEmit`
Expected: 通过。

- [ ] **Step 8: Commit**
```bash
git add apps/portal/src/db/schema/logs.ts apps/portal/src/lib/audit.ts apps/portal/__tests__/unit/audit-ip.test.ts
git commit -m "refactor(portal): logs.ip 改用 inet 并加固审计 IP 写入"
```

---

## Task 3: permissions 类型鉴别 CHECK 约束 + 删除冗余索引

**Files:**
- Modify: `apps/portal/src/db/schema/rbac.ts:84-90`、`:99-103`、`:112-116`、`:125-129`

- [ ] **Step 1: 删除 3 个冗余左前缀索引**

`apps/portal/src/db/schema/rbac.ts`：
- `rolePermissions`（约 :99-103）删除 `index('idx_role_permissions_role').on(t.roleId),`，保留 permission 索引。
- `roleDataScopes`（约 :112-116）删除 `index('idx_role_data_scopes_role').on(t.roleId),`，保留 dept 索引。
- `roleClients`（约 :125-129）删除 `index('idx_role_clients_role').on(t.roleId),`，保留 client 索引。

理由：复合唯一索引 `ux_*_pk(roleId, X)` 的 btree 左前缀已覆盖 `roleId` 单列查询。

- [ ] **Step 2: 给 permissions 加 CHECK 约束**

`apps/portal/src/db/schema/rbac.ts` import 行追加 `check`、`sql`、`and`：
```ts
import { pgTable, uuid, varchar, text, boolean, smallint, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
```
permissions 表回调改为：
```ts
}, (t) => [
  index('idx_permissions_client').on(t.clientId),
  index('idx_permissions_parent').on(t.parentId),
  index('idx_permissions_type').on(t.type),
  // CHECK：DIRECTORY/PAGE 不可有 resource/action/clientId；API/DATA 必有 resource/action
  check(
    'permissions_type_fields_chk',
    sql`(type IN ('DIRECTORY','PAGE') AND resource IS NULL AND action IS NULL AND client_id IS NULL)
      OR (type IN ('API','DATA') AND resource IS NOT NULL AND action IS NOT NULL)`,
  ),
]);
```

- [ ] **Step 3: 编译验证**

Run: `cd apps/portal && pnpm exec tsc --noEmit`
Expected: 通过。

- [ ] **Step 4: Commit**
```bash
git add apps/portal/src/db/schema/rbac.ts
git commit -m "refactor(portal): permissions 加类型鉴别 CHECK 约束 + 删冗余索引"
```

---

## Task 4: 重建迁移 baseline

**Files:**
- Delete: `apps/portal/drizzle/0000_graceful_lady_mastermind.sql`
- Delete: `apps/portal/drizzle/0001_slimy_infant_terrible.sql`
- Delete: `apps/portal/drizzle/0002_slimy_eternity.sql`
- Delete: `apps/portal/drizzle/meta/`（整个目录）
- Create: `apps/portal/drizzle/0000_*.sql`（generate 产出）

- [ ] **Step 1: 删除旧迁移产物**

Run:
```bash
cd apps/portal
rm -f drizzle/0000_graceful_lady_mastermind.sql drizzle/0001_slimy_infant_terrible.sql drizzle/0002_slimy_eternity.sql
rm -rf drizzle/meta
```
Expected: `drizzle/` 目录为空。

- [ ] **Step 2: 生成新 baseline**

Run: `cd apps/portal && pnpm exec drizzle-kit generate`
Expected: 生成 `drizzle/0000_<snapshot>.sql` 与 `drizzle/meta/`，SQL 中包含：
- 所有表用 `uuid` PK、`gen_random_uuid()`
- 无 `menus`、`consents` 表
- `permission_type` 枚举为 `DIRECTORY/PAGE/API/DATA`
- `access_tokens.token_hash`、`refresh_tokens.token_hash`
- `permissions_type_fields_chk` CHECK 约束
- `logs.ip` 为 `inet`

- [ ] **Step 3: 人工核验生成产物**

Run: `cd apps/portal && grep -E "CREATE TYPE|CREATE TABLE|CHECK|menus|consents|public_id|token_hash|inet" drizzle/0000_*.sql | head -60`
Expected 核对清单：
- ✅ 存在 `permission_type` 含 4 值、`login_event`、`audit_operation`、`data_scope_type`
- ✅ 无 `menu_type`、无 `menus` 表、无 `consents` 表、无 `public_id` 列
- ✅ token 表列为 `token_hash varchar(64)`
- ✅ `audit_logs.ip` / `login_logs.ip` 为 `inet`
- ✅ 含 `CONSTRAINT "permissions_type_fields_chk" CHECK`

- [ ] **Step 4: 干净库迁移冒烟**

需要本地可用的 Postgres（如 docker-compose 提供的实例）。Run:
```bash
cd apps/portal
# 使用一个空数据库（按实际 env 调整）
pnpm exec drizzle-kit migrate
```
Expected: 迁移成功，无报错。

- [ ] **Step 5: 反向校验表结构**

Run（psql 或用脚本）:
```sql
\d permissions
SELECT conname FROM pg_constraint WHERE conrelid = 'permissions'::regclass AND contype = 'c';
```
Expected: `permissions` 表存在 `permissions_type_fields_chk` CHECK；无 `menus`/`consents` 表。

- [ ] **Step 6: Commit**
```bash
git add apps/portal/drizzle/
git commit -m "refactor(portal): 重建 drizzle 迁移 baseline，对齐 v2 schema"
```

---

## Task 5: register 契约补 path/icon/visible

**Files:**
- Modify: `apps/portal/src/app/api/permissions/register/route.ts:13-21`、`:155-200`
- Test: `apps/portal/__tests__/api/permission-api.test.ts`

- [ ] **Step 1: 写失败测试 — PAGE 类型携带 path/icon/visible 持久化**

在 `apps/portal/__tests__/api/permission-api.test.ts` 末尾新增（保留文件原有 mock 与 setup 风格，按现有 `describe` 块模式追加）：
```ts
describe('POST /api/permissions/register — PAGE 字段持久化', () => {
  it('PAGE 类型节点携带 path/icon/visible 时全部落库', async () => {
    // 复用文件顶部已 mock 的 db 与 clients 查询
    (db.select().from().where().limit as any).mockResolvedValueOnce([
      { clientId: 'erp-app', clientSecret: 's3cr3t' },
    ]);
    const insertSpy = vi.fn().mockResolvedValue([]);
    (db.transaction as any).mockImplementation(async (cb: any) => {
      const tx = {
        execute: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockReturnValue({ from: () => ({ where: vi.fn().mockReturnValue([]) }) }),
        insert: vi.fn().mockReturnValue({ values: insertSpy }),
        update: vi.fn().mockReturnValue({ set: () => ({ where: vi.fn().mockResolvedValue([]) }) }),
      };
      return cb(tx);
    });

    const req = new Request('http://localhost/api/permissions/register', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from('erp-app:s3cr3t').toString('base64') },
      body: JSON.stringify({
        permissions: [
          { code: 'erp:orders', name: '订单', type: 'DIRECTORY', sort: 1, children: [
            { code: 'erp:order:list', name: '订单列表', type: 'PAGE',
              path: '/orders', icon: 'orders', visible: true, sort: 1 },
          ]},
        ],
      }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const inserted = insertSpy.mock.calls[0][0];
    expect(inserted.path).toBe('/orders');
    expect(inserted.icon).toBe('orders');
    expect(inserted.visible).toBe(true);
  });
});
```
> 注：按文件现有 mock 写法对齐；若现有文件用不同 helper，照搬其 request 构造方式。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/portal && pnpm vitest run __tests__/api/permission-api.test.ts -t "PAGE 字段持久化"`
Expected: FAIL — `inserted.path` 为 `undefined`（当前契约未透传 path/icon/visible）。

- [ ] **Step 3: 扩展 IncomingPermission 接口**

`apps/portal/src/app/api/permissions/register/route.ts:13-21`，将：
```ts
interface IncomingPermission {
  code: string;
  name: string;
  type: 'DIRECTORY' | 'PAGE' | 'API' | 'DATA';
  resource?: string;
  action?: string;
  sort?: number;
  children?: IncomingPermission[];
}
```
改为：
```ts
interface IncomingPermission {
  code: string;
  name: string;
  type: 'DIRECTORY' | 'PAGE' | 'API' | 'DATA';
  // API/DATA 专属
  resource?: string;
  action?: string;
  // DIRECTORY/PAGE 专属
  path?: string;
  icon?: string;
  visible?: boolean;
  sort?: number;
  children?: IncomingPermission[];
}
```

- [ ] **Step 4: flattenPermissions 透传新字段**

`route.ts:36-44`（push 的对象）改为：
```ts
    list.push({
      code: node.code,
      name: node.name,
      type: node.type,
      resource: node.resource,
      action: node.action,
      path: node.path,
      icon: node.icon,
      visible: node.visible,
      sort: node.sort ?? 0,
      parentId,
    });
```

- [ ] **Step 5: insert/update 写入新字段**

`route.ts:160-172`（insert 的 values）在 `action: p.action ?? null,` 之后追加：
```ts
            path: p.path ?? null,
            icon: p.icon ?? null,
            visible: p.visible ?? null,
```
`route.ts:185-196`（update 的 set）在 `action: p.action ?? null,` 之后追加：
```ts
                path: p.path ?? null,
                icon: p.icon ?? null,
                visible: p.visible ?? null,
```
同时把 `propsChanged` 判定（约 :177-183）追加三项以感知变更：
```ts
          existing.path !== (p.path ?? null) ||
          existing.icon !== (p.icon ?? null) ||
          existing.visible !== (p.visible ?? null) ||
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd apps/portal && pnpm vitest run __tests__/api/permission-api.test.ts`
Expected: PASS（含新用例与原有用例）。

- [ ] **Step 7: Commit**
```bash
git add apps/portal/src/app/api/permissions/register/route.ts apps/portal/__tests__/api/permission-api.test.ts
git commit -m "feat(portal): register 契约补 path/icon/visible，PAGE/DIRECTORY 菜单字段完整可配"
```

---

## Task 6: 修复 seed-rbac.ts（复合主键 + 菜单种子）

**Files:**
- Modify: `apps/portal/scripts/seed-rbac.ts`

- [ ] **Step 1: 修复 seedRole 重复 id 写入**

`apps/portal/scripts/seed-rbac.ts`（seedRole 函数，约 :80-100），将两处 `id`：
```ts
  await db.insert(schema.roles).values({
    id,
    id: crypto.randomUUID(),
    ...
```
改为单次：
```ts
  await db.insert(schema.roles).values({
    id,
    ...
```

- [ ] **Step 2: 修复 bindPermissions 的复合主键插入**

同文件 `bindPermissions` 函数，将：
```ts
  const rows = Object.values(permIds).map(permissionId => ({
    id: crypto.randomUUID(),
    roleId,
    permissionId,
    createdAt: new Date(),
  }));
```
改为（移除已不存在的 `id` 列）：
```ts
  const rows = Object.values(permIds).map(permissionId => ({
    roleId,
    permissionId,
    createdAt: new Date(),
  }));
```

- [ ] **Step 3: 新增 Portal 菜单（PAGE/DIRECTORY）种子函数**

在 `seedPermissions` 函数之后新增：
```ts
/**
 * Portal 自身菜单节点（PAGE/DIRECTORY），数据驱动侧边栏。
 * code 命名空间 `menu:*`，遵循 D-1 全局唯一约定。
 */
const PORTAL_MENUS = [
  { code: 'menu:dashboard',   name: '仪表盘',     type: 'PAGE',      path: '/dashboard',         icon: 'LayoutDashboard', visible: true,  sort: 1 },
  { code: 'menu:system',      name: '系统管理',   type: 'DIRECTORY', path: null,                 icon: 'Settings',        visible: true,  sort: 90 },
  { code: 'menu:users',       name: '用户管理',   type: 'PAGE',      path: '/admin/users',       icon: 'Users',           visible: true,  sort: 10 },
  { code: 'menu:departments', name: '部门管理',   type: 'PAGE',      path: '/admin/departments', icon: 'Network',         visible: true,  sort: 20 },
  { code: 'menu:roles',       name: '角色管理',   type: 'PAGE',      path: '/admin/roles',       icon: 'Shield',          visible: true,  sort: 30 },
  { code: 'menu:permissions', name: '权限管理',   type: 'PAGE',      path: '/admin/permissions', icon: 'Key',             visible: true,  sort: 40 },
  { code: 'menu:clients',     name: '客户端管理', type: 'PAGE',      path: '/admin/clients',     icon: 'AppWindow',       visible: true,  sort: 50 },
  { code: 'menu:audit',       name: '审计日志',   type: 'PAGE',      path: '/admin/audit-logs',  icon: 'ScrollText',      visible: true,  sort: 60 },
] as const;

async function seedPortalMenus(): Promise<string[]> {
  console.log('\n📑 初始化 Portal 菜单节点...');
  const ids: string[] = [];
  for (const m of PORTAL_MENUS) {
    const existing = await db.select({ id: schema.permissions.id })
      .from(schema.permissions)
      .where(eq(schema.permissions.code, m.code));
    let id: string;
    if (existing.length > 0) {
      id = existing[0]!.id;
      process.stdout.write(`  ↩ 已存在: ${m.code}\n`);
    } else {
      id = crypto.randomUUID();
      await db.insert(schema.permissions).values({
        id,
        name: m.name,
        code: m.code,
        type: m.type,
        path: m.path,
        icon: m.icon,
        visible: m.visible,
        sort: m.sort,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      process.stdout.write(`  ✅ 创建菜单: ${m.code}\n`);
    }
    ids.push(id);
  }
  return ids;
}
```

- [ ] **Step 4: 在 main 中调用并绑定到 super_admin**

`main` 函数（约 :150 之后）在 `seedPermissions()` 之后追加：
```ts
  const menuIds = await seedPortalMenus();
```
并在 super_admin 绑定权限处，把菜单 id 一并纳入（与 `permIds` 合并后调用 `bindPermissions`）：
```ts
  const allPermIds = { ...permIds };
  menuIds.forEach((mid, i) => { allPermIds[`__menu_${i}`] = mid; });
  await bindPermissions(superAdminId, allPermIds);
```
> 说明：菜单可见性对 super_admin 全量授予；其他角色的菜单授予由其角色配置决定，沿用既有 `bindPermissions` 机制。

- [ ] **Step 5: 干净库执行 seed 冒烟**

Run（需要可用 DATABASE_URL）:
```bash
cd apps/portal
DATABASE_URL=<本地空库> pnpm tsx scripts/seed-rbac.ts
```
Expected: 控制台输出权限、角色、菜单均创建，无 SQL 错误；二次执行显示 `↩ 已存在`（幂等）。

- [ ] **Step 6: 反向校验**

Run:
```sql
SELECT code, type, path FROM permissions WHERE code LIKE 'menu:%' ORDER BY sort;
SELECT count(*) FROM role_permissions;
```
Expected: 8 条 `menu:*` 节点；role_permissions 含 super_admin 的菜单绑定。

- [ ] **Step 7: Commit**
```bash
git add apps/portal/scripts/seed-rbac.ts
git commit -m "fix(portal): 修复 seed-rbac 复合主键插入并补 Portal 菜单种子"
```

---

## Task 7: 清理文档与文案漂移

**Files:**
- Modify: `docs/spec/USER_STORIES.md`
- Modify: `apps/portal/src/app/(dashboard)/permissions/page.tsx:28`
- Modify: `apps/portal/src/app/(dashboard)/permissions/data.ts`（注释）

- [ ] **Step 1: 修正 USER_STORIES 过期引用**

`docs/spec/USER_STORIES.md`：
- US-B-09 验收标准第 3 条「用户资料包含 `public_id` 而非内部 `id`」改为：
  > 用户资料使用内部 `id`（UUID）作为标识，API 对外不暴露代理 ID。
- US-CROSS-07 验收标准第 4 条「存储到 `role_departments` 关联表」改为：
  > 存储到 `role_data_scopes` 关联表（仅 CUSTOM 数据范围使用）。

- [ ] **Step 2: 修正 permissions 页面文案**

`apps/portal/src/app/(dashboard)/permissions/page.tsx:28`，将：
```
管理系统的功能权限点，支持 API/MENU/DATA 三种类型。
```
改为：
```
管理系统的功能权限点，支持 DIRECTORY/PAGE/API/DATA 四种类型。
```

- [ ] **Step 3: 修正 data.ts 注释**

`apps/portal/src/app/(dashboard)/permissions/data.ts` 中 `getPermissionById` 上方注释「支持内部 ID 和 publicId」改为：
```ts
/**
 * 按 ID 获取单个权限详情（内部 UUID）
 */
```

- [ ] **Step 4: Commit**
```bash
git add docs/spec/USER_STORIES.md apps/portal/src/app/\(dashboard\)/permissions/page.tsx apps/portal/src/app/\(dashboard\)/permissions/data.ts
git commit -m "docs(portal): 清理 public_id/role_departments/MENU 等过期引用"
```

---

## Task 8: 全链路部署冒烟与回归

**Files:** 无新增，仅验证。

- [ ] **Step 1: 重置 dev 库并迁移**

Run:
```bash
cd apps/portal
# 按本地环境重置数据库（drop & create 或 docker-compose 重启 db）
pnpm exec drizzle-kit migrate
```
Expected: 迁移成功。

- [ ] **Step 2: 执行 seed**

Run: `cd apps/portal && DATABASE_URL=<本地库> pnpm tsx scripts/seed-rbac.ts`
Expected: 权限/角色/菜单全部创建，无错误。

- [ ] **Step 3: 类型守卫 + 单测全量**

Run:
```bash
cd apps/portal
pnpm exec tsc --noEmit
pnpm test:api
pnpm test:components
```
Expected: 全绿。

- [ ] **Step 4: Commit（如有 final 调整）**
```bash
git add -A
git commit -m "chore(portal): DB baseline 重建全链路冒烟通过"
```

---

## Task 9（后续依赖，不在本计划实现）：侧边栏数据驱动改造

> 一旦 Task 6 的 PAGE 菜单种子落地，侧边栏前端需从「按 `user:list` 等 API 权限渲染」改为「按用户拥有的 `type=PAGE` 且 `visible=true` 权限渲染」。涉及：
> - `GET /api/me/menus` 读模型改为查询 `permissions where type IN ('DIRECTORY','PAGE') and visible=true and code in (用户角色权限集)`。
> - `src/app/(dashboard)/layout.tsx` 侧边栏改为消费 `/api/me/menus`。
> - 各页面级 API 权限（`user:list` 等）保留为鉴权点，与菜单可见性解耦。
>
> 此为独立前端改造计划，本 DB 计划完成后单独立项。

---

## Self-Review 结论

- **Spec 覆盖**：DBA 审查报告中的 P0（迁移漂移 + seed 失效，Task 4+6）、P1-1（CHECK，Task 3）、P1-2（冗余索引，Task 3）、P1-3（register 契约，Task 5）、P2-1（expiresAt，Task 1）、P2-2（ip inet，Task 2）、文档漂移（Task 7）均有对应任务。D-2 的前端消费侧显式列为 Task 9 后续依赖，避免本计划越界。
- **占位符扫描**：无 TBD/TODO；每个代码步骤含完整代码；Task 5 测试 mock 注释了「按文件现有风格对齐」属合理对齐说明而非占位。
- **类型一致性**：`sanitizeIp`、`IncomingPermission.path/icon/visible`、`PORTAL_MENUS` 在定义与消费处命名一致；CHECK 约束名 `permissions_type_fields_chk` 在 Task 3 定义、Task 4 核验引用一致。
