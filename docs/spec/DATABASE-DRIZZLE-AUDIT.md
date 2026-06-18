# Drizzle Schema & ORM 实现审查报告

> 审查目标：`apps/portal/src/` 下所有 Drizzle schema 设计与 ORM 调用，对照 Drizzle 官方最佳实践，定位偏离项。
> 版本基线：`drizzle-orm@^0.45.2` / `drizzle-kit@^0.31.10`
> 审查日期：2026-06-17
> 整改完成：2026-06-18
> 关联文档：[DATABASE.md](./DATABASE.md)（设计规约）、[portal-architecture-guidelines.md](../portal-architecture-guidelines.md)

## 审查结论概览

| # | 议题 | 严重度 | 状态 |
|---|---|---|---|
| 1 | Schema 单文件未拆分（独立表应单独 schema） | 中 | ✅ 已整改 |
| 2 | 数组/JSON 字段类型错误（text 替代 array/jsonb） | 高 | ✅ 已整改（scopes 保留 text，见说明） |
| 3 | 未启用 Relations API（手写 join） | 中 | ✅ 已整改 |
| 4 | 关联表 FK 与高频过滤列缺索引 | 高 | ✅ 已整改 |
| 5 | clientId 外键引用列不一致 | 中 | ⚠️ 保留（刻意例外，见说明） |
| 6 | updatedAt 缺自动更新钩子（DRY 违规） | 中 | ✅ 已整改 |
| 7 | count / SELECT * / enum 断言 等次要项 | 低 | ✅ count 已整改 |

### 整改验证
- `npx tsc --noEmit`：drizzle 相关 0 新增错误（剩余 23 个为预存在的 Next.js 16 `revalidatePath/revalidateTag` 签名 + sidebar + login status 枚举推断问题，与本次无关）。
- `pnpm test:portal`：204/205 通过；唯一失败在未跟踪新文件 `src/lib/auth/token.ts` 的 kid 验签逻辑，与 drizzle 改动无关（该测试 mock 了整个 `@/infrastructure/db`）。
- `pnpm db:generate`：生成干净 migration `drizzle/0000_graceful_lady_mastermind.sql`，17 表 / 索引齐全 / `redirect_uris text[]` / `params jsonb` / 新 enum 齐备。

### 关键决策说明
- **scopes 保留 text**：OAuth `scope` 在 RFC 6749 / JWT `scope` claim 中本就是空格分隔字符串，`text` 是正确语义而非反模式。原审查第 2 项对此判断有误，已纠正。
- **P1-1 clientId 保留**：`permissions.clientId` / `roleClients.clientId` 存储业务 client_id（被 gateway 与权限注册路由直接消费），FK 指向 `clients.clientId`（unique）在 PG/Drizzle 中完全合法。改为引用 `clients.id` 会改变存储语义并破坏外部契约，故作为 DATABASE.md §2 的刻意例外保留。

---

## 1. Schema 拆分（独立表应单独 schema）

**现状**：`src/db/schema.ts` 单文件 300 行，包含 14 张表 + 5 个 pgEnum + 30 行类型守卫。

**官方最佳实践**：按领域拆分到目录，barrel 聚合。

```
src/db/schema/
├── index.ts        // barrel：export * from './xxx'
├── enums.ts        // userStatusEnum 等 5 个
├── users.ts        // users + userRoles
├── auth.ts         // clients / authorizationCodes / accessTokens / refreshTokens / consents / jwks
├── rbac.ts         // roles / permissions / rolePermissions / roleDataScopes / roleClients
├── org.ts          // departments / menus
└── logs.ts         // auditLogs / loginLogs
```

**配套**：`drizzle.config.ts` 的 `schema` 由 `'./src/db/schema.ts'` 改为 glob `'./src/db/schema/*.ts'`，drizzle-kit 自动聚合。

---

## 2. 字段类型偏离（最关键）

| 位置 | 现状 | 官方推荐 | 证据 |
|---|---|---|---|
| `clients.redirectUrls` | `text` 存数组，靠 `parseRedirectUris` 手写 `JSON.parse`/`split` 兜底 | `text('redirect_uris').array().notNull()` | `domain/client/client.ts:10` |
| `clients.scopes` / `accessTokens.scopes` / `refreshTokens.scopes` / `consents.scopes` | `text` | `text('scopes').array().notNull()` | `db/schema.ts:61,94,106,119` |
| `auditLogs.params` | `text` 存 JSON | `jsonb('params').$type<Record<string,unknown>>()` | `db/schema.ts:217` |
| `auditLogs.status` `integer` / `loginLogs.eventType` `text` | 裸值 | pgEnum 或 const 约束 | `db/schema.ts:220,230` |
| `jwks.algorithm` `.default('ES256')` / `codeChallengeMethod` `.default('S256')` | 裸 text 默认值 | pgEnum 或 `$type<Alg>()` | `db/schema.ts:82,129` |

---

