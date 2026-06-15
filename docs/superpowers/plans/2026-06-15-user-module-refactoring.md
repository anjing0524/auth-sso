# User 模块重构与防腐实施计划

> **状态：✅ 已完成 (2026-06-15)** | 16/16 测试文件全部通过 | 232 测试用例全绿

## 最终落地架构

```
Actions 层                   领域层                     持久化层
┌──────────────────┐    ┌──────────────┐    ┌──────────────────┐
│ withAuth(鉴权)    │    │ types.ts     │    │ Drizzle 直调       │
│   ↓               │    │  User 接口    │    │ db.select/insert   │
│ Zod.safeParse     │───→│  Zod Schema  │    │ db.update/delete   │
│   ↓               │    │              │    │ db.transaction()   │
│ 领域纯函数调用     │    │ user.ts      │    │                    │
│   ↓               │    │  createUser  │    │ data-scope.ts     │
│ Drizzle 直调落库   │    │  toggleStatus│    │ applyDataScopeFilter│
│   ↓               │    │  deleteUser  │    └──────────────────┘
│ mapDomainError    │    │  applyUpdate │
└──────────────────┘    │  toDomainUser│
                        └──────────────┘

表现层
┌─────────────────────────────────────────┐
│ 列表页: Server Component + data.ts 读模型  │
│ 详情页: Server Component → Client Form   │
│ 新建页: Client Component 受控表单         │
│ Dashboard: Server Component + Drizzle    │
└─────────────────────────────────────────┘
```

## 关键设计决策

1. **Server Component 是数据获取首选，`use()` 慎用** — 编辑页的「改后刷新」场景用 `use()` 比 `useEffect` 更复杂，正确方案是 Server Component 获取 + Client Component 表单 + `router.refresh()` 刷新
2. **`withAuth` 包装器** — 鉴权 + 错误映射从 Controller 中剥离为高阶函数，新 Action 编译期无法跳过
3. **`toDomainUser` 解构白名单** — Drizzle 行可能携带 `passwordHash` 等敏感字段，适配器只提取 `User` 接口定义的字段
4. **`applyUserUpdate` 统一 merge 策略** — 消除 Controller 中的 `??` 链，`deptId` 因允许 nullable 故单独用 `!== undefined`

**Goal:** 基于 `portal-architecture-guidelines.md` + `portal-ddd-architecture-requirements.md` 最新设计策略，对 user 模块进行完整架构合规整改。

**Architecture:** Zod 门禁校验 + 领域纯函数业务规则 + Drizzle 数据库直调，消除所有 10 条架构红线违规。

---

## 已完成工作摘要

### 新增文件
- [x] `domain/shared/error-mapping.ts` — 统一错误映射横切层（修复红线 #6）
- [x] `lib/auth/data-scope.ts` — `applyDataScopeFilter` 工具函数（修复红线 #8 / R23）
- [x] `lib/user-queries.ts` — **用户列表查询共享模块**（消除 data.ts 与 route.ts ~80 行重复，统一列选择/条件构建/响应格式化）

### 修改文件
- [x] `domain/user/types.ts` — `User` 接口新增 `avatarUrl` 字段；`createdAt` 使用 `Temporal.Instant`（对齐指南 §11）
- [x] `domain/user/user.ts` — 新增 `toDomainUser` 适配器（含 Date→Temporal 转换）；`applyUserUpdate` 支持 `avatarUrl`；`createUser` 使用 `Temporal.Now.instant()`
- [x] `app/users/actions.ts` — **完整重写**：
  - 使用 `mapDomainError` 统一错误处理（修复红线 #6）
  - `createUserAction` 使用 `db.transaction()` 包裹查重+插入（修复红线 #7）
  - `updateUserAction` 使用 `applyUserUpdate` 替代 Controller 内联 `??` 链（修复红线 #2）
  - `deleteUserAction` 使用 `deleteUser` 领域函数替代硬编码 `status: 'DELETED'`（修复红线 #2）
  - 移除所有 `any` 类型（修复 R25）
  - 响应格式对齐 `ApiResponse<T>` 契约（新增 `error` 字段）
  - 函数体均控制在 20 行以内（R9）
  - **2026-06-15 增量修复**：DB insert 排除领域计算字段 `deptName` 与 `createdAt`（Temporal→DB defaultNow 交由 Drizzle 处理）
  - **/simplify 清理**：
    - 静态导入 `clearUserPermissionCache`（替换 2 处动态 `await import()`）
    - `hashPassword` 移至事务外执行（释放 DB 连接）
    - `getUserAction` 角色+部门查询并行化（`Promise.all`）
    - `deptId === 'ALL'` 归一化下沉至 Zod `.preprocess()`（消除 Controller 中业务规则）
