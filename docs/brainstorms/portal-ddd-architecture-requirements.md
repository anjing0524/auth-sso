---
date: 2026-06-15
topic: portal-ddd-architecture
updated: 2026-06-15 (评估修订: Next.js 16 适配、错误映射层、Auth Guard、数据范围去重)
---

# Portal DDD 架构重构需求

## Summary

将 Portal 后端重构为**"Zod校验门禁 + 领域纯函数业务规则 + Drizzle数据库直调"**的极简大前端架构。我们推行**“单控制器选型原则”**：对于本系统内部页面交互调用的写业务，一律只开发 Server Action，彻底禁止同时开发重复的 REST 路由；只有在涉及外部集成、程序化脚本或 SSO 跨域开放服务时，才开发 Route API 控制器。这消除了多余的 Repository 接口、Mapper 映射、DI 工厂以及无意义的控制层重复开发。

本需求已针对 **Next.js 16 + React 19 + Node.js 26** 进行修订，涵盖 Cache Components（`use cache` 指令）、Middleware → Proxy 重命名、Server Function 安全模型等关键变化。

---

## Problem Frame

当前 Portal 存在四类架构问题：

**1. 领域逻辑耦合在框架层。** 以 Users 为例，写路径和读路径混合了鉴权、数据范围过滤和业务规则。Controller 中存在字段 merge 策略（`??` 链）和状态硬编码（`status: 'DELETED'`）等本应属于领域层的业务规则。领域逻辑都无法脱离 Next.js 独立快速测试。

**2. 多个 BC 的 page.tsx 是纯 Client Component 巨石。** roles、menus、permissions、departments 的 page.tsx 全部以 `'use client'` 开头，内联了复杂的数据获取与业务逻辑。

**3. `lib/` 目录职责不清，鉴权模块臃肿。** `auth-middleware.ts` 约 350 行，混杂了 JWT 验证、Session 回退、权限编码检查、角色检查、数据范围检查（含递归 CTE）等多种职责。数据范围过滤逻辑在多个读路径中重复编写。

**4. 缓存策略未适配 Next.js 16。** 仍使用 `React.cache()`（仅请求级去重）而非 Next.js 16 的 `"use cache"` 持久化缓存。错误处理在各 Controller 中 ad-hoc 重复，缺少统一的领域错误 → HTTP 响应映射层。

**目标：** 建立清晰的“Zod 校验门禁 -> 领域纯函数业务规则 -> Drizzle 数据库直调”的流转链路，确保业务核心逻辑完全可独立测试（毫秒级）。消除代码重复，统一横切关注点。

---

## Actors

- A1. **后端/全栈开发者**：编写和维护领域纯函数、单控制器（仅供内部的 Server Action，或供外部的 REST Route Handler）、Drizzle 数据库直调。
- A2. **前端开发者**：编写 Server Components（直接使用 Drizzle 查询）和 Client Components（通过 Server Action 写数据）。
- A3. **测试编写者**：编写领域层的高速单元测试与端到端的集成测试。

---

## Key Flows

- F1. **新增一个写操作（以"创建用户"为例）**
  - **Trigger:** 管理员在用户管理页提交创建表单。
  - **Actors:** A1, A2.
  - **Steps:**
    1. 根据选型矩阵判定：该操作仅服务于内部页面，故 `CreateUserDrawer.tsx` 仅触发调用 Server Action `createUserAction`（严禁编写重复的 POST `/api/users` 路由，除非该路由需要对外提供开放同步服务）。
    2. Controller 执行 Zod 门禁校验与权限校验（通过 `withAuth` 包装器强制统一）。
    3. Controller 使用 `db.transaction()` 包裹"查重 + 插入"步骤，保证原子性。
    4. Controller 调用领域纯函数（如 `createUser`）计算出最新的领域实体模型。
    5. Controller 使用 Drizzle 直调（`tx.insert`）将实体持久化到数据库。
    6. Action 通过 `updateTag('users-list')` 精确失效读缓存（或降级使用 `revalidatePath('/users')`）。
  - **Outcome:** 用户创建成功，列表页自动刷新。
  - **Covered by:** R1, R3, R9, R20, R22

