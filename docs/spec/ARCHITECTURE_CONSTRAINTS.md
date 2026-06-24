# Auth-SSO 架构约束指南 (Architecture Constraints Guide)

**版本**: v1.0 · **状态**: 正式生效 · **最后更新**: 2026-06-24

> 本文档定义了 Auth-SSO 项目所有代码贡献者**必须遵守**的架构约束。每条约束具有**一票否决权 (One-Vote Veto)**——违反任意一条的 PR 不得合并。本文档是 Code Review 与质量门禁的核心依据。

---

## 一、核心约束 (Core Rules)

### R1. Controller ≤ 20 行，零业务逻辑

Server Action 与 Route Handler 只做编排：Zod 校验 → 调领域函数 → DB 写入 → 响应。Controller 内**严禁出现** if/else 业务分支、状态判定、字段合并、或默认值赋值。

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

### R7. 统一数据范围过滤

所有读取路径**必须**使用 `applyDataScopeFilter(query, scopeFilter, userId)`。**严禁**在 `data.ts` 中重复 `if (scopeFilter.type === 'LIST')` 分支。

```typescript
// data.ts —— ✅ 统一调用
const scopeSQL = applyDataScopeFilter(scopeFilter, schema.users.deptId, schema.users.id, userId);
if (scopeSQL === null) return { data: [], pagination: { total: 0 } };   // 无权限
if (scopeSQL !== undefined) conditions.push(scopeSQL);                   // 有限范围
// undefined → type === 'ALL'，不追加任何条件
```

### R8. 三层鉴权体系

| 层 | 位置 | 机制 |
|---|---|---|
| Layout | 页面路由 | `requirePermission` 组件守卫 |
| Server Action | actions.ts | `withAuth` HOF 包裹 |
| API Route | route.ts | `withPermission` 包装器 |

```typescript
// Layout —— requirePermission
export default async function UsersLayout({ children }) {
  await requirePermission(['user:list']);
  return <>{children}</>;
}

// Server Action —— withAuth
export const createUserAction = withAuth(
  { permissions: ['user:create'] },
  async (_ctx, input) => { /* ... */ },
);

// API Route —— withPermission
export async function GET(request: NextRequest) {
  return withPermission({ permissions: ['role:list'] }, async () => {
    const result = await getRoles(params);
    return NextResponse.json(result);
  });
}
```

### R9. Temporal API

领域实体时间字段使用 `Temporal.Instant`。`new Date()` **仅限** Drizzle 写入列 (`createdAt`, `updatedAt`)。

```typescript
// domain/user/user.ts —— ✅ Temporal.Instant
export interface User {
  createdAt: Temporal.Instant;
  deletedAt: Temporal.Instant | null;
}

// domain/user/user.ts —— 转换到 DB 行时 new Date()
export function userToInsertRow(u: User) {
  return { createdAt: new Date(u.createdAt.epochMilliseconds) };
}
```

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
// data.ts —— ✅ 只读模型
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';

export async function getUsers(scopeFilter, userId, params) {
  'use cache';
  cacheLife('minutes');
  cacheTag('users-list');
  // ... Drizzle 查询
}

// route.ts —— ✅ 委托给 data.ts
export async function GET(request: NextRequest) {
  return withPermission({ permissions: ['user:list'] }, async (userId) => {
    const result = await getUsers(scopeFilter, userId, params);
    return NextResponse.json(result);
  });
}
```

### R12. 缓存策略 (Next.js 16)

- 列表查询：`'use cache'` + `cacheTag()` + `cacheLife()` 在 data.ts 中使用
- 写操作：`revalidatePath()` + `updateTag()` 在 actions.ts 中使用
- **严禁**在 `'use cache'` 作用域内访问 `cookies()` / `headers()` / `searchParams`
- 动态 API 必须包裹在 `<Suspense>` 边界内

### R13. 层依赖规则

```
app/         → domain/, lib/, infrastructure/   ✅
lib/         → domain/, infrastructure/         ✅
infrastructure/ → lib/, domain/                ✅
domain/      → ANY OTHER                        ❌ (零外部依赖)
```

`domain/` 层**不得**引入 `next/`、`react/`、Drizzle 或任何非 `@auth-sso/contracts`、`jose`、`bcryptjs` 的 npm 包。

---

## 二、红线检查清单 (Red Flags)

Code Review 中发现以下任意模式，**立即停止合并，必须重构**：

| # | 红线模式 | 违反的规则 |
|---|---|---|
| 1 | Controller 中出现 `if` 业务条件判定 | R1 |
| 2 | Controller 中手写 `instanceof` 错误分支 | R2 |
| 3 | Controller 超过 20 行有效代码 | R1 |
| 4 | `data.ts` 中重复 `if (scopeFilter.type === 'LIST')` | R7 |
| 5 | 循环内执行 `db.update()` / `db.insert()` | R3 |
| 6 | domain 实体使用 `z.object()` 定义 | R5 |
| 7 | 手写列名映射 `{ id: user.id, name: user.name }` | R6 |
| 8 | domain 层 `import` 了 `next/`、`react/`、`drizzle-orm` | R13 |
| 9 | `'use cache'` 函数内出现 `cookies()` / `headers()` | R12 |
| 10 | 枚举值在 contracts 外另起炉灶定义 | R4 |
| 11 | `new Date()` 出现在 domain 实体函数中 | R9 |
| 12 | API Route 中直接查询 DB 而非委托 data.ts | R11 |

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

---

## 四、Controller 骨架 (Skeleton Templates)

### Server Action

```typescript
'use server';
import { withAuth, type AuthContext } from '@/lib/auth';
import { db, schema } from '@/infrastructure/db';
import { revalidatePath, updateTag } from 'next/cache';

