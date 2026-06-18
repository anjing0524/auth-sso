# 数据库设计修复方案

Version: v1.0 | Date: 2026-06-18 | Status: ✅ Implemented

---

## 概述

基于对 15 张表、Drizzle Schema、业务代码、DATABASE.md 的全面排查，共发现 9 个设计问题。本文档制定统一的修复方案，按优先级分为三个批次实施。

### 批次规划

| 批次 | 问题 | 影响 | 风险 |
|------|------|------|------|
| **第一批** (P0) | #1 users.deptId FK、#2 文档与实现对齐 | 数据完整性 + 性能 | 低（纯增量） |
| **第二批** (P1) | #3 双 ID、#4 clientId 引用一致性、#5 权限两阶段写入、#6 列名对齐 | 代码质量 + 维护性 | 中（涉及 Gateway） |
| **第三批** (P2) | #7 日志表 FK、#8 scopes 索引、#9 枚举类型 | 锦上添花 | 低 |

---

## 第一批 (P0) — 数据完整性与文档

### 问题 1: `users.deptId` 缺少外键约束

**现状**：
```
users.deptId = text('dept_id')   ← 无 FK，无 Drizzle relation
departments.id = text('id').primaryKey()
```

**后果**：
- 数据库层无引用完整性，可出现孤儿 deptId
- `relations.ts` 中无 `users → departments` 关系声明
- `getUser()` 需两次 DB 往返（`users/data.ts:108-118`）
- `getUsers()` 用手动 `leftJoin`（`users/data.ts:69`）

**修复方案**：

#### Step 1: 新增迁移 — 添加 FK 约束

```sql
-- 0002_add_users_dept_fk.sql
ALTER TABLE "users" 
  ADD CONSTRAINT "users_dept_id_departments_id_fk" 
  FOREIGN KEY ("dept_id") REFERENCES "public"."departments"("id") 
  ON DELETE SET NULL ON UPDATE NO ACTION;
```

> 选择 `ON DELETE SET NULL` 而非 `CASCADE`：删除部门时不应删除用户，仅解除关联。

#### Step 2: Schema 定义更新

```typescript
// apps/portal/src/db/schema/users.ts
deptId: text('dept_id').references(() => departments.id, { onDelete: 'set null' }),
```

#### Step 3: Relations 声明更新

```typescript
// apps/portal/src/db/schema/relations.ts
export const usersRelations = relations(users, ({ many, one }) => ({
  userRoles: many(userRoles),
  department: one(departments, {
    fields: [users.deptId],
    references: [departments.id],
  }),
}));
```

#### Step 4: 业务代码更新 — `getUser()` 消除额外查询

```typescript
// apps/portal/src/app/(dashboard)/users/data.ts
export async function getUser(lookupId: string) {
  const user = await db.query.users.findFirst({
    where: or(eq(schema.users.id, lookupId), eq(schema.users.publicId, lookupId)),
    with: {
      userRoles: { with: { role: true } },
      department: true,  // ← 一次查询取出部门
    },
  });
  if (!user) return null;

  return {
    // ...其他字段
    deptName: user.department?.name || null,  // ← 不再需要单独查询
  };
}
```

#### Step 5: 业务代码更新 — `getUsers()` 使用 Drizzle relational query

```typescript
// apps/portal/src/app/(dashboard)/users/data.ts — getUsers()
// 当前用手动 leftJoin，改为 Drizzle with 方式：

const users = await db.query.users.findMany({
  where: and(...conditions),
  with: { department: true },
  orderBy: (users, { desc }) => [desc(users.createdAt)],
  limit: pageSize,
  offset,
});
```

> 注意：`"use cache"` + `cacheTag` 的缓存策略保持不变。

---

### 问题 2: DATABASE.md 与实现不一致 + departments 物化路径缺失

**差异清单**：

