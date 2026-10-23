# Auth-SSO 架构约束指南 (Architecture Constraints Guide)

**版本**: v1.2 · **状态**: 正式生效 · **最后更新**: 2026-10-23

> 本文档定义了 Auth-SSO 项目所有代码贡献者**必须遵守**的架构约束。每条约束具有**一票否决权 (One-Vote Veto)**——违反任意一条的 PR 不得合并。本文档是 Code Review 与质量门禁的核心依据。
>
> **v1.2 变更（2026-10-23 文档校正，以代码为准）**：R7 改用 `lib/authz` 门面（`getUserRoleDeptIds`/`canAccessDept` 已撤下，ADR-014）；R8 的 Layout 层改为 `<PermissionGate>` 装载、补 `requirePermission` 真实返回；R9 时间转换收口到 `domain/shared/time.ts`；R13 补 domain 层白名单实测；R11/R14/骨架模板改用 `validate()` 与 `withAuth`/`withPermission` 真实签名（`mapServerError` 统一映射，Controller 不写 try/catch）；§五 重写为 `proxy.ts` 实际职责（同源校验 403 + 白名单 `/oauth/error`）；§三「多层 layout」条目改写为 `PermissionGate` 与外壳单点包裹；红线表补 #14/#15。

---

## 一、核心约束 (Core Rules)

### R1. Controller 零业务逻辑（不设行数上限）

Server Action 与 Route Handler 只做编排：Zod 校验 → 调领域函数 → DB 写入 → 响应。Controller 内**严禁出现** if/else 业务分支、状态判定、字段合并、或默认值赋值。

**不设行数上限**——行数不是复杂度的好代理（实测 22 个 action 最大圈复杂度仅 8，长度来自声明式配置与多行参数）。复杂度由 lint 强制：`complexity ≤ 15`、`max-depth ≤ 4`。见 ADR-019。

```typescript
// ❌ 错误：Controller 内嵌业务逻辑
export const createUserAction = withAuth(..., async (ctx, input) => {
  if (input.status === 'ACTIVE' && input.deptId === 'ALL') {
    input.deptId = null; // 领域层该做的事
  }
  // ...
});

// ✅ 正确：只做编排，业务逻辑在 domain/user/user.ts
export const createUserAction = withAuth(..., async (ctx, input) => {
  const parsed = CreateUserInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'VALIDATION_ERROR', message: ... };

  const result = await db.transaction(async (tx) => {
    const existing = await tx.query.users.findFirst({ where: ... });
    if (existing) throw new DuplicateEntityError('User', 'username/email');
    const user = createUser(parsed.data, generateUUID);
    await tx.insert(schema.users).values({ ...userToInsertRow(user), passwordHash });
    return user;
  });

  revalidatePath('/users');
  return { success: true, data: { id: result.id } };
});
```

### R2. 统一错误映射

Controller 的 catch 块**必须**使用 `mapDomainError(err)`，**严禁**手写 `if (err instanceof XxxError)` 链。

```typescript
// ❌ 错误：手写 instanceof 分支
catch (err) {
  if (err instanceof EntityNotFoundError) return { status: 404 };
  if (err instanceof DuplicateEntityError) return { status: 409 };
  return { status: 500 };
}

// ✅ 正确：委托 mapDomainError
catch (err) {
  const mapped = mapDomainError(err);
  return NextResponse.json({ error: mapped.error, message: mapped.message }, { status: mapped.status });
}
```

### R3. 事务包裹多表/多行写入

所有涉及多表或多行的写操作**必须**使用 `db.transaction()`。**严禁**循环调用单行 `db.update()`。

```typescript
// ❌ 错误：循环逐行更新
for (const id of ids) {
  await db.update(schema.users).set({ status }).where(eq(schema.users.id, id));
}

// ✅ 正确：事务包裹
await db.transaction(async (tx) => {
  const row = await tx.query.users.findFirst({ where: eq(schema.users.id, id) });
  if (!row) throw new EntityNotFoundError('User', id);
  const updated = applyUserUpdate(toDomainUser(row), patch);
  await tx.update(schema.users).set(userToUpdateRow(updated)).where(eq(schema.users.id, id));
});
```

### R4. 枚举单一真相源

所有枚举值数组**仅在** `@auth-sso/contracts` 中定义。Zod `z.enum()` 和 Drizzle `pgEnum()` **必须**从同一源数组派生。