## 3. 未使用 Relations API

**现状**：grep `relations(` = 0 命中。所有关联查询手写 `innerJoin`/`leftJoin`（`roles/data.ts` 5 处、`users/data.ts` 4 处、`permissions.ts` 2 处等）。

**官方做法**：在 schema 中声明 `relations()`，启用 `db.query.roles.findMany({ with: { permissions: true } })` 声明式关系查询。`infrastructure/db/index.ts` 已传 `{ schema }`，但因无 relations 声明，Relational Queries API 不可用。

---

## 4. 缺少索引

**现状**：schema 中 `index(` 命中数 = 0。以下列需补索引：

- 关联表 FK：`userRoles.{userId,roleId}`、`rolePermissions.{roleId,permissionId}`、`roleDataScopes.{roleId,deptId}`、`roleClients.roleId`
- `users.status`、`users.deptId`（data scope 高频过滤）
- `auditLogs.userId`、`auditLogs.createdAt`（分页 + 审计查询）

**官方写法**：`index('idx_xxx').on(table.col)`，必要时复合索引。

---

## 5. 外键引用不一致

DATABASE.md §2 规定「FK 一律引用 internal `id`」，但实现不一致：

- `authorizationCodes/​accessTokens/​refreshTokens/​consents.clientId` → `clients.id`（PK）✅
- `permissions.clientId`、`roleClients.clientId` → `clients.clientId`（业务标识，非 PK）⚠️

**建议**：统一指向 `clients.id`。

---

## 6. updatedAt 自动更新

**现状**：所有表 `updatedAt` 靠应用层每次 update 手写 `updatedAt: new Date()`（`role.ts:103/115`、`token.ts` 等数十处），易遗漏。

**官方做法**：
```ts
updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date())
```

---

## 7. 次要项（待评估）

1. **count**：`db.select({ count: sql\`COUNT(*)::int\` })` → 用 `count()` from `drizzle-orm`。
2. **SELECT \***：`getActiveSigningKey`、`getRoles`、`getRoleById` 等显式列选择。
3. **enum 双重断言**：`pgEnum('...', VALUES as unknown as [string, ...string[]])` 削弱编译期校验，考虑 codegen 或字面量 tuple。
4. **主键**：全 `text` + 应用层 `generateId`，可接受；官方示例倾向 `crypto.randomUUID()`。

---

## 整改实施记录（2026-06-18）

### 1. Schema 拆分 ✅
`src/db/schema.ts`（300 行单文件）→ `src/db/schema/` 目录：
- `enums.ts` — 7 个 pgEnum（新增 `jwk_algorithm`、`code_challenge_method`）
- `helpers.ts` — `updatedAtColumn()` 共享列构造器（独立模块，避免循环初始化）
- `users.ts` / `auth.ts` / `rbac.ts` / `org.ts` / `logs.ts` — 按领域拆分
- `relations.ts` — Relations API 声明
- `index.ts` — barrel 聚合 + 类型守卫
- `drizzle.config.ts` → `schema: './src/db/schema/*.ts'`（glob 自动发现）

### 2. 字段类型 ✅
- `clients.redirectUrls`：`text` → `text[].notNull()`（PG 原生数组，移除手写 `parseRedirectUris`/`JSON.stringify`，删除孤立模块 `domain/shared/parse-redirect-uris.ts`）
- `auditLogs.params`：`text` → `jsonb().$type<AuditParams>()`
- `authorizationCodes.codeChallengeMethod`：`text` → `codeChallengeMethodEnum`
- `jwks.algorithm`：`text` → `jwkAlgorithmEnum`
- `scopes`：**保留 text**（OAuth 空格分隔约定，见上方决策说明）

### 3. Relations API ✅
新增 `relations.ts`，声明 users/roles/permissions/clients/departments/menus 的关联，启用 `db.query.*` 声明式关系查询。

### 4. 索引 ✅
为所有关联表 FK（userRoles / rolePermissions / roleDataScopes / roleClients / accessTokens / refreshTokens / consents）及高频过滤列（users.status / users.deptId / auditLogs.userId / auditLogs.createdAt / loginLogs.* / permissions.clientId / permissions.parentId / 父子树形 parentId）添加 btree 索引。

### 5. updatedAt 自动钩子 ✅
所有表 `updatedAt` 改用 `updatedAtColumn()`（`defaultNow()` + `$onUpdate(() => new Date())`），**移除 19 处**应用层手动 `updatedAt: new Date()` 赋值（domain 行构建器 + register/menus/users/clients 内联 `.set()`）。

### 6. count 收敛 ✅
8 处 `db.select({ count: sql\`COUNT(*)::int\` })` → `db.select({ count: count() })`（drizzle-orm 官方 helper）。

### 7. pgTable config 现代化 ✅
所有带索引的表改用 drizzle-orm 0.45 的**数组式** config `(t) => [...]`，替代已废弃的对象式 `(t) => ({...})`。

