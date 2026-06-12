---
date: 2026-06-12
topic: portal-ddd-architecture
---

# Portal DDD 架构重构

## Summary

将 Portal 后端重构为纯领域层 + 薄 Controller 的 DDD 架构。领域层函数式 + Branded Types、零依赖 Next.js；Controller 层复用现有 REST Route Handler，同时在表单交互场景引入 Server Actions 做浏览器侧 Controller，两者都只做参数适配并调用相同的领域函数；基础设施层用 Drizzle 实现仓储接口。

---

## Problem Frame

当前 Portal 存在三类架构问题：

**1. 领域逻辑耦合在框架层。** 以 Users 为例，读路径 `data.ts` 把鉴权检查、Drizzle 查询、数据映射写在一起——需要 mock `next/headers` 才能测试。写路径 27 个 REST Route Handler（`app/api/*/route.ts`）内联了 Drizzle 查询、数据范围过滤、审计日志和响应格式化。无论是读还是写，领域逻辑都无法脱离 Next.js 独立测试。

**2. 多个 BC 的 page.tsx 是纯 Client Component 巨石。** roles（26K）、menus（18K）、permissions（17K）、departments（15K）的 page.tsx 全部以 `'use client'` 开头——它们是 UI 组件拆分问题，不是后端领域逻辑耦合问题。但其中内联的数据获取、状态管理和业务规则判断仍然不可测试。

**3. `lib/` 目录职责不清。** 12 个文件混在一起——有纯领域逻辑（permissions.ts 的角色-权限查询）、有基础设施（redis.ts、db.ts）、有框架适配（auth-middleware.ts 混了 Cookie 读取和权限规则）。

**目标：** 建立清晰的领域层/基础设施层/表现层三层分离，让领域逻辑可独立测试。对于 Client Component 巨石，通过组件拆分和自定义 hooks 提取来缩小文件体积，再逐步将其中隐含的业务规则下沉到领域层。

---

## Actors

- A1. **后端开发者**：编写和维护领域逻辑、仓储实现、Server Actions
- A2. **前端开发者**：编写 Server Components 和 Client Components，通过薄 Controller 获取数据
- A3. **测试编写者**：为领域层写单元测试、为仓储写集成测试、为 Controller 写 API 测试

---

## Key Flows

- F1. **新增一个业务操作（以"创建用户"为例）**
  - **Trigger:** 管理员在用户管理页提交创建表单
  - **Actors:** A1, A2
  - **Steps:**
    1. `CreateUserDrawer.tsx` 调用 Server Action `createUserAction(prevState, formData)`（浏览器侧）或 POST `/api/users`（Gateway/外部客户端）
    2. Controller 层解析 FormData 为 DTO，调用鉴权
    3. Controller 层调领域函数 `createUser(props)` 构建用户对象
    4. Controller 层调 `userRepo.save(user)` 持久化
    5. Controller 层调 `revalidatePath('/users')`（Server Action）或返回 JSON 响应（Route Handler）
  - **Outcome:** 用户创建成功，列表页自动刷新
  - **Covered by:** R1, R2, R3, R7, R9

- F2. **为领域逻辑写单元测试**
  - **Trigger:** 开发者修改了用户激活/禁用规则
  - **Actors:** A3
  - **Steps:**
    1. 在 `__tests__/domain/user.test.ts` 中写纯函数测试
    2. 测试不依赖任何框架，直接 import 领域函数
    3. 构造输入，断言输出
  - **Outcome:** 秒级反馈，无需启动 Next.js
  - **Covered by:** R12

- F3. **将现有巨石 page.tsx 拆分为新架构**
  - **Trigger:** 准备重构 roles BC
  - **Actors:** A1
  - **Steps:**
    1. 从旧 page.tsx 提取领域逻辑 → `domain/role/role.ts`
    2. 提取数据访问 → `infrastructure/persistence/drizzle-role-repo.ts`
    3. 创建薄 Controller → `app/roles/_actions.ts`（仅用于写操作）
    4. page.tsx 改为 Server Component，直接调领域函数或仓储查询获取数据（读操作）
    5. 提取 Client Components → `app/roles/components/`（UI 交互）
    6. 旧 page.tsx 删除
  - **Outcome:** roles BC 与 users BC 架构一致，可独立测试
  - **Covered by:** R4, R5

---

## Requirements

> 本需求按三阶段组织，对应 Key Decision #5 "首选更简单的替代方案，迭代到全量 DDD"。每个 BC 完成 Phase 1 后评估是否进入后续阶段。

### Phase 1 — 必须：纯函数提取

- R1. 领域层必须零依赖 Next.js——不 import `next/headers`、`next/cache`、`next/server`、`server-only`
- R3. 聚合根的领域行为定义为纯函数（`createUser`、`activateUser`、`disableUser`），输入输出为 plain object，不含副作用
- R8. Redis 缓存逻辑封装在基础设施层，不直接出现在领域函数中