```typescript
// packages/contracts/src/index.ts —— 唯一真相源
export const USER_STATUS_VALUES = ['ACTIVE', 'DISABLED', 'LOCKED', 'DELETED'] as const;

// domain/shared/zod-schemas.ts —— Zod 派生
export const userStatusEnum = z.enum(USER_STATUS_VALUES);  // ✅

// db/schema/enums.ts —— Drizzle 派生
export const userStatusEnum = pgEnum('user_status', USER_STATUS_VALUES);  // ✅

// ❌ 错误：另起炉灶定义
export const userStatusEnum = pgEnum('user_status', ['ACTIVE', 'DISABLED']);  // 缺少 LOCKED/DELETED
```

### R5. 领域实体为纯 TypeScript interface

领域实体使用纯 `interface`，**不是** Zod Schema。Zod Schema 仅用于输入校验。

```typescript
// domain/user/types.ts —— ✅ 纯 interface
export interface User {
  id: string;
  status: UserStatus;
  deptId: string | null;
  createdAt: Temporal.Instant;
}

// domain/user/types.ts —— Zod 仅用于输入校验
export const CreateUserInputSchema = z.object({
  name: z.string().min(1),
  username: z.string().min(3),
});
```

> **关于 domain/auth/types.ts**：`PortalJwtClaims` 接口扩展了 `jose` 的 `JWTPayload` 类型。`jose` 是 domain 层允许的少数外部依赖之一（与 `bcryptjs` 同属白名单），因为 JWT 类型定义是领域模型的核心组成部分。

### R6. DB 行转换函数

每个聚合根**必须**提供 `xxxToInsertRow` / `xxxToUpdateRow` 函数。Controller **严禁**手写列名映射。

```typescript
// domain/user/user.ts —— ✅ 统一定义
export function userToInsertRow(u: User) {
  return {
    id: u.id, username: u.username, status: u.status,
    deletedAt: u.deletedAt ? new Date(u.deletedAt.epochMilliseconds) : null,
    createdAt: new Date(u.createdAt.epochMilliseconds),
  };
}

// Controller —— ✅ 调用转换函数
await tx.insert(schema.users).values({ ...userToInsertRow(user), passwordHash });
```

### R7. 角色部门数据范围过滤

所有读取路径**必须**基于用户角色的所属部门进行数据范围过滤。**严禁**在各 `data.ts` 中手写 dept_id 判断或遗漏过滤。

数据访问公式：**权限 × 角色部门交集**。用户能看到哪些数据 = 其所有角色的权限并集 ∩ 其所有角色所属部门（含子部门）的数据。

```typescript
// ✅ 正确的数据范围过滤（读路径，lib/authz 门面，ADR-014）
import { resolveScope, isScopeDenied, scopeFilter } from '@/lib/authz';

const scope = await resolveScope(db, userId);          // UserScope { deptIds }，已展开子树
if (isScopeDenied(scope)) return { data: [], pagination: { total: 0 } };  // 无角色 → 无数据
conditions.push(scopeFilter(scope, schema.users.deptId));  // 空范围恒 FALSE，绝不退化为不过滤
```

**两步计算逻辑**（封装在 `lib/authz/data-scope.ts` 的**私有** `expandRoleDeptSubtrees` 中，经 `resolveScope` 对外）：
1. 收集用户所有 **ACTIVE** 角色的 `dept_id`（通过 `user_roles` → `roles.dept_id`）
2. 对每个 `dept_id`，展开子树（`ancestors` 物化路径，**五条分支缺一不可**：自身 / `ancestors = deptId` / `LIKE 'deptId/%'` / `LIKE '%/deptId'` / `LIKE '%/deptId/%'`）
3. 去重后返回部门 ID 数组

> ⚠️ `getUserRoleDeptIds` / `canAccessDept` / `requireDeptAccess` **已从公开面撤下**（`lib/auth/index.ts`、`lib/authz/data-scope.ts`）：范围快照必须与使用绑定同一执行器，否则出现"事务外取快照、事务内复用"的 TOCTOU。写路径只能用 `withScopedWrite` / `withScopedRow`（`lib/authz/write.ts`）。

**用户分配角色约束**：角色必须属于该用户部门且为 `ACTIVE`；范围快照与写入同一事务（`withScopedWrite` / `withScopedRow`）。唯一写路径是 `lib/user-role-assignment.ts`（REST 路由与 Server Action 两个适配器共用，见该文件模块文档）。

