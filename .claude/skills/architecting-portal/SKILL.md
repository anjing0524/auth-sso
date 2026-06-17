---
name: architecting-portal
description: Use when adding features, refactoring, or writing Server Actions / Route Handlers / domain logic in @auth-sso/portal. Triggers on controller bloat, business logic in wrong layer, missing transactions, hand-written enum literals, or raw new Date() in domain code.
---

# Portal Architecture Guidelines

## Overview

Portal 遵循 **薄 Controller → 纯 Domain → Drizzle 直调** 的分层架构。Controller 只做编排（Zod 校验 → 调领域函数 → DB 直调 → 响应），零业务规则判断。Domain 层纯函数，零框架依赖。全栈同构，单一真相源。

## Layer Dependency Rules

```
app/ → domain/  ✅    app/ → lib/  ✅    app/ → infrastructure/  ✅
lib/ → domain/  ✅    lib/ → infrastructure/  ✅
infrastructure/ → lib/  ✅    infrastructure/ → domain/  ✅
domain/ → domain/  ✅    domain/ → ANY OTHER  ❌ (零外部依赖)
```

| 源层 → 目标层 | domain | lib | infrastructure | app |
|:---|:---:|:---:|:---:|:---:|
| **domain** | ✅ | ❌ | ❌ | ❌ |
| **lib** | ✅ | ✅ | ✅ | ❌ |
| **infrastructure** | ✅ | ✅ | ✅ | ❌ |
| **app** | ✅ | ✅ | ✅ | ✅ |

## Directory Map

```
src/
├── app/
│   ├── (dashboard)/          # Route Group：统一鉴权 + DashboardLayout
│   │   ├── layout.tsx        # 唯一一份：登录态校验 + DashboardLayout 包裹
│   │   ├── users/
│   │   │   ├── layout.tsx    # requirePermission(['user:list']) — 仅权限声明
│   │   │   ├── page.tsx      # Server Component 读入口（零鉴权样板）
│   │   │   ├── data.ts       # Drizzle 直调查询 + "use cache"
│   │   │   ├── actions.ts    # Server Actions（内部写）
│   │   │   └── components/   # Client Components
│   │   ├── roles/            # layout: requirePermission(['role:list'])
│   │   ├── clients/          # layout: requirePermission(['client:list'])
│   │   ├── departments/      # layout: requirePermission(['department:list'])
│   │   ├── permissions/      # layout: requirePermission(['permission:list'])
│   │   ├── menus/            # layout: requirePermission(['menu:list'])
│   │   ├── dashboard/        # layout: requirePermission(['dashboard:view'])
│   │   └── audit-logs/       # layout: requirePermission(['audit:read'])
│   ├── api/                  # REST API（仅外部集成/Webhook）
│   │   └── {resource}/route.ts
│   └── login/                # 公开路由（无鉴权）
├── domain/
│   ├── shared/
│   │   ├── errors.ts         # DomainError 类型体系
│   │   ├── error-mapping.ts  # mapDomainError(err) → HTTP 映射（Controller 唯一出口）
│   │   ├── zod-schemas.ts    # Zod 枚举集中导出
│   │   └── tree-utils.ts     # buildTree<T>() 泛型
│   └── {user}/               # 聚合根 BC
│       ├── types.ts          # 纯 TS interface + Zod 入参 Schema
│       └── user.ts           # 纯函数 + toDomainXxx / xxxToInsertRow / xxxToUpdateRow
├── infrastructure/           # 有状态适配器
│   ├── auth/                 # Better Auth 初始化
│   ├── db/                   # Drizzle + postgres-js 连接
│   └── redis/                # ioredis 客户端
├── lib/                      # 无状态工具
│   ├── auth/                 # withAuth HOF / checkPermission / guard / client
│   ├── session/              # JWT Cookie 读写、验签、jti 撤销
│   ├── permissions.ts        # 权限查询与缓存
│   ├── audit.ts              # 审计日志
│   ├── crypto.ts             # ID/Secret 生成
│   └── password.ts           # bcrypt 封装
└── db/                       # 物理存储
    ├── schema.ts             # 表定义 + pgEnum（枚举值从 contracts 导入）
    ├── types.ts              # $inferSelect / $inferInsert
    └── user-queries.ts       # 共享查询列选择
```

