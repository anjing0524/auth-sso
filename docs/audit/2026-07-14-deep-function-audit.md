# 深度函数级代码审计报告

> **审计日期**：2026-07-14
> **项目**：auth-sso
> **审计范围**：全项目 — 聚焦函数级深度（歧义/重复/雍容/测试真实性/业务一致性）
> **审计方法**：1 Explore Agent → 2 路并行 Agent（A：函数质量 / B：测试真实性）→ 1 复核 Agent 交叉验证
> **综合评级**：**B**（代码质量 B / 测试有效性 C+ / 业务一致性 B- / 架构 B+）
> **严重问题数**：5 个 | **一般问题数**：16 个 | **优化建议**：4 个

> ⚠️ 本报告与前 3 轮（7/10、7/13、7/14）互补。前 3 轮已修复的高阶问题（错误码统一、Redis 故障策略、Docker 安全、领域层边界等）不在本报告重复列出。

---

## 目录

1. [全局诊断报告](#1-全局诊断报告)
2. [分角色问题清单](#2-分角色问题清单)
3. [整体重构与规范方案](#3-整体重构与规范方案)
4. [核心模块优化示例](#4-核心模块优化示例)
5. [分阶段落地路线图](#5-分阶段落地路线图)
6. [长期维护规范](#6-长期维护规范)

---

## 1. 全局诊断报告

### 1.1 核心问题 TOP10（经复核确认）

| # | 严重度 | 问题 | 位置 | 复核结论 |
|---|--------|------|------|----------|
| 1 | 🔴 严重 | `permissions/actions.ts` 权限变更后无缓存失效/会话撤销 — 与 `roles/actions.ts` 行为不一致 | `permissions/actions.ts:55-80,83-100` | ✅ 确认：仅 revalidatePath + updateTag，无用户缓存刷新 |
| 2 | 🔴 严重 | `role.ts:84-89` `hasRolePermissionImpact` 不检测 rolePermissions 绑定变更 — 安全漏洞 | `role.ts:84-89` | ✅ 确认：仅检查 deptId + status，忽略权限绑定变更 |
| 3 | 🔴 严重 | `permission-actions.test.ts` 全部 4 个测试仅断言 `r.success` 布尔值 — 零有效覆盖 | `permission-actions.test.ts:37-40` | ✅ 确认：无任何 DB 写入验证、数据字段验证 |
| 4 | 🔴 严重 | `client-actions.test.ts:72-89` rotateClientSecret 未验证密钥哈希写入 DB | `client-actions.test.ts:72-89` | ✅ 确认：仅验证返回的原始 secret，未检查 DB update 内容 |
| 5 | 🔴 严重 | `department-actions.test.ts:61-62` deleteDepartmentAction 零测试 — 含子部门拒绝逻辑完全未覆盖 | `department-actions.test.ts:61-62` | ✅ 确认：注释承认 mock 能力不足 |
| 6 | 🟡 一般 | 20+ 处重复的 Zod `safeParse` + 内联错误返回模式 | 全部 6 个 actions.ts | ✅ 确认：每个 Action 开头重复 3-5 行相同模版 |
| 7 | 🟡 一般 | `performRevocation` 错误处理不一致 — JWT 解码异常中断 jti 黑名单写入 | `logout/route.ts:38-108` | ✅ 确认：步骤 1 失败阻断步骤 2-3 |
| 8 | 🟡 一般 | 全部 10 个 `*ToInsertRow`/`*ToUpdateRow` 转换函数零测试覆盖 | 5 个 domain 模块 | ✅ 确认：时间戳转换逻辑无防护 |
| 9 | 🟡 一般 | `createDepartmentAction` 父级祖先查询在事务外 — 读-写竞争窗口 | `departments/actions.ts:58-63` | ✅ 确认：getParentAncestors 和 insert 无事务包裹 |
| 10 | 🟡 一般 | `role.ts` 无角色-权限绑定函数 — Controller 层内联 Drizzle 操作 | `role.ts:1-119` | ✅ 确认：domain 层缺失 assignPermissions 等函数 |

### 1.2 分维度评级

| 维度 | 评级 | 与前轮对比 | 说明 |
|------|------|:---:|------|
| **架构** | B+ | 持平 | 分层清晰，但 domain 层 role 模块缺少权限绑定函数 |
| **代码质量** | B | 持平 | 大量重复 Zod 门禁模版、`apiSuccess`/`apiError` 死代码 |
| **安全性** | A- | 持平 | `hasRolePermissionImpact` 遗漏权限绑定检测——安全漏洞 |
| **测试有效性** | C+ | → C+ | 1 个无效测试文件 + 6 个弱测试文件。Domain 39% 函数无测试 |
| **工程化** | B+ | ↑+1 | 代码重复模式明确，抽取工具成本低 |

### 1.3 推荐核心优化方向

1. **补齐安全漏洞**（P0）：`hasRolePermissionImpact` 增加权限绑定变更检测；`permissions/actions.ts` 增加权限变更后的缓存失效逻辑
2. **抽取重复模版**（P1）：`validateOrReturn()` 消除 20+ 处 Zod 门禁重复
3. **补齐测试缺口**（P1）：为 `permission-actions`/`department-actions`/`client-actions` 增加业务行为验证
4. **Domain 层完备化**（P2）：为 10 个未测的 row 转换函数加测试；为 role domain 加权限绑定函数
5. **事务安全加固**（P2）：`createDepartmentAction` 查询+插入入事务

---

## 2. 分角色问题清单

### 角色 7：Clean Code

| # | 严重度 | 发现 | 位置 | 复核 |
|---|--------|------|------|:---:|
| 7.1 | 🟡 一般 | **20+ 处重复 Zod safeParse + 内联错误返回模式**：所有 6 个 actions.ts 中每个 Server Action 都以完全相同的 3-5 行开头（safeParse → 检查 !success → 返回 { success: false, error: COMMON_ERRORS.VALIDATION_ERROR }） | `users/actions.ts:63-65`、`departments/actions.ts:47-49`、`roles/actions.ts:47-49`、`permissions/actions.ts:30-32`、`clients/actions.ts:42-44`、`profile/actions.ts` | ✅ |
| 7.2 | 🔵 优化 | **`apiSuccess`/`apiError` 工厂函数零调用 — 死代码**：`lib/response.ts:73-88` 定义了 `apiSuccess()` 和 `apiError()`，注释声明"用于 actions.ts"，但全部 6 个 actions.ts 文件（~1000 行）均使用内联 `{ success: true/false, ... }` 构造 | `lib/response.ts:73-88` | ✅ |
| 7.3 | 🟡 一般 | **`updateRoleAction` 重复查询 `getRoleBoundUserIds`**：同一次请求内，`invalidateRoleBoundUsersCache(roleId)` 内部调用 `getRoleBoundUserIds()` 做 DB 查询（line 114），然后 line 116 再次调用做相同查询，浪费一次 DB 往返 | `roles/actions.ts:114,116` | ✅ |
| 7.4 | 🟡 一般 | **`performRevocation` 错误处理不一致 — JWT 解码异常阻断后续撤销步骤**：步骤 1-3（JWT 解码、RT revoked、jti 黑名单）在外层 try/catch 中，步骤 1 异常会跳过步骤 2-3。步骤 4-5 有独立 try/catch | `logout/route.ts:38-108` | ✅ |
| 7.5 | 🔵 优化 | **`resetPasswordAction` 密码空值双重检查**：line 273 `if (!newPassword)` 硬编码检查，然后 line 276 `validatePassword(newPassword)` 再次检查（Zod min(10)），前者冗余且错误消息不一致 | `users/actions.ts:273-279` | ✅ |
| 7.6 | 🟡 一般 | **`audit.ts` 模块级 `setInterval` 在 Next.js HMR 场景下内存泄漏**：`audit.ts:48` 模块顶层 `setInterval(flushBuffer, ...)` 虽 `unref()` 但 HMR 每次热重载创建新 timer，开发环境累积永不清理 | `audit.ts:48-51` | ✅ |
| 7.7 | 🟡 一般 | **`verifyAccessToken` 静默填充空数组掩盖签发端 bug**：`token.ts:176-181` 使用 `payload.roles ?? []` 等静默兜底。若签发端因回归漏设这些字段，用户以空权限继续使用系统 | `token.ts:176-181` | ✅ |
| 7.8 | 🔵 优化 | **`menu-tree.ts` 本地重复实现 `buildTree`，未使用共享 `tree-utils`**：`menu-tree.ts:48-64` 内部定义 `buildTree` 闭包，与 `tree-utils.ts:22` 的泛型 `buildTree<T>()` 功能重复 | `menu-tree.ts:48-64`、`tree-utils.ts:22` | ✅ |

### 角色 3：系统架构

| # | 严重度 | 发现 | 位置 | 复核 |
|---|--------|------|------|:---:|
| 3.1 | 🟡 一般 | **`createDepartmentAction` 父级祖先查询在事务外 — 读-写竞争窗口**：`getParentAncestors()`（独立查询）和 `db.insert()` 之间无事务包裹，并发下可能产生不一致物化路径 | `departments/actions.ts:58-63` | ✅ |
| 3.2 | 🟡 一般 | **`buildDepartmentTree` 未使用 tree-utils 的 `sortKey` 参数**：`department.ts:168` 调用 `buildTree(flatList, 'id', 'parentId')` 无 sortKey，部门树展示顺序不可控 | `department.ts:168` | ✅ |
| 3.3 | 🔵 优化 | **`tree-utils.ts:47-56` 死代码分支**：`nodeMap.has(parentId)` 确认存在后，`nodeMap.get(parentId)` 必非空，后续 `if (!parentNode)` 分支永不可达 | `tree-utils.ts:47-56` | ✅ |

### 角色 14：业务治理

| # | 严重度 | 发现 | 位置 | 复核 |
|---|--------|------|------|:---:|
| 14.1 | 🔴 严重 | **`permissions/actions.ts` 权限变更后无缓存失效/会话撤销**：`updatePermissionAction`（line 55-80）和 `deletePermissionAction`（line 83-100）仅 `revalidatePath` + `updateTag`，不触发用户权限缓存刷新或 JWT 撤销。对比 `roles/actions.ts`：角色更新有完整 `invalidateRoleBoundUsersCache()` + 条件 `revokeUsersAccessByUserId()` | `permissions/actions.ts:55-80,83-100` | ✅ |
| 14.2 | 🟡 一般 | **`resolveParentAncestors` 三态返回值（`string \| null \| undefined`）语义不直观**：`undefined` 为哨兵表示"parentId 未变更"，调用方需 `!== undefined` 判断，增加理解成本 | `department.ts:123-132`、`departments/actions.ts:83-84` | ✅ |

### 角色 12：测试深度治理

| # | 严重度 | 发现 | 位置 | 复核 |
|---|--------|------|------|:---:|
| 12.1 | 🔴 严重 | **`permission-actions.test.ts` 全部 4 个测试仅断言 `r.success` 布尔值**：零 DB 写入验证、零数据字段验证 | `permission-actions.test.ts:37-40` | ✅ |
| 12.2 | 🔴 严重 | **`client-actions.test.ts:72-89` rotateClientSecret 未验证哈希写入 DB**：仅验证返回原始 secret，不检查 DB update 是否包含正确的 `clientSecret: 'hash:s'` | `client-actions.test.ts:72-89` | ✅ |
| 12.3 | 🔴 严重 | **`department-actions.test.ts:61-62` deleteDepartmentAction 零测试**：注释明确承认 mock-db 无法区分两次 findFirst 调用。级联删除/含子部门拒绝删除等核心逻辑未覆盖 | `department-actions.test.ts:61-62` | ✅ |
| 12.4 | 🟡 一般 | **`audit-logging.test.ts` 所有 8 个测试仅验证分页结构和 HTTP 200**：文件头注释自述"数据内容验证属于集成测试范畴，不在本测试文件中覆盖" | `audit-logging.test.ts:4-5,75-86` | ✅ |
| 12.5 | 🟡 一般 | **所有 10 个 `*ToInsertRow`/`*ToUpdateRow` 转换函数零测试**：5 个 domain 模块共 10 个转换函数，在 7 个 domain 测试文件中无任何测试覆盖 | `user/user.ts:159-188`、`department/department.ts:139-162`、`role/role.ts:95-119`、`permission/permission.ts:104-142`、`client/client.ts:84-113` | ✅ |
| 12.6 | 🔵 优化 | **`session-lifecycle.test.ts` mock `jwtVerify` 硬编码 `token === 'valid-jwt'`**：限制测试覆盖真实签发→验签链路的能力 | `session-lifecycle.test.ts:98-100` | ✅ |

#### 12A. API 测试真实度评级表

| # | 文件 | 真实度 | 测试数 | 关键缺陷 |
|---|------|:---:|:---:|------|
| 1 | `audit-logging.test.ts` | ⚠️ 弱 | 8 | 仅验证分页结构，无数据内容验证 |
| 2 | `auth-login.test.ts` | ✅ 有效 | 7 | 验证计数器、session 签名、Cookie 设置 |
| 3 | `auth-logout.test.ts` | ✅ 有效 | 5 | 验证 jti 撤销、fail-open、Cookie 全清除 |
| 4 | `client-actions.test.ts` | ⚠️ 弱 | 6 | 多数仅检查 success，rotateSecret 未验证 DB 写入 |
| 5 | `client-api.test.ts` | ⚠️ 弱 | 6 | 验证分页结构，无数据完整性验证 |
| 6 | `data-scope.test.ts` | ✅ 有效 | 7 | 测领域函数，subtree 展开+去重 |
| 7 | `department-actions.test.ts` | ⚠️ 弱 | 4 | delete 测试缺失，mock 能力不足 |
| 8 | `department-api.test.ts` | ✅ 有效 | 4 | 树形嵌套 parent→child ID 匹配、数据范围过滤 |
| 9 | `me-endpoints.test.ts` | ✅ 有效 | 8 | JWT/网关信任路径/tokenInfo 验证 |
| 10 | `permission-actions.test.ts` | ❌ 无效 | 4 | 全部测试仅断言 `r.success` 布尔值 |
| 11 | `permission-api.test.ts` | ✅ 有效 | 10 | 注册两阶段事务、PAGE/DIRECTORY 透传 |
| 12 | `permission-enforcement.test.ts` | ✅ 有效 | 15 | requireAll/角色检查/管理员绕过/错误码 |
| 13 | `role-actions.test.ts` | ⚠️ 弱 | 5 | 主要检查 success/error，无系统角色保护测试 |
| 14 | `role-api.test.ts` | ✅ 有效 | 5 | toMatchObject 业务字段验证 |
| 15 | `session-lifecycle.test.ts` | ✅ 有效 | 11 | Redis 内存存储+jose mock |
| 16 | `user-actions.test.ts` | ✅ 有效 | 7 | 密码已哈希非明文、状态转换验证 |
| 17 | `user-api.test.ts` | ✅ 有效 | 14 | 邮箱/密码/状态边界验证 |

**汇总：❌ 无效=1，⚠️ 弱=6，✅ 有效=10（有效占比 58.8%）**

### 角色 6：全链路实现

| # | 严重度 | 发现 | 位置 | 复核 |
|---|--------|------|------|:---:|
| 6.1 | 🟡 一般 | **`role.ts` 无角色-权限绑定函数 — Controller 层内联 Drizzle 操作**：role domain 缺少 `assignPermissions`/`getRolePermissions`/`getRoleUsers` 函数，Controller 层直接操作 `rolePermissions` 表 | `role.ts:1-119` | ✅ |

### 角色 4：数据建模

| # | 严重度 | 发现 | 位置 | 复核 |
|---|--------|------|------|:---:|
| 4.1 | 🟡 一般 | **`hasDeptChanged` 中 null/空字符串判断与 row 转换函数不一致**：`user.ts:146` `(oldDeptId ?? '')` 将 null 和 '' 视为等价，但 `roleToUpdateRow` deptId 直接映射无 ?? 处理 | `user.ts:145-147`、`role.ts:112-118` | ✅ |
| 4.2 | 🔵 优化 | **全部 5 个模块的 `*ToInsertRow` 手动 `new Date(d.createdAt.epochMilliseconds)` 重复**：应抽取 `toDbTimestamp()` 共享工具 | 5 个 domain 模块 | ✅ |

### 角色 1：需求工程

| # | 严重度 | 发现 | 位置 | 复核 |
|---|--------|------|------|:---:|
| 1.1 | 🔴 严重 | **`hasRolePermissionImpact` 不检测 rolePermissions 绑定变更**（与 14.1 相同根因从不同角度发现）：角色权限绑定变更后不刷新用户缓存，导致安全漏洞 | `role.ts:84-89` | ✅ |
| 1.2 | 🟡 一般 | **`computeAncestors` 物化路径函数无测试**：影响所有基于 ancestors 的 SQL 过滤和数据范围正确性 | `department.ts:12-13` | ✅ |

---

## 3. 整体重构与规范方案

### 3.1 消除跨模块重复：Zod 门禁抽取

**问题**：全部 6 个 actions.ts 中每个 Server Action 都以相同的 3-5 行开头：

```typescript
const parsed = Schema.safeParse(input);
if (!parsed.success) {
  return { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: parsed.error.issues[0]!.message };
}
```

**方案**：在 `lib/response.ts` 或新的 `lib/validation.ts` 中抽取共享门禁函数：

```typescript
// lib/validation.ts
import { z } from 'zod';
import { COMMON_ERRORS } from '@auth-sso/contracts';

interface ValidationResult<T> {
  ok: true;
  data: T;
}

interface ValidationErrorResult {
  ok: false;
  response: { success: false; error: string; message: string };
}

export function validateOrReturn<T>(schema: z.ZodSchema<T>, input: unknown): ValidationResult<T> | ValidationErrorResult {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, response: { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: parsed.error.issues[0]!.message } };
  }
  return { ok: true, data: parsed.data };
}
```

调用方：
```typescript
const v = validateOrReturn(CreateUserInputSchema, input);
if (!v.ok) return v.response;
// v.data 类型安全
```

预期收益：消除约 60 行重复代码。

### 3.2 推广 `apiSuccess`/`apiError` 到 actions.ts

**问题**：`apiSuccess()`/`apiError()` 定义但零使用，所有 actions 内联构造 `{ success: true, ... }`。

**方案**：
```typescript
// 改造前
return { success: true, data: { id: perm.id }, message: '权限创建成功' };

// 改造后
return apiSuccess({ id: perm.id }, undefined, '权限创建成功');
```

若推广成本过高，反之应删除 `apiSuccess`/`apiError` 保持代码整洁。

### 3.3 补齐权限变更缓存失效链路

**问题**：`permissions/actions.ts` 的 `updatePermissionAction` 和 `deletePermissionAction` 不触发用户缓存失效。

**修复**（在 `updatePermissionAction` 事务后增加）：
```typescript
// 查询受影响的用户 ID
const affectedUsers = await db
  .select({ userId: schema.userRoles.userId })
  .from(schema.userRoles)
  .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.userRoles.roleId))
  .where(eq(schema.rolePermissions.permissionId, permId));
const userIds = [...new Set(affectedUsers.map(r => r.userId))];
if (userIds.length > 0) {
  await refreshUsersPermissionCache(userIds);
  await revokeUsersAccessByUserId(userIds);
}
```

### 3.4 修复 `hasRolePermissionImpact` 检测范围

**问题**：`role.ts:84-89` 仅检测 `deptId` 和 `status`，遗漏权限绑定变更。

**方案**：要么增加 `permissionIdsChanged` 参数，要么在 Controller 层角色权限分配接口中独立调用缓存刷新。

### 3.5 补齐领域层测试覆盖

**目标**：为 10 个未测的 `*ToInsertRow`/`*ToUpdateRow` 函数添加基础测试：
- 验证字段完整性（所有字段都被包含）
- 验证 `Temporal.Instant → Date` 转换正确
- 为 `updateRow` 验证不包含 `id`（不应在 update 中修改 id）

---

## 4. 核心模块优化示例

### 4.1 修复 `hasRolePermissionImpact` 漏检

**优化前** — `apps/portal/src/domain/role/role.ts:84-89`：
```typescript
export function hasRolePermissionImpact(
  original: Pick<Role, 'deptId' | 'status'>,
  updated: Pick<Role, 'deptId' | 'status'>,
): boolean {
  return original.deptId !== updated.deptId || original.status !== updated.status;
}
```

**优化后**：
```typescript
export function hasRolePermissionImpact(
  original: Pick<Role, 'deptId' | 'status'>,
  updated: Pick<Role, 'deptId' | 'status'>,
  permissionChanged: boolean = false,
): boolean {
  return original.deptId !== updated.deptId
    || original.status !== updated.status
    || permissionChanged;
}
```

**优化点**：
- 新增 `permissionChanged` 参数，Controller 在分配/撤销权限时传入 `true`
- 保持向后兼容（默认 `false`）

### 4.2 补全 `permission-actions.test.ts` 业务行为验证

**优化前** — `apps/portal/__tests__/api/permission-actions.test.ts:37-40`：
```typescript
it('create: 有效 → success', async () => {
  const r: any = await createPermissionAction({ code: 'NEW', name: 'New', resource: '/api/test', action: 'GET', type: 'API' } as any);
  expect(r.success).toBe(true);
});
it('update: 存在 → success', async () => {
  mockDb.setQueryResult([permRow]);
  const r: any = await updatePermissionAction('perm-1', { name: 'Updated' } as any);
  expect(r.success).toBe(true);
});
it('delete: 可删除 → success', async () => {
  mockDb.setQueryResult([permRow]);
  const r: any = await deletePermissionAction('perm-1');
  expect(r.success).toBe(true);
});
```

**优化后**：
```typescript
it('create: 有效 → 返回 id 且写入 DB', async () => {
  const r: any = await createPermissionAction({ code: 'NEW', name: 'New', resource: '/api/test', action: 'GET', type: 'API' } as any);
  expect(r.success).toBe(true);
  expect(r.data.id).toBeDefined();
  // 验证 DB 写入内容
  const inserts = mockDb.getWrites('insert');
  expect(inserts).toHaveLength(1);
  expect(inserts[0]!.data.code).toBe('NEW');
  expect(inserts[0]!.data.name).toBe('New');
});

it('update: 存在 → 写入正确字段', async () => {
  mockDb.setQueryResult([permRow]);
  const r: any = await updatePermissionAction('perm-1', { name: 'Updated' } as any);
  expect(r.success).toBe(true);
  const updates = mockDb.getWrites('update');
  expect(updates).toHaveLength(1);
  expect(updates[0]!.data.name).toBe('Updated');
});

it('delete: 可删除 → 级联删除 rolePermissions', async () => {
  mockDb.setQueryResult([permRow]);
  const r: any = await deletePermissionAction('perm-1');
  expect(r.success).toBe(true);
  const deletes = mockDb.getWrites('delete');
  expect(deletes.length).toBeGreaterThanOrEqual(2); // rolePermissions + permissions
});
```

**优化点**：
- 验证返回数据的字段内容（data.id）
- 验证 DB 写入内容（code/name 正确传入）
- 验证 delete 级联操作（rolePermissions + permissions 均删除）

### 4.3 消除 Zod 门禁重复

**优化前** — 6 个 actions.ts 中 15+ 处重复：
```typescript
const parsed = SomeSchema.safeParse(input);
if (!parsed.success) {
  return { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: parsed.error.issues[0]!.message };
}
```

**优化后** — 新增 `lib/validation.ts`：
```typescript
import { z } from 'zod';
import { COMMON_ERRORS } from '@auth-sso/contracts';

type Valid<T> = { ok: true; data: T };
type Invalid = { ok: false; response: { success: false; error: string; message: string } };

export function validate<T>(schema: z.ZodSchema<T>, input: unknown): Valid<T> | Invalid {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, response: { success: false, error: COMMON_ERRORS.VALIDATION_ERROR, message: parsed.error.issues[0]!.message } };
  }
  return { ok: true, data: parsed.data };
}
```

调用方简化：
```typescript
const v = validate(CreateUserInputSchema, input);
if (!v.ok) return v.response;
// v.data 类型安全，直接使用
```

---

## 5. 分阶段落地路线图

### P0（本周，安全修复）

| 任务 | 严重度 | 预计工时 | 可独立上线 |
|------|:---:|:---:|:---:|
| 修复 `hasRolePermissionImpact` 漏检 permissions 绑定变更 | 🔴 严重 | 0.5h | ✅ |
| `permissions/actions.ts` 权限变更后增加缓存失效/会话撤销 | 🔴 严重 | 1.5h | ✅ |
| 为 `permission-actions.test.ts` 增加业务行为验证（创建/更新/删除） | 🔴 严重 | 2h | ✅ |
| 为 `client-actions.test.ts` rotateClientSecret 增加 DB 写入验证 | 🔴 严重 | 0.5h | ✅ |
| 为 `department-actions.test.ts` 增加 deleteDepartmentAction 测试 | 🔴 严重 | 2h | ✅ |

### P1（本月，代码质量提升）

| 任务 | 严重度 | 预计工时 | 可独立上线 |
|------|:---:|:---:|:---:|
| 抽取 `validate<T>()` 共享 Zod 门禁函数 | 🟡 一般 | 2h | ✅ |
| 推广或删除 `apiSuccess`/`apiError` 死代码 | 🔵 优化 | 1h | ✅ |
| 修复 `performRevocation` 异常处理 — 每个步骤独立 try/catch | 🟡 一般 | 1h | ✅ |
| `updateRoleAction` 消除重复 DB 查询 | 🟡 一般 | 0.5h | ✅ |
| 修复 `audit.ts` HMR 内存泄漏（globalThis 防重复创建） | 🟡 一般 | 0.5h | ✅ |

### P2（下月，完备化）

| 任务 | 严重度 | 预计工时 | 可独立上线 |
|------|:---:|:---:|:---:|
| `createDepartmentAction` 查询+插入入事务 | 🟡 一般 | 0.5h | ✅ |
| 为 10 个未测 `*ToInsertRow`/`*ToUpdateRow` 添加测试 | 🟡 一般 | 2h | ✅ |
| `role.ts` 补充权限绑定/解绑纯函数 | 🟡 一般 | 2h | ✅ |
| `buildDepartmentTree` 传入 sortKey 参数 | 🔵 优化 | 0.5h | ✅ |
| 修正 `tree-utils.ts` 不可达分支 | 🔵 优化 | 0.5h | ✅ |
| `menu-tree.ts` 使用共享 `buildTree` | 🔵 优化 | 1h | ✅ |

### P3（季度，技术债清理）

| 任务 | 严重度 | 预计工时 |
|------|:---:|:---:|
| `resolveParentAncestors` 三态返回值语义重构 | 🔵 优化 | 1h |
| `verifyAccessToken` 空数组兜底改为 warn+兜底 | 🟡 一般 | 0.5h |
| 消除 `hasDeptChanged` null/空字符串不一致 | 🟡 一般 | 0.5h |
| 抽取 `toDbTimestamp()` 共享工具 | 🔵 优化 | 0.5h |

---

## 6. 长期维护规范

### 6.1 新增 Actions 检查清单

- [ ] 使用 `validate<T>()` 统一 Zod 门禁（非手写 safeParse 模版）
- [ ] 写操作后有对应的缓存失效/会话撤销逻辑（参照 `roles/actions.ts`）
- [ ] 多步骤操作在 `db.transaction()` 内完成（参照 `createDepartmentAction` 反例）
- [ ] 使用 `apiSuccess()`/`apiError()` 统一响应格式
- [ ] 测试至少覆盖：创建验证写入字段、更新验证正确修改、删除验证级联

### 6.2 测试真实度基线

| 真实度 | 最低断言要求 |
|:---:|------|
| ✅ 有效 | 至少 1 个测试验证了业务行为结果（如 DB 写入内容、字段值、状态转换） |
| ⚠️ 弱 | 验证了响应数据结构但未验证业务正确性 |
| ❌ 无效 | 所有测试仅断言 HTTP 200 或 `r.success === true` |

新 PR 中写操作测试必须达到「✅ 有效」级别。

### 6.3 代码重复红线

- 同一项目中 3 处以上相同的 3+ 行模式 → 必须抽取为工具函数
- `*ToInsertRow`/`*ToUpdateRow` 中的时间转换逻辑 → 使用 `toDbTimestamp()` 共享函数
- Zod safeParse + 错误返回模式 → 使用 `validate<T>()` 门禁

---

> **审计 Agent**：复核 Agent（Kilo）
> **复核方式**：Read 源文件逐条交叉验证 + TOP10 严重问题二次确认
> **复核修正**：无 Agent 误报。Agent A 的 13 条发现全部确认，Agent B 的 12 条发现全部确认。无重叠需去重。
> **与前 3 轮审计的关系**：本报告聚焦前 3 轮（架构/Top10/安全/错误码/CI 等高阶问题）未覆盖的函数级细节。