### R8. 三层鉴权体系

| 层 | 位置 | 机制 |
|---|---|---|
| Layout | `(dashboard)/<route>/layout.tsx` | 只声明权限码（`ROUTE_ACCESS`），守卫由 `<PermissionGate>` 装载（内部 `connection()` + `requirePermission` + `<Forbidden/>`） |
| Server Action | actions.ts | `withAuth` HOF 包裹 → `checkPermission` + `mapServerError` |
| API Route | route.ts | `withPermission` 包装器 → 同样走 `checkPermission` + `mapServerError` |

```typescript
// Layout —— 声明式：layout 不自己 await requirePermission，交给 PermissionGate
// app/(dashboard)/users/layout.tsx
export default function UsersLayout({ children }: { children: React.ReactNode }) {
  return <PermissionGate options={ROUTE_ACCESS['/users']}>{children}</PermissionGate>;
}

// Server Action —— withAuth（第一个形参 ctx: AuthContext = { userId }）
export const createUserAction = withAuth(
  { permissions: [USER_PERMISSIONS.CREATE], audit: 'USER_CREATE' },
  async (ctx: AuthContext, input: CreateUserInput) => { /* ... */ },
);

// API Route —— withPermission（handler 形参是 userId: string，返回 NextResponse）
export async function GET(request: NextRequest) {
  return withPermission({ permissions: [ROLE_PERMISSIONS.LIST] }, async (userId) => {
    const result = await getRoles(scope, params);
    return restListSuccess(result.data, result.pagination);
  });
}
```

> **`requirePermission` 的真实返回**：`Promise<{ userId: string } | null>`（`React.cache()` 包裹），不是 `await requirePermission(...)` 后无事发生——必须判定返回值。`PermissionGate` 是它的唯一装载点（`components/layout/permission-gate.tsx`）。

### R9. Temporal API

领域实体时间字段使用 `Temporal.Instant`。取"现在"用 `Temporal.Now.instant()`；`new Date()` **仅限** DB 边界（`domain/shared/time.ts` 的 `dateFromInstant` 内部，即 `xxxToInsertRow` / `xxxToUpdateRow` / `xxxFromPersistence` 调用处）。

```typescript
// domain/user/types.ts —— ✅ Temporal.Instant
export interface User {
  createdAt: Temporal.Instant;
  deletedAt: Temporal.Instant | null;
}

// domain/shared/time.ts —— 时间与 Date 的转换只有这一处
export function instantFromDate(value: Date): Temporal.Instant { /* … */ }
export function dateFromInstant(value: Temporal.Instant): Date { /* … */ }

// domain/user/user.ts —— 工厂函数取现在用 Temporal.Now.instant()，转换走 dateFromInstant
export function createUser(...) { return { /* … */ createdAt: Temporal.Now.instant() }; }
export function userToInsertRow(u: User) { return { /* … */ createdAt: dateFromInstant(u.createdAt) }; }
```

> **前端展示**：读模型输出 ISO 字符串，前端统一用 `lib/format-date.ts`（固定 `zh-CN` / `Asia/Shanghai`），不要直接用 `toLocaleDateString()`（会导致 hydration 文本不一致）。

### R10. Controller 选择规则

| 场景 | 方案 |
|---|---|
| 内部页面表单、按钮操作 | Server Action (`actions.ts`) |
| 外部集成、Webhook、CORS、脚本 | REST Route Handler (`route.ts`) |

### R11. CQRS 读模型 (data.ts)

- `data.ts` 是各模块**唯一**的 DB 读入口
- 头部**必须** `import 'server-only'`
- API Route GET **必须**委托给 data.ts
- Server Action **禁止**包含只读查询
- data.ts **禁止**做鉴权检查

```typescript
// data.ts —— ✅ 只读模型（真实签名：scope 是入参，鉴权在缓存作用域外完成）
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';

export async function getUsers(scope: UserScope, userId: string, params: {...}) {
  'use cache';
  cacheLife('minutes');
  cacheTag('users-list');
  if (isScopeDenied(scope)) return { data: [], pagination: paginationMeta(page, pageSize, 0) };
  // ... Drizzle 查询
}

// route.ts —— ✅ 委托给 data.ts
export async function GET(request: NextRequest) {
  return withPermission({ permissions: [USER_PERMISSIONS.LIST] }, async (userId) => {
    const scope = await resolveScope(db, userId);
    const result = await getUsers(scope, userId, params);
    return restListSuccess(result.data, result.pagination);
  });
}
```

