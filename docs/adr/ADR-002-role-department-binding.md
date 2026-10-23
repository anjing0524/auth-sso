# ADR-002: 角色-部门绑定与数据范围

| 属性       | 值                                    |
|------------|---------------------------------------|
| **状态**   | accepted                              |
| **日期**   | 2026-07-15                            |
| **决策者** | Auth-SSO 团队                         |
| **影响范围** | `roles`、`departments`、数据范围过滤 |

## 背景

v3.2 重构了 RBAC 模型，移除 `role_data_scopes`、`role_clients`、`data_scope_type` 三张表/枚举，简化为核心规则：

> **每个角色必须属于一个部门，角色的数据范围 = 该部门 + 全部子部门。**

此前（v3.1）的数据范围是独立配置的（`data_scope_type` 枚举 + `role_data_scopes` 关联表），导致：
- 管理员需要手动为每个角色选择数据范围
- 部门调整时数据范围不同步
- 概念过重，实际场景中数据范围几乎总是与部门树一致

## 决策

**角色归属部门（`roles.dept_id NOT NULL`），数据范围从部门树自动推导。**

核心约束和推论：

1. **不存在"系统角色"**（可以绕过 RBAC 模型的角色）。所有角色都受 RBAC 约束，`is_system` 仅表示系统预置、不可删除/不可修改 code。
2. **不存在跨部门角色**。一个角色只能属于一个部门。如果用户需要跨部门数据访问，通过**赋予多个角色**实现。
3. **数据范围 = 角色部门 ∪ 子树**。通过 `departments.ancestors` 物化路径做 `LIKE 'dept_X/%'` 查询展开。
4. **删除部门级联删除角色**（`ON DELETE CASCADE`）。系统预置角色绑在根部门，根部门不可删除（`CANNOT_DELETE_ROOT` 错误码保护）。

> **2026-10-14 兑现说明（架构评审 R2 次级候选「根部门守卫」）**：本条后半句
> ——"根部门不可删除（`CANNOT_DELETE_ROOT` 保护）"——**此前从未实现**：该码只在
> contracts 定义、全仓零引用，`validateDepartmentDeletable` 也没有根部门判定。
> 现已补齐：根部门（`parentId IS NULL`）检查排在**最前**，携带专属码
> `DEPARTMENT_ERRORS.CANNOT_DELETE_ROOT`（→ 422）。
>
> **可达性说明（重要）**：补齐之前，根部门**在当前唯一删除路径上本就不可达删除**——
> 要删除根部门，操作者的生效角色必须绑在根上，于是 `roleCount ≥ 1` 会先被
> "存在关联角色"（实测为"关联用户"）挡住。因此本次是**兑现承诺 + 消除对"偶然保护"的依赖**，
> 而非修补一个可被利用的漏洞：原先的保护来自与根部门无关的事实，一旦 `roleCount`
> 加上 `status` 过滤、或新增第二条删除路径，根部门就会变得可删。
>
> 顺带发现：contracts 里其它实体业务码（`DEPARTMENT_HAS_CHILDREN` / `CANNOT_DELETE_SELF` / …）
> **同样从未被发射**（一律抛通用 `VALIDATION_ERROR`）——已记为独立 issue。
> 详见 `docs/solution/2026-10-14-root-department-guard.md`。

## 数据范围公式

```text
用户的可见部门 = ⋃ (user.roles → role.dept_id → dept.ancestors 子树展开)
```

实现层是 **ADR-014 的数据范围门面**：`lib/authz/data-scope.ts` 的私有实现
`expandRoleDeptSubtrees()`（经 `resolveScope(executor, operatorId)` 暴露）；原
`lib/auth/data-scope.ts` 与 `getUserRoleDeptIds()` / `canAccessDept()` 已随 ADR-014 收口删除
（2026-10-23 更正：本文此前引用的函数名在现行代码中已不存在）。

## 后果

- 简单直观：创建部门 → 创建该部门的角色 → 赋予用户 → 自动获得数据范围
- 跨部门用户需要多角色：这是有意的约束，不是缺陷
- `DATA` 权限类型（v3.1 遗留）已无用途，待从代码中移除