export const createEntityAction = withAuth(
  { permissions: ['entity:create'] },                // 权限码
  async (_ctx: AuthContext, raw: unknown) => {       // ← 不超 20 行
    const parsed = InputSchema.safeParse(raw);
    if (!parsed.success) return { success: false, error: 'VALIDATION_ERROR', message: ... };

    const result = await db.transaction(async (tx) => {
      const entity = createEntity(parsed.data, generateUUID);
      await tx.insert(schema.entities).values(toInsertRow(entity));
      return entity;
    });

    revalidatePath('/entities');
    updateTag('entities-list');
    return { success: true, data: { id: result.id } };
  },
);
```

### Route Handler GET

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { getEntities } from '@/app/(dashboard)/entities/data';

export async function GET(request: NextRequest) {
  return withPermission({ permissions: ['entity:list'] }, async (userId) => {
    const sp = request.nextUrl.searchParams;
    const result = await getEntities({                                     // 委托 data.ts
      page: parseInt(sp.get('page') || '1', 10),
      pageSize: parseInt(sp.get('pageSize') || '10', 10),
      keyword: sp.get('keyword') || '',
    });
    return NextResponse.json(result);
  });
}
```

### Route Handler POST

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/auth';
import { db, schema } from '@/infrastructure/db';
import { mapDomainError } from '@/domain/shared/error-mapping';

export async function POST(request: NextRequest) {
  return withPermission({ permissions: ['entity:create'] }, async (userId) => {
    try {
      const body = await request.json();
      const parsed = InputSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: 'VALIDATION', message: ... }, { status: 400 });

      const result = await db.transaction(async (tx) => {
        const entity = createEntity(parsed.data, generateUUID);
        await tx.insert(schema.entities).values(toInsertRow(entity));
        return entity;
      });

      return NextResponse.json({ success: true, data: { id: result.id } }, { status: 201 });
    } catch (err) {
      const mapped = mapDomainError(err);                  // 统一错误映射
      return NextResponse.json({ error: mapped.error, message: mapped.message }, { status: mapped.status });
    }
  });
}
```

---

## 五、proxy.ts 职责边界

`apps/portal/src/proxy.ts` 是 Next.js 中间件级的请求守卫，其职责严格限定为：

- **做**: Cookie 存在性检查（检查 `portal_jwt_token` 是否存在）
- **做**: 路径白名单放行（`/login`、`/oauth`、`/_next`、API 公开端点）
- **不做**: JWT 签名验证（由 API 层的 `resolveIdentity()` 处理）
- **不做**: 业务鉴权或角色/权限判定（由 `lib/auth/` 三层体系处理）
- **不做**: 任何数据库或 Redis 查询

```typescript
// proxy.ts —— 只检查 Cookie 存在与否，不验签
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();        // 白名单放行
  const jwt = request.cookies.get(COOKIE_NAMES.JWT);
  if (!jwt?.value) return NextResponse.redirect(new URL('/login', request.url));  // 跳登录
  return NextResponse.next();
}
```

---

> **本指南与 ARCHITECTURE.md 形成互补：ARCHITECTURE.md 描述"系统是什么样"，本文档定义"代码该怎么写"。两者不一致时以本文档为准。**