### R12. 缓存策略 (Next.js 16)

- 列表查询：`'use cache'` + `cacheTag()` + `cacheLife()` 在 data.ts 中使用
- 写后失效：**只**经 `lib/cache-invalidation.ts`（资源表与标签的唯一真相源），并按**写入位置**选入口：
  - Server Action → `invalidateResource(resource)`（内部 `updateTag`，立即过期）
  - Route Handler → `invalidateResourceFromRoute(resource)`（内部 `revalidateTag(tag, { expire: 0 })`）
  - ⚠️ `updateTag` **只能**在 Server Action 里调用；在 Route Handler 里**必抛**（Next.js `E872`），而抛出点在写事务提交之后 —— 形态是「写成功 + 失效未发生 + 响应 5xx」并诱使调用方重试
  - 机械守卫：`__tests__/api/cache-invalidation-site-guard.test.ts` 扫描全部 `route.ts`，命中即红
- **严禁**在 `'use cache'` 作用域内访问 `cookies()` / `headers()` / `searchParams`
- 动态 API 必须包裹在 `<Suspense>` 边界内

### R13. 层依赖规则

```
app/         → domain/, lib/, infrastructure/   ✅
lib/         → domain/, infrastructure/         ✅
infrastructure/ → lib/, domain/                ✅
domain/      → ANY OTHER                        ❌ (零外部依赖)
```

`domain/` 层**不得**引入 `next/`、`react/`、Drizzle，也不得引入白名单外的 npm 包。白名单（实测 `apps/portal/src/domain/**` 的全部外部导入）：`@auth-sso/contracts`、`zod`、`bcryptjs`（`domain/auth/password.ts`）、`jose`（仅 `domain/auth/types.ts` 的 `JWTPayload` 类型）、`node:crypto`（`domain/auth/oauth-client.ts`）。

### R14. data.ts DB 查询风格选择

| 场景 | 推荐风格 | 原因 |
|------|---------|------|
| 简单查询（单表、无嵌套 JOIN） | `db.select().from().where()` 链式调用 | mock 复杂度低，利于单元测试 |
| 嵌套 JOIN（深度 ≤2，需自动分组） | `db.query.xxx.findFirst({ with: {...} })` | 单次 DB 往返，代码量减半 |
| 嵌套 JOIN（深度 >2） | `db.select()` + 手动 JOIN | 避免 Drizzle relational query 性能退化 |

**判断标准**：如果 `db.query` 的嵌套深度 ≤2 且代码行数节省 >30%，优先用 `db.query`。

---

## 二、红线检查清单 (Red Flags)

Code Review 中发现以下任意模式，**立即停止合并，必须重构**：

| # | 红线模式 | 违反的规则 |
|---|---|---|
| 1 | Controller 中出现 `if` 业务条件判定 | R1 |
| 2 | Controller 中手写 `instanceof` 错误分支 | R2 |
| 3 | Controller 出现业务规则判定（状态机／权限判定／配额计算） | R1 |
| 4 | `data.ts` 中遗漏数据范围过滤或手写 dept_id 判断 | R7 |
| 5 | 循环内执行 `db.update()` / `db.insert()` | R3 |
| 6 | domain 实体使用 `z.object()` 定义 | R5 |
| 7 | 手写列名映射 `{ id: user.id, name: user.name }` | R6 |
| 8 | domain 层 `import` 了 `next/`、`react/`、`drizzle-orm` | R13 |
| 9 | `'use cache'` 函数内出现 `cookies()` / `headers()` | R12 |
| 10 | 枚举值在 contracts 外另起炉灶定义 | R4 |
| 11 | `new Date()` 出现在 domain 实体函数中（时间转换只经 `domain/shared/time.ts`） | R9 |
| 12 | API Route 中直接查询 DB 而非委托 data.ts | R11 |
| 13 | `'use cache'` 函数内调用 `cookies()` / `headers()` / `searchParams` | R12 |
| 14 | 写路径自行取范围快照再判定（手写 `resolveScope` + `isWithinScope`，绕过 `withScopedWrite` / `withScopedRow`） | R7 |
| 15 | Route Handler 里调用 `invalidateResource()`（内部 `updateTag`，route 上下文必抛 `E872`） | R12 |

