# RBAC 权限模型重构设计

版本：v1.0
状态：已发布（目标态设计）
最后更新：2026-06-24

> 本文档定义 Auth-SSO RBAC 权限模型的目标形态，包括实体关系模型、数据访问控制规则、以及从当前实现的迁移路径。本文档是 DATABASE.md、ARCHITECTURE_CONSTRAINTS.md、REQUIREMENTS_MATRIX.md、DETAILED_DESIGN.md 相关章节变更的设计依据。

---

## 1. 问题分析

### 1.1 当前模型的问题

当前 RBAC 模型存在以下结构性问题：

**问题一：`data_scope_type` 混入了两种不同语义**

`roles.data_scope_type` 的 5 种取值实际承载了两类逻辑：

| 类型 | 语义 | 依赖的数据 |
|------|------|-----------|
| `ALL` | 能看到多少数据 — 全部 | 无 |
| `SELF` | 能看到多少数据 — 仅自己 | `user.id` |
| `DEPT` | 在哪个部门范围内生效 — 用户所属部门 | `user.dept_id` |
| `DEPT_AND_SUB` | 在哪个部门范围内生效 — 用户部门 + 子部门 | `user.dept_id` + ancestors |
| `CUSTOM` | 在哪个部门范围内生效 — 角色绑定的特定部门 | `role_data_scopes` |

其中 `DEPT`/`DEPT_AND_SUB` 依赖**用户的** `dept_id`，而 `CUSTOM` 依赖**角色的** `role_data_scopes`。同一字段承载两种不同的数据来源和语义，导致理解和维护成本高。

**问题二：角色不属于任何部门**

`roles` 表没有 `dept_id` 外键，角色是全局的。这导致：
- 同一个「部门主管」角色被分配给不同部门的用户时，数据范围完全依赖用户的 `dept_id`
- 无法表达「研发部主管」和「市场部主管」具有不同管理权限的需求
- 跨部门角色需要通过 `CUSTOM` + `role_data_scopes` 来模拟，将两个不同概念强行耦合

**问题三：`role_clients` 存在但不参与鉴权链路**

`role_clients` 表（角色↔客户端多对多）在 Drizzle relations 中声明，但在权限校验和数据范围过滤中完全未被使用。它的语义不明确，增加了理解负担。

**问题四：数据范围过滤链路过重**

`getDataScopeFilter()` → `applyDataScopeFilter()` → `checkDataScope()` 三个函数形成了 5 种分支的 switch 逻辑。当数据范围可以简化为「角色部门 ID 列表」时，这个链条属于过度抽象。

### 1.2 核心洞察

经过需求梳理，一个更简洁的模型浮现出来：

> **权限决定「能做什么」，角色所属部门决定「能在哪个部门范围内做」。**
> **门户自身也是 OAuth 客户端，同样被这套机制管理。**

---

## 2. 目标模型

### 2.1 实体关系图

```
departments（部门树，自引用 + 物化路径 ancestors）
    │
    ├── roles.dept_id ───── 角色天生属于一个部门（NOT NULL）
    │       │
    │       ├── role_permissions ─── permissions（权限统一树）
    │       │                               │
    │       │                      permissions.client_id ── clients（OAuth 客户端）
    │       │                         ↑
    │       │                    客户端注册 API 资源时，
    │       │                    权限标记归属于哪个客户端
    │       │
    │       └── user_roles ─── users
    │                               │
    └── users.dept_id ──────────────┘
                                 用户只能被分配其所属部门的角色
                                 （前后端双重约束）
```

### 2.2 核心规则

