# 权限管理设计 / 业务逻辑审计（2026-10-21）

> 触发（用户）：“UI、UX 操作判断是否合理、简便；业务逻辑分析是否准确；权限管理排查设计实现是否正确。”
>
> 方法：用真实角色/用户做**受限用户实机矩阵**（自定义部门角色 A：仅本部门 `user:list/create` + `department:list`；
> 仅菜单角色 B：只有 `portal:menu:*` 无功能权限），从“能不能登录、能看见什么、能点什么、直接调 API 会怎样”
> 四个面逐项验证；另做会话撤销、角色删除、部门删除、自禁用等业务守卫测试。测试夹具用
> `.ui-audit/setup-perm-fixtures.sql`（gitignored），验收栈最终已重置为 seed。

## 1. P0：自定义角色用户**根本无法登录**（client 绑定断链）

- 现象：管理员在 UI 里创建角色、分配权限、建用户并绑定角色后，该用户登录被重定向
  `/login?error=oauth_denied`，只有内置 `SUPER_ADMIN/ADMIN` 能进。
- 根因：OAuth 授权准入 `checkUserClientAccess` 对**非管理员角色**要求
  “角色 → 权限 → `permissions.client_id` → 目标 client”的绑定；而 `seed-rbac` 写入的
  39 个 `portal:*` API 权限 `client_id` **全为 NULL** ⇒ 自定义角色永远拿不到 `portal` 绑定。
  `permissions_type_fields_chk` 又规定 `DIRECTORY/PAGE` 菜单权限 `client_id must be NULL`，
  所以“只授菜单”的角色同样无绑定。
- 修复（三层）：
  1. **seed**：`portal:*` API 权限写入 `clientId='portal'`；
  2. **迁移 0002**：存量库 `UPDATE permissions SET client_id='portal' WHERE type='API' AND code LIKE 'portal:%'`；
  3. **授权数据层兜底**：`portal:` 命名空间的权限（含不能带 clientId 的菜单）视为可访问 portal；
     `createPermissionAction` 新建 `portal:*` API 权限时自动补 `clientId`。
- 实测：角色 A、B 修复前 `oauth_denied`，修复后均落到 `/dashboard`；A 的 `user:list` API 200、
  `role:list`/`permission:list` 403。

## 2. P0：生产构建下**所有领域错误状态码退化为 400**

- 现象：受限用户调用 `/api/roles` 返回 `400 {"error":"AUTH_SSO_1003","message":"权限不足"}`（应为 403）。
- 根因：`mapDomainError` 用 `ERROR_STATUS[err.constructor.name] ?? 400` 查表；Turbopack 生产构建
  压缩类名（`ForbiddenError` → 单字母）⇒ 查表全部落空，403/404/409/422 全部变 400。
  源码测试（Vitest）不压缩，所以单元/API 测试全绿、**只有生产包暴露**。
- 修复：`DomainError` 增加实例字段 `status`（默认 400），每个子类在 `super()` 第三个参数显式声明；
  `mapDomainError` 直接返回 `err.status`。`error-status-guard.test.ts` 重写为：
  “禁止按类名/`constructor.name` 查表 + 每个子类必须显式声明状态码”。
- 实测：同一请求修复后 403；禁用用户后旧会话 API 返回 401。

## 3. P1：列表/详情操作入口不按权限隐藏（看得到、点不动）

受限用户 A 只有 `user:list/create`，却能看到用户列表的 **编辑 / 分配角色 / 禁用**；
角色、权限、应用、部门、应用详情、用户详情、审计导出同样存在越权入口。
真正的门禁在 Server Action（会正确拒绝），但 UI 让用户反复撞墙。

修复：把 `PermissionGuard` 提升到 `components/shared/` 并接入：
- 用户列表：编辑 `user:update`、分配角色 `user:assign_role`、禁用/恢复 `user:update`；
- 角色：新建/编辑/配置权限/删除分别按 `role:create|update|assign_permission|delete`；
- 权限：新建/编辑/删除按 `permission:create|update|delete`；
- 应用：注册/编辑/注销按 `client:create|update|delete`；
- 部门：新建根/子部门/成员/编辑/删除按 `department:create`、`user:list`、`department:update|delete`；
- 审计：导出按钮按 `audit:export` 服务端裁剪（只有 `audit:read` 时不再显示会 403 的按钮）；
- 用户/应用详情页：删除、重置密码、分配角色、保存、禁用/启用按权限隐藏；
  详情读取再单独要求 `user:read` / `client:read`（LIST 只允许看列表，防止改 URL 读取他人详情/应用配置）。