## Core Rules (Code Review 一票否决)

### 1. Controller ≤ 20 行，零业务规则判断

Server Action / Route Handler 只做编排。严禁在 Controller 内写 `if (user.status === 'DELETED')` 等状态判断、字段 merge 策略、`??` 链默认值赋值。

```typescript
// ❌ 错误：业务逻辑在 Controller
export async function toggleAction(userId: string) {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (user.status === 'DELETED') return { error: '已删除' };  // ← 业务规则在控制器！
  const newStatus = user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  await db.update(users).set({ status: newStatus }).where(eq(users.id, userId));
}

// ✅ 正确：Controller 只做编排
export const toggleAction = withAuth({ permissions: ['user:edit'] }, async (input) => {
  const parsed = UserIdentityInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message };
  const user = await db.transaction(async (tx) => {
    const row = await tx.query.users.findFirst({ where: eq(users.id, parsed.data.id) });
    if (!row) throw new EntityNotFoundError('User', parsed.data.id);
    const updated = toggleUserStatus(toDomainUser(row));  // ← 领域纯函数处理业务逻辑
    await tx.update(users).set(userToUpdateRow(updated)).where(eq(users.id, row.id));
    return updated;
  });
  revalidatePath('/users');
  return { success: true, data: user };
});
```

### 2. 统一错误映射出口

Controller 的 catch 块只能用 `mapDomainError(err)`，严禁手写 `if (err instanceof XxxError)`。

```typescript
// ❌ 错误
catch (err) {
  if (err instanceof DuplicateEntityError) return NextResponse.json(..., { status: 409 });
  if (err instanceof EntityNotFoundError) return NextResponse.json(..., { status: 404 });
}

// ✅ 正确
catch (err) {
  const mapped = mapDomainError(err);
  return NextResponse.json({ error: mapped.error, message: mapped.message }, { status: mapped.status });
}
```

### 3. 多表/多行写入必须用 `db.transaction()`

```typescript
// ❌ 错误：独立更新无事务保护
for (const id of ids) {
  await db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, id));
}

// ✅ 正确：事务包裹
await db.transaction(async (tx) => {
  for (const id of ids) {
    await tx.update(users).set({ status: 'DISABLED' }).where(eq(users.id, id));
  }
});
```

### 4. 枚举值单一真相源

所有枚举值数组只在 `@auth-sso/contracts` 定义一次。Zod `z.enum()` 和 Drizzle `pgEnum()` 均从同一数组派生。

```typescript
// ✅ contracts/constants.ts
export const USER_STATUS_VALUES = ['ACTIVE', 'DISABLED', 'LOCKED', 'DELETED'] as const;

// ✅ domain/user/types.ts
import { USER_STATUS_VALUES } from '@auth-sso/contracts';
const userStatusEnum = z.enum(USER_STATUS_VALUES);  // ← 派生，不手写字面量

// ✅ db/schema.ts
import { USER_STATUS_VALUES } from '@auth-sso/contracts';
export const userStatusEnum = pgEnum('user_status', USER_STATUS_VALUES as [string, ...string[]]);
```

### 5. Domain 实体用纯 `interface`，不用 Zod Schema

废除 `UserPropsSchema`。Domain 实体用纯 TS `interface`，与 Drizzle `$inferSelect` 的兼容性由编译期类型守卫保证。

```typescript
// ✅ domain/user/types.ts
export interface User {
  id: string;
  publicId: string;
  username: string;
  email: string | null;
  name: string;
  status: UserStatus;     // from contracts
  deptId: string | null;
  deptName: string | null; // JOIN 计算字段
  createdAt: Temporal.Instant;  // ← Temporal，非 Date
}

// 入参校验仍用 Zod
export const CreateUserInputSchema = z.object({
  name: z.string().min(1),
  username: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(6),
  deptId: z.string().optional().nullable(),
});
```

### 6. DB 行转换函数集中管理

每个聚合根必须提供 `xxxToInsertRow` / `xxxToUpdateRow` 函数，Controller 禁止手写列名映射。

### 7. 数据范围过滤统一抽取

所有读路径必须使用 `applyDataScopeFilter(query, scopeFilter, userId)`，严禁在各 data.ts 中重复 `if (scopeFilter.type === 'LIST')` 分支。

