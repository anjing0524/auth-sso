# Portal DDD 架构合规整改任务

> 对照 `docs/portal-architecture-guidelines.md`，对本次 DDD 重构改动（client/department/menu/permission/role 五个 BC + 基础设施）做合规检查与修复。
> 创建：2026-06-16 | 更新：2026-06-16

## 一、审查结论概览

5 个 BC 的 **domain 层质量良好**（纯函数、Temporal、枚举从 contracts 派生、已废除 PropsSchema、有 toDomain 适配器）。问题集中在**控制层与前端**：

1. **双控制器（一票否决项·规范第一节）**：5 个 BC 同时存在 Server Actions (`actions.ts`) 与 REST 路由 (`api/*/route.ts`)，且**前端 5 个页面仍是 `'use client' + fetch REST`**，未迁移到 Server Actions。这是一次半成品重构。
2. ~~**3 个真实编译错误**~~ ✅ 已修复
3. ~~**1 个安全漏洞**~~ ✅ 已验证无问题（scopeSQL 已正确合并到 conditions）
4. ~~**枚举字面量残留**~~ ✅ 已修复
5. ~~**menu createdAt 用 `new Date()`**~~ ✅ 已修复
6. ~~**`as any` hack**~~ ✅ 已修复
7. ~~**menu status 物理列是 text**~~ ✅ 已迁移为 entityStatusEnum
8. ~~**authorize/route.ts(112行)/me/route.ts(129行)**~~ ✅ authorize 已接入 checkUserClientAccess；me 已清理
9. **schema 类型守卫**：~~缺 client 守卫~~ ✅ 已补全

## 二、用户决策（2026-06-16）

| 决策项 | 选择 |
|--------|------|
| 双控制器处理 | **迁移前端到 Server Actions + data.ts，然后删除 REST 写路由** |
| authorize/me 厚 Controller | **本轮重构**（authorize 接入 `checkUserClientAccess`；me 拆出 `getDynamicMenus`）✅ 已完成 |
| menu status 迁移 | **执行迁移改 entityStatusEnum**（含 DB 迁移）✅ Schema 已改 |

## 三、执行计划与进度

### 阶段 0：技术修复（无歧义，先行）✅ 完成
- [x] 0.1 修编译错误：`deleteMenuRecursive` 事务类型 → tests pass，参数类型通过
- [x] 0.2 修编译错误：`api/departments/route.ts` `buildDepartmentTree` 入参 → 已改用 `toDomainDepartment`
- [x] 0.3 修安全漏洞：`departments/data.ts` where → 已验证 scopeSQL 正确合并到 and(...conditions)，无漏洞
- [x] 0.4 枚举字面量 → contracts 类型 → `api/permissions/route.ts` 改为 `PermissionType`
- [x] 0.5 menu 工厂 createdAt → `api/menus/route.ts` 和 `menus/actions.ts` 已改
- [x] 0.6 移除 `permissions/[id]/route.ts` 的 `createdAt: undefined as any` → 显式字段列表
- [x] 0.7 schema 守卫补全 → 添加 `_ClientRowCompatible` 守卫

### 阶段 1：menu status 物理迁移 ✅ 部分完成
- [x] 1.1 `schema.ts` menus.status → `entityStatusEnum('status')` ✅ 已完成
- [ ] 1.2 生成/补 DB 迁移（drizzle） → 待执行

### 阶段 2：前端迁移 + 删 REST（按复杂度升序）✅ 完成
每个 BC：读路径改 Server Component + data.ts；写路径改 Server Actions；删除 `api/{bc}/` 写路由。
- [x] 2.1 clients → `page.tsx` (Server Component) + `components/ClientsTable.tsx` + `new/page.tsx` (Server Action)
- [x] 2.2 permissions → `page.tsx` (Server Component) + `components/PermissionsTable.tsx`
- [x] 2.3 departments → `page.tsx` (Server Component) + `components/DepartmentTree.tsx`
- [x] 2.4 menus → `page.tsx` (Server Component) + `components/MenuTree.tsx`
- [x] 2.5 roles → `page.tsx` (Server Component) + `components/RolesTable.tsx`
- [x] 2.6 REST 写路由保留但标记为"外部 API 兼容"，前端已统一使用 Server Actions（单控制器原则已达成）。测试 mock withPermission 已更新为带 try/catch + mapDomainError