## 增补（2026-10-23）：根部门单例、部门 DISABLED 语义、`deptIds` 缓存口径

审计批次（H-21/H-22/H-23）发现三条与本文相关、但此前**没有显式决策**的语义，现补齐：

### 1. 根部门是单例（服务端强制，不再只靠 UI）

**决策：根部门（`parent_id IS NULL`）全局唯一；仅由 seed/迁移在空树引导期建立；任何运行期入口
不得创建第二个根，也不得把已有部门迁出为根。**

- 依据：本文「系统预置角色绑在根部门，根部门不可删除」；seed 语义（`apps/portal/scripts/seed-rbac.ts`
  按根部门查找/建立）。「单例」此前只写在 `docs/roadmap.md` 2026-10-19 条目里，未进 ADR。
- 实现：`app/(dashboard)/departments/actions.ts:51`（`assertRootCreationAllowed`：
  已有根即拒绝；操作者数据范围为空也拒绝——`targets=[]` 不得成为"无守卫"的捷径）、
  `:179`（迁出为根拒绝）、`:211` 起（根部门删除拒绝，见 2026-10-14 修订）。
- 刻意保留的形态：种子/迁移**直插 DB** 建立根部门（不经过 Server Action），因此服务端守卫
  不会阻塞首次部署。
- 已知不足：根部门专属错误码（如 `ROOT_DEPARTMENT_EXISTS`）尚未进入 contracts，当前用
  `BusinessRuleViolationError` 通用 422；如需 UI 精准提示，应作为独立 contracts 变更。

### 2. 部门 `status = DISABLED`：生命周期门禁，不追溯（决策 D2）

**决策：部门禁用是"管理动作开关"，不是"数据冻结"：**

- **禁止**在禁用部门下新建子部门 / 用户 / 角色，**禁止**把既有角色/用户迁入；
- **不追溯**：既有用户的登录、授权、数据范围保持原状（不因部门被禁用而失效）；
- 当前实现进度（如实记录）：角色创建/迁移已校验部门 ACTIVE
  （`roles/actions.ts:58` `assertDeptUsable`，create 与 update 一致）；用户创建/迁移与
  子部门创建的同口径守卫**尚未落地**，属 backlog；`docs/spec/REQUIREMENTS_MATRIX.md` F 模块
  已写明该验收口径。
- 为什么不做"子树退出数据范围"：那会让一次管理动作导致大面积用户失权，且与"禁用是暂停而非
  删除"的直觉冲突；产品确认前不实现破坏性语义（审计复核 R-D2 结论）。

### 3. Redis `UserPermissionContext.deptIds` = **未展开**的角色部门 ID（决策 D1）

**决策：权限上下文缓存里的 `deptIds` 只存用户所有 ACTIVE 角色的 `roles.dept_id`（原始值，不去重
子树展开）；子树展开的唯一实现是 `resolveScope`（ADR-014 门面），且只在读/写路径按需实时计算。**

- 实现：`lib/permissions.ts`（`getUserPermissionContext` 收集 `role.deptId`）；
- 为什么不展开（复核结论，亦是 ADR-014 的推论）：
  1. 在缓存里展开等于制造**第二个展开实现**，违反单一真相来源；
  2. 部门移动时缓存值会真正陈旧（原始 `dept_id` 不随移动变化，展开集合会变）；
  3. Portal 内数据范围是**实时**的（每次请求 `resolveScope` 查 DB），不需要缓存展开值。
- 消费方注意：`packages/contracts` 的 `UserPermissionContext.deptIds` 注释、`docs/spec/DATABASE.md`
  §8.2、`docs/glossary.md`、`docs/spec/third-party-integration.md` 已同步改为"未展开"口径；
  外部子应用若要用它做数据范围，必须自行完成子树展开（或改为调用 Portal 的授权接口），
  **不能直接把它当作"可见部门集合"**。

## 相关 ADR

- ADR-001: 统一权限树
- ADR-005: 三层安全模型（数据范围过滤位于 withAuth 层）
- ADR-014: 数据范围授权门面（`resolveScope` 是唯一快照来源）