### 8. Auth Guard 统一鉴权（三层：layout → withAuth → withPermission）

**Server Component Page 鉴权** — 通过 Route Group `(dashboard)` + `requirePermission` 在 layout 层统一处理，page.tsx 零鉴权样板。

```typescript
// ✅ app/(dashboard)/layout.tsx — 唯一一份，登录态 + DashboardLayout
import { resolveIdentity } from '@/lib/auth';
export default async function DashboardGroupLayout({ children }) {
  const identity = await resolveIdentity(await headers());
  if (!identity) redirect('/login');
  return <DashboardLayout>{children}</DashboardLayout>;
}

// ✅ app/(dashboard)/users/layout.tsx — 仅 5 行权限声明
import { requirePermission } from '@/lib/auth/require-permission';
import { Forbidden } from '@/components/ui/forbidden';
export default async function UsersLayout({ children }) {
  const userId = await requirePermission({ permissions: ['user:list'] });
  if (!userId) return <Forbidden />;
  return children;
}

// ✅ app/(dashboard)/users/page.tsx — 零鉴权样板，纯业务
export default async function UsersPage({ searchParams }) {
  const userId = (await requirePermission({ permissions: ['user:list'] }))!; // React.cache 命中
  const { data } = await getUsers(userId, params);
  return <UserTable data={data} />;
}
```

`requirePermission` 基于 `React.cache()`，同请求内 layout 和 page 各自调用时第二次命中缓存，零额外 DB 查询。

**Server Action 鉴权** — `withAuth` HOF，严禁在 Action 体内手写 `checkPermission` + `mapDomainError`。

```typescript
// ✅ 正确
export const myAction = withAuth({ permissions: ['user:create'] }, async (input) => {
  // 只写业务逻辑，无鉴权/错误处理样板
});
```

**API Route 鉴权** — `withPermission` 包装。

### 9. Temporal API 替代 `new Date()`

Domain 实体使用 `Temporal.Instant`。唯一允许 `new Date()` 的地方是 Drizzle 写入时的 `updatedAt` / `createdAt` 列。tsconfig 需包含 `"lib": ["esnext", "esnext.temporal"]`。

### 10. Controller 选择原则

| 场景 | 使用 |
|------|------|
| 内部页面表单/按钮 | **Server Actions** (`actions.ts`)，严禁另写 `/api/` 路由 |
| 外部集成/Webhook/跨域/脚本 | **REST Route Handler** (`route.ts`) |

### 11. 读模型统一收拢 `data.ts`（CQRS 只读层）

`data.ts` 是模块内**唯一的数据库读入口**，所有 SELECT 查询集中于此。必须 `import 'server-only'`（编译期隔离，防止 Client Component 误引用），不含 `'use server'` 指令。

| 层级 | 文件 | 职责 | 调用方 |
|------|------|------|--------|
| 读模型 | `data.ts` | 纯数据获取，`'use cache'` + `cacheTag` 缓存 | Server Component / API Route |
| 写模型 | `actions.ts` | CUD 写操作，`'use server'`，`withAuth` 鉴权 | Server/Client Component |
| REST 网关 | `route.ts` | GET 委托 `data.ts`，POST/PUT/DELETE 直接处理 | 外部集成/客户端 fetch |

**硬性规则：**

- **API Route GET 处理器禁止直接操作 DB**：必须通过 `withPermission` 鉴权后，委托给 `data.ts` 的同名函数。
- **`actions.ts` 禁止只读查询**：读操作只在 `data.ts` 中。`actions.ts` 仅保留 CUD 写操作。
- **Server Component Page 直调 `data.ts`**：鉴权由 `layout.tsx` 通过 `requirePermission` 统一处理，page.tsx 零鉴权样板。如需 `userId`，在 page 中再次调用 `requirePermission`（`React.cache` 命中，零额外开销）。
- **`data.ts` 不自行鉴权**：鉴权在调用方（layout）完成，`data.ts` 通过 `userId` 参数接收身份，内部仅做数据范围过滤。