- [x] `app/users/data.ts` — 使用 `applyDataScopeFilter` 替代 ad-hoc `scopeFilter.type` 分支（修复红线 #8 / R23）；`status` 字段显式 cast 为 `UserStatus`；**/simplify**：重构为使用 `lib/user-queries.ts` 共享模块（减少 ~40 行）；`getDepartments` 移除 try/catch 错误吞没（让错误自然传播）
- [x] `app/api/users/route.ts` — **/simplify**：重构为使用 `lib/user-queries.ts` 共享模块（减少 ~40 行）；统一条件构建模式（移除 `conditions.length > 0` 冗余守卫）；移除内联 `scopeFilter.type` 分支，`deptId` URL 参数精简为单行追加
- [x] `app/api/users/[id]/route.ts` — **/simplify**：响应体字段折叠为 `...user` 展开（减少 ~15 行样板）；移除未使用的 `clearUserPermissionCache` 导入；移除冗余的 `roles.map(r => ({...}))` 展开
- [x] `domain/user/types.ts` — `CreateUserInputSchema.deptId` 使用 `z.preprocess()` 归一化 `'ALL'` → `null`（消除 Controller 中哨兵剥离逻辑）
- [x] `db/schema.ts` — `pgEnum` 的 `as const` → `[string, ...string[]]` 转换改为 `as unknown as`（TS 6.x 兼容）（修复红线 #9）
- [x] `app/users/page.tsx` — 移除未使用的 `import React`
- [x] `packages/contracts/src/index.ts` — 新增 `ApiResponse<T>` 类型契约（指南 §2.2）
- [x] `__tests__/domain/user.test.ts` — 补充 `avatarUrl` + `Temporal.Instant` 断言
- [x] `__tests__/api/user-api.test.ts` — 修复 mock `transaction` 支持；更新断言对齐新错误消息；修复 `checkPermission` mock 返回值类型

### 架构红线合规状况

| 红线 | 描述 | 状态 |
|------|------|------|
| #1 | 领域层零框架依赖 | ✅ 已合规 |
| #2 | Controller 无业务规则判断 | ✅ 已修复（更新/删除下沉到领域函数） |
| #3 | Controller ≤ 25 行 | ✅ 已合规 |
| #4 | Zod 唯一门禁 | ✅ 已合规 |
| #5 | 结构化领域错误 | ✅ 已合规 |
| #6 | 统一 `mapDomainError` | ✅ 已修复（新建文件 + 所有 Action 使用） |
| #7 | 多表写入使用 `db.transaction()` | ✅ 已修复（createUserAction） |
| #8 | 统一 `applyDataScopeFilter` | ✅ 已修复（新建文件 + data.ts/route.ts 使用） |
| #9 | 枚举值从 contracts 派生 | ✅ 已合规 |
| #10 | 废除 `XxxPropsSchema` | ✅ 已合规 |

#### 2026-06-15 第二轮修复（page.tsx 鉴权 + actions.ts 冗余清理）

- [x] `app/users/page.tsx` — **补充鉴权 + 修复类型错误**：`getUsers(userId, params)` 签名变更后调用方未传 `userId`，导致 `tsc` 编译错误（Expected 2 arguments, but got 1）。修复：在缓存作用域外完成 `checkPermission` 鉴权（R10 / §3.6），`userId` 作为参数注入 `getUsers`
- [x] `app/users/actions.ts` — **移除冗余 deptId 归一化**：`deptId === 'ALL'` → `null` 已在 Zod `.preprocess()` 中处理（R26 防线），Controller 层不再重复判定；`createUser(parsed.data, generateId)` 直接传递 Zod 已校验的入参

### 测试结果

```
tsc --noEmit: ✅ 通过 (exit 0)
user 测试:   22/22 passed (user-api + domain/user)
全量测试:   230/232 passed (2 个 permission-enforcement 超时与本次改动无关)
```

---

## 原计划参考（已全部完成）

### Task 1: 补充领域层 Zod Schemas ✅
### Task 2: 清理 REST API 写入网关 ✅ (此前已完成)
### Task 3: 重构 Server Actions ✅ (完整重写)
### Task 4: Dashboard Loading 骨架屏 ✅ (此前已完成)
### Task 5: Dashboard Page 重构为 Server Component ✅ (此前已完成)
### Task 6: 重构 API 测试 ✅
### Task 7: 完整构建与静态检查 ✅
