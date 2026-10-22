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

### 12. 缓存策略与失效（Next.js 16 Cache Components）

本项目启用 `cacheComponents: true`（`next.config.ts`），**`dynamic` / `revalidate` / `fetchCache` / `dynamicParams` 四个导出已从 v16 移除，不可再用**。

| 位置 | 机制 | 示例 |
|------|------|------|
| `data.ts` 列表查询 | `'use cache'` + `cacheTag('xxx-list')` + `cacheLife('minutes'\|'hours')` | `cacheTag('users-list')` |
| `actions.ts` 写操作后 | `revalidatePath('/xxx')` + `updateTag('xxx-list')` | 页面 RSC Payload + 数据缓存双失效 |

**规则：** 每个写 Action 必须在 `revalidatePath` 后追加 `updateTag`（v16 替代原 `revalidateTag` 的即时失效语义），profile 参数与 `data.ts` 中的 `cacheLife` 保持一致。

```typescript
import { updateTag } from 'next/cache';

// ✅ 正确的缓存失效
export const createXxxAction = withAuth({ permissions: ['xxx:create'] }, async (_ctx, input) => {
  const result = await db.transaction(async (tx) => { /* ... */ });
  revalidatePath('/xxx');              // 失效 RSC Payload
  updateTag('xxx-list');               // 即时失效 data.ts use cache（v16 新 API）
  return { success: true, data: result };
});
```

**`'use cache'` 硬性约束：缓存作用域内严禁访问 `cookies()` / `headers()` / `searchParams`**。必须在缓存作用域外读取这些动态 API，将值作为函数参数传入：

```typescript
// ✅ 正确：动态值在缓存外读取 → 作为参数注入
export async function getUsers(
  scopeFilter: ScopeFilter,  // 调用方在缓存外从 cookies/headers 提取后传入
  userId: string,
  params: { page: number; pageSize: number; keyword: string; status: string }
) {
  'use cache';
  cacheLife('minutes');
  cacheTag('users-list');
  // ...内部仅做 DB 查询，不访问 cookies/headers/searchParams
}

// ❌ 错误：在 'use cache' 内访问 cookies()
export async function getUsers(params: {...}) {
  'use cache';
  const cookieStore = await cookies();  // ← 编译/运行时错误！
  // ...
}
```

### 13. data.ts 函数命名规范

| 函数 | 用途 | 缓存 |
|------|------|------|
| `getXxxs(params)` | 分页/过滤列表 | `'use cache'` + `cacheTag` |
| `getXxxById(id)` | 单实体详情 | 不缓存（保证实时性） |
| `getXxxRoles(xxxId)` | 关联子资源 | 不缓存 |
| `getXxxPermissions(xxxId)` | 关联子资源 | 不缓存 |

### 14. data.ts 的 DB 查询风格

**优先 `db.select()` 链式调用**。`db.select()` 的 mock 复杂度低，利于单元测试。

**但 `db.query` 关系查询在以下场景优先使用：**
- 需要嵌套 JOIN 且一次 DB 往返完成（`with` 深度 ≤2）
- 结果需要 Drizzle 自动分组为嵌套结构（避免手动 `.filter().map()` 去重）
- 函数已有 `vi.mock` 级别的 mock 覆盖（非 Drizzle 级别 mock）

```typescript
// ✅ 简单查询 → db.select() 链式
const rows = await db.select().from(schema.xxx)
  .where(eq(schema.xxx.id, id)).limit(1);
const row = rows[0];

// ✅ 嵌套 JOIN → db.query 关系查询（单次往返 + 自动分组，代码量减半）
const user = await db.query.users.findFirst({
  where: eq(schema.users.id, userId),
  with: {
    userRoles: { with: { role: { with: { roleClients: true } } } },
    department: true,
  },
});

// ❌ 强行用 db.select() 做嵌套 JOIN → ~35 行手动分组去重，易出错
const rows = await db.select({ ...15+ fields... })
  .from(schema.users)
  .leftJoin(schema.userRoles, ...)
  .leftJoin(schema.roles, ...)
  .leftJoin(schema.departments, ...);
// 然后手动 group：rows.filter(r => r.roleId).map(...) ← 出错高发区
```

**判断标准：** 如果 `db.query` with 的嵌套深度 ≤2 且代码行数节省 >30%，优先用 `db.query`。需要 Drizzle 级别 mock 时再改为 `db.select()`。

### 15. Next.js 16 `cacheComponents: true` 运行时规则

本项目启用 `cacheComponents: true`（Partial Prerendering / PPR），以下规则必须严格遵守：

#### 15.1 禁用的 Route Segment Config 导出

