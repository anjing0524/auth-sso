# ADR-001: 统一权限树 — Permissions 表承载鉴权与菜单

| 属性       | 值                                    |
|------------|---------------------------------------|
| **状态**   | accepted                              |
| **日期**   | 2026-07-15                            |
| **决策者** | Auth-SSO 团队                         |
| **影响范围** | `permissions` 表、RBAC 引擎、菜单渲染 |

## 背景

v2 版本中，`menus`（菜单树）和 `permissions`（权限码）是两张独立的表，维护两套父子关系。v3 合并为统一权限树，`permissions` 表通过 `type` 列区分 3 种节点类型：

| type        | 用途                             | 鉴权参与 |
|-------------|----------------------------------|----------|
| `DIRECTORY` | 业务系统分组（如 `dir:用户管理`） | 否       |
| `PAGE`      | 菜单/页面节点（如 `menu:users`） | **是**   |
| `API`       | 后端权限码（如 `user:create`）   | **是**   |

通过 `parent_id` 自引用形成树：`DIRECTORY → PAGE → API → (子 API)`。

## 决策

**保持统一权限树，不拆分为 `permissions` + `menus` 两张表。**

理由：

1. **菜单本身需要权限管理**。一个 PAGE 节点被分配给角色后，拥有该角色的人才可见对应菜单项。如果拆成 `menus` 表，需要额外维护 `menu_permissions` 映射表。
2. **菜单可见性从 RBAC 自动派生**。用户有 `user:create` → 其父节点 `menu:users` 自动可计算可见 → 父父节点 `dir:用户管理` 自动可见。无需额外查询。
3. **`parent_id` 树是自然的层次**。一个业务系统（DIRECTORY）下有多个页面（PAGE），每个页面关联多个操作（API）。DIRECTORY 是纯分组节点，不参与鉴权——但这不影响它合法存在于统一表中。
4. **简单高效**。角色分配权限时只需要操作 `role_permissions` 关联表（分配 API 节点），菜单可见性自动计算。

## 后果

- `permissions` 表承担双重职责，需在文档中明确标注三种 type 的语义差异
- DIRECTORY 节点的 `path`/`icon`/`visible` 字段对菜单渲染有意义，但对鉴权无意义
- 删除一个 DIRECTORY/PAGE 节点会级联删除其子树（包括 API 权限）：**服务端保留码守卫 + 删除影响面确认**（`deletePermissionAction` 拒绝删除 `ALL_PERMISSIONS` 中任一码，且检查整棵子树；UI 仍需展示影响面）。2026-10-23 增补，见下
- `DATA` 类型已废弃，待清理（见 ADR-002 对数据范围的定义）

## 增补（2026-10-23）：菜单模块在需求矩阵中的表述 + 核心权限码服务端保留清单

### 1. 菜单管理的实现形态（对 REQUIREMENTS_MATRIX E 模块的澄清）

「菜单管理」不是独立表/独立模块，而是**权限树的一类节点**：

- `permissions.type = 'DIRECTORY' | 'PAGE'` 承载菜单层级；`path`（PAGE 必填）、`icon`、
  `visible`、`sort`、`parent_id` 为菜单属性；
- `type = 'API'` 节点只表达后端权限码，不混入导航字段（DB CHECK：
  `permissions_type_fields_chk`，见 `apps/portal/src/db/schema/rbac.ts`）；
- 侧边栏 = 从用户权限码集合出发的可见节点投影（`lib/menu-tree.ts` + `lib/route-access.ts`
  的唯一路由权限映射），不存在第二套菜单权限判断；
- 因此 E-MNU-01～05 的验收口径应为「权限树中 DIRECTORY/PAGE 节点的 CRUD 与可见性」，
  **不是**「独立 menus 表的 CRUD」。`docs/spec/REQUIREMENTS_MATRIX.md` 模块 E 已按此改写。

### 2. 核心权限码的服务端保留清单（H-20 修复后的决策）

**决策：`ALL_PERMISSIONS`（`packages/contracts/src/permissions.ts`）中的权限码是"被代码硬编码
引用"的保留集，任何运行期入口不得删除。**

- 实现：`apps/portal/src/app/(dashboard)/permissions/actions.ts:57`
  （`RESERVED_PERMISSION_CODES = new Set(ALL_PERMISSIONS)`）；
- 删除前检查**整棵子树**（`:223-224` 的 `loadPermissionSubtree` + reserved 过滤）：
  删除父目录时若子树含保留码，整体拒绝——因为 `permissions.parent_id` 是
  `ON DELETE CASCADE`（`db/schema/rbac.ts`），不检查子树就会被 CASCADE 绕过；
- 普通自定义权限码仍可删除（不误伤），删除后收敛受影响用户（`:240`
  `revokeAndRefreshAuthorization`，覆盖"仅绑定后代权限"的用户——H-B-01）。

**保留集的边界（刻意不扩大）**：`ALL_PERMISSIONS` 含 `portal:menu:dashboard` 等少数菜单码，
但不含全部 `portal:menu:*`（后者由 seed 数据建立）。因此本清单的准确语义是"契约常量集"，
**不是**"所有菜单码都不可删"——菜单是可配置数据，删除由影响面确认与角色绑定关系约束。
本轮不新增"不可删菜单码"概念，避免把可配置数据误标为代码契约。

## 权衡

| 方案 | 优点 | 缺点 |
|------|------|------|
| **统一表（采用）** | 一次查询拿到整棵树、菜单自动继承权限 | 表字段语义混合 |
| 分 menús + permissions | 职责单一 | 额外映射表、菜单权限同步问题 |

## 相关 ADR

- ADR-002: 角色-部门绑定与数据范围
- ADR-005: 三层安全模型
