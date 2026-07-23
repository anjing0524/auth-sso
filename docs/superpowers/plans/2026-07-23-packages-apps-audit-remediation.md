# Packages / Apps Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复本轮 packages/apps 审计确认的授权原子性、审计可靠性、REST 契约、SQL 分页、分层边界与死契约问题。

**Architecture:** 角色绑定的验证、替换与安全审计收敛到同一 Drizzle transaction；访问日志保持异步。领域错误映射收缩为纯函数，REST 和 Server Action 的响应协议继续分离。权限 UI 的全量树与 API 的 SQL 分页列表使用不同读模型。

**Tech Stack:** Next.js 16、React 19、TypeScript 6、Zod 4、Drizzle ORM、Vitest 4、PostgreSQL、Rust/Pingora（仅文档约束）。

## Global Constraints

- 内部页面写操作使用 Server Actions；外部 REST 路由保持薄控制器。
- `domain/` 不得依赖 `next/*`、Drizzle、logger 或其他基础设施。
- 所有安全敏感低频写操作必须与审计记录同一数据库事务；访问日志可异步。
- REST 错误体为 `{ error, message }`；`success` 仅用于 Server Action `ApiResponse`。
- 共享枚举和值数组仅由 `@auth-sso/contracts` 定义；不新增依赖。
- 自定义 Rust async Trait 必须返回 `impl Future + Send`；Pingora 外部 Trait 实现允许 `async_trait` 适配。
- 每一项先写失败测试，再写最小实现；完成后运行 lint、typecheck、全量测试。

---

### Task 1: 角色绑定输入和同事务校验

**Files:**
- Create: `apps/portal/__tests__/api/user-role-api.test.ts`
- Modify: `apps/portal/src/app/api/users/[id]/roles/route.ts:20-218`

**Interfaces:**
- Consumes: `db.transaction((tx) => ...)`、`schema.users`、`schema.roles`、`schema.userRoles`、`withPermission()`。
- Produces: `RoleAssignmentBodySchema`、`RoleRemovalBodySchema` 和 `validateRoleAssignment(tx, userDeptId, roleIds)`；所有非法角色输入均返回 `{ error, message }` 的 400。

- [ ] **Step 1: 写入角色绑定 Route 的失败集成测试**

在新测试文件中建立真实测试 DB、mock `withPermission`/Redis token revoke，并导入 `POST`/`DELETE`。加入以下断言：

```ts
it('重复 roleIds 返回 400 且不改变既有绑定', async () => {
  await seedUserAndRoles();
  const response = await AssignRoles(request({ roleIds: [ROLE_ID, ROLE_ID] }), params(USER_ID));
  expect(response.status).toBe(400);
  expect(await currentRoleIds(USER_ID)).toEqual([OLD_ROLE_ID]);
});

it.each([
  { roleIds: ['not-a-uuid'] },
  { roleIds: [] },
  { roleIds: Array.from({ length: 101 }, () => ROLE_ID) },
])('非法 roleIds 返回 400', async (body) => {
  expect((await AssignRoles(request(body), params(USER_ID))).status).toBe(400);
});

it('不存在、禁用或跨部门角色均返回 400 且不写 user_roles', async () => {
  // 分别种入不存在 ID、DISABLED 同部门角色、ACTIVE 异部门角色。
});

it('DELETE 的 roleId 非 UUID 返回 400', async () => {
  expect((await RemoveRole(request({ roleId: 'bad' }), params(USER_ID))).status).toBe(400);
});
```

- [ ] **Step 2: 运行新增测试，确认当前实现失败**

Run: `pnpm exec vitest run --project @auth-sso/portal apps/portal/__tests__/api/user-role-api.test.ts`

Expected: 重复 ID 或非法 UUID 测试失败，或出现 500/现有绑定被删除。

- [ ] **Step 3: 实现最小的 Zod schema 和 tx 校验函数**

在 `route.ts` 中定义：

```ts
const MAX_ASSIGNED_ROLES = 100;
const RoleAssignmentBodySchema = z.object({
  roleIds: z.array(z.string().uuid()).min(1).max(MAX_ASSIGNED_ROLES),
}).superRefine(({ roleIds }, ctx) => {
  if (new Set(roleIds).size !== roleIds.length) {
    ctx.addIssue({ code: 'custom', message: '角色 ID 不可重复', path: ['roleIds'] });
  }
});
const RoleRemovalBodySchema = z.object({ roleId: z.string().uuid() });
```