```typescript
// ❌ 以下四个导出在 cacheComponents 模式下是编译错误
export const dynamic = 'force-dynamic';     // Turbopack: "not compatible with cacheComponents"
export const dynamic = 'force-static';      // 同上
export const revalidate = 60;               // 同上
export const fetchCache = 'force-no-store'; // 同上
export const dynamicParams = false;         // 同上

// ❌ runtime 导出在 Turbopack + cacheComponents 下也是编译错误
export const runtime = 'nodejs';            // Turbopack: "not compatible with cacheComponents"
export const runtime = 'edge';              // 且 edge 完全不支持 Cache Components
```

**API routes 默认就是 Node.js 运行时（且是唯一可用运行时），无需且不能显式声明 `runtime`。**

#### 15.2 动态 API（cookies / headers / searchParams）必须包裹 `<Suspense>`

**原则**：谁直接调用了动态 API，它所在的渲染路径上就必须有 `<Suspense>` 边界。边界会捕获**整个子树**中 throw 的动态 API 中断信号——不只是直接子组件。

判断标准：**该组件自身是否直接调用了 `cookies()` / `headers()` / `searchParams` / `resolveIdentity()`（内部访问上述 API）**。

```
dashboard 分组（全部被 (dashboard)/layout.tsx 的 <Suspense> 子树覆盖）：

(dashboard)/layout.tsx      → resolveIdentity() → cookies/headers  ✅ 自己包裹 <Suspense>
   └── (子树内所有 sub-layout 和 page 都受此边界保护)
       ├── users/layout.tsx     → requirePermission()              （被父 Suspense 覆盖）
       ├── users/[id]/page.tsx  → await params + DB               （被父 Suspense 覆盖）
       ├── clients/layout.tsx   → requirePermission()              （被父 Suspense 覆盖）
       ├── clients/[id]/page    → 'use client' + use(params)      （被父 Suspense 覆盖）
       └── ...

非 dashboard 分组（不在任何 Suspense 子树内）：

page.tsx                    → resolveIdentity() → cookies/headers  ✅ 需要独立 Suspense
login/page.tsx              → cookies() 直接调用                   ✅ 需要独立 Suspense
profile/page.tsx            → resolveIdentity() → cookies/headers  ✅ 需要独立 Suspense
```

**关键**：`<Suspense>` 边界捕获整个子树的 prerendering 中断——不只是直接子组件。所以 dashboard 下所有 sub-layout 和 page（包括 `'use client'` + `use(params)` 的 `clients/[id]`）都不需要重复包裹。只有**不在任何 Suspense 子树内**的 page（根 `/`、`/login`、`/profile`）才需要自己包裹。

```tsx
// ✅ 正确模式：静态壳 + 动态内容
import { Suspense } from 'react';

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <PageContent />
    </Suspense>
  );
}

async function PageContent() {
  const cookieStore = await cookies();  // ← 动态 API
  // ...
}
```

#### 15.3 `'use cache'` 与动态 API 隔离

`'use cache'` 作用域运行在隔离环境中，**无法访问** `cookies()` / `headers()` / `searchParams`。必须在外层读取后作为参数传入：

```typescript
// ✅ 正确：layout/page 读取动态值 → 传给 data.ts 的 use cache 函数
// layout.tsx (动态，有 Suspense 边界)
async function DashboardContent() {
  const identity = await resolveIdentity();  // ← cookies/headers 在缓存外
  const data = await getUsers(scopeFilter, identity.userId, params);  // ← userId 作为参数注入
}

// data.ts (静态，use cache 可缓存)
export async function getUsers(scopeFilter, userId, params) {
  'use cache';
  // 只能访问参数和 DB，不能访问 cookies/headers
}
```

#### 15.4 手动 `<Suspense>` vs `loading.tsx`

##### `loading.tsx` 不包裹 layout

`loading.tsx` 只包裹 `page.js` 及子节点，**不包裹同级的 `layout.js`**。当 layout 访问 cookies/headers 时，`loading.tsx` 完全无效——layout 只能手动 `<Suspense>`。

即使用在 page 上，手动 `<Suspense>` 也更精细：可以把静态部分（header、nav）留在 Suspense 外作为静态壳，只让动态内容 streaming。

##### 不要在工具函数层 catch 动态 API 的异常

`headers()` / `cookies()` 在构建期 throw 的 prerendering 中断信号，**必须**传播到 `<Suspense>` 边界由 React 静默处理。如果在工具函数中用 `try/catch` 拦截并 `console.error`，会产生构建噪音。

```typescript
// ❌ 错误：catch 拦截了 Suspense 应该处理的 prerendering 信号
async function getGatewayUserId(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get(GATEWAY_HEADERS.USER_ID) || null;
  } catch (e) {
    console.error('[Auth] headers() 异常:', e);  // ← 构建期噪音
    return null;
  }
}

// ✅ 正确：不 catch，让异常自然传播到 Suspense
// 构建期：throw → Suspense 静默捕获 → 请求时重新渲染
// 请求期：headers() 是平台标准 API，不会 throw
async function getGatewayUserId(): Promise<string | null> {
  const h = await headers();
  return h.get(GATEWAY_HEADERS.USER_ID) || null;
}
```