- F2. **为领域核心规则写单元测试**
  - **Trigger:** 开发者修改了用户激活/禁用的业务规则。
  - **Actors:** A3.
  - **Steps:**
    1. 在 `__tests__/domain/user.test.ts` 中针对领域纯函数编写测试。
    2. 测试不依赖任何数据库和 Next.js 运行时，直接运行并于毫秒级反馈。
  - **Outcome:** 纯函数单元测试在毫秒级内跑完，无需 mock 任何数据库和框架服务。

- F3. **重构现有巨石 page.tsx**
  - **Trigger:** 准备重构 roles BC。
  - **Actors:** A1.
  - **Steps:**
    1. 从旧 page.tsx 中剥离业务判断逻辑，下沉至 `domain/role/role.ts` 纯函数中。
    2. 在 page.tsx (Server Component) 或是专门的查询 helper 中，直接使用 Drizzle 调取只读扁平对象（读模型）。
    3. 写操作提取到 actions 中作为薄 Controller，使用 Zod 做入参检验，调领域函数并 Drizzle 直调写入。
  - **Outcome:** roles BC 的读写路径分离，代码易读易维护。

---

## Requirements

### 核心规范要求

- R1. **领域层零依赖框架**：`domain/` 目录下的代码严禁 import 任何框架模块（如 `next/*`）或第三方持久化模块（如 `drizzle-orm`），只使用原生 TS 和基础库。
- R2. **入参 Zod 唯一门禁**：所有控制器（Server Actions / Route Handlers）的外部输入必须首先通过 Zod Schema 解析（不手写 `if (!field)`），校验成功即获得强类型保障，失败则立刻中止。
- R3. **核心业务下沉纯函数**：状态机切换、行为计算、数据转换必须下沉为输入输出皆为 Plain Object 的**纯函数**。
- R8. **错误结构化表达**：统一使用领域错误类型体系（`DomainError` 的各派生子类，如 `BusinessRuleViolationError`）来表达业务规则冲突，严禁裸 `throw new Error()`。
- R9. **薄 Controller 职责约束**：Controller 限制在 20 行以内。只能进行三件事：Zod 门禁校验、调用领域纯函数、Drizzle 数据库直调持久化。

### 表现层与测试

- R10. **读写分离与读路径直调**：只读查询直接调用 Drizzle 执行，无需经过领域层或任何 Repository 接口封装。启用 `cacheComponents` 后使用 `"use cache"` + `cacheLife()` 实现跨请求持久化缓存，配合 `cacheTag()` 标签化精确失效。未启用时降级使用 `React.cache()` 实现请求级去重。
- R12. **极致高频 TDD**：领域层核心业务必须配备纯单元测试（`vitest`），严禁在单测中引入 mock 数据库或框架的行为。
- R19. **架构边界自动化守护**：使用 `eslint-plugin-boundaries` 强拦截非法导入（例如领域层 import 了 Drizzle 或 Next.js 模块），违反者 CI 直接挂掉。

### 横切关注点与防腐层（2026-06-15 评估新增）