**Phase 1 验收标准：** 领域函数可在纯 Node 环境（`vitest --environment node`）中直接 import 并测试，无需 mock 任何 Next.js API。若该 BC 在此阶段已达成可测试性目标且代码质量可接受，后续阶段可跳过。

### Phase 2 — 按需：Repository 接口 + 基础设施

- R4. 仓储接口（`UserRepository`、`RoleRepository` 等）在领域层定义为 TypeScript interface，方法签名只用领域类型，不暴露 ORM 细节
- R5. 每个 BC 的领域目录结构统一为 `types.ts`（Zod schema + 基础类型）、`<entity>.ts`（聚合根函数）、`repository.ts`（接口）
- R6. 仓储实现放在 `infrastructure/persistence/`，用 Drizzle ORM 实现领域层定义的 Repository 接口，负责领域对象 ↔ DB 行的双向映射
- R7. 鉴权适配器（`infrastructure/auth/`）封装 Better Auth API 调用，对外暴露 `requireAuth(permissions)` 等纯接口，领域层不感知 Better Auth

**Phase 2 验收标准：** Controller 层不再直接 import Drizzle 或 Better Auth——所有数据访问通过 Repository 接口，所有鉴权通过适配器。

### Phase 3 — 条件：Branded Types

- R2. 当某个 BC 出现因纯 string ID 导致的类型混淆 Bug（如用 UserId 误传给 RoleId 参数且未被 TypeScript 捕获），对该 BC 引入 Branded Types（`UserId`、`RoleId` 等）并用 Zod schema 做边界校验。未出现此类 Bug 的 BC 继续使用 plain string ID

**Phase 3 验收标准：** 引入 Branded Types 后，原本会被 TypeScript 放行的跨类型 ID 误传变为编译期错误。

### 表现层

- R9. Controller 层（REST Route Handler 和 Server Actions）的职责：(a) 解包 HTTP 参数（FormData/Request）并调用鉴权适配器；(b) 调用领域函数执行业务逻辑；(c) 通过仓储接口持久化变更；(d) revalidatePath（Server Action）或返回 JSON 响应（Route Handler）。不包含 SQL 查询或业务规则判断
- R10. Server Components（`page.tsx`）作为读模型直接调领域函数或仓储查询获取数据，不做数据变更
- R11. Client Components 放在 `components/` 目录下，通过 Server Actions 触发写操作，通过 props 接收只读数据

### 测试体系

- R12. 领域层测试为纯单元测试：直接 import 领域函数和 Zod schema，不 mock 任何外部依赖
- R13. 仓储实现测试为集成测试：连接测试数据库，验证 Drizzle 查询与领域类型的映射正确性
- R14. Controller 测试（API 层）mock 仓储接口和鉴权适配器，验证 Server Action 的参数校验和返回格式
- R15. 每个 BC 的领域测试文件带有 `@req` 标注，关联需求矩阵中的对应需求 ID

### 迁移策略

- R16. 迁移必须以 BC 为单位渐进进行，每次只重构一个有界上下文，确保现有测试不退化。跨 BC 依赖（如 `userRoles`、`rolePermissions`、`getDataScopeFilter()`）通过以下策略处理：(a) 仓储实现内部直接查询 Drizzle schema 处理跨表关联，不等待被引用 BC 的迁移；(b) 每个 BC 迁移完成后，其 Repository 接口成为被引用方的官方 API；(c) 迁移中的 Context 同时存在新旧代码——旧路径继续可用，新路径逐步替换
- R17. Users BC 作为第一个参考实现——将其现有 `data.ts`（读路径）和 `app/api/users/route.ts`（写路径）中的领域逻辑下沉到 `domain/user/`，同时将 Route Handler 改造为调用领域函数的薄 Controller，行为不变
- R18. 迁移顺序：Users（参考实现，含 Route Handler 改造）→ Roles → Permissions → Departments → Clients → Menus → 清理 `lib/` 冗余代码。每个 BC 迁移时同步处理其对应的 Route Handler 文件

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given `domain/user/user.ts`，when `import { createUser } from '@/domain/user/user'` 在纯 Node 环境执行，then import 成功且不触发任何 Next.js 模块加载错误。
- AE2. **Covers R9.** Given `app/users/_actions.ts` 中的 `createUserAction`，when 其被调用，then 函数体不超过 20 行，不包含任何 SQL 查询或业务规则判断。
- AE3. **Covers R12.** Given `__tests__/domain/user.test.ts`，when 运行 `vitest --environment node`（非 jsdom），then 测试在 100ms 内完成，且不需要 mock `next/headers` 或 `next/cache`。
- AE4. **Covers R17.** Given Users BC 重构完成，when 运行 `pnpm test:api` 中 Users 相关的测试用例，then 全部通过，且测试文件的修改仅限于 import 路径变更和领域值构造适配（如 `UserId` 类型构造）。现有测试的 HTTP 语义和断言逻辑不受影响。
- AE5. **Covers R9（REST Handler 瘦身）.** Given `app/api/roles/route.ts` 重构完成，when 检查其 GET/POST handler 的 import 和函数体，then 不直接 import Drizzle（`drizzle-orm`）、`@/lib/permissions`、`@/lib/audit`——数据访问通过 Repository 接口，权限检查通过鉴权适配器，审计通过审计服务。