将 `validateDeptConstraint` 替换为接收 `tx` 的函数。它必须以 `tx.select(...).from(schema.roles)` 查询，并同时检查：用户已有部门、查询数等于输入数、每个角色与用户部门相同、每个角色为 `ENTITY_ACTIVE`。`POST` 和 `DELETE` 均在 `db.transaction` 内重新读取用户并完成数据范围校验；禁止 transaction callback 内调用全局 `db`。

- [ ] **Step 4: 扩展测试覆盖正确替换和精确删除**

```ts
it('合法同部门 ACTIVE 角色替换旧绑定，并只保留新集合', async () => {
  const response = await AssignRoles(request({ roleIds: [ROLE_ID] }), params(USER_ID));
  expect(response.status).toBe(200);
  expect(await currentRoleIds(USER_ID)).toEqual([ROLE_ID]);
});

it('DELETE 仅移除指定 roleId，保留该用户的其他角色', async () => {
  await seedBindings(USER_ID, [ROLE_ID, SECOND_ROLE_ID]);
  expect((await RemoveRole(request({ roleId: ROLE_ID }), params(USER_ID))).status).toBe(200);
  expect(await currentRoleIds(USER_ID)).toEqual([SECOND_ROLE_ID]);
});
```

- [ ] **Step 5: 运行角色绑定测试，确认通过**

Run: `pnpm exec vitest run --project @auth-sso/portal apps/portal/__tests__/api/user-role-api.test.ts`

Expected: PASS。

### Task 2: 将安全审计置入业务事务

**Files:**
- Modify: `apps/portal/src/lib/audit.ts:17-164`
- Modify: `apps/portal/src/lib/auth/guard.ts:13-89`
- Modify: `apps/portal/src/app/api/users/[id]/roles/route.ts:75-113, 143-204`
- Modify: `apps/portal/__tests__/api/user-role-api.test.ts`
- Modify: `apps/portal/__tests__/api/permission-enforcement.test.ts`

**Interfaces:**
- Produces: `appendSecurityAudit(tx, params): Promise<void>`，其中 `tx` 为当前 Drizzle transaction。
- Produces: `writeLoginLog(params): Promise<void>` 和 `writeAccessLog(params): void`；前者同步、后者尽力而为。
- Removes: `recordActionAudit`、`recordApiAudit` 和 guard 中的隐式安全审计。

- [ ] **Step 1: 写入审计原子性失败测试**

在角色 API 测试中 mock/拦截 `appendSecurityAudit` 抛错，并验证业务绑定回滚：

```ts
it('安全审计插入失败时回滚角色替换', async () => {
  mockAppendSecurityAudit.mockRejectedValueOnce(new Error('audit unavailable'));
  const response = await AssignRoles(request({ roleIds: [ROLE_ID] }), params(USER_ID));
  expect(response.status).toBe(500);
  expect(await currentRoleIds(USER_ID)).toEqual([OLD_ROLE_ID]);
});
```

在 guard 测试中断言成功 handler 后不再调用隐式 audit 函数。

- [ ] **Step 2: 运行相关测试，确认当前实现不满足原子性**

Run: `pnpm exec vitest run --project @auth-sso/portal apps/portal/__tests__/api/user-role-api.test.ts apps/portal/__tests__/api/permission-enforcement.test.ts`

Expected: 新增“审计失败回滚”测试失败，因为当前 `writeAuditLog()` 只调度后台 Promise。

- [ ] **Step 3: 实现审计分级 API**

保留 `fireAndForgetWithRetry` 只给 `writeAccessLog` 使用。新增：

```ts
export async function appendSecurityAudit(
  tx: DrizzleTransaction,
  params: WriteAuditLogParams,
): Promise<void> {
  await tx.insert(schema.auditLogs).values(toAuditLogRow(params));
}

export async function writeLoginLog(params: WriteLoginLogParams): Promise<void> {
  await db.insert(schema.loginLogs).values(toLoginLogRow(params));
}
```

抽取 `toAuditLogRow` 和 `toLoginLogRow` 仅消除同一行映射重复；不引入 Repository。删除 `recordAudit`、`recordActionAudit`、`recordApiAudit`。在用户角色路由 transaction 内、关联表写入后调用 `await appendSecurityAudit(tx, params)`；缓存刷新、JTI 撤销仍在 commit 后执行。

- [ ] **Step 4: 去除 guard 的隐式审计依赖**

从 `guard.ts` 删除 audit imports 和 `options.audit` 的成功后调用，保留 `PermissionCheckOptions.audit` 类型字段以避免本轮扩大调用方改造。所有当前安全写 Controller 将在后续任务的同类复核中改为显式事务审计；未迁移的 `audit` 字段不得再制造虚假的“已记录”承诺。

- [ ] **Step 5: 运行审计与角色测试，确认通过**

