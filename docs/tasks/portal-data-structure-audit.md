# Portal 数据流与数据结构审计报告

> 分析范围：`apps/portal/src/` + `packages/contracts/src/`
> 审计日期：2026-06-16
> 对照规范：`docs/portal-architecture-guidelines.md`

---

## 一、发现的问题总览

| # | 类别 | 严重度 | 问题 | 状态 |
|---|------|--------|------|------|
| 1 | 重复定义 | 🔴 高 | 5 个 domain 文件各自重复定义 `entityStatusEnum` (Zod) | ✅ 已修复 |
| 2 | 重复定义 | 🟡 中 | `PermissionContext`(contracts) 与 `UserPermissionContext`(lib) 语义重叠且前者未被消费 | ✅ 已修复 |
| 3 | 重复定义 | 🟡 中 | `buildMenuTree` 和 `buildDepartmentTree` 算法完全相同 | ✅ 已修复 |
| 4 | 分层合规 | 🔴 高 | `lib/permissions.ts`, `lib/user-queries.ts`, `lib/audit.ts` 违反边界依赖 `infrastructure/` | ✅ 已修复 |
| 5 | 分层合规 | 🟡 中 | `domain/user/user.ts` 缺少 `userToInsertRow`/`userToUpdateRow`，Controller 手写列映射 | ✅ 已修复 |
| 6 | 数据一致性 | 🟡 中 | contracts `PUBLIC_ID_PREFIX` 与 domain 工厂函数中的前缀不一致（`u_` vs `user_`） | ✅ 已修复 |
| 7 | 数据一致性 | 🟡 中 | contracts `ClientBase.clientType` 字段在 DB/domain 中不存在 | ✅ 已修复 |
| 8 | 响应规范 | 🟡 中 | API Route 响应格式未统一遵循 `ApiResponse<T>` 契约 | 🔶 部分修复（指南已更新，渐进迁移） |
| 9 | 清晰度 | 🟢 低 | contracts 中 `MenuBase` 缺少 `menuType`/`sort`/`permissionCode` 等实际存在的字段 | 🔷 保持现状（MenuBase 为对外 API） |

---

## 二、问题详细分析

### 2.1 Zod `entityStatusEnum` 在 5 处重复定义（#1）

**现状**：每个 domain/types.ts 文件各自创建 `const entityStatusEnum = z.enum(ENTITY_STATUS_VALUES)`：

| 文件 | 行号 |
|------|------|
| `domain/department/types.ts:34` | `const entityStatusEnum = z.enum(ENTITY_STATUS_VALUES)` |
| `domain/role/types.ts:36` | `const entityStatusEnum = z.enum(ENTITY_STATUS_VALUES)` |
| `domain/permission/types.ts:38` | `const entityStatusEnum = z.enum(ENTITY_STATUS_VALUES)` |
| `domain/menu/types.ts:42` | `const entityStatusEnum = z.enum(ENTITY_STATUS_VALUES)` |
| `domain/client/types.ts:45` | `const entityStatusEnum = z.enum(ENTITY_STATUS_VALUES)` |

**影响**：运行时 5 次重复创建相同的 Zod schema；修改枚举值后需同步 5 处（虽然都从 `ENTITY_STATUS_VALUES` 派生，但代码冗余）。

**修复方案**：创建 `domain/shared/zod-schemas.ts`，集中导出 `entityStatusEnum`、`userStatusEnum` 等所有 Zod 枚举。

**同样问题**：`userStatusEnum`(1 处)、`dataScopeTypeEnum`(1 处)、`permissionTypeEnum`(1 处)、`menuTypeEnum`(1 处) 也建议一并提取。

---

### 2.2 `PermissionContext` 与 `UserPermissionContext` 重叠（#2）

**现状**：

```typescript
// packages/contracts/src/index.ts — 定义了但未被使用
export interface PermissionContext {
  roles: string[];        // 角色编码数组
  permissions: string[];  // 权限编码数组
  menus: string[];        // 菜单数组 ← 实际代码不包含此字段
  dataScope: DataScopeType;
  dataScopeDepts?: string[];
}

// apps/portal/src/lib/permissions.ts — 实际被使用的
export interface UserPermissionContext {
  roles: Array<{id: string; code: string; name: string}>;
  permissions: string[];
  dataScopeType: DataScopeType;
  deptId?: string;
}
```