---

## Success Criteria

- 每个 BC 的领域层函数可以被独立导入和测试，无需启动 Next.js 进程
- 所有现有 API 测试用例在重构后保持通过，行为不变
- `lib/` 目录最终只保留跨 BC 的共享胶水代码（db.ts、auth.ts、audit.ts），文件数从 12 降到 6 以内
- roles、permissions、menus、departments 的 page.tsx 从当前 15K~26K 降到 5K 以内

---

## Scope Boundaries

- 不碰认证基础设施（Better Auth、JWT、session.ts）——它们作为外部服务被基础设施层封装
- 不改 packages/contracts 的结构——现有共享类型和错误码保持不变
- 不改变用户体验和 UI 外观——这是纯后端架构重构
- 不迁移 E2E 测试——E2E 覆盖的关键路径不受影响
- 不引入 DI 容器或 IoC 框架——依赖通过模块级导入和函数参数显式传递
- 不创建抽象基类或通用 Repository 模式——每个 BC 的 Repository 接口独立定义
- REST Route Handler 保留为对外 API 契约——它们会被改造为调用领域函数的薄 Controller，但 HTTP 接口签名和行为不变。Gateway 和外部客户端的程序化访问不受影响

---

## Key Decisions

- **函数式 + Branded Types over 类 + 接口**: TypeScript 社区习惯，不需要 DI 容器，纯函数可直接测试，Branded Types 在编译期提供类型安全而不引入运行时开销
- **REST Route Handler + Server Actions 双 Controller 模式**: 保留 27 个现有 Route Handler 作为程序化访问（Gateway、外部客户端）的标准 HTTP 接口，同时在表单交互场景新增 Server Actions 利用 revalidatePath 减少样板代码。两者均调用相同的领域函数，避免逻辑重复
- **每个 BC 独立 Repository 接口 over 通用 BaseRepository**: 避免过早抽象，每个 BC 的数据访问需求不同（Users 需要分页+数据范围过滤，Roles 需要权限绑定）
- **渐进迁移 over 大爆炸重写**: 以 BC 为单位逐个重构，每个 BC 重构后合并回 main，保证主干始终可部署
- **首选更简单的替代方案，迭代到全量 DDD**: 第一阶段提取纯函数到独立模块（可脱离 Next.js 测试）；第二阶段引入 Repository 接口和基础设施层；第三阶段按需引入 Branded Types。避免一次性投入全部 DDD 基础设施，仅在简单方案证明不足时增加复杂度

---

## Dependencies / Assumptions

- Drizzle ORM 和 postgres-js 继续作为持久化方案
- Better Auth 的 API（`auth.api.getSession`）保持稳定
- 当前测试体系（Vitest + @req 标注 + traceability）在重构后继续运作
- Node.js 环境支持 TypeScript path alias（`@/domain/*`）

---

## Outstanding Questions

### Resolve Before Planning

- [Affects Problem Frame][Product] 当前架构是否真的阻碍了交付？需要收集团队的实际痛点数据（Bug 率变化、开发者反馈、测试脆弱性事件）来证明全量 DDD 重构的 ROI

- [Affects Key Decisions][Product] 7 步迁移的机会成本——列出在这个重构期间会延迟的其他工作（OIDC 功能补全、安全加固、文档等），由团队明确排序

### Deferred to Planning

- [Affects R6][Technical] Drizzle schema 类型与领域类型的双向映射是否统一放在 Repository 实现中，还是抽一个独立的 Mapper 层
- [Affects R13][Technical] 仓储集成测试用内存数据库（pglite）还是 Docker PostgreSQL
- [Affects R2][Technical] Branded Types 是否用 `zod` 的 `.brand()` 方法还是手写 `__brand` 标记——需评估两者对 LSP/IDE 体验的影响
- [Affects Success Criteria][Technical] `lib/` 目录从 12 降到 6 的具体方案——需逐文件审计确定每个文件的归属（迁移到 BC domain、移到 infrastructure/、保留为共享胶水代码、或删除）
- [Affects R9][Technical] Server Actions "不超过 20 行"的约束需要 CI 检查（如 ESLint `max-lines-per-function` 规则），否则属于空洞声明
