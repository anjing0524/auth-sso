# User 模块重构与防腐设计规范 (2026-06-15)

本设计文档旨在规范 `user` 限界上下文的代码重构，贯彻“Zod 门禁校验 + 领域纯函数业务规则 + Drizzle 数据库直调”的系统架构，彻底践行单控制器原则（Single Controller），杜绝控制层代码冗余与业务规则流失。

---

## 1. 架构目标与重构背景

当前 `user` 模块已初步废除 Repository、DI 工厂及 Mapper 转换层，但在控制器层（Actions 及 API 路由）和表现层仍有以下问题需要彻底规范：
1. **入参门禁未完全对齐 Zod**：除创建外，更新、删除、读取等 Action 的入参并未严格通过 Zod Schema 门禁。
2. **写操作双重控制器冗余**：虽然 UI 已改调 Server Action，但 `/api/users` 网关中仍冗余保留了 `POST`, `PUT`, `DELETE` 的写操作控制器。
3. **表现层客户端 Fetch 负担**：Dashboard 组件仍然在客户端使用 `useEffect` + `fetch` 的方式去拉取用户数、角色数等只读统计指标，引入了冗余网络开销与客户端 Loading 维护状态。

---

## 2. 详细设计方案

### Part 1: 领域层 Zod 门禁与 Schema 补全 (`domain/user/types.ts`)
我们将在领域层新增并完善输入校验 Schema，以获取编译期强类型与运行时的绝对安全。

*   **`UpdateUserInputSchema`**：
    *   `id`: `z.string().min(1, '用户ID不能为空')` (必填)
    *   `name`: `z.string().min(1, '姓名不能为空').optional()`
    *   `email`: `z.string().email('邮箱格式不合法').optional()`
    *   `status`: `z.enum(['ACTIVE', 'DISABLED', 'LOCKED', 'DELETED']).optional()`
    *   `deptId`: `z.string().nullable().optional()`
    *   `avatarUrl`: `z.string().optional()`
*   **`UserIdentityInputSchema`**（用于详情、删除、状态切换）：
    *   `id`: `z.string().min(1, '用户ID不能为空')`

---

### Part 2: Thin Controller 与 Server Actions 重构 (`app/users/actions.ts` / API)

#### 2.1 彻底精简 REST 写入网关
*   **物理清理**：
    *   删除 `apps/portal/src/app/api/users/route.ts` 中的 `POST` 接口。
    *   删除 `apps/portal/src/app/api/users/[id]/route.ts` 中的 `PUT` 和 `DELETE` 接口。
*   **仅保留只读端点**：
    *   `GET /api/users` (分页过滤列表) 与 `GET /api/users/[id]` (详情) 继续保留，作为外部只读集成的查询接口（读模型）。

#### 2.2 重构 Server Actions
每个 Action 的函数体行数严格限制在 **≤ 20 行**。

*   **`createUserAction(prevState: any, formData: FormData)`**：
    *   外部表单数据过 Zod 校验 -> 校验权限 `user:create` -> Drizzle 查重 -> 纯函数 `createUser` 创建 -> Drizzle `insert` 落库。
*   **`toggleUserStatusAction(userIdStr: string, currentStatus: string)`**：
    *   Zod 门禁校验参数 `{ id: userIdStr }` -> 校验权限 `user:edit` -> Drizzle 读取 -> 领域纯函数 `toggleUserStatus` 运算 -> Drizzle `update` 状态落库 -> revalidatePath 刷新。
*   **`updateUserAction(userIdStr: string, input: any)`**：
    *   Zod 门禁校验参数 `{ id: userIdStr, ...input }` -> 校验权限 `user:edit` -> 确保用户存在 -> Drizzle `update` 执行修改 -> 清除权限缓存 -> revalidatePath 刷新。
*   **`deleteUserAction(userIdStr: string)`**：
    *   Zod 门禁校验参数 `{ id: userIdStr }` -> 校验权限 `user:delete` -> Drizzle 将状态 `status` 更新为 `DELETED`（逻辑删除）-> 清除权限缓存 -> revalidatePath 刷新。

---

### Part 3: Dashboard 服务端组件重构 (`app/dashboard/page.tsx`)

为了切断客户端对读模型 API 的 HTTP 依赖，我们将 Dashboard 重构为 Server Component。

1. **移除 `'use client'`** 声明。
2. **服务端直调 Drizzle**：通过 `Promise.all` 在服务端并行查询：
    *   未被删除的用户总数。
    *   活跃角色总数。
    *   受控应用总数。
    *   近 8 条审计日志（Join 用户表获取操作者用户名）。
3. **分拆加载状态 (Streaming)**：
    *   在同级目录下新建 `app/dashboard/loading.tsx`，将原有 Dashboard 的骨架屏 (Skeleton) 提取其中。
    *   Next.js 将在拉取数据时自动异步渲染骨架屏，数据就绪后直接用流式传输显示完整组件，彻底省去客户端 loading 状态维护。

---

## 4. 测试与验证策略

1. **保留领域层纯函数测试**：`__tests__/domain/user.test.ts` 保持 100% 独立于数据库运行。
2. **重构 API 与 Action 测试**：
    *   精简 `__tests__/api/user-api.test.ts` 中针对已删 REST 写入接口的模拟调用。
    *   在测试中直接引入 `app/users/actions.ts` 中暴露的 Actions 并进行调用测试（配合 mock `next/headers`），确保 Action 的入参门禁、权限拦截以及异常流程能被 100% 覆盖。
3. **跑通全量单元测试与类型校验**：
    *   执行 `npx vitest run` 保证 228 个测试全绿。
    *   执行 `pnpm typecheck` 或 `tsc --noEmit` 保证没有遗留 TS 校验错误。