> 项目中 `verify-jwt.ts` / `cookies.ts` / `error-mapping.ts` 中临时保留了 `isPrerenderingError()` 守卫以兼容现有 try/catch 结构。新增代码或重构时应遵循上述模式（不 catch），逐步淘汰该守卫。

#### 15.5 `connection()` 的正确用途

`connection()` 用于**非确定性操作**（`Math.random()` / `Date.now()` / `crypto.randomUUID()`）需要延迟到请求时的场景，**不是** `cookies()` / `headers()` 的替代方案：

```typescript
// ✅ connection() 的正确用法：同步 DB 驱动需要 per-request 数据
import { connection } from 'next/server';
export async function getVisitorCount() {
  await connection();  // 显式标记为请求时执行
  return db.prepare('SELECT value FROM counters').get('visitors');
}

// ❌ 不要用 connection() 替代 Suspense 包裹 cookies/headers
// cookies/headers 在 prerendering 时会直接 throw，不是 connection() 能解决的
```

#### 15.6 构建输出符号解读

```
○  (Static)             → 完全静态预渲染（无动态 API，无 use cache）
◐  (Partial Prerender)  → 静态壳 + 动态内容流式注入（有 Suspense 包裹的动态 API）
ƒ  (Dynamic)            → 完全动态（API routes 或未包裹 Suspense 的动态页面）
```

**目标：** 所有使用动态 API 的页面应为 `◐`（Partial Prerender），API routes 为 `ƒ`（Dynamic）。

#### 15.7 Proxy（原 Middleware）的职责边界

Proxy 在路由渲染**之前**执行（类似 CDN 边缘网关），职责是轻量级路由守卫：检查 Cookie 存在性、路径白名单、重定向。**不在 Proxy 中做 JWT 验签**——验签是异步 crypto 操作，在 Proxy 层执行会拖慢所有请求。

```typescript
// ✅ proxy.ts 的正确职责：仅检查 Cookie 存在性 + 路由白名单
export function proxy(request: NextRequest) {
  // 白名单放行
  if (isPublicPath(pathname)) return NextResponse.next();
  // Cookie 存在性检查（不验签）
  if (!request.cookies.get(COOKIE_NAMES.JWT)) {
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}
```

JWT 有效性校验由 `resolveIdentity()`（在 Server Component 的 `<Suspense>` 边界内）完成，不在 Proxy 中重复。

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
| `data.ts` 简单查询用 `db.query.xxx.findFirst()` | 简单查询（无嵌套 JOIN）改为 `db.select().from().where().limit(1)` |
| 写 Action 只调 `revalidatePath` 不调 `updateTag` | 追加 `updateTag('xxx-list')`（v16 新 API，即时失效） |
| `'use cache'` 函数内调用 `cookies()` / `headers()` / `searchParams` | 在外层读取后作为函数参数传入（缓存隔离） |
| 访问 cookies/headers 的 Server Component 未包裹 `<Suspense>` | 静态壳 + 动态内容模式（PPR 要求） |
| `export const runtime = 'nodejs'` in API route | v16 + cacheComponents + Turbopack 编译错误，移除 |
| `export const dynamic = 'force-dynamic'` in page/layout | v16 已移除，Turbopack 编译错误，移除 |
| 将 cookies() / headers() 返回的 Promise 作为 prop 传入 `'use cache'` 组件 | 先 await 提取纯值再传入（防止构建超时 hang） |
| 用 `connection()` 替代 `<Suspense>` 来包裹 cookies/headers 调用 | `connection()` 仅用于非确定性操作（Math.random 等），与 cookies/headers 机制不同 |

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
- `data.ts` 简单查询使用 `db.query.xxx.findFirst()`（无嵌套 JOIN 的场景应用 `db.select()` 风格）
- 写操作只调 `revalidatePath` 未调 `updateTag`（v16 缓存失效不完整）
- 返回给客户端的 data 中包含 `Temporal.Instant` 而非 ISO 字符串（API Route JSON 序列化兼容性）
- API route 写 `export const runtime = 'nodejs'`（Turbopack + cacheComponents 编译错误）
- page/layout 写 `export const dynamic = 'force-dynamic'`（v16 编译错误，export 已移除）
- `'use cache'` 内调用 `cookies()` / `headers()` / `searchParams`（缓存作用域冲突）
- 访问 cookies/headers 的 Server Component 不在 `<Suspense>` 边界内（PPR prerendering 中断）
- 将 cookies() 返回的 Promise 作为 prop 传给 `'use cache'` 组件（构建超时 hang）

> **完整规范详见** `docs/portal-architecture-guidelines.md`（含 React 19 组件模式、安全三层防御、Temporal API 详解、eslint-plugin-boundaries 配置等）。