---

## 三、常见错误 (Common Mistakes)

| 反模式 | 表现 | 正确做法 |
|---|---|---|
| 贫血 Controller | Controller 包含 if/else 校验，领域函数只是数据容器 | 将所有判定移到 domain 纯函数 |
| 错误枚举膨胀 | 在 domain 层定义 `const STATUS = {...}` | 追加到 `@auth-sso/contracts` |
| 猜疑式缓存 | 在 data.ts 的每个方法上加 `'use cache'` | 仅在列表查询加缓存，单详情不加 |
| 类型耦合 | domain 实体 `extends z.infer<typeof XSchema>` | 纯 interface + 独立的 Zod Schema |
| 事务懒惰 | `await tx.query` 查完立刻 `await db.update`（外层事务失效） | 同一 `db.transaction` 回调内完成 |
| 读写在 actions 混用 | 在 actions.ts 中先 `getUsers()` 再 `createUser()` | 只读去 data.ts，只写留 actions.ts |
| 写 Action 只调 `revalidatePath` 不调标签失效 | v16 缓存失效不完整 | 改用 `invalidateResource('xxx')`（内部同时做路径与标签） |
| 写后失效绕过 `lib/cache-invalidation.ts` 手写原语 | 资源表与跨资源标签必漏（如部门变更需失效用户下拉的 `departments`） | 改用 `invalidateResource()` |
| Route Handler 里调 `invalidateResource()`（内部 `updateTag`） | `updateTag` 在 route 上下文必抛 `E872`，抛出点在事务提交之后 → 写成功 + 响应 5xx | 改用 `invalidateResourceFromRoute()` |
| layout 重复手写鉴权样板 | 每个 `(dashboard)/<route>/layout.tsx` 自己 `await requirePermission(...)` + `<Forbidden/>`，且漏判返回值 | 各 layout 只声明 `ROUTE_ACCESS['/xxx']`，守卫统一交给 `<PermissionGate>`（内部 `connection()` + `requirePermission` + `<Forbidden/>` + `<Suspense>`） |
| 外层 `<DashboardLayout>` 重复包裹 | 多个 layout.tsx 各自包裹外壳 | 外壳只在 `(dashboard)/layout.tsx` 裹一次；`(dashboard)/<route>/layout.tsx` 只放 `<PermissionGate>` |

---

## 四、Controller 骨架 (Skeleton Templates)

> 签名唯一出处：`apps/portal/src/lib/auth/guard.ts`（`withAuth`）、`:48`（`withPermission`）、`apps/portal/src/lib/validation.ts`（`validate`）。

### Server Action

```typescript
'use server';
import { withAuth, type AuthContext } from '@/lib/auth';
import { db, schema } from '@/infrastructure/db';
import { invalidateResource } from '@/lib/cache-invalidation';
import { validate } from '@/lib/validation';
import { withScopedWrite } from '@/lib/authz';
import type { ApiResponse } from '@auth-sso/contracts';

export const createEntityAction = withAuth(
  { permissions: [ENTITY_PERMISSIONS.CREATE], audit: 'ENTITY_CREATE' },   // 权限码 + 审计
  async (ctx: AuthContext, raw: unknown): Promise<ApiResponse<{ id: string }>> => {
    // ← 只编排，无业务判定。ctx 是第一个形参（{ userId }）
    const v = validate(InputSchema, raw);                 // 返回 { ok: true, data } | { ok: false, response: ApiError }
    if (!v.ok) return v.response;

    // 有数据范围时用 withScopedWrite（事务 + 快照 + 守卫一体）；无范围时用 db.transaction
    const result = await withScopedWrite(
      { operatorId: ctx.userId, targets: [...] },
      async (tx) => {
        const entity = createEntity(v.data, generateUUID);
        await tx.insert(schema.entities).values(toInsertRow(entity));
        return entity;
      },
    );

    // 路径与标签都在资源表里；Server Action 位置用 invalidateResource
    invalidateResource('entities');
    return { success: true, data: { id: result.id } };
  },
);
```

### Route Handler GET