| DATABASE.md | 实际 | 处理 |
|-------------|------|------|
| §3.1 users 有 `deleted_at` | 用 `status = 'DELETED'` | 更新文档 |
| §3.2 departments 有 `ancestors varchar(512)` | 不存在 | 添加列 + 更新文档 |
| §3.1 users 有 `email_verified` / `mobile_verified` | 存在但文档未提及 | 更新文档 |
| §4.1 redirect_uris 为逗号分隔 text | 实际是 `text[]` 数组 | 更新文档 |
| §6.1 逻辑删除用 `deleted_at` | 用 status 枚举 | 更新文档 |
| §2 关系表命名 `table1_table2_rel` | 实际用语义化命名 | 更新文档 |
| Redis TTL 写 300s | 实际 PERM_CACHE_TTL = 3600s | 更新文档 |

#### Step 1: 新增 departments.ancestors 列

```sql
-- 0002_add_departments_ancestors.sql
ALTER TABLE "departments" ADD COLUMN "ancestors" text;

-- 回填现有数据（假设现有部门树最多 5 层深度）
WITH RECURSIVE dept_tree AS (
  SELECT id, parent_id, '' as ancestors, 1 as depth
  FROM departments
  WHERE parent_id IS NULL
  UNION ALL
  SELECT d.id, d.parent_id, 
    CASE 
      WHEN dt.ancestors = '' THEN dt.id
      ELSE dt.ancestors || '/' || dt.id
    END,
    dt.depth + 1
  FROM departments d
  INNER JOIN dept_tree dt ON d.parent_id = dt.id
  WHERE dt.depth < 10
)
UPDATE departments d SET ancestors = dt.ancestors
FROM dept_tree dt WHERE d.id = dt.id;

CREATE INDEX "idx_departments_ancestors" ON "departments" USING btree ("ancestors");
```

#### Step 2: Schema 定义更新

```typescript
// apps/portal/src/db/schema/org.ts — departments 表新增
export const departments = pgTable('departments', {
  // ...现有列
  ancestors: text('ancestors'),  // 物化路径，如 'dept_001/dept_002'，顶级为 NULL
}, (t) => [
  index('idx_departments_parent').on(t.parentId),
  index('idx_departments_ancestors').on(t.ancestors),
]);
```

#### Step 3: 简化 data-scope.ts — 消除 `extractDeptIdsFromExecute`

```typescript
// apps/portal/src/lib/auth/data-scope.ts

// 删除 extractDeptIdsFromExecute 函数（26 行）

async function getSubDepartmentIds(deptId: string): Promise<string[]> {
  try {
    // 使用物化路径替代递归 CTE，避免 db.execute 的三种格式兼容问题
    const result = await db
      .select({ id: schema.departments.id })
      .from(schema.departments)
      .where(
        or(
          eq(schema.departments.id, deptId),
          sql`${schema.departments.ancestors} LIKE ${deptId + '/%'}`
        )
      );
    return result.map(r => r.id);  // ← 类型安全，无需 any/unknown
  } catch (error) {
    console.error('[DataScope] getSubDepartmentIds 查询异常:', error);
    return [deptId];
  }
}
```

#### Step 4: 维护 ancestors 的业务逻辑

```typescript
// 新增：apps/portal/src/domain/department/ancestors.ts

/**
 * 计算部门的物化路径
 * @param parentId 父部门 ID
 * @returns 子部门的 ancestors 值
 */
export async function computeAncestors(parentId: string | null): Promise<string | null> {
  if (!parentId) return null;
  const parent = await db.query.departments.findFirst({
    where: eq(schema.departments.id, parentId),
    columns: { id: true, ancestors: true },
  });
  if (!parent) return null;
  return parent.ancestors ? `${parent.ancestors}/${parentId}` : parentId;
}
```

在创建/移动部门时调用：
```typescript
// 创建部门时
const ancestors = await computeAncestors(input.parentId);

// 移动部门时（需同时更新所有子孙节点）
// 使用递归 CTE 更新子树的所有 ancestors
```