```typescript
// ✅ API Route GET 标准模板：鉴权 → 委托 data.ts
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['xxx:list'] }, async (userId) => {
    const params = parseSearchParams(request);
    const result = await getXxx(userId, params);  // ← 委托 data.ts
    return NextResponse.json(result);
  });
}

// ✅ Server Component Page 标准模板：layout 鉴权，page 零样板
// app/(dashboard)/xxx/layout.tsx
export default async function XxxLayout({ children }) {
  const userId = await requirePermission({ permissions: ['xxx:list'] });
  if (!userId) return <Forbidden />;
  return children;
}
// app/(dashboard)/xxx/page.tsx
export default async function XxxPage({ searchParams }) {
  const userId = (await requirePermission({ permissions: ['xxx:list'] }))!; // cache 命中
  const { data } = await getXxx(userId, params);  // ← 直调 data.ts
  return <XxxList data={data} />;
}

// ❌ 旧模式（已废弃）：page.tsx 手写 checkPermission
export default async function XxxPage() {
  const auth = await checkPermission(await headers(), { permissions: ['xxx:list'] });
  if (!auth.authorized) return <div>未授权</div>;
  // ...
}
```

### 12. 缓存策略与失效

| 位置 | 机制 | 示例 |
|------|------|------|
| `data.ts` 列表查询 | `cacheTag('xxx-list')` + `cacheLife('minutes'\|'hours')` | `cacheTag('users-list')` |
| `actions.ts` 写操作后 | `revalidatePath('/xxx')` + `revalidateTag('xxx-list', 'minutes')` | 页面缓存 + 数据缓存双失效 |

**规则：** 每个写 Action 必须在 `revalidatePath` 后追加 `revalidateTag`，且 `profile` 参数需与 `data.ts` 中 `cacheLife` 一致。

```typescript
// ✅ 正确的缓存失效
export const createXxxAction = withAuth({ permissions: ['xxx:create'] }, async (_ctx, input) => {
  const result = await db.transaction(async (tx) => { /* ... */ });
  revalidatePath('/xxx');              // 失效 RSC Payload
  revalidateTag('xxx-list', 'minutes'); // 失效 data.ts use cache
  return { success: true, data: result };
});
```

### 13. data.ts 函数命名规范

| 函数 | 用途 | 缓存 |
|------|------|------|
| `getXxxs(params)` | 分页/过滤列表 | `'use cache'` + `cacheTag` |
| `getXxxById(id)` | 单实体详情 | 不缓存（保证实时性） |
| `getXxxRoles(xxxId)` | 关联子资源 | 不缓存 |
| `getXxxPermissions(xxxId)` | 关联子资源 | 不缓存 |

### 14. API Route 读模型的 DB 查询风格

`data.ts` 中所有查询**必须使用 `db.select()` 风格**，禁止使用 `db.query.xxx.findFirst()`。原因：`db.query` 的 mock 复杂度远高于 `db.select()` 链式调用，不利于测试。

```typescript
// ✅ db.select() 链式（测试友好）
const rows = await db.select().from(schema.xxx)
  .where(or(eq(...), eq(...))).limit(1);
const row = rows[0];

// ❌ db.query（测试 mock 复杂）
const row = await db.query.xxx.findFirst({ where: or(...) });
```

## Controller 标准骨架

**Server Action（内部页面用）**：`withAuth` 统一处理鉴权 + 错误映射，Action 体内零鉴权/零 catch 样板。

```typescript
// Server Action 骨架 — withAuth 已内置鉴权 + mapDomainError
'use server';
export const xAction = withAuth({ permissions: ['x:create'] }, async (_ctx, input) => {
  // 1. Zod 门禁
  const parsed = XxxInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message };
  // 2. 事务 + 领域函数 + DB 直调（无需 try/catch，withAuth 统一捕获并映射错误）
  const result = await db.transaction(async (tx) => {
    // 查重/查存在 → 抛 DomainError
    // 调领域纯函数
    // tx.insert().values(xxxToInsertRow(entity))
    return entity;
  });
  revalidatePath('/xxx');
  revalidateTag('xxx-list', 'minutes');  // 与 data.ts cacheLife 保持一致
  return { success: true, data: result };
});
```

**Route Handler GET（读操作，委托 data.ts）**：

```typescript
// Route Handler GET 骨架 — withPermission 鉴权后委托 data.ts
export async function GET(request: NextRequest) {
  return withPermission(request, { permissions: ['xxx:list'] }, async () => {
    const sp = request.nextUrl.searchParams;
    const result = await getXxx({ /* parse params */ });
    return NextResponse.json(result);
  });
}
```