**影响**：
- `PermissionContext` 定义的 `menus` 字段在任何地方都没有被赋值
- 字段名不一致：`dataScope` vs `dataScopeType`，`dataScopeDepts` vs `deptId`
- 开发者看到两个类似类型会困惑该用哪个

**修复方案**：
- `PermissionContext` 迁移到 portal 内部（不再作为 contracts 的公共接口）
- 或者更新 `PermissionContext` 使其与实际 `UserPermissionContext` 对齐，作为 contracts 统一类型

---

### 2.3 `buildMenuTree` 与 `buildDepartmentTree` 重复（#3）

**现状**：两个函数算法完全相同（构建 Map → 分配父子关系 → 排序/返回），仅参数和返回值类型不同。

- `domain/menu/menu.ts:125-152` — `buildMenuTree(flatList: Menu[]): MenuTreeNode[]`
- `domain/department/department.ts:133-151` — `buildDepartmentTree(flatList: Department[]): DepartmentTreeNode[]`

**修复方案**：创建 `domain/shared/tree-utils.ts`，提供泛型 `buildTree<T>(flatList, idKey, parentIdKey, sortKey?)` 函数。

---

### 2.4 `lib/` 层违规依赖 `infrastructure/`（#4）

**现状**：架构指南 §5 边界矩阵规定 `lib` 只能 import `lib` 和 `domain`，但以下文件违规：

| 文件 | 违规导入 |
|------|---------|
| `lib/permissions.ts` | `@/infrastructure/db`, `@/infrastructure/redis` |
| `lib/user-queries.ts` | `@/infrastructure/db` |
| `lib/audit.ts` | `@/infrastructure/db` |
| `lib/session/revoke.ts` | `@/infrastructure/redis` |
| `lib/auth/check-permission.ts` | `@/infrastructure/db`（间接：通过 `../permissions`）|
| `lib/auth/data-scope.ts` | `@/infrastructure/db` |

**分析**：指南 §2 的目录结构图明确将 `permissions.ts`、`user-queries.ts`、`audit.ts` 放在 `lib/` 下。这与边界矩阵矛盾——要么调整代码位置，要么调整边界规则。

**推荐方案**：修改架构指南边界矩阵，允许 `lib` → `infrastructure` 依赖。理由：
1. `lib/` 中的鉴权模块天然需要查询 DB 和 Redis
2. 这些文件承担的是"业务工具 + 基础设施协调"职责，不是纯领域逻辑
3. 把它们移到 `infrastructure/` 又会使基础设施层过于臃肿

---

### 2.5 `domain/user/user.ts` 缺少 DB 行转换函数（#5）

**现状**：5 个聚合根（role/menu/permission/department/client）都提供了 `xxxToInsertRow`/`xxxToUpdateRow`，但 User 没有。

`actions.ts:68-72` 中 Controller 手写了列映射：
```typescript
await tx.insert(schema.users).values({
  id: user.id, publicId: user.publicId, username: user.username,
  email: user.email, name: user.name, avatarUrl: user.avatarUrl,
  status: user.status, deptId: user.deptId, passwordHash,
});
```

**修复方案**：为 User 添加 `userToInsertRow` 和 `userToUpdateRow`，Controller 改为调用转换函数。

---

### 2.6 `PUBLIC_ID_PREFIX` 与实际前缀不一致（#6）

**现状**：

```typescript
// contracts 定义
PUBLIC_ID_PREFIX = { USER: 'u_', DEPARTMENT: 'd_', ROLE: 'r_', PERMISSION: 'p_', MENU: 'm_', CLIENT: 'c_' }

// domain 工厂函数实际使用
createUser:    `user_${idGenerator(8)}`   // 应为 'u_' 或改为一致
createRole:    `role_${idGenerator(8)}`   // 应为 'r_' 或改为一致
createDepartment: `dept_${idGenerator(8)}` // 应为 'd_' 或改为一致
createMenu:    `menu_${idGenerator(8)}`   // 应为 'm_' 或改为一致
createClient:  `cli_${idGenerator(8)}`    // 应为 'c_' 或改为一致
createPermission: `perm_${Date.now()...}`  // 应为 'p_' 或改为一致
```