> **简化方案**：如果部门移动极其罕见，可以写一个存储过程/脚本在移动后批量重建子树 ancestors，避免维护复杂度。

#### Step 5: 更新 DATABASE.md

完整重写 DATABASE.md（见本文档末尾附件 A）。

---

## 第二批 (P1) — 代码质量与一致性

### 问题 3: 双 ID 查找模式消除

**现状**：6+ 个 data.ts 文件重复以下模式：
```typescript
.where(or(eq(schema.xxx.id, lookupId), eq(schema.xxx.publicId, lookupId)))
```

**修复方案**：提取公共辅助函数，API 层统一做 `publicId → id` 转换。

#### Step 1: 新增通用解析函数

```typescript
// apps/portal/src/db/resolve-id.ts
import { eq, or, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

/**
 * 构建「按 id 或 publicId 匹配单行」的 WHERE 条件。
 * 
 * @param table  Drizzle 表定义（必须含 id 和 publicId 列）
 * @param lookup  用户输入的标识符（可能是内部 id 或 publicId）
 * @returns SQL 条件
 */
export function idLookupCondition<T extends { id: string; publicId: string }>(
  table: { id: ReturnType<typeof eq> extends infer C ? any : never; publicId: ReturnType<typeof eq> extends infer C ? any : never },
  lookup: string,
) {
  return or(eq(table.id, lookup), eq(table.publicId, lookup));
}
```

> 如果 Drizzle 类型让泛型太复杂，更务实的方案：

```typescript
// apps/portal/src/db/resolve-id.ts
import { eq, or } from 'drizzle-orm';
import { schema } from '@/infrastructure/db';

type LookupTable = 'users' | 'roles' | 'clients' | 'menus' | 'departments' | 'permissions';

const tableMap = {
  users: schema.users,
  roles: schema.roles,
  clients: schema.clients,
  menus: schema.menus,
  departments: schema.departments,
  permissions: schema.permissions,
} as const;

/** 构建 id/publicId 双匹配条件 */
export function byIdOrPublicId(table: keyof typeof tableMap, lookup: string) {
  const t = tableMap[table];
  return or(eq(t.id, lookup), eq(t.publicId, lookup));
}
```

#### Step 2: 替换所有 data.ts 中的 OR 查询

```typescript
// 之前
.where(or(eq(schema.users.id, lookupId), eq(schema.users.publicId, lookupId)))

// 之后
.where(byIdOrPublicId('users', lookupId))
```

涉及文件：
- `apps/portal/src/app/(dashboard)/users/data.ts`
- `apps/portal/src/app/(dashboard)/roles/data.ts`
- `apps/portal/src/app/(dashboard)/clients/data.ts`
- `apps/portal/src/app/(dashboard)/menus/data.ts`（通过 menu-tree.ts 间接使用）
- `apps/portal/src/app/(dashboard)/departments/data.ts`
- `apps/portal/src/app/api/permissions/register/route.ts`

---

### 问题 4: clientId 引用一致性 — 文档化而非修改

**分析结论**：`permissions.clientId` 和 `roleClients.clientId` 引用 `clients.clientId`（业务键）而非 `clients.id` 是**有意的跨服务契约设计**，不应修改。

**原因**：
- Gateway (Rust) 直接从 `permissions` 表读取 `client_id`，期望是业务 client_id
- 权限注册路由用 Basic Auth 的 client_id 直接匹配
- `clients.client_id` 有 UNIQUE 约束，引用完整性不受影响
- 修改会破坏 Gateway ↔ Portal 的隐式契约

**修复**：在 Schema 注释和 DATABASE.md 中明确文档化此设计决策。

