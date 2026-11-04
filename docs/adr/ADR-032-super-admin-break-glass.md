# ADR-032: SUPER_ADMIN 唯一 break-glass，PLATFORM_ADMIN 回到显式 RBAC

| 属性 | 值 |
|---|---|
| **状态** | accepted / implemented (2026-11-03) |
| **日期** | 2026-11-03 |
| **决策者** | 用户（要求只保留一个明确的 break-glass 超级管理员；日常管理员回到显式 RBAC，并修复权限管理链路） |
| **影响范围** | `packages/contracts/src/admin-roles.ts`、`packages/contracts/src/authorization.ts`、`apps/portal/scripts/seed-rbac.ts`、`apps/portal/src/lib/auth/check-permission.ts`、`apps/portal/src/lib/authz/*`、角色/权限管理 actions、权限守卫测试、相关文档 |

## 背景

1. 此前 `ADMIN_ROLE_CODES = ['SUPER_ADMIN', 'ADMIN']`，`checkPermission` 在权限码检查前直接放行；`seed-rbac` 又给两者绑定全部 API 权限。结果是：
   - 管理员角色同时是“RBAC 角色”和“硬编码超级用户”；
   - `ADMIN` 与 `SUPER_ADMIN` 权限行为完全相同；
   - 管理员角色绑定的权限对其实际鉴权没有约束力；
   - 无法用 RBAC 表达受限管理员。
2. 管理面还缺少高权目标保护：非管理员可以删除/停用同部门的高权自定义角色，或清空其权限；内置权限的 `status` 也可以被普通权限管理员停用。
3. 这些路径的既有测试固定以 `SUPER_ADMIN` 操作者运行，覆盖不到非管理员操作者。

## 决策

1. **`SUPER_ADMIN` 是唯一 break-glass**：`ADMIN_ROLE_CODES` 只含 `SUPER_ADMIN`；只有它可以绕过权限码检查。
2. **`PLATFORM_ADMIN`（平台管理员）保留为系统角色，但回到显式 RBAC**：不再因角色编码获得绕过；必须由 `role_permissions` 显式授予权限。`seed-rbac` 给 `PLATFORM_ADMIN` 绑定全部权限（含 PAGE 菜单），使其可以和 `SUPER_ADMIN` 一样管理平台，但授权来源是 RBAC 数据而不是角色码。
3. **角色检查不被 break-glass 绕过**：`checkPermission` 先检查 `options.roles`，再执行 SUPER_ADMIN 权限码旁路；角色归属是业务要求。
4. **角色管理高权目标保护**：新增 `assertCanMutateRoleTarget`；非 break-glass 操作者不得修改、删除或清空权限集合超出自身的角色。
5. **内置权限启停只由 break-glass 执行**：修改 `ALL_PERMISSIONS` 中核心权限的 `status` 时，非 SUPER_ADMIN 一律 403，避免普通权限管理员造成全平台 403。
6. **保留角色编码不可创建**：`RESERVED_ROLE_CODES = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'ADMIN']` 在创建角色时直接拒绝，防御 seed 缺失或系统角色被直接删除后的角色码碰撞。
7. **历史 ADR 不被改写**：ADR-001/029 保留原决策背景；本 ADR 记录新的管理员语义。

## 后果

- 正面：
  - 管理员语义只有一处出口：SUPER_ADMIN 的 break-glass；日常管理员全部可由 RBAC 审计与限制；
  - 管理面高权目标保护与用户面 `assertCanMutateAdminTarget` 对称；
  - 核心权限启停不再能被部门级权限管理员误操作成平台级拒绝服务。
- 负面/注意：
  - `PLATFORM_ADMIN` 用户必须显式持有菜单权限才能看到菜单；seed 已补全，已有环境由迁移 0004/0005 补齐；
  - `PLATFORM_ADMIN` 不再能分配系统角色（包括自身），系统角色分配只保留给 break-glass；
  - OAuth 准入中 `PLATFORM_ADMIN` 不再走“无 client 绑定直接放行”，必须由显式 API 权限的 `client_id` 命中目标 client；seed 绑定满足。
  - 现有以旧 `ADMIN` 作为“管理员”的测试/文档需要同步改为 `SUPER_ADMIN` 或显式权限。
- 残余风险：
  - `SUPER_ADMIN` 仍是角色码硬编码，属于有意保留的 break-glass；若需要多租户/多平台管理员，应另行引入显式平台管理员属性，不复用本角色码。

## 验证

- `pnpm test` 全量通过；新增：
  - `role-admin-target.test.ts`：非 break-glass 停用/删除/清空高权角色 → 403 且 DB 不变；
  - `permission-breakglass.test.ts`：非 break-glass 停用核心权限 → 403 且 DB 保持 ACTIVE；
  - `permission-enforcement.test.ts`：普通角色无显式权限 403；SUPER_ADMIN 仍绕过权限码；SUPER_ADMIN 不能绕过显式角色要求；
  - `authorization.test.ts`：旧 `ADMIN` / 普通角色不再判定为 break-glass。
- 文档守卫通过；最新 CI 以提交后结果为准。

## 命名更新（2026-11-04）

日常管理员角色由 `ADMIN` 改名为 `PLATFORM_ADMIN`（平台管理员），由迁移 `0005_rename_admin_role.sql` 原地完成；`SUPER_ADMIN` 不变。旧 `ADMIN` 编码保留在 `RESERVED_ROLE_CODES` 中防止复活。

## 相关 ADR

- ADR-001：统一权限树（管理员绕过语义的来源，现由本 ADR 收窄为 SUPER_ADMIN）。
- ADR-029：权限授予反提权（用户高权目标保护；本 ADR 将对称保护扩展到角色管理面）。
- ADR-015：授权判定单一实现（`isAdminRole` 仍由 contracts 统一提供）。