- R20. **统一错误映射出口**：Controller 层统一通过 `mapDomainError(err)` 将领域错误转为 HTTP 响应，严禁在各 Controller 中手写 `if (err instanceof XxxError)` 分支。映射函数位于 `domain/shared/error-mapping.ts`，属于纯横切关注点，无副作用。
- R21. **三层鉴权防御（Gateway 验签 + Proxy CSRF + withAuth 精细鉴权）**：Gateway 做 JWT 离线验签，Proxy 做 CSRF，Server Action 层通过 `withAuth(permissions, handler)` 做精细"是否有权限"检查（需 DB 查询）。Gateway/Proxy 不可访问 Drizzle，不得在其中做 DB 依赖的权限校验。
- R22. **Controller 显式事务包裹**：涉及多表或多步骤写操作（如"查重 + 插入"、"读取 + 更新"）的 Controller 必须使用 `db.transaction()` 包裹，事务内所有操作使用 `tx` 实例，严禁混用全局 `db`。
- R23. **数据范围过滤统一抽取**：所有读路径（`data.ts`、GET Route）中**严禁**重复编写 `scopeFilter.type` 分支逻辑。必须抽取 `applyDataScopeFilter(query, scopeFilter, userId)` 工具函数，集中管理数据范围过滤条件构建。
- R24. **鉴权中间件拆分**：`auth-middleware.ts` 拆分为 `lib/auth/verify-jwt.ts`（身份验证）、`lib/auth/check-permission.ts`（权限/角色检查）、`lib/auth/data-scope.ts`（数据范围过滤）。`auth-middleware.ts` 保留为统一入口，组合子模块。
- R25. **Server Action 入参类型安全**：Server Action 的入参不得使用 `any` 类型（如 `firstArg: any`），必须定义明确的 Zod Schema 并通过 `z.infer` 推导类型。双签名兼容（`FormData` vs plain object）通过函数重载或明确的类型守卫实现。
- R26. **类型单一真相源，消除 Zod/Drizzle/TS 三层重复**：枚举值集合（如 `UserStatus` 的合法值）只在 `@auth-sso/contracts` 中以 `as const` 数组定义一次。`domain/` 中的 `z.enum()` 和 `db/` 中的 `pgEnum()` 均从 contracts 导入同一数组派生。**废除 `XxxPropsSchema`**（如 `UserPropsSchema`），Domain 实体改用纯 `interface`，与 Drizzle `$inferSelect` 的兼容性由 `db/schema.ts` 中的编译期类型守卫保证。严禁在 domain/ 或 db/ 中手写枚举字面量。

---

## Acceptance Examples

- AE1. **Covers R1.** Given `domain/user/user.ts`，when `import { createUser } from '@/domain/user/user'`，then 可以在任意纯 TypeScript / Node 环境下无缝加载，无任何 Next.js 报错。
- AE2. **Covers R9.** Given `createUserAction`，when 检查其行数和逻辑，then 其函数体不超过 20 行，仅包含 Zod 校验、领域纯函数调用和 Drizzle 直接写库操作，没有包含内联的业务规则计算（如状态机状态转移）。
- AE3. **Covers R12.** 当运行 `vitest` 测试 `__tests__/domain/user.test.ts` 时，单测无需 mock `db` 或 `headers`，并且在 20ms 内跑完。
- AE4. **Covers R19.** 如果开发者尝试在 `domain/user/user.ts` 中 `import { db } from '@/lib/db'`，运行 `pnpm lint` 时 ESLint 将抛出边界阻断错误。
- AE5. **Covers R8.** 调用 `toggleUserStatus` 处理已被逻辑删除的用户，能够捕获到具体的 `BusinessRuleViolationError` 异常，而非普通的 `Error`。
- AE6. **Covers R20.** 当 Controller 的 catch 块捕获到任何领域错误时，调用 `mapDomainError(err)` 即可获得 `{ status, error, message }` 的统一映射结果，无需手写 `instanceof` 分支。
- AE7. **Covers R21.** 新的 Server Action 只需声明 `export const createXAction = withAuth({ permissions: ['x:create'] }, async (input) => { ... })` 即可自动获得鉴权 + 错误映射能力。
- AE8. **Covers R23.** 任意读路径中的数据范围过滤只需调用 `applyDataScopeFilter(baseConditions, scopeFilter, userId)` 一行代码，不再出现 5 行以上的 `if/else if` 分支。
- AE9. **Covers R26.** 新增一个 `UserStatus` 枚举值（如 `SUSPENDED`）时，只需在 `@auth-sso/contracts` 的 `USER_STATUS_VALUES` 数组中追加一项。`domain/` 的 `z.enum(USER_STATUS_VALUES)` 和 `db/` 的 `pgEnum('user_status', USER_STATUS_VALUES)` 自动获得新值，无需同步修改其他文件。