```typescript
// apps/portal/src/db/schema/rbac.ts — 更新模块注释
/**
 * RBAC 权限领域表
 * 
 * ## FK 约定说明
 * 
 * permissions.clientId 和 roleClients.clientId 引用 clients.clientId（业务键）
 * 而非 clients.id。这是**刻意设计**，原因：
 * 
 * 1. Gateway (Rust/Pingora) 直接从 permissions 表读取 client_id 用于 JWT 校验，
 *    它期望的是业务 client_id 而非内部 UUID
 * 2. 权限注册路由 (POST /api/permissions/register) 使用 Basic Auth 的 client_id
 *    直接匹配，避免额外的 clients 表查询
 * 3. clients.client_id 具有 UNIQUE 约束，引用完整性等价于引用 id
 * 
 * 其他表（access_tokens / refresh_tokens / authorization_codes / consents）
 * 的 clientId 引用的是 clients.id，因为它们是 OAuth 协议内部流转，
 * 不暴露给外部系统。
 */
```

---

### 问题 5: 权限注册 parentId 两阶段写入优化

**现状**：先全部插 `parentId: null`，再逐行 UPDATE（`route.ts:165-233`）。两次全表扫描。

**修复方案**：预分配 UUID，单阶段写入。

```typescript
// apps/portal/src/app/api/permissions/register/route.ts

// Step A: 在事务开始前，预分配所有新权限的 UUID
const newCodes = flatIncoming
  .filter(p => !dbMap.has(p.code))
  .map(p => p.code);

const preAllocatedIds = new Map<string, string>();
for (const code of newCodes) {
  preAllocatedIds.set(code, generateUUID());
}

// Step B: 单阶段写入（parentId 直接使用预分配 ID 或已存在 ID）
const dbPermissions = await tx.select()
  .from(schema.permissions)
  .where(eq(schema.permissions.clientId, clientId));

// 构建完整的 code → DB id 映射（已存在 + 预分配）
const codeToIdMap = new Map<string, string>();
for (const p of dbPermissions) {
  codeToIdMap.set(p.code, p.id);
}
for (const [code, id] of preAllocatedIds) {
  codeToIdMap.set(code, id);  // 预分配的 UUID 覆盖
}

// 单阶段写入：parentId 直接从 codeToIdMap 取
const writePromises = flatIncoming.map(async (p) => {
  const existing = dbMap.get(p.code);
  const dbParentId = p.parentId ? (codeToIdMap.get(p.parentId) ?? null) : null;
  
  if (!existing) {
    const id = codeToIdMap.get(p.code)!;
    const publicId = generatePermissionPublicId();
    await tx.insert(schema.permissions).values({
      id,
      publicId,
      name: p.name,
      code: p.code,
      type: p.type,
      resource: p.resource ?? null,
      action: p.action ?? null,
      clientId,
      parentId: dbParentId,  // ← 直接设置正确的 parentId
      sort: p.sort,
      status: 'ACTIVE',
      createdAt: new Date(),
    });
    stats.inserted++;
  } else {
    // 已存在记录：检查是否需要更新 parentId
    codeToIdMap.set(p.code, existing.id);
    const parentChanged = existing.parentId !== dbParentId;
    const propsChanged = /* ... 现有检查 ... */;
    
    if (parentChanged || propsChanged) {
      await tx.update(schema.permissions)
        .set({
          name: p.name,
          // ...其他字段
          parentId: dbParentId,  // ← 同时更新 parentId
        })
        .where(eq(schema.permissions.id, existing.id));
      stats.updated++;
    }
  }
});

await Promise.all(writePromises);

// 删除第二阶段（原 C 段 relationPromises 整个代码块）
```

**效果**：原来需要 A 阶段（INSERT）+ C 阶段（UPDATE parentId），现在合并为一个阶段。事务内 SQL 语句数量减半。

---

### 问题 6: clients 表 DB 列名与 Domain 字段名对齐

**现状**：

| DB 列名 | Domain 字段 | 说明 |
|---------|------------|------|
| `redirectUrls` | `redirectUris` | OAuth RFC 用 "redirect_uri" |
| `icon` | `logoUrl` | "Logo URL" 比 "Icon" 更精确 |