| # | 规则 | 说明 |
|---|------|------|
| **R-ROLE-DEPT** | 角色天生属于部门 | `roles.dept_id` NOT NULL。角色创建时必须指定所属部门 |
| **R-USER-ROLE** | 用户只能被分配所属部门的角色 | 前后端双重校验。管理员分配角色时，候选列表仅展示该用户所属部门的角色 |
| **R-DATA-SCOPE** | 数据访问范围 = 用户角色所属部门 + 子树 | 查询用户列表/部门列表等资源时，WHERE 条件为 `dept_id IN (角色部门 ID 列表 + 各自子树展开)` |
| **R-SUB-DEPT** | 默认包含子部门 | 角色属于「研发部」即可自动访问「研发部」及「前端组」「后端组」等所有子部门数据 |

### 2.3 数据访问公式

```typescript
// 旧模型（5 分支 + 3 函数链）
const scopeFilter = await getDataScopeFilter(userId);
//   返回 { type: 'ALL'|'LIST'|'SELF', deptIds?: string[] }
const scopeSQL = applyDataScopeFilter(scopeFilter, deptIdCol, userIdCol, userId);
//   转为 Drizzle SQL 条件

// 新模型（直接计算部门 ID 列表）
const deptIds = await getUserRoleDeptIds(userId);
//   查询用户所有角色 → 取 dept_id → 对每个用 ancestors LIKE 展开子树 → 去重
//   部门 ID 通过角色 ID 即可拿到：user → user_roles → roles.dept_id
if (deptIds.length === 0) return { data: [], pagination: { total: 0 } };  // 无角色 → 无数据
const conditions = [inArray(schema.users.deptId, deptIds)];
```

### 2.4 与当前实现的差异对照

| 维度 | 当前实现 (v3.1) | 目标态 (v3.2) |
|------|----------------|---------------|
| **角色归属** | 角色不隶属部门 | `roles.dept_id` FK → departments.id |
| **数据范围** | `roles.data_scope_type` 5 种枚举 | 由 `roles.dept_id` 隐式决定（默认含子部门） |
| **自定义范围** | `role_data_scopes` 表 | 不再需要（创建多个按部门划分的角色实例替代） |
| **角色-客户端** | `role_clients` 表 | 不再需要（链路 client→permission→role→user 已闭环） |
| **个人数据** | `data_scope_type = 'SELF'` | 通过权限码粒度控制（如 `user:list_self`），不属于数据范围概念 |
| **数据范围过滤** | `getDataScopeFilter()` → `applyDataScopeFilter()` 3 函数链 | `getUserRoleDeptIds(userId)` 单函数，永远返回 `string[]` |
| **JWT claims** | `dataScopeType` + `deptId` | `deptIds: string[]`（已展开子树的部门 ID 列表） |
| **Redis 缓存** | `dataScopeType` + `deptId` | `deptIds: string[]` |

---

## 3. Schema 变更清单

### 3.1 新增

| 表 | 列 | 类型 | 约束 |
|----|-----|------|------|
| `roles` | `dept_id` | uuid | NOT NULL，FK → departments.id，ON DELETE CASCADE |

### 3.2 删除

| 表 | 说明 |
|----|------|
| `role_data_scopes` | 整表删除。CUSTOM 数据范围不再存在 |
| `role_clients` | 整表删除。client→permission→role→user 链路已闭环 |

### 3.3 修改

| 表 | 列 | 变更 |
|----|-----|------|
| `roles` | `data_scope_type` | 删除列 |

### 3.4 枚举

| 枚举 | 变更 |
|------|------|
| `data_scope_type` | 删除（`ALL`/`DEPT`/`DEPT_AND_SUB`/`SELF`/`CUSTOM`） |

---

## 4. 代码影响范围

### 4.1 分层影响