```typescript
import { type NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { restListSuccess } from '@/lib/response';
import { db } from '@/infrastructure/db';
import { getEntities } from '@/app/(dashboard)/entities/data';

export async function GET(request: NextRequest) {
  // handler 形参是 userId: string，返回 NextResponse
  return withPermission({ permissions: [ENTITY_PERMISSIONS.LIST] }, async (userId) => {
    const sp = request.nextUrl.searchParams;
    const scope = await resolveScope(db, userId);          // 鉴权/取范围在 data.ts 之外
    const result = await getEntities(scope, userId, {      // 委托 data.ts
      page: parseInt(sp.get('page') || '1', 10),
      pageSize: parseInt(sp.get('pageSize') || '10', 10),
      keyword: sp.get('keyword') || '',
    });
    return restListSuccess(result.data, result.pagination);
  });
}
```

### Route Handler POST

```typescript
import { type NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth';
import { validate } from '@/lib/validation';
import { restSuccess, restError } from '@/lib/response';
import { withScopedWrite } from '@/lib/authz';
import { invalidateResourceFromRoute } from '@/lib/cache-invalidation';

export async function POST(request: NextRequest) {
  return withPermission({ permissions: [ENTITY_PERMISSIONS.CREATE] }, async (userId) => {
    const v = validate(InputSchema, await request.json());
    if (!v.ok) return restError(v.response.error, v.response.message, 400);

    const entity = await withScopedWrite(
      { operatorId: userId, targets: [...] },
      async (tx) => { /* insert */ },
    );

    invalidateResourceFromRoute('entities');               // route 位置必须用 route 版入口
    return restSuccess({ id: entity.id }, 201);
  });
}
```

> **不要写 `try/catch`，也不要写 `instanceof` 分支**：`withPermission` 已经把异常交给 `mapServerError` 并返回 `restError(...)`；`withAuth` 同理返回 `ApiError`。手写这两样即违反 R2（红线 #2）。

---

## 五、proxy.ts 职责边界

`apps/portal/src/proxy.ts` 是 Next.js Proxy 层（源码根，不在 `lib/` 下），PKCE 生成已上移到 Gateway（Rust/Pingora）统一完成。proxy.ts 职责：

- **做**: 同源校验（`isCrossSiteWrite()`）——`POST/PUT/PATCH/DELETE` 带 `Origin` 时比对信任来源 / `X-Forwarded-Host` / 自身 `Host`，跨站返回 **403**；无 `Origin` 的服务端调用放行；`GET/HEAD` 不校验（ADR-005 第 2 层承诺）
- **做**: 路径白名单放行（`PUBLIC_PATHS = ['/login','/oauth/error','/.well-known']`、`SKIP_PREFIXES = ['/_next','/favicon','/images','/fonts']`、根路径 `/`、以及 `pathname.startsWith('/api/')`）
- **做**: Cookie 存在性检查（`COOKIE_NAMES.JWT` 无值 → 302 `/login`）
- **不做**: JWT 签名验证（由 `lib/auth/verify-jwt.ts` 的 `resolveIdentity()` 处理，内含 Gateway HMAC 信任路径与自验签兜底）
- **不做**: PKCE 生成、OAuth 授权链路由（由 Gateway 统一完成）
- **不做**: 业务鉴权或角色/权限判定（由 `lib/auth/` + `lib/authz/` 处理）

```typescript
// proxy.ts（签名、顺序、白名单均与 apps/portal/src/proxy.ts 一致）
const PUBLIC_PATHS = ['/login', '/oauth/error', '/.well-known'];
const SKIP_PREFIXES = ['/_next', '/favicon', '/images', '/fonts'];

export async function proxy(request: NextRequest) {
  if (isCrossSiteWrite(request)) {                                   // ① 同源校验先行
    return new NextResponse('Forbidden', { status: 403 });
  }
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname) || isSkipPath(pathname) || pathname.startsWith('/api/')) {
    return NextResponse.next();                                      // ② 白名单直通
  }
  const jwtToken = request.cookies.get(COOKIE_NAMES.JWT);
  if (!jwtToken?.value) {
    return NextResponse.redirect(new URL('/login', request.url));    // ③ 无 JWT → 登录页
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next|favicon\\.ico|images|fonts).*)'] };
```

> 历史修正：白名单里的 `/oauth2` 是**死配置**（实际端点在 `/api/auth/oauth2`，已被 `/api/` 跳过覆盖），现由 `/oauth/error` 取代——未登录用户被引导到 OAuth 错误页时必须放行，否则错误上下文会被 302 `/login` 吞掉（`proxy.ts`）。