---

## Success Criteria

- 限界上下文中的业务逻辑完全下沉为纯函数，单元测试完全摆脱数据库 and 框架依赖。
- 写控制器中完全消除了 Repository 接口、Mapper 映射和 DI 工厂的间接抽象代码，开发效率大幅提升。
- `lib/` 目录归位，只保留真正的全局通用工具。`infrastructure/` 独立存放有副作用的外部适配器。
- `auth-middleware.ts` 拆分为独立子模块（身份验证 / 权限检查 / 数据范围），代码行数显著下降。
- 所有读路径的数据范围过滤统一通过 `applyDataScopeFilter` 执行，零重复分支代码。
- 所有 Controller 的错误处理统一通过 `mapDomainError` 映射，零 ad-hoc `instanceof` 分支。
- 读路径数据获取升级为 `"use cache"` 持久化缓存（或完成迁移评估）。

---

## Scope Boundaries

- **不碰认证基础设施**：Better Auth 的逻辑保持在外部。
- **不碰 UI 外观**：重构仅在表现层薄 Controller 与领域层、持久化层中进行。
- **不设仓储防腐**：彻底废弃 Repository、DI、Mapper 和工厂模式，不为“可能发生的更换数据库”增加无用复杂度。
- **不设 Branded Types**：ID、状态等均直接使用 `string` 类型。

---

## Key Decisions

- **Zod 门禁 + 领域纯函数 + Drizzle 直调**：弃用 Java 式的 Repository + DI + Mapper 三层抽象架构。以大前端最自然的薄 Controller (Server Actions / Route Handlers) 为桥梁，以 Zod 为唯一门禁，Drizzle 为直调持久化，只有业务判断内聚于 Domain 纯函数中。
- **去除 Branded Types**：基于项目规模的实际考量，取消 Branded Types 带来的强转复杂性，回归普通的 string 传值。
- **结构化错误映射**：保留并重申领域级结构化错误的使用，但将 Controller 层的错误映射集中到 `mapDomainError` 横切函数中，消除各 Controller 的 ad-hoc `instanceof` 分支。
- **`use cache` 持久化缓存**：Next.js 16 的 Cache Components 提供比 `React.cache()` 更强大的持久化缓存能力，读路径应优先采用。
- **Auth Guard 包装器模式**：用 `withAuth` 高阶函数统一 Server Action 的鉴权与错误处理，确保每个新 Action 在编译期就无法跳过安全防线。
- **基础设施层独立**：`infrastructure/` 与 `lib/` 分离——前者存放有副作用的外部适配器（bcrypt、外部 API 客户端），后者存放纯工具函数（ID 生成、crypto）。

---

## Dependencies / Assumptions

- Drizzle ORM 和 postgres-js 继续作为持久化方案。
- Better Auth 的 API（`auth.api.getSession`）保持稳定。
- 当前测试体系（Vitest）在重构后继续运作。
- Node.js 26 环境支持 TypeScript path alias（`@/domain/*`）。
- Next.js 16 `cacheComponents: true` 配置可用于 Cache Components 功能。
- Next.js 16 Middleware → Proxy 重命名已生效，`proxy.ts` 文件约定已就绪。

---

## Outstanding Questions

### Resolve Before Planning

- [Affects Problem Frame][Product] 当前架构是否真的阻碍了交付？需要收集团队的实际痛点数据（Bug 率变化、开发者反馈、测试脆弱性事件）来证明重构的 ROI。

- [Affects Key Decisions][Product] 7 步迁移的机会成本——列出在这个重构期间会延迟的其他工作，由团队明确排序。