**影响**：如果已有生产数据使用 `user_` 前缀，修改 contracts 会导致不兼容。

**推荐方案**：
1. 修改 `contracts` 的 `PUBLIC_ID_PREFIX` 使其与 domain 工厂一致（因为 domain 是生产者）
2. Public ID 前缀是内部约定，不是公开 API，变更风险可控

---

### 2.7 `ClientBase` 的 `clientType` 字段不存在（#7）

**现状**：`contracts` 中 `ClientBase` 定义了 `clientType: ClientType`（'confidential' | 'public'），但：
- `db/schema.ts` 的 `clients` 表**没有** `client_type` 列
- `domain/client/types.ts` 的 `Client` interface **没有** `clientType` 字段
- 实际上 Client 使用 `status` + `disabled` 组合来表示状态

**修复方案**：从 `ClientBase` 中移除 `clientType` 字段，或向 DB/domain 添加此字段（取决于业务需求）。

---

### 2.8 API Route 响应格式不统一（#8）

**现状**：

```typescript
// api/users/route.ts — 返回裸 { data, pagination }，无 success 包装
NextResponse.json({ data: [...], pagination: {...} })

// Server Actions — 返回 ApiResponse<T> = { success: true, data, ... }
return { success: true, data: {...}, message: '...' }

// api/me/route.ts — 返回自定义扁平结构
NextResponse.json({ user: {...}, permissions: [...], roles: [...], ... })
```

**指南要求 §2.2**：Route Handler 也应返回 `{ success: true, data: T, ... }` 格式。

**修复方案**：统一所有 API Route 使用 `ApiResponse<T>` 格式。

---

### 2.9 `MenuBase` 缺少实际存在的字段（#9）

**现状**：`contracts` `MenuBase` 只有 7 个字段（id, parentId, name, path, icon, visible, status），但：
- `domain/menu/types.ts` 的 `Menu` 有 12 个字段
- 缺少 `publicId`, `permissionCode`, `sort`, `menuType`, `createdAt`
- 特别是 `menuType` 和 `sort` 是实际业务中重要的字段

**是否修复**：这取决于 `MenuBase` 的设计意图——是"对外暴露的基础信息"还是"完整实体"。如果是对外 API 用，当前字段就可以。建议评估后决定。

---

## 三、架构合规性总评

### ✅ 合规项

| 检查项 | 状态 |
|--------|------|
| 枚举值数组从 contracts 单源派生（Zod/Drizzle 均 `import { X_VALUES }`） | ✅ 合规 |
| 编译期类型守卫（Domain ↔ Drizzle 不漂移） | ✅ 合规 |
| Domain 层零 Next.js/框架依赖 | ✅ 合规 |
| 领域错误类型体系（DomainError 基类 + 子类） | ✅ 合规 |
| 错误映射横切层（mapDomainError 统一入口） | ✅ 合规 |
| 读模型使用 `"use cache"` + `cacheLife` + `cacheTag` | ✅ 合规 |
| 写模型使用 `withAuth` 包装器统一鉴权 | ✅ 合规 |
| `db.transaction()` 显式包裹多表写入 | ✅ 合规 |
| 数据范围过滤统一使用 `applyDataScopeFilter` | ✅ 合规 |
| contracts 类型扩展使用 alias import（`LoginEventType as BaseLoginEventType`） | ✅ 合规 |

### ❌ 需修复项

| 检查项 | 对应问题 # |
|--------|-----------|
| Zod enum 未集中到 shared 模块 | #1 |
| `domain/user` 缺少 DB 行转换函数 | #5 |
| `PUBLIC_ID_PREFIX` 与实际前缀不一致 | #6 |
| `ClientBase.clientType` 字段不存在 | #7 |
| API Route 响应格式未统一 | #8 |
| `buildMenuTree`/`buildDepartmentTree` 算法重复 | #3 |