---

## 六、领域模型实现约束

> 以下约束是 DDD 领域模型层的实现标准，属于**架构设计范畴**而非产品需求。此处列出的条目对应 REQUIREMENTS_MATRIX.md 中产品需求的实现层面落地规范。测试文件中的 `@req` 注解引用本节的约束 ID。

### DC-USR: 用户领域模型

| ID | 约束描述 | 验证方法 | 关联产品需求 |
| :--- | :--- | :--- | :--- |
| **DC-USR-C** | 新建用户时，领域层须校验用户名和邮箱在系统内的唯一性，确保指定部门存在，密码须满足安全策略要求（**至少 10 位、大写/小写/数字/特殊字符四类中至少三类**；2026-10-23 以代码为准统一，此前写"最小 8 位、含大小写字母和数字"） | 自动化测试 / 代码审查 | B-USR-C |
| **DC-USR-U** | 编辑用户时，领域层须校验目标用户未被逻辑删除，对已删除用户拒绝任何修改操作；部门变更时须校验新部门存在性 | 自动化测试 / 代码审查 | B-USR-U |
| **DC-USR-D** | 删除用户时，领域层须执行逻辑删除（状态标记为 DELETED），防止重复删除，关联的活跃会话须同步失效 | 自动化测试 / 代码审查 | B-USR-D |
| **DC-USR-ST** | 切换用户状态时，领域层须校验目标用户未被逻辑删除，已锁定的用户须通过专门的解锁流程恢复，禁止直接切换 | 自动化测试 / 代码审查 | B-USR-ST |

### DC-ROLE: 角色领域模型

| ID | 约束描述 | 验证方法 | 关联产品需求 |
| :--- | :--- | :--- | :--- |
| **DC-ROLE-C** | 创建角色时，领域层须校验角色编码全局唯一，编码不可变，必须指定所属部门（`dept_id`），校验部门存在且状态为 ACTIVE | 自动化测试 / 代码审查 | C-ROL-C |
| **DC-ROLE-U** | 编辑角色时，领域层须校验目标角色非系统内置角色（系统角色不可修改），更新后的属性须符合业务规则 | 自动化测试 / 代码审查 | C-ROL-U |
| **DC-ROLE-D** | 删除角色时，领域层须校验目标角色非系统内置角色，须解除所有关联关系（用户绑定、权限绑定）后再删除。角色删除后，受影响用户的权限上下文缓存须同步刷新 | 自动化测试 / 代码审查 | C-ROL-D |

### DC-DEPT: 部门领域模型

| ID | 约束描述 | 验证方法 | 关联产品需求 |
| :--- | :--- | :--- | :--- |
| **DC-DEPT-C** | 创建部门时，领域层须校验部门编码唯一性及上级部门存在性，自动计算物化祖先路径 | 自动化测试 / 代码审查 | F-DEP-C |
| **DC-DEPT-U** | 移动部门时，领域层须校验不会形成循环依赖（目标父部门不能是当前部门的子孙节点），移动后级联更新所有子孙部门的祖先路径 | 自动化测试 / 代码审查 | F-DEP-U |
| **DC-DEPT-D** | 删除部门时，领域层须校验不存在下属子部门，不存在绑定用户，两项均满足方可删除 | 自动化测试 / 代码审查 | F-DEP-D |

### DC-MENU: 菜单领域模型

| ID | 约束描述 | 验证方法 | 关联产品需求 |
| :--- | :--- | :--- | :--- |
| **DC-MENU-C** | 创建权限树节点时，领域层须校验路径格式合法性、类型与字段约束一致性：DIRECTORY/PAGE 类型仅允许使用 `path`/`icon`/`visible` 这组导航字段，且 PAGE 必须具备可跳转路径；API 类型不得混入导航字段，需要通过 `code` 与可选 `client_id` 表达鉴权语义 | 自动化测试 / 代码审查 | E-MNU-C |
| **DC-MENU-U** | 编辑菜单时，领域层须校验修改后的路由、父级菜单、权限绑定符合类型约束 | 自动化测试 / 代码审查 | E-MNU-U |
| **DC-MENU-D** | 删除菜单时，领域层须递归清理所有下级子菜单，级联解除所有权限绑定关系 | 自动化测试 / 代码审查 | E-MNU-D |

