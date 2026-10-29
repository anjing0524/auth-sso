# ADR-029: 权限授予反提权——组合权限、系统角色与权限子集

| 属性 | 值 |
|---|---|
| **状态** | implemented (2026-10-29) |
| **日期** | 2026-10-29 |
| **决策者** | Auth-SSO 团队（授权渗透测试修复批次） |
| **影响范围** | `lib/authz/operator.ts`、`lib/user-role-assignment.ts`、`lib/role-permission-assignment.ts`、`api/users/[id]/roles`、`api/roles/[id]/permissions`、`(dashboard)/users/[id]/roles`、`(dashboard)/roles/[id]/permissions` |

## 背景

授权渗透测试在验收栈用真实低权账号复现了提权：

- 该账号只有 `portal:user:list`、`portal:user:read`、`portal:user:assign_role`，**没有** `portal:user:manage`；
- 它调用 `POST /api/users/{lisi}/roles` 分配 `SUPER_ADMIN`，返回 **200**，数据库 `user_roles` 实际写入 SUPER_ADMIN；
- 同一账号随后可登录被提权用户，获得管理员权限。

根因有三层：

1. 写入口只要求 `user:assign_role`，未实现 REQUIREMENTS_MATRIX 的 **H-ACL-003**「用户管理 + 角色分配」组合校验；
2. `assignUserRoles` 只校验角色与目标用户同部门，**不限制系统角色**，也不比较操作者与目标角色的权限集合；
3. `assignRolePermissions` 只要求 `role:assign_permission`，非管理员可把自身没有的权限授予任何可写角色（包括自己所属角色），从而绕过角色分配限制。

## 决策

1. **组合权限**：角色分配写路径（Server Action + REST POST/DELETE + 页面门禁）要求
   `user:manage` **且** `user:assign_role`（`requireAll: true`）；角色权限授予写路径要求
   `role:manage` **且** `role:assign_permission`。管理员绕过保持既有 ADR-001 语义。
2. **事务内操作者授权快照**：新增 `loadOperatorAuthorization(tx, operatorId)`，与目标加载/写入同事务读取操作者的 ACTIVE 角色与 ACTIVE 权限。
3. **不允许跨权限边界授予**：
   - 非管理员不得分配 `is_system=true` 的系统角色；
   - 非管理员分配的角色，其权限码必须是操作者当前权限码的子集；
   - 非管理员授予角色的权限码必须是操作者当前权限码的子集。
   管理员（ADMIN/SUPER_ADMIN）保留平台级分配能力。
4. **高权目标保护**：非管理员即使持有 `reset_password` / `update` / `delete` / `manage` 等单权限，也不能对系统管理员或权限高于自身的自定义高权用户执行凭证类或破坏性操作。
5. **越权拒绝返回 403**：系统角色/权限子集失败抛 `ForbiddenError`，不再伪装成 400 参数校验失败。
6. **角色权限页补数据范围**：页面入口使用 `getRoleById(id, scope)`，范围外与不存在同形 404，关闭 IDOR 名称泄露。
7. **自我角色变更下沉**：Server Action 原有“不能修改自己的角色”仅在 Action 层；REST 直接调用共享 `assignUserRoles`/`removeUserRole` 可绕过。检查下沉到共享写路径，REST/Action 统一 403。
8. **身份读口状态过滤**：旧 AT 在 Redis 撤销失败时仍可能通过验签；`getOwnUser` / `getUserProfile` 只返回 ACTIVE 且未删除用户，Dashboard 布局在身份读口为空时重定向登录，避免禁用/删除账号继续读取 `/api/me`、profile 或 UserInfo。
9. **高权目标保护**：`user:reset_password` 单独就能重置同范围 SUPER_ADMIN 密码，等价于账号接管。新增 `assertCanMutateAdminTarget`（与写入同事务）：目标持有 ADMIN/SUPER_ADMIN，或其权限码集合超出操作者时，非管理员禁止重置密码、禁用/删除、修改资料、修改角色、解锁、强制下线；管理员保留全部能力。

## 补充决策（2026-10-29，基于业内最小权限/特权账号保护实践）

- **保留**“高权目标只能由管理员操作”的收紧策略，不提供默认的委派管理管理员例外。
- 若业务确认需要委派，单独立 ADR 设计受控流程（双人审批、break-glass、时限与审计），
  不在本策略上直接放宽；当前不引入未确认需求的例外分支。
- B 类测试补齐：新增 `apps/portal/__tests__/api/admin-target-paths.test.ts`，逐路径覆盖
  toggle/update/delete/reset/unlock/force-logout，6/6 通过。
- fail-open（Redis 撤销 / 缓存刷新）、CSRF 无 Origin、OAuth 并发授权码兑换列为下一批
  安全专项，不在本次扩大范围。

## 不在本 ADR 范围

- 职责分离（SoD）：同一操作者仍可同时拥有管理+分配权限；这是组织授权策略，不在本轮强加。
- 角色码 `ADMIN` 的既有管理员绕过（ADR-001）未改；系统角色由平台维护且不可修改。
- 被授予权限子集的**跨部门等同源**：权限码没有部门维度，子集比较是全局权限集合；更细的权限范围模型需单独 ADR。

## 后果

- 正面：低权账号无法再通过角色分配/权限授予越过自身权限边界；系统角色只有管理员可分配；角色权限页不再越范围泄露角色名。
- 代价：只授 `assign_role` 的旧集成（未同时授 `user:manage`）会从"能写"变为 403；需要按 H-ACL-003 重新审视委派角色配置。这是有意的 fail-closed。
- 残余：权限码子集比较基于操作者当前权限快照；在 READ COMMITTED 下仍存在语句间竞态（与 ADR-014 记录的同类残余一致），强一致需锁/串行化。

## 验证

- 渗透复现（修复前）：低权账号 `POST /api/users/{lisi}/roles` 分配 `SUPER_ADMIN` → **200**，`user_roles` 写入 SUPER_ADMIN。
- 同类面：仅持 `reset_password` 的账号可重置同范围 SUPER_ADMIN 密码 → 管理员账号接管；现由 `assertCanMutateAdminTarget` 拦截（回归测试覆盖低权操作者修改管理员目标）。
- 修复后：
  - 无 `user:manage`：同一请求 → **403 `AUTH_SSO_1003`**；
  - 有 `user:manage` 时分配系统角色 → **400/403 明确拒绝**（系统角色守卫；最终代码为 403）；
  - 非管理员给角色授予自身没有的 `portal:audit:read` → **403「不能授予超出自身权限范围的权限」**。
- `pnpm --filter @auth-sso/portal typecheck` 通过；`next build` 通过；临时账号/角色已清理。

## 相关 ADR

- ADR-001：管理员角色绕过。
- ADR-002：数据范围由角色部门子树决定。
- ADR-014：数据范围授权门面（事务内快照与残余竞态）。
- ADR-028：写路径非空 targets 与全局写入口。