### 🔶 需决策项

| 检查项 | 对应问题 # |
|--------|-----------|
| `lib/` → `infrastructure/` 边界违规（代码 vs 指南矛盾） | #4 |
| `PermissionContext` vs `UserPermissionContext` 重叠 | #2 |

---

## 四、修复方案

### Phase 1: 消除重复定义（低风险、高收益）

1. **提取共享 Zod Schema** → 新建 `domain/shared/zod-schemas.ts`
   - 集中导出 `entityStatusEnum`, `userStatusEnum`, `dataScopeTypeEnum`, `permissionTypeEnum`, `menuTypeEnum`
   - 6 个 domain/types.ts 改为从此文件导入
   - 预期减少 ~20 行重复代码

2. **提取泛型树构建函数** → 新建 `domain/shared/tree-utils.ts`
   - 提供 `buildTree<T>()` 泛型函数
   - `buildMenuTree` 和 `buildDepartmentTree` 改为调用泛型版本
   - 预期减少 ~40 行重复代码

3. **统一 PUBLIC_ID_PREFIX** → 修改 contracts
   - 将 `PUBLIC_ID_PREFIX` 值改为与 domain 工厂一致（`USER: 'user_'` 等）

### Phase 2: 修复数据一致性问题

4. **添加 User DB 行转换函数** → 修改 `domain/user/user.ts`
   - 添加 `userToInsertRow()` 和 `userToUpdateRow()`
   - Controller 改为调用转换函数

5. **修复 ClientBase** → 修改 contracts
   - 移除多余 `clientType` 字段（或添加业务需要的字段）

6. **清理 PermissionContext** → 修改 contracts
   - 移除 contracts 中未使用的 `PermissionContext`，或将 `UserPermissionContext` 上提到 contracts

### Phase 3: 统一 API 响应格式

7. **统一 Route Handler 响应格式** → 修改各 route.ts
   - 所有 `NextResponse.json({ data, pagination })` 改为 `NextResponse.json({ success: true, data, pagination })`
   - 所有错误响应统一格式

### Phase 4: 边界合规决策

8. **决策并调整 lib/ 边界**
   - 选项 A：调整指南，允许 `lib` → `infrastructure` 依赖
   - 选项 B：将 `permissions.ts`, `user-queries.ts`, `audit.ts` 移到新目录（如 `services/`）
   - 推荐选项 A，修改指南中的边界矩阵

---

## 五、文件变更清单

| 文件 | 操作 | 关联问题 |
|------|------|---------|
| `domain/shared/zod-schemas.ts` | **新建** | #1 |
| `domain/shared/tree-utils.ts` | **新建** | #3 |
| `domain/department/types.ts` | 修改（导入 zod-schemas） | #1 |
| `domain/role/types.ts` | 修改（导入 zod-schemas） | #1 |
| `domain/permission/types.ts` | 修改（导入 zod-schemas） | #1 |
| `domain/menu/types.ts` | 修改（导入 zod-schemas） | #1 |
| `domain/client/types.ts` | 修改（导入 zod-schemas） | #1 |
| `domain/user/types.ts` | 修改（导入 zod-schemas） | #1 |
| `domain/menu/menu.ts` | 修改（使用泛型 buildTree） | #3 |
| `domain/department/department.ts` | 修改（使用泛型 buildTree） | #3 |
| `domain/user/user.ts` | 修改（添加转换函数） | #5 |
| `packages/contracts/src/index.ts` | 修改（PUBLIC_ID_PREFIX, ClientBase, PermissionContext）| #2, #6, #7 |
| `apps/portal/src/app/users/actions.ts` | 修改（使用转换函数） | #5 |
| `apps/portal/src/app/api/users/route.ts` | 修改（统一响应格式） | #8 |
| 其他 route.ts | 修改（统一响应格式） | #8 |
| `docs/portal-architecture-guidelines.md` | 修改（边界矩阵调整） | #4 |