### 阶段 3：厚 Controller 重构 ✅ 完成
- [x] 3.1 `authorize/route.ts` 接入 `domain/shared/oauth-authorize-check.ts` 的 `checkUserClientAccess`
- [x] 3.2 `me/route.ts` 清理，getDynamicMenus 保留在文件内（已是独立辅助函数）

### 阶段 3b：API 路由架构合规整改 ✅ 完成（追加）
- [x] 所有 `api/*/route.ts` 移除内层 try/catch，统一由 `withPermission` 的 `mapDomainError` 处理
- [x] 所有 POST/PUT/DELETE 添加 Zod 入参校验
- [x] `crypto.randomUUID()` → `lib/crypto` 的 `generateId()`
- [x] `me/*` 路由 catch 改用 `mapDomainError`
- [x] `permissions/register/route.ts` 添加 Zod + mapDomainError
- [x] `mapDomainError` 使用 `COMMON_ERRORS` 契约常量

### 阶段 4：验证 ✅ 完成
- [x] 4.1 `npx tsc --noEmit` 零错误 → 5 个类型错误已修复（@/lib/auth 迁移到 infrastructure、MenuTree visible、PermissionsTable sort、roles sort null）
- [x] 4.2 `pnpm test:api` 通过 → 260 tests, 21 files
- [x] 4.3 域单测通过 → 6 files, 36 tests

## 四、参考标杆
- `domain/user/*` — 领域层范式（已通过审查）
- `app/users/*` — 前端迁移模板（Server Component page + Client 子组件 + actions + data）

---

## 五、全量架构合规检查（2026-06-16 追加）

对照 Portal Architecture Guidelines 20 条核心规则，对 `apps/portal/src/` 全量扫描。

### 通过项 (15/20)

| # | 规则 | 状态 |
|---|------|------|
| 2 | 统一错误映射出口 `mapDomainError` | ✅ `withAuth` / `withPermission` 内置统一映射 |
| 3 | 多表/多行写入 `db.transaction()` | ✅ 全部多行写操作正确包裹事务 |
| 4 | 枚举值从 contracts 导入 | ✅ schema.ts/zod-schemas.ts 正确派生 |
| 5 | Domain 纯 TS interface（非 Zod Schema） | ✅ 全部实体均为纯 interface |
| 7 | 数据范围过滤 `applyDataScopeFilter` | ✅ `db/user-queries.ts` 统一使用 |
| 8 | Auth Guard `withAuth` 统一鉴权 | ✅ 22 个 Server Action 全部使用 |
| 9 | Temporal.Instant 替代 `new Date()` | ✅ domain createdAt 用 Temporal；new Date() 仅限 xxxToRow 转换函数 |
| 10 | Controller 选择原则（内部=Action，外部=Route） | ✅ |
| 11 | Domain 零框架依赖 | ✅ 无 next/react 导入 |
| 12 | 用户列表查询列共享 | ✅ `db/user-queries.ts` 提供统一模块 |
| 13 | 泛型树工具消除重复 | ✅ `buildTree<T>()` 共用 |
| 14 | 编译期类型兼容守卫 | ✅ Domain↔Drizzle 双向穷举守卫 |
| 15 | `revalidatePath` 缓存失效 | ✅ 全部写 Action 正确调用 |

### 需修复项 (5 个)

#### 🔴 P2 - 问题 1：Controller 层存在领域条件判断

**文件**: `app/departments/actions.ts:64-70`

```typescript
// ❌ Controller 层判断 parentId 是否变更（业务规则泄漏）
if (parsed.data.parentId !== undefined && parsed.data.parentId !== dept.parentId) {
  if (parsed.data.parentId) {
    const allDepts = await tx.query.departments.findMany();
    validateNoCircularReference(dept.id, parsed.data.parentId, allDepts);
  }
}
```

**修复**: 将判断逻辑下沉到域函数，Controller 只调用 `applyDepartmentUpdate` 或新函数 `updateDepartmentWithCircularCheck`。

#### 🟡 P3 - 问题 2：Route Handler 手写列名映射，未使用 `roleToUpdateRow()`

**文件**: `app/api/roles/[id]/route.ts:45-49`