- 权限列表对 API 权限显示“归属应用”（`client_id`），让“角色为何能/不能登录某个 Client”可见。

实测：A 在用户列表只剩「新建用户」，行内编辑/分配/禁用全部消失；部门页只剩「成员」；审计页不渲染导出。

## 4. P1：菜单可见性与页面可访问性两套规则（点进去 403）

- 菜单只按菜单节点自身权限码过滤，页面 layout 按功能权限守卫 ⇒ 只授 `portal:menu:users` 的角色
  能看到“用户管理”，点进去却是未授权；
- 更糟：动态菜单为空时会回退到**内置全量菜单**，**没有菜单权限的角色反而看到全部入口**。

修复：
- 新增 `lib/route-access.ts`：`/users → user:list`、`/roles → role:list`、`/permissions → permission:list`、
  `/departments → department:list`、`/clients → client:list`、`/audit-logs → audit:read`、
  `/dashboard → 已登录即可`；layout 守卫与菜单过滤**共用同一映射**；
- 删除侧边栏全量兜底菜单；工作台固定为所有登录用户可见的第一项。
- 实测：A 侧边栏只有「工作台/用户管理/部门管理」；B（仅菜单）只有「工作台」，直接访问 `/users` 得到 403 视图。

## 5. P1：工作台泄露跨部门审计动态 + 登录落地 403

- 工作台 layout 要求 `portal:menu:dashboard`：只授业务菜单的角色登录后**直接落在未授权页**；
- 页面 `getRecentAuditLogs()` 无数据范围/权限过滤，任何能看工作台的人都能看到最新 8 条
  跨部门操作日志（用户名/操作/结果），而运行角色只有 `portal:menu:dashboard`。
- 修复：工作台对所有已登录用户开放（数据按范围裁剪）；`audit:read` 才查询并渲染“安全审计动态”；
  统计卡（用户/角色/应用）、快捷入口（新建用户/应用接入/架构管理）分别按 LIST/CREATE 权限裁剪；
  首次引导步骤也按权限过滤。
- 实测：A 登录直接 `/dashboard`；工作台无审计卡、无“查看日志”、只有用户/部门相关内容；
  A 的用户统计仅本部门范围（1 人）。

## 6. P2：403 视图只有一行红字

`Forbidden` 只有 `<p>未授权访问或权限不足</p>`，没有图标、没有原因、没有出口。
修复：图标 + “无权限访问” + 说明（联系管理员分配角色/权限）+ “返回工作台”。

## 7. P2：登录失败只显示 `oauth_denied`

授权端拒绝后网关折叠成 `oauth_denied`，登录页 default 分支把英文码原样显示。
修复：登录页增加 `oauth_denied / no_roles / user_inactive / unauthorized_client` 的中文可执行提示
（“账号没有有效角色或权限，请联系管理员分配”）。实测角色被删后登录提示可读。

## 8. P2：删除角色未提示“会解除用户绑定”

`deleteRoleAction` 会删除 `user_roles`、撤销绑定用户会话并强制重登，但确认弹窗只说“权限绑定一并清除”。
修复：弹窗补充“若已分配给用户，这些用户会失去该角色权限并被强制重新登录”。

## 9. 业务守卫实测（全部通过）

| 场景 | 结果 |
|---|---|
| 禁用用户后旧会话 | 禁用前 API 200 → 禁用后 401；页面被踢回登录 |
| 删除已分配角色 | 删除成功、绑定用户会话撤销、该用户再登录被拒（无有效角色） |
| 删除有子部门/用户的部门 | 拒绝，提示“该部门下有子部门，无法删除” |
| 管理员禁用自己 | 拒绝，提示“不能禁用自己的账号” |
| 受限用户数据范围 | 用户列表仅本部门 1 人；部门树仅本部门；工作台统计按范围 |
| 角色/权限越权 API | 403（修复后状态码正确） |