| 层 | 文件 | 变更类型 |
|----|------|---------|
| **Schema** | `db/schema/rbac.ts` | 删 `dataScopeType` 列、`roleDataScopes` 表、`roleClients` 表；加 `roles.deptId` |
| **Schema** | `db/schema/relations.ts` | 删 `roleDataScopes`、`roleClients` 的 relations；加 roles→departments |
| **Schema** | `db/schema/enums.ts` | 删 `dataScopeTypeEnum` |
| **Contracts** | `packages/contracts/src/index.ts` | 删 `DATA_SCOPE_TYPE_VALUES`、`DataScopeType`、`DATA_SCOPE_SELF`；`UserPermissionContext` 改 `deptIds` |
| **Domain** | `domain/role/types.ts` | `Role` interface 删 `dataScopeType`、加 `deptId`；Zod schema 同步 |
| **Domain** | `domain/shared/zod-schemas.ts` | 删 `dataScopeTypeEnum` |
| **Lib** | `lib/permissions.ts` | `getUserPermissionContext` 改查角色 dept_id + 子树展开；删除 dataScopeType 优先级逻辑 |
| **Lib** | `lib/auth/data-scope.ts` | 整个文件重构：删除 `getDataScopeFilter`、`applyDataScopeFilter`、`checkDataScope`；新增 `getUserRoleDeptIds` |
| **Lib** | `lib/auth/index.ts` | 直接导出 `getUserRoleDeptIds`，不引入 facade 层 |
| **DB** | `db/user-queries.ts` | `buildUserListConditions` 参数改为 `deptIds: string[]` |
| **App** | `app/(dashboard)/departments/data.ts` | 替换 `applyDataScopeFilter` 为 `inArray(deptIdCol, deptIds)` |
| **App** | `app/(dashboard)/departments/page.tsx` | 替换 `getDataScopeFilter` 为 `getUserRoleDeptIds` |
| **App** | `app/(dashboard)/users/page.tsx` | 同上 |
| **App** | `app/api/users/route.ts` | 同上 |
| **App** | `app/api/users/[id]/route.ts` | 替换 `checkDataScope` 为直接 dept_id 比对 |
| **App** | `app/api/departments/route.ts` | 替换 `getDataScopeFilter` |
| **App** | `app/api/departments/[id]/route.ts` | 替换 `checkDataScope` |
| **App** | `app/api/roles/[id]/data-scopes/route.ts` | 整个文件废弃 |
| **App** | `app/(dashboard)/roles/` | 角色创建/编辑表单新增部门选择器 |
| **App** | `app/(dashboard)/users/` | 用户分配角色时，候选角色列表按用户部门过滤 |
| **Seed** | seed 脚本 | 更新角色初始数据（加 dept_id，删 data_scope_type） |
| **Tests** | `__tests__/api/data-scope.test.ts` | 重写：测试 `getUserRoleDeptIds` 和子树展开逻辑 |
| **Tests** | 各 API 测试文件 | 更新 mock 的 `UserPermissionContext` 结构 |

### 4.2 影响文件统计

| 类别 | 数量 |
|------|------|
| 新增函数 | 1（`getUserRoleDeptIds`） |
| 删除函数 | 3（`getDataScopeFilter`、`applyDataScopeFilter`、`checkDataScope`） |
| 修改文件 | ~20 |
| 删除文件 | 1（`roles/[id]/data-scopes/route.ts`） |
| 删除表 | 2（`role_data_scopes`、`role_clients`） |
| 删除列 | 1（`roles.data_scope_type`） |
| 新增列 | 1（`roles.dept_id`） |

---

## 5. 迁移策略

### 5.1 数据库迁移

```sql
-- 1. 新增列（先允许 NULL，后续补齐数据后设为 NOT NULL）
ALTER TABLE roles ADD COLUMN dept_id uuid;

-- 2. 数据迁移：**必须人工介入**，为每个现有角色指定所属部门
--    旧 data_scope_type 无法自动映射到具体部门：
--    - DEPT/DEPT_AND_SUB 只表达了「本部门」语义，但角色不属于任何部门
--    - CUSTOM 需从 role_data_scopes 确认目标部门
--    - ALL 需人工指定一个部门（所有角色必须属于某个部门）

-- 3. 确认所有角色的 dept_id 已正确设置后，设为 NOT NULL + 添加外键
ALTER TABLE roles ALTER COLUMN dept_id SET NOT NULL;
ALTER TABLE roles ADD CONSTRAINT fk_roles_dept
  FOREIGN KEY (dept_id) REFERENCES departments(id) ON DELETE CASCADE;

-- 4. 删除旧列和旧表
ALTER TABLE roles DROP COLUMN data_scope_type;
DROP TABLE IF EXISTS role_data_scopes;
DROP TABLE IF EXISTS role_clients;
```