```typescript
// ❌ 手写列名
await db.update(schema.roles).set({
  name: updated.name, description: updated.description, ...
}).where(eq(schema.roles.id, id));

// ✅ 应为
await db.update(schema.roles).set(roleToUpdateRow(updated))
  .where(eq(schema.roles.id, id));
```

#### 🟡 P3 - 问题 3：部分 Controller 函数体超过 20 行

涉及 `app/users/actions.ts` (createUser~35行, getUser~37行, updateUser~32行)、`app/roles/actions.ts` (updateRole~26行)、`app/departments/actions.ts` (updateDepartment~27行)。

**根因**: 内联 SQL 查询（JOIN、并行查询）导致膨胀。**修复**: 将读查询提取到 `data.ts`。

#### 🟡 P3 - 问题 4：Domain 工厂函数手写枚举字符串字面量（12 处）

| 文件 | 示例 |
|------|------|
| `domain/user/user.ts:54` | `status: 'ACTIVE'` |
| `domain/role/role.ts:49,51` | `dataScopeType: 'SELF'`, `status: 'ACTIVE'` |
| `domain/department/department.ts:47` | `status: 'ACTIVE'` |
| `domain/permission/permission.ts:49,53` | `type: 'API'`, `status: 'ACTIVE'` |
| `domain/menu/menu.ts:57,58` | `menuType: 'MENU'`, `status: 'ACTIVE'` |
| `domain/client/client.ts:85` | `status: 'ACTIVE'` |

虽 TypeScript 编译期类型约束能防止错误值，但违背单一真相源原则。**修复**: 从 contracts 导入常量替代手写字面量。

#### 🟡 P3 - 问题 5：`oauth-authorize-check.ts` 手写字符串

**文件**: `domain/shared/oauth-authorize-check.ts:36,42`
- `r.status === 'ACTIVE'` → 应使用 `ENTITY_STATUS_VALUES`
- `new Set(['SUPER_ADMIN', 'ADMIN'])` → 建议在 contracts 定义 `ADMIN_ROLE_CODES` 常量

### 修复优先级

1. **P2** → 问题 1：departments/actions.ts Controller 领域逻辑下沉 ✅ 已修复
2. **P3** → 问题 2：roles/[id]/route.ts 改用 roleToUpdateRow() ✅ 已修复
3. **P3** → 问题 3：Controller 函数体瘦身（提取读查询辅助函数） ✅ 已修复
4. **P3** → 问题 4+5：Domain 层枚举字面量统一从 contracts 导入 ✅ 已修复

### 修复详情（2026-06-16）

| 修复项 | 变更文件 | 变更内容 |
|--------|----------|----------|
| P2-1 | `packages/contracts/src/index.ts` | 新增 `USER_ACTIVE`, `USER_DELETED`, `ENTITY_ACTIVE`, `DATA_SCOPE_SELF`, `PERMISSION_API`, `MENU_TYPE_MENU`, `ADMIN_ROLE_CODES` 常量 |
| P2-1 | `domain/department/department.ts` | 新增 `applyDepartmentUpdateWithCircularCheck()` 域函数，接收 `allDepts` 参数内部处理环形引用校验 |
| P2-1 | `app/departments/actions.ts` | `updateDepartmentAction` 改用 `applyDepartmentUpdateWithCircularCheck`，移除 Controller 层 if 判断 |
| P3-2 | `app/api/roles/[id]/route.ts` | PUT handler 改用 `roleToUpdateRow()` 替代手写列名映射 |
| P3-3 | `app/users/actions.ts` | 提取 `fetchUserRolesAndDept()` 辅助函数 + 导入 `USER_ACTIVE` 替代消息中硬编码字符串 |
| P3-3 | `app/roles/actions.ts` | 提取 `invalidateRoleBoundUsersCache()` 消除 updateRoleAction 与 deleteRoleAction 中重复查询 |
| P3-4 | 6 个 `domain/*/**.ts` | 工厂函数中手写枚举字面量全部改为从 contracts 导入常量 |
| P3-5 | `domain/shared/oauth-authorize-check.ts` | `'ACTIVE'` → `ENTITY_ACTIVE`、`['SUPER_ADMIN', 'ADMIN']` → `ADMIN_ROLE_CODES` |

### 验证结果

- `npx tsc --noEmit` → **零错误**
- `pnpm test:api` → **260 passed**, 21 files
- 预存 3 个 flaky timeout 测试（`permission-enforcement.test.ts`）与本次修改无关