## 9.1 端到端 UI 自查（按用户要求“需要复核的内容自己执行”）

不再只用 SQL 夹具：用 **管理员真实 UI 流程** 建角色 → 勾 7 项权限 → 建用户 → 分配角色 → 新用户登录，
逐项验证（`.ui-audit/selfcheck-permission-ui.mjs`，16/16）：

- UI 创建角色/配置权限/创建用户/分配角色全部成功；
- 新角色用户可登录，侧边栏只显示授过的菜单（工作台/用户/部门）；
- `user:list` API 200，`role:list` 403；
- 用户列表只有「新建用户」，无编辑/分配/禁用；
- 有 `user:read` 无 `user:update` 时用户详情为**只读**（4 个输入全部 `:disabled`、无保存按钮、显示只读横幅）；
- 应用只读角色（`client:list/read`）看不到注册/编辑/注销按钮，应用详情无保存/撤销 Token，显示只读提示。

自查过程中发现并修复：
1. **只读详情仍可编辑**：`UserDetailForm` 之前只隐藏保存按钮，字段仍可改（改完无入口提交）。
   现在由服务端计算 `canUpdate` 传入，`<fieldset disabled>` + 只读横幅；`ClientDetailClient` 同理，
   并隐藏 Token 撤销入口。
2. **分配角色对话框单页上限**：`/api/roles?pageSize=500` 被服务端夹到 100，规模数据下 100 名之后的角色
   无法分配；改为按页拉全量，并显示“系统”标记、只列 ACTIVE 同部门角色。
3. **环境级缓存提示**：在 `down -v` 重建数据库后，Next `"use cache"` 的权限列表可能仍持有旧 ID，
   导致“存在无效或已停用的权限”（角色权限保存失败）。这是**测试环境绕过应用重建数据**的产物；
   清 `.next/cache` 或走 `stack:up` 重建容器即恢复。生产数据变更都经 Server Action 触发 cacheTag 失效。
   已在 solution 记录，避免下次误判为权限逻辑 bug。

## 10. 变更文件

- 登录准入：`apps/portal/scripts/seed-rbac.ts`、`drizzle/0002_bind_portal_permissions_to_client.sql`、
  `api/auth/oauth2/authorize/data.ts`、`permissions/actions.ts`
- 错误语义：`domain/shared/errors.ts`、`domain/shared/error-mapping.ts`、`__tests__/api/error-status-guard.test.ts`
- 路由/菜单：`lib/route-access.ts`（新增 + 单测）、`lib/menu-tree.ts`、6 个 `layout.tsx`、
  `components/layout/app-sidebar.tsx`、`(dashboard)/layout.tsx`
- UI 权限裁剪：`components/shared/permission-guard.tsx`（从 users 提升）、用户/角色/权限/应用/部门表、
  用户/应用详情页、审计页导出
- 工作台：`dashboard/layout.tsx`、`dashboard/page.tsx`
- UX：`components/shared/forbidden.tsx`、`login/login-form.tsx`、角色删除弹窗

## 11. 保留判断

- **菜单权限不能携带 clientId** 是数据库 CHECK 的设计（`permissions_type_fields_chk`）；因此“仅菜单角色”
  的准入由 `portal:` 命名空间兜底，而不是给菜单加 clientId。若未来要支持“多客户端共用一套菜单”，
  需要重新设计该约束与菜单归属模型。
- 权限页没有“归属应用”字段：`portal:*` API 权限自动归 portal；其它客户端的权限由 client 详情页同步生成
  （`permission-sync` 已带 clientId）。管理端手动创建非 portal 命名空间权限时仍不显示归属，属于下一轮可优化项。
- 分配角色对话框目前展示全部角色（受数据范围过滤），未显示“该角色所属部门/是否系统角色”的辅助信息；
  规模数据下可加筛选（与权限对话框一致）。
- 权限删除是级联的（角色绑定/子菜单同步删除），确认文案已提示；若需要“影响面预览”（多少角色/用户受影响），
  需要新增 read model。