### DC-CLI: 客户端领域模型

| ID | 约束描述 | 验证方法 | 关联产品需求 |
| :--- | :--- | :--- | :--- |
| **DC-CLI-C** | 创建客户端时，领域层须自动生成强随机 Secret 并安全哈希存储，校验回调 URL 白名单格式合法性 | 自动化测试 / 代码审查 | G-CLT-C |
| **DC-CLI-U** | 更新客户端时，领域层须校验回调 URL 白名单安全性，Secret 不可通过更新接口修改（须使用专门的轮换接口） | 自动化测试 / 代码审查 | G-CLT-U |
| **DC-CLI-D** | 注销客户端时，领域层须级联清理该客户端签发的所有令牌（访问令牌和刷新令牌），确保无残留有效令牌 | 自动化测试 / 代码审查 | G-CLT-D |

### DC-AUTH: 认证领域约束

| ID | 约束描述 | 验证方法 | 关联产品需求 |
| :--- | :--- | :--- | :--- |
| **DC-AUTH-001** | 登录时，领域层须校验用户状态（ACTIVE/DISABLED/LOCKED/DELETED），仅 ACTIVE 状态允许通过认证 | 自动化测试 / 安全审计 | H-AUTH-002 |
| **DC-AUTH-002** | 授权码签发时，领域层须校验客户端状态（ACTIVE）、回调地址精确匹配、用户有权访问该应用 | 自动化测试 / 安全审计 | H-AUTH-003 |
| **DC-AUTH-003** | Token 交换时，领域层须校验授权码未过期、未被使用、客户端凭证正确、PKCE code_verifier 匹配 | 自动化测试 / 安全审计 | H-AUTH-004 |
| **DC-AUTH-004** | Token 刷新时，领域层须执行令牌轮换（撤销旧令牌 + 签发新令牌），旧令牌立即失效 | 自动化测试 / 安全审计 | H-SESS-003 |

### DC-AUDIT: 审计日志领域约束

| ID | 约束描述 | 验证方法 | 关联产品需求 |
| :--- | :--- | :--- | :--- |
| **DC-AUDIT-IMMUTABLE** | 审计日志为仅追加（append-only）。应用层严禁暴露 `audit_logs`/`login_logs` 的 UPDATE/DELETE 接口；生产部署脚本须对应用 DB 角色 REVOKE 这两张表的 UPDATE/DELETE 权限，仅授 INSERT/SELECT。违反即破坏 J-LOG-003 不可篡改要求 | 代码审查 / 部署脚本校验 | J-LOG-003 |
| **DC-POLISH-001** | 登录页视觉规范：品牌渐变背景 + 白色卡片，无设计债残留 | E2E 视觉回归 | A-NAV-01 |
| **DC-POLISH-002** | Dashboard 视觉规范：指标卡片 + 圆角收敛 + 无装饰 blob | E2E 视觉回归 | A-NAV-03 |
| **DC-POLISH-003** | 用户列表视觉规范：DataTable + EmptyState 正确渲染 | E2E 视觉回归 | B-USR-L |
| **DC-POLISH-004** | 审计日志视觉规范：shadcn Table + 暗黑模式徽章 | E2E 视觉回归 | J-LOG-001 |
| **DC-POLISH-005** | 关键页面视觉快照比对基线稳定，无未预期漂移 | E2E 视觉回归 | A-NAV-01 |
| **DC-POLISH-006** | 视觉回归测试覆盖品牌一致性（配色/字体/间距收敛） | E2E 视觉回归 | A-NAV-01 |

---

> **本指南与 ARCHITECTURE.md 形成互补：ARCHITECTURE.md 描述"系统是什么样"，本文档定义"代码该怎么写"。两者不一致时以本文档为准。**

## 七、Gateway Rust 异步 Trait 边界

项目自定义且需要跨线程调度的异步 Trait，必须使用 `-> impl std::future::Future<Output = T> + Send`；实现块直接使用 `async fn`，禁止引入 `#[async_trait]` 的 Box 分配。

唯一例外是 Pingora 等第三方 Trait 的实现：当上游 Trait 定义要求 `#[async_trait]` 时，可在其适配实现上使用该宏。此例外不得扩展至项目自定义 Trait，也不得作为新增动态分发抽象的理由。