Run: `pnpm exec vitest run --project @auth-sso/portal apps/portal/__tests__/api/user-role-api.test.ts apps/portal/__tests__/api/permission-enforcement.test.ts`

Expected: PASS；审计失败时数据库角色绑定保持原状。

### Task 3: 纯错误映射与一致 REST 错误体

**Files:**
- Modify: `apps/portal/src/domain/shared/error-mapping.ts:9-80`
- Modify: `apps/portal/src/lib/auth/guard.ts:13-89`
- Modify: `apps/portal/__tests__/api/permission-enforcement.test.ts`

**Interfaces:**
- Consumes: `mapDomainError(err): { status: number; error: string; message: string }`。
- Produces: `withPermission()` 对 401/403/500 的 `{ error, message }` 响应。

- [ ] **Step 1: 添加 REST 错误体的失败断言**

在现有 `withPermission` 测试的 401、403 与 handler 抛错测试中增加：

```ts
expect(body).toEqual({ error: 'AUTH_SSO_1003', message: expect.any(String) });
expect(body).not.toHaveProperty('success');
```

为未知异常测试断言 logger 在 guard 内调用，而不是在 `mapDomainError()` 内调用。

- [ ] **Step 2: 运行守卫测试并确认失败**

Run: `pnpm exec vitest run --project @auth-sso/portal apps/portal/__tests__/api/permission-enforcement.test.ts`

Expected: 失败，因为当前错误体含有 `success: false`。

- [ ] **Step 3: 实现纯映射和 REST 工厂复用**

从 `error-mapping.ts` 删除 `createLogger` import、logger 实例和 `log.error` 调用。修改 guard：保留捕获的 `error`，当 `mapDomainError(error).status >= 500` 时在 guard logger 中记录原异常。以 `restError(mapped.error, mapped.message, mapped.status)` 生成 REST 错误；授权失败仍使用 `check.error` 作为 message，但响应只能含 `error` 和 `message`。

- [ ] **Step 4: 运行守卫测试确认通过**

Run: `pnpm exec vitest run --project @auth-sso/portal apps/portal/__tests__/api/permission-enforcement.test.ts`

Expected: PASS。

### Task 4: SQL 级权限分页与独立全量读模型

**Files:**
- Modify: `apps/portal/src/app/(dashboard)/permissions/data.ts:13-57`
- Modify: `apps/portal/src/app/api/permissions/route.ts:13-25`
- Modify: `apps/portal/src/app/(dashboard)/permissions/page.tsx:1-40`
- Modify: `apps/portal/__tests__/api/permission-api.test.ts:100-155`

**Interfaces:**
- Produces: `getPermissionPage({ type?, page, pageSize }): Promise<{ data: PermissionListItem[]; pagination: PaginationMeta }>`。
- Produces: `getPermissions(type?): Promise<PermissionListItem[]>` only for the dashboard's complete permission tree/list.

- [ ] **Step 1: 添加分页数据库语义的失败测试**

将 API 测试改为明确查询参数并断言总数、页数和排序：

```ts
it('分页只返回请求页且保留总数', async () => {
  await seedPermissions(3);
  const body = await parseResponseJson(await ListPermissions(
    createTestRequest('/api/permissions', { searchParams: { page: '2', pageSize: '1' } }),
  ));
  expect(body.pagination).toMatchObject({ page: 2, pageSize: 1, total: 3, totalPages: 3 });
  expect(body.data).toHaveLength(1);
  expect(body.data[0].code).toBe('portal:role:list');
});
```

- [ ] **Step 2: 运行权限 API 测试，确认当前测试失败或无法证明 SQL 分页**

Run: `pnpm exec vitest run --project @auth-sso/portal apps/portal/__tests__/api/permission-api.test.ts`

Expected: 新测试失败，或经 spy 证明 `getPermissions()` 未接收分页参数。

- [ ] **Step 3: 实现 `getPermissionPage`**

用相同筛选条件执行 `count()` 和 `select().limit(pageSize).offset((page - 1) * pageSize)`，按 `sort, createdAt` 排序，并返回 `PaginationMeta`。把 row→DTO 映射提取为本文件私有函数，避免两个读模型漂移。`getPermissions` 保持现有完整集合语义供 dashboard；API Route 改为调用 `getPermissionPage`，删除 `slice()`。

- [ ] **Step 4: 运行权限 API 与页面相关测试确认通过**

Run: `pnpm exec vitest run --project @auth-sso/portal apps/portal/__tests__/api/permission-api.test.ts apps/portal/__tests__/components/app-sidebar.test.tsx`

Expected: PASS。

### Task 5: 清理未使用 OIDC 类型并记录 Pingora 例外