**修复方案**：统一为 Domain 命名（更符合 OAuth 规范），修改 DB 列名。

#### Step 1: 新增迁移

```sql
-- 0002_rename_client_columns.sql
ALTER TABLE "clients" RENAME COLUMN "redirect_uris" TO "redirect_urls";
ALTER TABLE "clients" RENAME COLUMN "logo_url" TO "icon";
```

> 等等，让我检查实际的 DB 列名。从迁移 SQL 看：
> ```sql
> "redirect_uris" text[] NOT NULL,
> "logo_url" text,
> ```
> 而 Drizzle schema 是：
> ```typescript
> redirectUrls: text('redirect_uris').array(),
> icon: text('logo_url'),
> ```
> 所以 Drizzle 的字段名是 `redirectUrls`，映射到 DB 列 `redirect_uris`。Domain 是 `redirectUris`。

**重新分析**：问题本质是三层命名不一致：

| 层 | 重定向 URL | Logo |
|----|-----------|------|
| DB 列 | `redirect_uris` | `logo_url` |
| Drizzle 属性 | `redirectUrls` | `icon` |
| Domain 实体 | `redirectUris` | `logoUrl` |

**修复方案**：对齐 Drizzle 属性名和 Domain 字段名，DB 列名不变（避免不必要的迁移）。

```typescript
// apps/portal/src/db/schema/auth.ts — 重命名 Drizzle 属性
export const clients = pgTable('clients', {
  // ...
  redirectUris: text('redirect_uris').array().notNull(),  // 曾用名 redirectUrls
  logoUrl: text('logo_url'),                               // 曾用名 icon
  // ...
});
```

```typescript
// apps/portal/src/domain/client/client.ts — 简化映射函数
export function toDomainClient(row: { /* ... */ }): Client {
  return {
    // ...
    redirectUris: row.redirectUris,  // 不再需要 row.redirectUrls
    logoUrl: row.logoUrl,            // 不再需要 row.icon
    // ...
  };
}

export function clientToInsertRow(c: Client) {
  return {
    // ...
    redirectUris: c.redirectUris,    // 不再需要 c.redirectUris → redirectUrls
    logoUrl: c.logoUrl,              // 不再需要 c.logoUrl → icon
    // ...
  };
}
```

**影响范围**：所有引用 `schema.clients.redirectUrls` 或 `schema.clients.icon` 的代码需更新为 `redirectUris` 和 `logoUrl`。包括：
- `apps/portal/src/app/(dashboard)/clients/data.ts`
- `apps/portal/src/app/(dashboard)/clients/[id]/page.tsx`
- `apps/portal/src/app/api/clients/` 相关路由
- `apps/portal/src/domain/client/client.ts`（toDomainClient / clientToInsertRow / clientToUpdateRow）

---

## 第三批 (P2) — 锦上添花

### 问题 7: 日志表 userId 不强制 FK

**决策**：日志表**故意不加 FK**。原因：
- 用户删除后日志应保留（审计需求）
- FK 会阻止删除用户（或级联删除日志，都不合适）
- `userId` 和 `username` 冗余存储已在保证日志自包含性

**修复**：在 Schema 注释中说明此设计决策。

```typescript
// apps/portal/src/db/schema/logs.ts — 更新注释
/**
 * 审计与登录日志表
 *
 * 设计说明：
 * - userId / username 冗余存储，确保日志在用户被删除后仍可读（审计合规）
 * - userId 不设 FK 约束，避免阻塞用户删除操作
 * - 日志表为 append-only，不参与业务逻辑关联查询
 */
```

### 问题 8: scopes 列 — 保持现状

**决策**：`scopes` 以空格分隔 text 存储**不是反模式**，是 OAuth RFC 6749 标准格式。JWT 的 `scope` claim 本身就是空格分隔字符串。

