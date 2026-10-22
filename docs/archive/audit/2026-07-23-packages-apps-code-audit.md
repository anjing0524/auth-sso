# packages / apps 代码审计报告

> **审计日期**：2026-07-23
> **项目**：Auth-SSO
> **审计范围**：`packages/`、`apps/`（含相关测试与工作流验证）
> **综合评级**：B-
> **严重问题数**：1 个 ｜ **一般问题数**：5 个 ｜ **优化建议**：2 个

## 目录

1. [全局诊断](#1-全局诊断)
2. [经复核的问题清单](#2-经复核的问题清单)
3. [重构与规范方案](#3-重构与规范方案)
4. [核心修复示例](#4-核心修复示例)
5. [分阶段路线图](#5-分阶段路线图)
6. [长期维护规范](#6-长期维护规范)

## 1. 全局诊断

本轮以现行规格和当前 HEAD 为准，未沿用旧审计报告中已经失效的结论。Portal 的读写分离、统一权限守卫、分页上限与 Gateway 的静态检查均已具备；本轮没有发现新的 JWKS、JWT 验签或 Rust 编译问题。

| 维度 | 评级 | 结论 |
|---|:---:|---|
| 正确性与安全 | B- | 角色分配事务内仍有一次跨事务读取，可能绕过部门/启用状态约束。 |
| 架构边界 | B- | `domain/` 有一处反向依赖 `lib/`；少量 REST Controller 承担了用例逻辑。 |
| API 与性能 | B | 分页参数已统一钳制，但权限接口仍把全量数据读入内存后分页。 |
| 可观测性与审计 | B- | 有重试和错误日志，但 fire-and-forget 审计不能保证业务成功即审计持久化。 |
| 工程质量 | A- | `pnpm lint`、`pnpm typecheck`、`pnpm test` 和 `cargo check --all-targets --all-features` 均通过。 |

### 核心问题 TOP5

1. **P0：角色约束校验未使用当前事务连接**，并发修改角色部门或状态时可产生不满足 `R-USER-ROLE` 的绑定。
2. **P1：角色分配输入只校验“是非空数组”**，重复/非 UUID/不存在角色会导致 500 或不透明的业务失败。
3. **P1：错误映射位于 domain 却依赖 lib logger**，违反领域层纯 TS、依赖方向单向的约束。
4. **P1：权限列表在内存分页**，数据规模增长时会放大全表读、缓存序列化和 GC 压力。
5. **P1：审计写入脱离主流程**，进程终止或数据库持续故障时，已成功的敏感操作可能无审计记录。

## 2. 经复核的问题清单

### P0 — 正确性 / 授权一致性

#### P0-1：角色部门与状态检查没有与写入处于同一事务

- **文件**：`apps/portal/src/app/api/users/[id]/roles/route.ts:23-28, 75-90`
- **风险等级**：严重
- **证据**：`POST` 在 `db.transaction(async (tx) => ...)` 内调用 `validateDeptConstraint()`，但该函数使用全局 `db.select()`，不是 `tx.select()`。
- **影响**：校验完成后到 `user_roles` 写入前，另一事务可改变角色的 `deptId` 或 `status`；最终绑定可能违反“角色必须属于用户部门且为 ACTIVE”的业务规则。注释声称已防 TOCTOU，实际没有覆盖角色读取。
- **修复**：令校验函数接收当前 `tx`（或将角色读取内联在事务中）；同一事务内校验角色数量与 ID 集合，再删除/插入。为并发角色禁用、改部门的场景补集成测试。

### P1 — API、架构与数据访问

#### P1-1：角色分配/移除缺少结构化输入校验

- **文件**：`apps/portal/src/app/api/users/[id]/roles/route.ts:58-62, 137-143`
- **风险等级**：一般
- **证据**：`roleIds` 仅检查 `Array.isArray` 和非空；`roleId` 仅检查 truthy。没有 UUID、最大长度、去重、角色数精确匹配或 JSON 解析失败映射。
- **影响**：重复 ID 会触发关联表唯一约束并变为 500；非法 ID 和不存在 ID 的失败语义不稳定，且无上限数组增加数据库负载。
- **修复**：使用 Zod `z.array(z.string().uuid()).min(1).max(n)` 与 `Set` 去重；查询后确认 `roles.length === uniqueRoleIds.length`，返回 `VALIDATION_ERROR`，不要依赖数据库约束作为输入校验。

#### P1-2：`domain/shared/error-mapping.ts` 反向依赖 `lib/logger`

- **文件**：`apps/portal/src/domain/shared/error-mapping.ts:9-13, 79`
- **风险等级**：一般
- **证据**：领域目录直接导入 `@/lib/logger` 并执行日志副作用。
- **影响**：违反 `domain → 零框架/基础设施依赖` 约束，错误映射不能作为真正纯函数复用，且未来 logger 依赖环境/框架时会扩大领域层耦合。
- **修复**：让 `mapDomainError()` 只返回映射结果；在 `guard.ts` 的未知异常分支记录原异常。若日志需要复用，注入一个最小 `onUnexpectedError` 回调，而不是让 domain 导入 lib。

#### P1-3：权限 REST 接口的“分页”仍是全量查询后的内存切片

- **文件**：`apps/portal/src/app/api/permissions/route.ts:13-24`；`apps/portal/src/app/(dashboard)/permissions/data.ts:15-36`
- **风险等级**：一般
- **证据**：`getPermissions()` 不接收 page/pageSize，SQL 没有 `limit/offset/count`；Route 对全部映射后的结果 `slice()`。
- **影响**：`MAX_PAGE_SIZE` 只限制响应，不限制数据库扫描和缓存对象大小；权限量或客户端数增加后，列表请求的 CPU、内存与缓存成本线性增长。
- **修复**：为列表读模型增加 `{ page, pageSize, type }`，在数据库执行 `count` 与 `limit/offset`。如页面需要完整权限树，保留一个语义明确、非 REST 列表使用的 `getPermissionTree()`，不要复用分页读模型。

#### P1-4：REST 守卫错误体偏离已声明的 REST 契约

- **文件**：`apps/portal/src/lib/auth/guard.ts:61-72, 80-88`；`apps/portal/src/lib/response.ts:8-18, 52-60`
- **风险等级**：一般
- **证据**：`response.ts` 规定 REST 错误为 `{ error, message }`，但 `withPermission()` 返回 `{ success: false, error, message }`。
- **影响**：同一个 REST API 的成功和错误处理需要依赖鉴权分支，增加外部客户端和 OpenAPI 对齐成本。
- **修复**：守卫使用统一 `restError()`（或等价的无 `success` 工厂）；保持 `success` 仅用于 Server Action 的 `ApiResponse`。

#### P1-5：审计记录并非可交付语义

- **文件**：`apps/portal/src/lib/audit.ts:17-37, 53-64, 85-100, 141-156`；`apps/portal/src/lib/auth/guard.ts:37-41, 75-78`
- **风险等级**：一般
- **证据**：审计写入被 fire-and-forget 调度，守卫也不 await；重试只存在于当前进程内，最终失败只记日志。
- **影响**：业务响应成功不代表审计已落库；部署回收、崩溃或 DB 故障会留下无法补偿的敏感操作审计缺口。
- **修复**：区分访问日志与合规审计。对角色、权限、客户端密钥、强制下线等安全写操作，在业务事务内写 audit outbox，提交后由可靠消费者投递；若当前不引入 outbox，至少对这些操作 `await writeAuditLog()` 并明确失败策略。普通访问日志可继续异步。

### P2 — 无效代码与维护性

#### P2-1：OIDC 类型导出在仓库内没有消费者

- **文件**：`packages/contracts/src/oidc.ts:61-146`
- **风险等级**：优化建议
- **证据**：`IDTokenClaims`、`AccessTokenPayload`、`AuthorizationRequest`、`TokenRequest`、`IntrospectRequest`、`IntrospectResponse`、`PKCEData` 仅在其定义处被搜索到，`apps/`、`packages/` 无任何 import。
- **影响**：这些“共享契约”容易与 Portal 实际领域类型漂移，且使消费者误以为是维护中的公共 API。
- **修复**：先确认不存在仓库外消费者；若无，删除并以实际使用的领域/协议类型为唯一真相源。若要保留公共 SDK 契约，增加消费者测试并标注版本兼容承诺。

#### P2-2：Pingora Trait 实现中的 `async_trait` 是框架边界，不能机械清理

- **文件**：`apps/gateway/src/redis.rs:172`、`redirect.rs:48`、`gateway.rs:531`、`jwks.rs:461`
- **风险等级**：优化建议（非缺陷）
- **证据**：这些都是 Pingora `BackgroundService` / `ProxyHttp` 的外部 Trait 实现；项目自定义 `SessionExt` 已采用返回 `impl Future + Send` 的零分配方式（`apps/gateway/src/http.rs:109-145`）。
- **建议**：保留第三方 Trait 所需宏；禁止在新增自定义 Trait 中使用它。将此例外写入架构约束，避免“全局删除依赖”破坏 Pingora 兼容性。

## 3. 重构与规范方案

遵循最小变更原则，建议不做全局重构：

1. 先修 `P0-1` 与 `P1-1`：将角色查询、用户重读和关联写入收敛到一个事务；用 schema 取代手写 body 判断。
2. 将 `mapDomainError` 降为纯映射，日志留在 guard/controller；这是单文件依赖修正，不需要引入 Repository 或 Mapper 层。
3. 将权限读模型分为“分页列表”和“完整树”两个显式用例，前者只返回页面需要的数据。
4. 将审计按可靠性分级：访问日志异步，安全操作采用事务 outbox 或同步写入。
5. 删除前先执行发布物/外部消费者核查；`packages/contracts` 的未使用导出属于潜在破坏性变更。

## 4. 核心修复示例

### 事务一致的角色校验

**当前问题**：事务回调中调用了使用全局 `db` 的校验函数。

```ts
const errMsg = await validateDeptConstraint(userRow.deptId, roleIds);
await tx.insert(schema.userRoles).values(/* ... */);
```

**建议形态**：校验函数显式接收事务，并验证集合完整性。

```ts
async function validateRoleAssignment(
  tx: DrizzleTransaction,
  userDeptId: string | null,
  roleIds: readonly string[],
): Promise<string | null> {
  if (!userDeptId) return '该用户尚未分配部门';
  const roles = await tx.select({ id: schema.roles.id, deptId: schema.roles.deptId, status: schema.roles.status })
    .from(schema.roles)
    .where(inArray(schema.roles.id, roleIds));
  if (roles.length !== roleIds.length) return '存在无效角色';
  return roles.every((role) => role.deptId === userDeptId && role.status === ENTITY_ACTIVE)
    ? null
    : '角色必须属于用户部门且处于启用状态';
}
```

该修改把“读取的事实”和“写入的决定”置于同一事务连接内，并让缺失角色成为可预测的 4xx，而不是数据库异常。

## 5. 分阶段路线图

| 阶段 | 内容 | 预计工作量 | 风险点 | 可独立上线 |
|---|---|:---:|---|:---:|
| P0 | 角色分配使用 `tx` 校验；Zod 校验、去重与角色集合完整性测试 | 0.5 天 | 需确认并发测试 DB 隔离 | ✅ |
| P1 | 修正 REST 错误体；error mapping 去除 logger 依赖 | 0.5 天 | 外部客户端可能依赖错误体的 `success` 字段 | ✅ |
| P2 | SQL 级权限分页与完整树用例拆分 | 1 天 | 页面是否仍需要完整树 | ✅ |
| P3 | 安全审计采用 outbox / 同步持久化 | 2–3 天 | 要定义审计失败时的业务策略 | ⚠️ |
| P4 | 核查并清理 contracts 未使用类型 | 0.5 天 | 可能存在仓库外消费者 | ✅ |

## 6. 长期维护规范

- 所有“校验后写入”的授权规则，校验查询必须使用同一 `tx`；为并发变更写回归测试。
- API body 先由 Zod 完整解析，再进入数据库；数组输入须限定元素类型、数量和唯一性。
- `domain/` 只包含纯函数、领域错误与类型；日志、DB、Next API 均留在外层。
- 列表接口的 `pageSize` 上限不是 SQL 分页的替代品；每个分页端点都应有 `count + limit + offset` 或游标策略。
- 合规审计不得只依赖未等待 Promise；异步日志必须有明确的可丢失等级。
- 自定义 Rust Trait 使用 `impl Future + Send`；第三方 Trait 的宏适配仅限边界层并备注原因。

## 验证记录

- `pnpm lint`：通过
- `pnpm typecheck`：通过
- `pnpm test`：通过
- `cargo check --all-targets --all-features`（`apps/gateway`）：通过