**Route Handler POST/PUT/DELETE（写操作，外部集成/Webhook）**：手动 `checkPermission` + try/catch `mapDomainError`。

```typescript
// Route Handler POST 骨架
export async function POST(req: NextRequest) {
  const check = await checkPermission(req.headers, { permissions: ['x:create'] });
  if (!check.authorized) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const parsed = XxxInputSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
  try {
    const result = await db.transaction(async (tx) => { /* ... */ });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    const mapped = mapDomainError(err);
    return NextResponse.json({ error: mapped.error, message: mapped.message }, { status: mapped.status });
  }
}
```

## Common Mistakes (from real failures)

| Mistake | Fix |
|---------|-----|
| `if (user.status === 'DELETED')` in Controller | 下沉到 domain 纯函数，Controller 只捕获 DomainError |
| 循环 `db.update()` 无事务 | 用 `db.transaction(async (tx) => { ... })` 包裹 |
| `new Date()` in domain | 用 `Temporal.Now.instant()`，仅 DB 写入保留 `new Date()` |
| Controller 手写 `if (err instanceof XxxError)` | 统一用 `mapDomainError(err)` |
| 复制粘贴 `if (scopeFilter.type === 'LIST')` | 用 `applyDataScopeFilter()` 工具函数 |
| `z.enum(['ACTIVE', 'DISABLED'])` 手写字面量 | 从 contracts 导入 `USER_STATUS_VALUES` 派生 |
| Action 内手写 `checkPermission(...)` + `catch (err) { mapDomainError(err) }` | 用 `withAuth({ permissions: [...] }, async (input) => { ... })` |
| Page 手写 `checkPermission(await headers(), ...)` 样板 | 在 `app/(dashboard)/xxx/layout.tsx` 中用 `requirePermission()`；page.tsx 零鉴权 |
| 多个 layout.tsx 重复包裹 `<DashboardLayout>` | 放入 Route Group `(dashboard)/layout.tsx`，统一一份 |
| `useState(initialUser)` 全量复制 prop | 按编辑/只读维度拆分：可编辑字段进 state，只读字段直接从 prop 读 |
| API Route GET 手写 Drizzle 查询 | 委托给 `data.ts` 同名函数，Route 只做鉴权 + 委托 |
| `actions.ts` 中有 `getXxxAction` 只读 Action | 移到 `data.ts` 的 `getXxx(id)` 纯函数 |
| 写 Action 只调 `revalidatePath` 不调 `revalidateTag` | 追加 `revalidateTag('xxx-list', 'minutes')` |
| `data.ts` 用 `db.query.xxx.findFirst()` | 改为 `db.select().from().where().limit(1)` 风格 |

## Red Flags - STOP and Refactor

- Controller 函数体超过 20 行
- Controller 中出现 `if`/`else` 业务条件分支
- `catch` 块中有 `instanceof` 判断
- domain/ 中出现 `import ... from 'next/...'`
- `db.schema.ts` 或 `domain/types.ts` 中出现手写枚举字面量
- 多行写入无 `db.transaction()`
- domain entity 仍使用 `XxxPropsSchema`（应为纯 `interface`）
- Action 内手写 `checkPermission` + `catch (err) { mapDomainError(err) }` 样板
- Page 手写 `checkPermission(await headers(), ...)` + forbidden 判断（应由 layout.tsx `requirePermission` 统一处理）
- 多个 layout.tsx 重复包裹 `<DashboardLayout>`（应放入 Route Group `(dashboard)/layout.tsx` 统一一份）
- API Route GET 处理器中出现 `db.select()` / `db.query` 直接 DB 调用（应委托 `data.ts`）
- `actions.ts` 中存在只读查询函数（只能写，读归 `data.ts`）
- `data.ts` 函数使用 `db.query.xxx.findFirst()`（应用 `db.select()` 风格）
- 写操作只调 `revalidatePath` 未调 `revalidateTag`（缓存失效不完整）
- 返回给客户端的 data 中包含 `Temporal.Instant` 而非 ISO 字符串（API Route JSON 序列化兼容性）

> **完整规范详见** `docs/portal-architecture-guidelines.md`（含 React 19 组件模式、安全三层防御、Temporal API 详解、eslint-plugin-boundaries 配置等）。