**Files:**
- Modify: `packages/contracts/src/oidc.ts:61-146`
- Modify: `packages/contracts/src/__tests__/constants.test.ts`
- Modify: `docs/spec/ARCHITECTURE_CONSTRAINTS.md`（Rust async Trait 规则处）

**Interfaces:**
- Removes: 未使用的 `IDTokenClaims`、`AccessTokenPayload`、`AuthorizationRequest`、`TokenRequest`、`IntrospectRequest`、`IntrospectResponse`、`PKCEData`。
- Preserves: `OAUTH_PARAMS`、OIDC discovery 常量、`TOKEN_TTL`、`REDIS_KEY_PREFIX`。

- [ ] **Step 1: 写入 contracts 回归测试与删除前引用检查**

在 constants 测试中断言现用 OIDC 常量的值和唯一性；执行：

Run: `rg -n "IDTokenClaims|AccessTokenPayload|AuthorizationRequest|TokenRequest|IntrospectRequest|IntrospectResponse|PKCEData" apps packages --glob '*.{ts,tsx}'`

Expected: 仅有 `packages/contracts/src/oidc.ts` 自身定义；否则停止删除并将消费者迁移到其实际协议/领域类型。

- [ ] **Step 2: 删除无消费者接口并记录框架例外**

删除上述七个 interface；不删除 OIDC 常量。向架构约束的 Rust 异步 Trait 章节补充：Pingora 等第三方 Trait 的实现可使用其规定的 `async_trait` 宏，新增项目自定义 Trait 仍必须使用 `-> impl Future<Output = T> + Send`。

- [ ] **Step 3: 运行 contracts 测试和类型检查**

Run: `pnpm --filter @auth-sso/contracts test && pnpm typecheck`

Expected: PASS。

### Task 6: 同类安全写路径复审、文档沉淀与全量验证

**Files:**
- Modify: 已受影响的 `apps/portal/src/app/**/actions.ts` 或 `route.ts`（仅发现使用已删除隐式审计但未显式事务审计的安全写路径）
- Create: `docs/solution/2026-07-23-synchronous-security-audit.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/audit/2026-07-23-packages-apps-code-audit.md`

**Interfaces:**
- Consumes: `appendSecurityAudit(tx, params)`。
- Produces: 安全写操作的显式审计规则、完成状态与根因记录。

- [ ] **Step 1: 搜索并分类现有安全写路径**

Run: `rg -n "audit:|writeAuditLog|recordActionAudit|recordApiAudit" apps/portal/src -g '*.{ts,tsx}'`

将结果分为“已有 transaction，可直接追加 audit”、“无 transaction 但安全写操作”、“访问日志”。只修改前两类；访问日志保持异步。

- [ ] **Step 2: 为每个仍受 `audit:` 标记的安全写操作补事务内审计**

在各自既有 `db.transaction(async (tx) => ...)` 内追加：

```ts
await appendSecurityAudit(tx, {
  userId: ctx.userId,
  operation: 'USER_UPDATE',
  method: 'ACTION',
  status: 200,
});
```

操作枚举必须使用该用例现有的 `audit` 值；不得创建通用 Controller 或 Repository。为每个新增路径补一个“审计写入失败回滚”的最小集成测试。

- [ ] **Step 3: 重新阅读并更新质量文档**

新增 solution 文档，记录根因（事务回调误用全局 DB、异步审计语义不清）、纠正措施和预防清单。更新 roadmap 将 P0/P1 相关项标记完成；更新本轮 audit 报告的状态和验证结果。修改前完整阅读每个目标文档。

- [ ] **Step 4: 运行完整验证**

Run: `pnpm lint && pnpm typecheck && pnpm test`

Expected: 全部 PASS。

- [ ] **Step 5: 复核工作区与审计结论**

Run: `git diff --check && git status --short && rg -n "recordActionAudit|recordApiAudit" apps/portal/src`

Expected: diff 无空白错误；不存在已删除的隐式安全审计 API；工作区只含本计划相关文件。

## Plan Self-Review

- **规格覆盖**：Task 1 覆盖 P0-1/P1-1；Task 2 覆盖 P1-5；Task 3 覆盖 P1-2/P1-4；Task 4 覆盖 P1-3；Task 5 覆盖 P2-1/P2-2；Task 6 覆盖同类复审、solution 与 roadmap。
- **无占位符**：每项实现步骤都给出目标文件、接口、测试断言和命令；唯一条件分支（仓内发现外部引用）有明确停止/迁移规则，避免破坏性删除。
- **类型一致性**：安全审计统一使用 `appendSecurityAudit(tx, params)`；分页读模型统一使用 `getPermissionPage({ type, page, pageSize })`；所有 REST 错误统一 `{ error, message }`。