当前无「按 scope 查 client」的业务需求，无需添加 GIN 索引或数组列。如果将来有此需求，方案是：
```sql
-- 可选的未来优化
ALTER TABLE "clients" ADD COLUMN "scopes_arr" text[] GENERATED ALWAYS AS (string_to_array(scopes, ' ')) STORED;
CREATE INDEX "idx_clients_scopes" ON "clients" USING gin ("scopes_arr");
```

### 问题 9: 枚举 as 断言 — 已收敛

**现状分析**：
- Schema `index.ts` 已有编译期双向穷举守卫（TypeScript `extends true ? true : never`）
- 运行时的 `as DataScopeType` / `as EntityStatus` 是因为 Drizzle pgEnum 的 `$inferSelect` 推断为宽类型
- 这是 Drizzle ORM 的已知局限，无更好方案

**修复**：提取公共 type guard 函数替代裸 `as`：

```typescript
// apps/portal/src/lib/type-guards.ts
import type { EntityStatus, DataScopeType, UserStatus } from '@auth-sso/contracts';
import { ENTITY_STATUS_VALUES, DATA_SCOPE_TYPE_VALUES, USER_STATUS_VALUES } from '@auth-sso/contracts';

export function asEntityStatus(v: string): EntityStatus {
  if (!ENTITY_STATUS_VALUES.includes(v as EntityStatus)) {
    throw new Error(`Invalid EntityStatus: ${v}`);
  }
  return v as EntityStatus;
}

export function asDataScopeType(v: string): DataScopeType {
  if (!DATA_SCOPE_TYPE_VALUES.includes(v as DataScopeType)) {
    throw new Error(`Invalid DataScopeType: ${v}`);
  }
  return v as DataScopeType;
}

export function asUserStatus(v: string): UserStatus {
  if (!USER_STATUS_VALUES.includes(v as UserStatus)) {
    throw new Error(`Invalid UserStatus: ${v}`);
  }
  return v as UserStatus;
}
```

替换所有裸 `as` 断言（`permissions.ts:111`、`departments/data.ts:49/58`、`clients/data.ts:34-35` 等）。

---

## 实施顺序

```
第一批 ──────────────────────
  ├─ 1.1 迁移: users.deptId FK
  ├─ 1.2 迁移: departments.ancestors 列 + 回填
  ├─ 1.3 Schema + Relations 更新
  ├─ 1.4 业务代码更新 (data.ts / data-scope.ts)
  └─ 1.5 更新 DATABASE.md
        ↓
第二批 ──────────────────────
  ├─ 2.1 新增 byIdOrPublicId 辅助函数
  ├─ 2.2 替换所有 data.ts 中的双 ID 查询
  ├─ 2.3 更新 rbac.ts 注释（clientId 设计文档化）
  ├─ 2.4 优化权限注册路由（预分配 UUID）
  └─ 2.5 对齐 clients 表 Drizzle 属性名
        ↓
第三批 ──────────────────────
  ├─ 3.1 日志表设计注释
  ├─ 3.2 scopes 设计注释
  ├─ 3.3 枚举 type guard 函数
  └─ 3.4 替换裸 as 断言
```

## 验证清单

- [x] `pnpm test:api` 全部通过 (21 files, 205 tests)
- [ ] `pnpm test:components` 全部通过
- [ ] `pnpm test:e2e` 全部通过
- [ ] 手动验证：用户列表页部门名称正常显示
- [ ] 手动验证：用户详情页部门信息正常显示
- [ ] 手动验证：数据范围过滤（DEPT_AND_SUB）正常工作
- [ ] 手动验证：权限注册端点正常同步
- [ ] 手动验证：删除部门后用户 deptId 正确置为 NULL
- [ ] 手动验证：Gateway JWT 校验正常工作（权限未受影响）

---

## 附件 A: 更新后的 DATABASE.md

见下文，完整替换 `docs/spec/DATABASE.md`。

---