### 5.2 数据迁移注意事项

- **所有角色必须指定所属部门**，不存在「全局角色」概念
- 旧 `data_scope_type` 无法自动推断具体部门，需业务方提供映射关系
- 建议在低峰期执行，先备份 `roles` 和 `role_data_scopes` 表

### 5.3 应用层迁移顺序

1. Schema 层：Drizzle schema 定义 + migration 文件
2. 数据迁移：执行 SQL 迁移
3. Domain 层：更新类型 + 工厂函数
4. Lib 层：重构 data-scope.ts
5. App 层：更新所有调用方
6. Seed：更新种子数据
7. Tests：更新测试
8. Contracts：更新共享类型（最后，因为是独立包）

---

## 6. 设计决策记录

| # | 决策 | 理由 |
|---|------|------|
| D1 | 删除 `data_scope_type`，以 `dept_id` 替代 | 5 种枚举混入了两种语义（数据可见度 vs 组织范围），且 `CUSTOM` 与 `DEPT`/`DEPT_AND_SUB` 的数据来源不一致 |
| D2 | 默认包含子部门 | 「角色属于研发部 → 看到所有子部门」是更自然的企业组织模型，不需要额外开关 |
| D3 | 删除 `role_clients` | 链路 client → permission → role → user 已经完整表达了「客户端资源 → 权限 → 角色 → 用户」的授权链，中间的 role_clients 是冗余的 |
| D4 | 删除 `applyDataScopeFilter` 等三个函数，改为单一 `getUserRoleDeptIds` | 旧函数链的核心逻辑是一个 5 分支 switch，新模型只有一种路径（收集角色 dept_id + 子树展开）。`getUserRoleDeptIds` 永远返回 `string[]`，部门 ID 通过角色 ID 即可拿到 |
| D5 | JWT claims 中用 `deptIds` 替代 `dataScopeType` + `deptId` | 子树展开在签发 Token 时完成，验签后的请求路径零 DB 查询。`deptIds` 直接可用，无需再查角色 |
| D6 | 用户只能分配其所属部门的角色（前后端双重约束） | 安全纵深防御。前端约束提升用户体验（减少无效选项），后端约束保证数据完整性 |

---

## 7. 关联文档更新清单

本文档发布后，以下 spec 文件需同步更新：

| 文档 | 需要更新的章节 | 状态 |
|------|---------------|------|
| **DATABASE.md** | §3.3 角色表、§3.8~§3.9（删除）、§6 枚举、§7 外键、§8 Redis | ✅ 已更新至 v3.2 |
| **ARCHITECTURE_CONSTRAINTS.md** | R7（数据范围过滤）、DC-ROLE-C（角色创建约束）、Red Flags | ✅ 已更新 |
| **REQUIREMENTS_MATRIX.md** | C-ROL-C、C-ROL-U、C-ROL-ASGN、H-DSCOPE-001~003、H-ACL-001 | ✅ 已更新 |
| **DETAILED_DESIGN.md** | §3 数据范围过滤详细设计（重写）、§4 权限缓存结构、§6 JWT claims、函数签名参考 | ✅ 已更新 |
| **ARCHITECTURE.md** | §4.1 读取链路、§6.1 链路总览第 6 层、§7 JWT 载荷、附录关键文件映射 | ✅ 已更新 |
| **PRD.md** | §2 产品范围、§4.2.1 用户管理、§4.2.2 角色与授权（FR 表重写）、§4.2.6 应用管理 | ✅ 已更新 |
