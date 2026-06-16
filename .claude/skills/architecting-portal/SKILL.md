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
├── app/{users}/              # 表现层（与 Next.js 耦合）
│   ├── page.tsx              # Server Component 读入口
│   ├── data.ts               # Drizzle 直调查询 + "use cache"
│   ├── actions.ts            # Server Actions（内部写）
│   └── route.ts              # REST API（仅外部集成/Webhook）
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

### 8. Auth Guard 统一鉴权

Server Action 必须用 `withAuth` HOF 包装，严禁在 Action 体内手写 `checkPermission` + `mapDomainError`。

```typescript
// ✅ 正确
export const myAction = withAuth({ permissions: ['user:create'] }, async (input) => {
  // 只写业务逻辑，无鉴权/错误处理样板
});
```

### 9. Temporal API 替代 `new Date()`

Domain 实体使用 `Temporal.Instant`。唯一允许 `new Date()` 的地方是 Drizzle 写入时的 `updatedAt` / `createdAt` 列。tsconfig 需包含 `"lib": ["esnext", "esnext.temporal"]`。

### 10. Controller 选择原则

| 场景 | 使用 |
|------|------|
| 内部页面表单/按钮 | **Server Actions** (`actions.ts`)，严禁另写 `/api/` 路由 |
| 外部集成/Webhook/跨域/脚本 | **REST Route Handler** (`route.ts`) |

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
  return { success: true, data: result };
});
```

**Route Handler（外部集成/Webhook）**：手动 `checkPermission` + try/catch `mapDomainError`。

```typescript
// Route Handler 骨架
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
| `useState(initialUser)` 全量复制 prop | 按编辑/只读维度拆分：可编辑字段进 state，只读字段直接从 prop 读 |

## Red Flags - STOP and Refactor

- Controller 函数体超过 20 行
- Controller 中出现 `if`/`else` 业务条件分支
- `catch` 块中有 `instanceof` 判断
- domain/ 中出现 `import ... from 'next/...'`
- `db.schema.ts` 或 `domain/types.ts` 中出现手写枚举字面量
- 多行写入无 `db.transaction()`
- domain entity 仍使用 `XxxPropsSchema`（应为纯 `interface`）
- Action 内手写 `checkPermission` + `catch (err) { mapDomainError(err) }` 样板

> **完整规范详见** `docs/portal-architecture-guidelines.md`（含 React 19 组件模式、安全三层防御、Temporal API 详解、eslint-plugin-boundaries 配置等）。
