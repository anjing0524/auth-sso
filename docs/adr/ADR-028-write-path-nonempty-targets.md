# ADR-028: 写路径收口——非空 targets 与全局写入口

| 属性 | 值 |
|---|---|
| **状态** | implemented (2026-10-23) |
| **日期** | 2026-10-23 |
| **决策者** | Auth-SSO 团队（治理试运行 Q1/Q5 修复批次） |
| **影响范围** | `apps/portal/src/lib/authz/{data-scope,write,index}.ts`、`lib/user-role-assignment.ts`、`lib/role-permission-assignment.ts`、`(dashboard)/users/actions.ts`、`(dashboard)/departments/actions.ts`、相关测试与架构文档 |

## 背景

2026-10-23 用新建的治理工作流对 `apps/portal/src/lib/authz` 做只读审计（见 `docs/roadmap.md` 续一百），发现两个同源缺陷：

1. **Q1（P1 候选）**：`ScopeTargets` 允许空数组，`assertWithinScope` 对空集合零次迭代、不抛错 ⇒「没有目标」与「跳过校验」共用同一个值。生产中有 4 处进入该状态：`createUserAction` 空 `deptId`、`createDepartmentAction` 根部门分支、`assignUserRoles` / `assignRolePermissions` 的目标缺失分支。后两处随后在 handler 内二次加载目标——守卫行 ≠ 写入行。
2. **Q5（P2 可能）**：权限授予路径用 `withScopedWrite` + `scopedTargets` + handler 二次 `findFirst`。两次读取在 READ COMMITTED 下可见不同版本；目标在两次加载之间出现/迁出时，可能对范围外对象写入。

共同根因：**接口把「守卫目标」建模为可能为空的列表**，于是「无需范围断言」可以悄悄表达成「空列表」。

## 决策

1. **空 targets 不可表达**：`ScopeTargets` 改为非空元组 `readonly [AccessTarget, ...AccessTarget[]]`（或其异步函数形式）；`assertWithinScope` 对空集合 **fail-close**（抛出 `ForbiddenError`），不再把空集合当「无需校验」。
2. **全局资源写走具名入口**：新增 `withGlobalWrite({ operatorId, resource, preflight? }, handler)`——`preflight` → 同一事务内 `resolveScope` → **要求操作者范围非空** → handler。根部门创建改走它（单例检查留在 `preflight`，不再自行 `resolveScope`，顺带消掉重复快照）。无部门用户创建（Q2 未决期间）同样走它：从「空 targets 静默关守卫」变为「显式全局写 + 操作者必须有范围」。
3. **权限授予写路径单次加载**：`assignUserRoles` / `removeUserRole` / `assignRolePermissions` 改用 `withScopedRow`（load → 404 → 范围断言 → handler 用同一份 row），删除 `scopedTargets` 与 handler 二次加载；`EntityNotFoundError` 在模块内捕获并映射回既有 `{ ok:false, status:404 }` 结果，保持适配器契约与 404/403 顺序。
4. **静态守卫**：`scoped-write-guard.test.ts` 增加 `targets: []` 形状扫描与「权限授予模块必须 `withScopedRow`、不得有 `scopedTargets`」检查；`authz-write.test.ts` 增加空 targets fail-close、函数式 targets 运行时返回空集合、`withGlobalWrite` 有范围/无范围/preflight 顺序的行为测试。

## 不在本 ADR 范围（保留为独立决策）

- **Q2**：无部门用户是否受支持。本 ADR 只把创建入口显式化，**未**把 `CreateUserInputSchema.deptId` / `users.dept_id` 改为必填（涉及产品语义、API 契约与迁移）。触发条件：产品确认「部门必填」后另立 ADR/迁移。
- **Q3**：`withScopedWrite` 承诺的「同事务」不等于「同一快照」；未加锁、未提升隔离级别。本轮只做**契约措辞降级**（`data-scope.ts` 注释 + ADR-014 修订段：收窄窗口，不宣称消除），未改行为。触发条件：需要「降权后不可写」的强保证时，按 ADR-014 已列方案（`FOR SHARE` / Serializable + 重试）单独决策。
- **Q4**：`UserScope` 品牌化未做；`withScopedRow` 空 handler 的静态守卫**已在本批扩展**（`scoped-write-guard` 现对 `withScopedWrite` / `withScopedRow` 两个原语一并检查）。品牌化的触发条件：下一次写路径扩展或审计复审。
- **Q6**：`load/deptOf/message` 配置在 action / lib / route 的重复集中。本 ADR 只修根因（双重加载），未做配置聚拢。

## 后果

- 正面：「零守卫状态」在类型与运行时都不可表达；权限授予路径的守卫行与写入行是同一份 row；根部门与无部门用户写入口显式可审计；新增调用点若试图传空 targets 会编译失败或 403。
- 代价/风险：无部门用户创建仍被允许（Q2 未决，现有测试/API 契约不变）；根部门无范围操作者的错误由 422 `BusinessRuleViolationError` 变为 403 `ForbiddenError`（安全姿态更严格，已由测试覆盖）；`withGlobalWrite` 是新的写入口，需在架构文档中保持同步。

## 验证

- `pnpm --filter @auth-sso/portal typecheck` **exit 0**。
- 定向集成测试：`authz-write` / `scoped-write-guard` / `authz-surface` / `user-role-api` / `department-actions` / `user-actions` / `role-actions` → **7 文件 / 93 用例通过，exit 0**。
- 全量 `pnpm test` → **EXIT 0，135 文件 / 1172 用例通过**。
- 文档守卫（`docs-claims` / `docs-references` / `docs-api-error-codes` / `agent-governance-skills`）→ **25/25 通过，exit 0**（ADR 计数同步到 28）。
- 变异验证（真实执行，均在还原后 `diff` 确认一致）：
  1. 把 `(dashboard)/roles/actions.ts` 的 `targets` 改回 `[]` → `scoped-write-guard` **1 failed / 4 passed**（空 targets 静态守卫生效）。
  2. 把 `lib/role-permission-assignment.ts` 的 `withScopedRow` 改成 `withScopedWrite` → `scoped-write-guard` **1 failed / 4 passed**（权限授予路径单次加载守卫生效）。

## 相关 ADR

- ADR-014：数据范围授权门面（本 ADR 修订其写路径形状；Q3 残余窗口仍按 ADR-014 记录）。
- ADR-019：行数不是复杂度的好代理。
- ADR-027：AI 治理工作流与技能标准化（本 ADR 的发现来源）。
