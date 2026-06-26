# User Stories - Auth-SSO

Version: v3.2
Status: Released (角色矩阵 + 正文已同步 v3.2，旧行为以删除线标注)
Last Updated: 2026-06-25
Related Specs: REQUIREMENTS_MATRIX.md, PRD.md, ARCHITECTURE.md, DATABASE.md

> **⚠️ v3.2 术语漂移**：本文档部分 User Story 描述的是 v3.1 的 DataScope 模型（`DEPT`/`DEPT_AND_SUB`/`ALL`/`SELF`/`CUSTOM`、`role_data_scopes` 表）。v3.2 已将这些替换为「角色归属部门（`roles.dept_id`）+ 子树展开」的简化模型。角色矩阵已同步至 v3.2；US-C-02/07、US-CROSS-07、US-RBAC-01/04 等 DataScope 相关 Story 正文已将术语替换为 v3.2 描述，旧行为以 `~~删除线~~` 标注。详见 [RBAC_MODEL_REDESIGN.md](./RBAC_MODEL_REDESIGN.md)。

---

## 1. Actor Matrix（测试角色矩阵）

### 1.1 组织架构

```
干了科技（总部）
├── 技术部
│   ├── 前端组
│   └── 后端组
├── 产品部
└── 运营部
```

### 1.2 测试用户

| 用户 | 部门 | 角色 | 数据范围（v3.2: 由角色所属部门决定） | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| **张三** | 总部 | `super_admin` | 全部部门 | 超级管理员，拥有全部权限 |
| **李四** | 技术部 | `org_admin` | 技术部 + 子部门 | 组织管理员，角色归属技术部 |
| **王五** | 产品部 | `dept_manager` | 产品部 | 部门经理，角色归属产品部 |
| **赵六** | 后端组 | `employee` | 后端组 | 普通员工，角色归属后端组 |
| **孙七** | 总部 | `app_admin` | 全部部门 | 应用管理员，仅管理 OAuth 客户端 |
| **周八** | 运营部 | `audit_viewer` | 运营部 | 审计员，仅查看审计/登录日志 |
| **吴九** | 前端组 | _(无角色)_ | — | 新入职员工，无任何权限 |
| **陈十** | 产品部 | `employee`（DISABLED） | 产品部（已禁用，无法登录） | 已禁用账户，不可登录（v3.2 不再有 SELF 类型，数据范围由角色所属部门决定） |

### 1.3 角色权限分配明细

#### super_admin（超级管理员 — 张三）

| 权限组 | 权限代码 |
| :--- | :--- |
| 用户管理 | `user:list`, `user:create`, `user:read`, `user:update`, `user:delete`, `user:manage`, `user:reset_password`, `user:assign_role` |
| 部门管理 | `department:list`, `department:create`, `department:read`, `department:update`, `department:delete`, `department:manage` |
| 角色管理 | `role:list`, `role:create`, `role:read`, `role:update`, `role:delete`, `role:manage`, `role:assign_permission` |
| 权限管理 | `permission:list`, `permission:create`, `permission:read`, `permission:update`, `permission:delete`, `permission:manage` |
| 菜单管理 | `menu:list`, `menu:create`, `menu:read`, `menu:update`, `menu:delete`, `menu:manage` |
| 客户端管理 | `client:list`, `client:create`, `client:read`, `client:update`, `client:delete`, `client:manage`, `client:rotate_secret` |
| 审计日志 | `audit:read`, `audit:export` |
| 登录日志 | `login_log:read`, `login_log:export` |
| 系统管理 | `system:manage`, `system:view_dashboard` |

#### org_admin（组织管理员 — 李四）

| 权限组 | 权限代码 |
| :--- | :--- |
| 用户管理 | `user:list`, `user:create`, `user:read`, `user:update`, `user:reset_password`, `user:assign_role` |
| 部门管理 | `department:list`, `department:read` |
| 角色管理 | `role:list`, `role:read` |
| 系统管理 | `system:view_dashboard` |

#### dept_manager（部门经理 — 王五）

| 权限组 | 权限代码 |
| :--- | :--- |
| 用户管理 | `user:list`, `user:read`, `user:update` |
| 部门管理 | `department:list`, `department:read` |
| 角色管理 | `role:list`, `role:read` |
| 系统管理 | `system:view_dashboard` |

#### employee（普通员工 — 赵六）

| 权限组 | 权限代码 |
| :--- | :--- |
| _(无管理权限)_ | `system:view_dashboard` |

#### app_admin（应用管理员 — 孙七）

| 权限组 | 权限代码 |
| :--- | :--- |
| 客户端管理 | `client:list`, `client:create`, `client:read`, `client:update`, `client:delete`, `client:manage`, `client:rotate_secret` |

#### audit_viewer（审计员 — 周八）

| 权限组 | 权限代码 |
| :--- | :--- |
| 审计日志 | `audit:read`, `audit:export` |
| 登录日志 | `login_log:read`, `login_log:export` |

### 1.4 OAuth 客户端

| 客户端 | Redirect URI | 授权角色 | 状态 |
| :--- | :--- | :--- | :--- |
| **portal** | `http://localhost:4100/api/auth/callback` | ADMIN | ACTIVE |
| **erp-app** | `https://erp.example.com/callback` | `super_admin`, `org_admin`, `dept_manager` | ACTIVE |
| **crm-app** | `https://crm.example.com/callback` | `super_admin`, `org_admin` | ACTIVE |
| **disabled-app** | `https://disabled.example.com/callback` | — | DISABLED |

---

## 2. 模块 A：门户底座 (Portal Infrastructure)

### US-A-01：侧边栏根据权限动态渲染

> **@req A-NAV-01**

**作为** 拥有 `super_admin` 角色的张三，
**我** 登录 Portal 后看到完整的侧边栏菜单（用户管理、部门管理、角色管理、权限管理、菜单管理、客户端管理、审计日志、系统设置），
**以便** 我能管理系统的所有功能模块。

**验收标准：**
1. 张三登录后，侧边栏展示全部一级菜单项
2. 菜单项与 `system:view_dashboard`、`user:list`、`department:list`、`role:list`、`permission:list`、`menu:list`、`client:list`、`audit:read` 等权限代码一一对应
3. 菜单顺序与 `E-MNU-*` 管理的排序一致

---

### US-A-02：侧边栏仅展示有权限的菜单

> **@req A-NAV-01**

**作为** 拥有 `employee` 角色的赵六（仅有 `system:view_dashboard`），
**我** 登录后侧边栏只显示「首页/仪表盘」菜单项，
**以便** 我不会看到无法操作的灰化入口。

**验收标准：**
1. 赵六的侧边栏仅包含「仪表盘」
2. 「用户管理」「角色管理」等菜单项不可见（非灰化，而是完全隐藏）
3. 直接访问 `/admin/users` URL 时返回 403 或重定向回仪表盘

---

### US-A-03：无角色用户看到空侧边栏

> **@req A-NAV-01**

**作为** 没有任何角色的吴九，
**我** 登录后侧边栏为空（或仅显示无权限提示），
**以便** 系统清晰告知我没有可操作的功能。

**验收标准：**
1. 吴九登录后侧边栏无任何菜单项
2. 页面中央显示「您暂无系统权限，请联系管理员」提示
3. 访问任何管理页面均被 403 拦截

---

### US-A-04：面包屑导航支持回溯

> **@req A-NAV-02**

**作为** 拥有 `super_admin` 角色的张三，
**我** 在「用户管理 → 用户详情 → 编辑用户」页面中看到准确的面包屑路径，
**以便** 我能快速返回上级页面。

**验收标准：**
1. 面包屑显示：`首页 / 用户管理 / 张三详情 / 编辑`
2. 点击「用户管理」返回用户列表页（保留搜索状态）
3. 点击「首页」返回仪表盘

---

### US-A-05：仪表盘指标卡片加载

> **@req A-NAV-03**

**作为** 拥有 `system:view_dashboard` 权限的张三、李四、王五，
**我** 在首页仪表盘看到用户总数、在线用户数、今日登录数等指标卡片，
**以便** 我快速了解系统运行状态。

**验收标准：**
1. 指标卡片数据正确加载，无空白或 loading 卡死
2. 数据范围由角色所属部门决定：张三（super_admin）看到全公司，李四（归属技术部）看到技术部及子部门，王五（归属产品部）只看到产品部
3. 无 `system:view_dashboard` 权限的用户（如吴九）看不到仪表盘

---

## 3. 模块 B：用户管理 (User Management)

### US-B-01：超级管理员查看全部用户列表

> **@req B-USR-L** | **权限:** `user:list`

**作为** 拥有 `super_admin` 角色的张三（超级管理员绕过数据范围限制），
**我** 访问用户管理页面时看到公司所有用户（包括总部、技术部、前端组、后端组、产品部、运营部的全部成员），
**以便** 我能全局管理所有用户。

**验收标准：**
1. 用户列表分页展示，默认每页 20 条
2. 列表列包含：用户名、姓名、邮箱、部门、角色、状态、操作
3. 数据不受部门限制，可看到所有部门的用户

---

### US-B-02：组织管理员查看本部门及子部门用户

> **@req B-USR-L** | **权限:** `user:list`

**作为** 拥有 `org_admin` 角色（归属技术部）的李四，
**我** 访问用户管理页面时仅看到技术部及其子部门（前端组、后端组）的用户，
**以便** 我在职责范围内管理用户，不会看到产品部或运营部的用户。

> ~~v3.1：DataScope: DEPT_AND_SUB~~ → v3.2：角色归属技术部，数据范围 = 技术部 + 子部门（ancestors LIKE 子树展开）。

**验收标准：**
1. 列表仅展示技术部、前端组、后端组的用户（赵六在列）
2. 总部、产品部、运营部的用户（王五、周八等）不出现在列表中
3. 调用 `GET /api/users` 返回数据已按 deptIds 过滤

---

### US-B-03：部门经理仅查看本部门用户

> **@req B-USR-L** | **权限:** `user:list`

**作为** 拥有 `dept_manager` 角色（归属产品部）的王五，
**我** 访问用户管理页面时仅看到产品部的直属用户，
**以便** 我管理本部门成员。

> ~~v3.1：DataScope: DEPT~~ → v3.2：角色归属产品部，数据范围 = 产品部（若无需子部门，将角色 dept_id 设在产品部即可，子树展开仅当角色部门有子部门时生效）。

**验收标准：**
1. 列表仅展示产品部直属用户
2. 不展示其他部门（总部、技术部等）的用户

---

### US-B-04：普通员工的数据范围

> **@req B-USR-L** | **权限:** `user:list`

**作为** 拥有 `employee` 角色（归属后端组）的赵六，
**我** 访问用户管理页面时仅看到后端组的用户，
**以便** 我能查看本部门同事信息。

> ~~v3.1：DataScope: SELF~~ → v3.2：角色归属后端组，数据范围 = 后端组（含子部门，如有）。不再有「仅自身」的数据范围类型。

**验收标准：**
1. 列表仅展示后端组用户
2. 搜索功能无法查到其他部门的用户

---

### US-B-05：无权限用户无法查看用户列表

> **@req B-USR-L** | **权限:** _(无 `user:list`)_

**作为** 没有任何管理权限的吴九，
**我** 尝试访问 `/api/users` 时收到 403 FORBIDDEN，
**以便** 未授权用户无法获取用户数据。

**验收标准：**
1. 侧边栏不显示「用户管理」入口
2. 直接访问 `/admin/users` 返回 403 或重定向
3. API 调用 `GET /api/users` 返回 `{ "code": "FORBIDDEN" }`

---

### US-B-06：实时搜索用户

> **@req B-USR-S** | **权限:** `user:list`

**作为** 拥有 `super_admin` 角色的张三，
**我** 在用户列表页输入搜索关键词「赵」时，列表实时过滤出姓名/邮箱/用户名包含「赵」的用户，
**以便** 我快速定位目标用户。

**验收标准：**
1. 输入「赵」后 300ms 内触发搜索（debounce）
2. 结果匹配姓名、邮箱、用户名字段
3. 搜索结果仍受数据范围约束（李四搜索时只返回技术部及子部门的匹配用户）

---

### US-B-07：通过对话框创建用户

> **@req B-USR-C** | **权限:** `user:create`

**作为** 拥有 `super_admin` 角色的张三，
**我** 点击「新建用户」按钮，在弹出的对话框中填写用户名、姓名、邮箱、部门、初始密码后提交，
**以便** 新员工能登录系统。

**验收标准：**
1. 对话框包含必填字段：用户名、姓名、初始密码
2. 用户名和邮箱唯一性校验（重复时提示错误）
3. 创建成功后列表自动刷新，新用户出现在列表中
4. Portal 同步创建对应身份记录（共享 DB 模式下自动完成）
5. 新用户默认状态为 `ACTIVE`

---

### US-B-08：无创建权限时新建按钮不可见

> **@req B-USR-C** | **权限:** _(无 `user:create`)_

**作为** 拥有 `dept_manager` 角色但没有 `user:create` 权限的王五，
**我** 在用户列表页面看不到「新建用户」按钮，
**以便** 我不会尝试无法完成的操作。

**验收标准：**
1. 「新建用户」按钮不渲染（非 disabled）
2. 即使通过 API 直接 `POST /api/users` 也返回 403

---

### US-B-09：查看用户详情

> **@req B-USR-R** | **权限:** `user:read`

**作为** 拥有 `super_admin` 角色的张三，
**我** 点击用户列表中「赵六」行进入 `/users/u_zhaoliu` 详情页，
**以便** 我查看赵六的完整资料（基本信息、所属部门、分配角色、账户状态、最近登录时间）。

**验收标准：**
1. 详情页展示：用户名、姓名、邮箱、手机号、部门、角色列表、状态、创建时间、最近登录
2. 访问不在数据范围内的用户详情时返回 404（如李四访问产品部王五的详情）
3. 用户资料使用 `id`（uuid）作为外部标识

---

### US-B-10：更新用户资料

> **@req B-USR-U** | **权限:** `user:update`

**作为** 拥有 `super_admin` 角色的张三，
**我** 在赵六的详情页点击「编辑」，修改其邮箱和部门（从后端组调到前端组）后保存，
**以便** 用户资料保持最新。

**验收标准：**
1. 修改保存成功后详情页即时刷新
2. 部门变更后，归属该部门的管理者列表自动反映变化
3. 李四（org_admin，管理技术部）也能编辑技术部内用户的资料
4. 王五（dept_manager）可编辑产品部用户的资料，但不可编辑其他部门用户

---

### US-B-11：逻辑删除用户（二次确认）

> **@req B-USR-D** | **权限:** `user:delete`

**作为** 拥有 `super_admin` 角色的张三，
**我** 在用户列表中点击某个离职员工的「删除」按钮，弹出二次确认对话框，确认后该用户被逻辑删除，
**以便** 系统保留审计记录但用户不再可登录。

**验收标准：**
1. 删除前弹出确认对话框：「确认删除用户 XXX？此操作不可恢复」
2. 确认后调用 `DELETE /api/users/:id`，数据库设置 `deleted_at` 时间戳
3. 被删除用户不再出现在用户列表中
4. 被删除用户的 JWT jti 被写入 Redis 黑名单（紧急撤销）
5. 无 `user:delete` 权限的用户（李四、王五、赵六）看不到删除按钮

---

### US-B-12：账户状态控制（锁定/激活/禁用）

> **@req B-USR-ST** | **权限:** `user:update`

**作为** 拥有 `super_admin` 角色的张三，
**我** 在陈十（已禁用）的用户详情页点击「激活」，将其状态从 DISABLED 改为 ACTIVE，
**以便** 陈十恢复休假后可以重新登录系统。

**验收标准：**
1. 状态切换选项：ACTIVE → DISABLED/LOCKED，DISABLED → ACTIVE，LOCKED → ACTIVE
2. 陈十状态为 DISABLED 时尝试登录，Portal 拒绝认证并返回错误
3. 激活后陈十可正常登录
4. 锁定用户（LOCKED）后该用户当前 JWT 的 jti 写入黑名单
5. 状态变更记录写入审计日志

---

### US-B-13：为用户分配角色

> **@req B-USR-ST** | **权限:** `user:assign_role`

**作为** 拥有 `super_admin` 角色的张三，
**我** 在赵六的用户详情页点击「分配角色」，勾选 `dept_manager` 角色后保存，
**以便** 赵六获得部门经理权限，能管理后端组的用户。

**验收标准：**
1. 角色选择器展示系统所有可用角色列表
2. 保存后赵六的 JWT claims 中 `roles` 字段包含 `dept_manager`
3. 赵六的数据范围跟随新分配角色的所属部门
4. 赵六的下一次 API 请求即生效（或通过刷新 Token 立即生效）

---

### US-B-14：重置用户密码

> **@req B-USR-ST** | **权限:** `user:reset_password`

**作为** 拥有 `super_admin` 角色的张三，
**我** 在赵六的用户详情页点击「重置密码」，输入新密码后确认，
**以便** 赵六忘记密码时管理员能帮他重置。

**验收标准：**
1. 重置密码需要管理员输入并确认新密码
2. 重置成功后赵六的当前 JWT jti 被写入 Redis 黑名单（强制重新登录）
3. 赵六使用新密码可正常登录
4. 无 `user:reset_password` 权限的用户（王五）看不到重置密码按钮

---

## 4. 模块 C：角色与授权 (Role & Authorization)

### US-C-01：查看角色列表

> **@req C-ROL-L** | **权限:** `role:list`

**作为** 拥有 `super_admin` 角色的张三，
**我** 访问角色管理页面，看到所有系统角色（super_admin、org_admin、dept_manager、employee、app_admin、audit_viewer），
**以便** 我了解和管理局部角色配置。

**验收标准：**
1. 角色列表展示：角色名称、Code、描述、所属部门、关联用户数
2. 李四（org_admin）和赵六（employee）也能看到角色列表（有 `role:list`）
3. 吴九（无角色）无法访问角色列表页面

---

### US-C-02：新建角色（含部门归属）

> **@req C-ROL-C** | **权限:** `role:create`

**作为** 拥有 `super_admin` 角色的张三，
**我** 点击「新建角色」，在对话框中填写角色名称「项目经理」、Code `project_manager`、描述、所属部门选择「技术部」，
**以便** 为项目管理岗位创建专属角色，该角色的数据范围自动限定为技术部及子部门。

> ~~v3.1：DataScope 选择 `DEPT_AND_SUB`~~ → v3.2：选择「所属部门」，数据范围由 `roles.dept_id` 隐式决定。

**验收标准：**
1. 对话框包含：角色名称（必填）、Code（必填，唯一）、描述（选填）、所属部门选择（必填）
2. Code 重复时提示错误
3. 创建成功后角色出现在列表中
4. 李四（无 `role:create`）看不到「新建角色」按钮

---

### US-C-03：编辑角色

> **@req C-ROL-U** | **权限:** `role:update`

**作为** 拥有 `super_admin` 角色的张三，
**我** 编辑 `org_admin` 角色的描述为「组织管理员，管理指定部门及子部门的用户和配置」，
**以便** 角色描述更准确地反映职责。

**验收标准：**
1. 可修改角色名称和描述
2. 不可修改角色 Code（Code 是不可变标识）
3. 保存后角色列表即时更新

---

### US-C-04：删除角色（二次确认）

> **@req C-ROL-D** | **权限:** `role:delete`

**作为** 拥有 `super_admin` 角色的张三，
**我** 删除 `project_manager` 角色前，系统弹出确认对话框，确认后角色被移除，
**以便** 不再需要的角色被清理。

**验收标准：**
1. 弹出二次确认：「角色 N 当前关联 M 个用户，确认删除？」
2. 若角色仍关联用户，提示先解除用户绑定
3. 删除成功后角色从列表消失
4. 已分配该角色的用户自动失去对应权限

---

### US-C-05：为角色授予功能权限

> **@req C-ROL-PA** | **权限:** `role:assign_permission`

**作为** 拥有 `super_admin` 角色的张三，
**我** 编辑 `dept_manager` 角色，在权限树中勾选 `user:reset_password` 权限后保存，
**以便** 部门经理也能帮下属重置密码。

**验收标准：**
1. 权限树按模块分组展示（用户管理、角色管理、部门管理...）
2. 勾选/取消勾选后保存到 `role_permissions` 关联表
3. 保存后拥有该角色的用户在下一次请求时获取更新后的权限
4. 李四（有 `role:list` 但无 `role:assign_permission`）只能查看权限树但不能编辑

---

### US-C-06：控制角色的应用授权

> **@req C-ROL-CA** | **权限:** `role:update`

**作为** 拥有 `super_admin` 角色的张三，
**我** 编辑 `dept_manager` 角色，在「应用授权」Tab 中勾选 `erp-app`，
**以便** 拥有 `dept_manager` 角色的用户（如王五）能通过 SSO 登录 ERP 系统。

**验收标准：**
1. 展示所有 ACTIVE 状态的 OAuth 客户端供勾选
2. 保存后更新 `role_clients` 关联表
3. 王五登录 ERP 时 Portal 授权端点校验通过
4. 取消勾选后王五登录 ERP 时被 Portal 拒绝（G-SEC-INT）

---

### US-C-07：修改角色的所属部门

> **@req C-ROL-U** | **权限:** `role:update`

**作为** 拥有 `super_admin` 角色的张三，
**我** 将 `dept_manager` 角色的所属部门从「产品部」修改为「技术部」，
**以便** 该角色的数据范围跟随新部门变动。

> ~~v3.1：DataScope 下拉 ALL/DEPT/DEPT_AND_SUB/SELF/CUSTOM~~ → v3.2：修改 `roles.dept_id`，数据范围自动切换为新技术部 + 子部门。

**验收标准：**
1. 角色编辑表单包含「所属部门」下拉选择
2. 修改保存后，拥有该角色用户的 API 查询结果范围立即跟随新部门变更
3. 部门变更后，该角色所有用户的数据范围同步更新

---

## 5. 模块 D：权限标识维护 (Permission Registry)

### US-D-01：查看权限分类列表

> **@req D-PRM-L** | **权限:** `permission:list`

**作为** 拥有 `super_admin` 角色的张三，
**我** 访问权限管理页面，看到按类型（DIRECTORY/PAGE/API/DATA）分组的所有权限 Code，
**以便** 我了解系统的权限全貌。

**验收标准：**
1. 权限按类型分组展示（树形或标签页）
2. 每条权限展示：Code、名称、类型、描述、关联角色数
3. 搜索功能支持按 Code 过滤
4. 周八（audit_viewer）无 `permission:list` 权限，无法访问此页面

---

### US-D-02：新增权限标识

> **@req D-PRM-C** | **权限:** `permission:create`

**作为** 拥有 `super_admin` 角色的张三，
**我** 点击「新增权限」，在对话框中填写 Code `order:approve`、名称「订单审批」、类型 `API`、描述，
**以便** 新业务功能的权限标识被注册到系统。

**验收标准：**
1. 对话框包含：Code（必填，唯一）、名称（必填）、类型（DIRECTORY/PAGE/API/DATA）、描述
2. Code 重复时提示错误
3. 创建后权限出现在列表中，可被分配给角色

---

### US-D-03：编辑权限标识

> **@req D-PRM-U** | **权限:** `permission:update`

**作为** 拥有 `super_admin` 角色的张三，
**我** 编辑 `order:approve` 权限的名称和描述，
**以便** 权限描述更加清晰。

**验收标准：**
1. 可修改名称、类型、描述
2. 不可修改 Code（Code 是不可变标识）
3. 保存后更新即时生效

---

### US-D-04：删除权限标识（确认对话框）

> **@req D-PRM-D** | **权限:** `permission:delete`

**作为** 拥有 `super_admin` 角色的张三，
**我** 删除 `order:approve` 权限时，系统弹出确认对话框，
**以便** 防止误删正在使用的权限。

**验收标准：**
1. 弹出确认：「权限 N 当前被 M 个角色引用，确认删除？」
2. 若权限仍被角色引用，需先解除引用或强制删除
3. 删除后该权限从所有角色的权限树中消失
4. 拥有该权限的用户立即失去对应操作能力

---

## 6. 模块 E：菜单架构管理 (Menu Management)

### US-E-01：树形菜单列表展示

> **@req E-MNU-L** | **权限:** `menu:list`

**作为** 拥有 `super_admin` 角色的张三，
**我** 访问菜单管理页面，看到树形结构的菜单层级（首页、用户管理、角色管理、部门管理...），
**以便** 我了解和维护系统导航结构。

**验收标准：**
1. 菜单以树形结构展示，支持展开/收起
2. 每个节点显示：菜单名称、路径、图标、排序号、状态（显示/隐藏）
3. 孙七（app_admin）无 `menu:list` 权限，无法访问此页面

---

### US-E-02：创建菜单项

> **@req E-MNU-C** | **权限:** `menu:create`

**作为** 拥有 `super_admin` 角色的张三，
**我** 在「系统设置」节点下新建子菜单「邮件配置」，指定路径 `/admin/email-config`、图标、排序号，
**以便** 新功能模块在侧边栏中出现。

**验收标准：**
1. 对话框包含：名称（必填）、路径（必填）、父级菜单（下拉选择）、图标、排序号、状态
2. 创建后菜单树即时刷新
3. 有对应权限的用户侧边栏自动出现新菜单项

---

### US-E-03：编辑菜单属性

> **@req E-MNU-U** | **权限:** `menu:update`

**作为** 拥有 `super_admin` 角色的张三，
**我** 将「用户管理」菜单的排序号从 2 改为 1（提升到第一位置），并修改路径为 `/admin/users`，
**以便** 菜单顺序和路径符合业务需求。

**验收标准：**
1. 可修改：名称、路径、图标、排序号、显隐状态
2. 修改排序后菜单树重新排列
3. 设为「隐藏」的菜单不在侧边栏显示但仍可通过 URL 直接访问

---

### US-E-04：删除菜单项（递归清理）

> **@req E-MNU-D** | **权限:** `menu:delete`

**作为** 拥有 `super_admin` 角色的张三，
**我** 删除「邮件配置」菜单项，
**以便** 不再需要的菜单入口被移除。

**验收标准：**
1. 删除父菜单时，子菜单级联删除（递归清理）
2. 删除后侧边栏不再显示该项
3. 关联的权限绑定自动解除

---

### US-E-05：菜单绑定权限标识

> **@req E-MNU-PB** | **权限:** `menu:update`

**作为** 拥有 `super_admin` 角色的张三，
**我** 将「用户管理」菜单项绑定权限 Code `user:list`，
**以便** 只有拥有 `user:list` 权限的用户才能在侧边栏看到该菜单。

**验收标准：**
1. 每个菜单项可绑定一个权限 Code
2. 绑定后侧边栏渲染逻辑：用户拥有该权限 Code 时菜单可见，否则隐藏
3. 修改绑定即时生效

---

## 7. 模块 F：组织架构 (Department Management)

### US-F-01：查看部门组织树

> **@req F-DEP-L** | **权限:** `department:list`

**作为** 拥有 `super_admin` 角色的张三，
**我** 访问部门管理页面，看到完整的组织架构树（总部 → 技术部/前端组/后端组/产品部/运营部），
**以便** 我了解和维护公司的组织结构。

**验收标准：**
1. 树形结构展示，支持展开/收起
2. 每个节点显示：部门名称、编码、负责人、人数
3. 李四（org_admin）也能查看部门树（有 `department:list` 和 `department:read`）

---

### US-F-02：创建子部门

> **@req F-DEP-C** | **权限:** `department:create`

**作为** 拥有 `super_admin` 角色的张三，
**我** 在「技术部」节点下新增子部门「测试组」，
**以便** 新成立团队有自己的部门节点。

**验收标准：**
1. 选择父部门后创建子节点
2. 新部门的 `ancestors` 字段自动计算（materialized path）
3. 创建后组织树即时刷新
4. 李四（无 `department:create`）无法创建部门

---

### US-F-03：修改部门信息

> **@req F-DEP-U** | **权限:** `department:update`

**作为** 拥有 `super_admin` 角色的张三，
**我** 将「前端组」的名称修改为「大前端组」，
**以便** 部门名称与实际一致。

**验收标准：**
1. 可修改：部门名称、编码、负责人
2. 修改编码时校验唯一性
3. 李四（无 `department:update`）无法修改

---

### US-F-04：删除部门节点

> **@req F-DEP-D** | **权限:** `department:delete`

**作为** 拥有 `super_admin` 角色的张三，
**我** 删除「测试组」部门节点，
**以便** 撤销的团队结构被清理。

**验收标准：**
1. 若部门下有用户，提示「请先迁移部门内用户」
2. 若部门下有子部门，提示「请先删除或迁移子部门」
3. 无用户且无子部门时允许删除
4. 删除后组织树即时刷新

---

## 8. 模块 G：应用与安全 (OAuth & Security)

### US-G-01：查看客户端列表

> **@req G-CLT-L** | **权限:** `client:list`

**作为** 拥有 `super_admin` 角色的张三或拥有 `app_admin` 角色的孙七，
**我** 访问客户端管理页面，看到所有 OAuth 客户端（portal、erp-app、crm-app、disabled-app），
**以便** 我了解和管理接入的应用。

**验收标准：**
1. 列表展示：客户端名称、Client ID、Redirect URI、授权角色、状态、创建时间
2. 孙七能看到完整的客户端列表（归属总部，数据范围覆盖全公司）
3. 李四（无 `client:list`）无法访问此页面，侧边栏不显示入口

---

### US-G-02：注册新客户端

> **@req G-CLT-C** | **权限:** `client:create`

**作为** 拥有 `super_admin` 角色的张三，
**我** 点击「注册客户端」，填写应用名称「HR 系统」、Redirect URI `https://hr.example.com/callback` 后提交，
**以便** HR 系统能接入 SSO。

**验收标准：**
1. 系统自动生成 Client ID 和 Client Secret
2. Client Secret 仅在创建时展示一次，后续不可查看
3. 新客户端默认状态为 ACTIVE
4. 孙七（app_admin，有 `client:create`）也能注册新客户端

---

### US-G-03：更新客户端配置

> **@req G-CLT-U** | **权限:** `client:update`

**作为** 拥有 `super_admin` 角色的张三，
**我** 修改 `portal` 的 Redirect URI 从 `http://localhost:4000/callback` 改为 `http://localhost:4100/api/auth/callback`，
**以便** 回调地址与实际路由一致。

**验收标准：**
1. 可修改：名称、Redirect URI、描述、状态（ACTIVE/DISABLED）
2. 修改 Redirect URI 后新登录使用新地址
3. 孙七（app_admin）也能修改客户端配置

---

### US-G-04：注销客户端

> **@req G-CLT-D** | **权限:** `client:delete`

**作为** 拥有 `super_admin` 角色的张三，
**我** 注销 `disabled-app` 客户端（彻底移除），
**以便** 不再使用的应用被清理。

**验收标准：**
1. 弹出二次确认对话框
2. 删除后该 Client ID 不再有效，所有授权请求被拒绝
3. 已发放的 Refresh Token 失效

---

### US-G-05：SSO 强拦截 — 角色未授权应用

> **@req G-SEC-INT** | **核心安全需求**

**作为** 拥有 `employee` 角色的赵六，
**我** 尝试通过 SSO 登录 ERP 系统时，Portal 授权端点拒绝请求并显示「您没有权限访问该应用」，
**以便** 未授权用户无法登录不属于自己的系统。

**验收标准：**
1. 赵六访问 ERP → ERP 重定向到 Portal → Portal 校验赵六角色 `employee` 不在 `erp-app` 授权角色列表中 → 拒绝
2. 返回错误页面：「无权访问该应用，请联系管理员」
3. 张三（super_admin）和王五（dept_manager）可以正常登录 ERP（在授权角色列表中）
4. 陈十（DISABLED）尝试任何应用登录时被 Portal 直接拒绝（账户状态校验优先于角色校验）

---

### US-G-06：SSO 强拦截 — 禁用的客户端

> **@req G-SEC-INT**

**作为** 拥有 `super_admin` 角色的张三，
**我** 尝试通过 SSO 登录 `disabled-app` 时被拒绝，
**以便** 禁用的应用不接受任何登录。

**验收标准：**
1. 即使是超级管理员，DISABLED 状态的客户端也拒绝授权
2. 返回错误：「该应用已被禁用」

---

### US-G-07：轮换客户端密钥

> **@req G-CLT-U** | **权限:** `client:rotate_secret`

**作为** 拥有 `super_admin` 角色的张三，
**我** 在 `erp-app` 详情页点击「轮换密钥」，系统生成新的 Client Secret，
**以便** 密钥泄露后能快速更换。

**验收标准：**
1. 新 Secret 立即生效，旧 Secret 立即失效
2. 新 Secret 仅展示一次
3. 使用旧 Secret 的请求返回 `invalid_client` 错误
4. 孙七（app_admin，有 `client:rotate_secret`）也能轮换密钥

---

## 9. 模块 H：认证与身份生命周期 (Authentication & Session)

### 9.1 OAuth 2.1 认证流程 (H-AUTH)

### US-H-AUTH-01：未登录用户首次访问跳转到 Portal

> **@req H-AUTH-001**

**作为** 未登录的吴九，
**我** 在浏览器输入 `https://portal.example.com/admin/users` 时被自动重定向到 Portal 登录页，
**以便** 我完成身份认证后才能访问受保护页面。

**验收标准：**
1. Portal BFF 检测到无 `portal_jwt_token` Cookie
2. 重定向到 `/api/auth/login`，生成 PKCE 参数并存储到 HttpOnly Cookie
3. 浏览器最终跳转到 Portal `/authorize` 端点，展示登录表单
4. 登录成功后重定向回原始请求的页面 `/admin/users`

---

### US-H-AUTH-02：OAuth 授权码获取

> **@req H-AUTH-002**

**作为** 在 Portal 登录页输入正确凭证的张三，
**我** 提交用户名和密码后被重定向回 Portal 并携带 `code` 参数，
**以便** Portal BFF 用授权码换取 Token。

**验收标准：**
1. Portal 验证凭证成功
2. 重定向到 Portal `/api/auth/callback?code=xxx&state=yyy`
3. URL 中的 `state` 与 Cookie 中存储的 `state` 一致

---

### US-H-AUTH-03：Token 交换（Back-Channel）

> **@req H-AUTH-003**

**作为** Portal BFF（服务端），
**在** 收到 Portal 回调的 `code` 参数后，
**通过** Back-Channel（服务端到服务端）向 Portal `/token` 端点发送 `code` + `code_verifier` + `client_id` + `client_secret`，
**换取** `access_token`（ES256 JWT）和 `refresh_token`。

**验收标准：**
1. Token 请求使用 HTTPS，参数包含 `grant_type=authorization_code`
2. Portal 验证 `code_verifier` 与之前存储的 `code_challenge` 匹配（S256）
3. 返回的 `access_token` 是有效的 ES256 JWT
4. 返回的 `refresh_token` 可用于后续续签
5. 整个过程在服务端完成，浏览器不可见

---

### US-H-AUTH-04：JWT Cookie 写入

> **@req H-AUTH-004**

**作为** Portal BFF（Token 交换成功后），
**将** `access_token` 写入 `portal_jwt_token` HttpOnly Cookie，`refresh_token` 写入 `portal_refresh_token` HttpOnly Cookie，
**以便** 浏览器后续请求自动携带认证信息。

**验收标准：**
1. `Set-Cookie: portal_jwt_token=<JWT>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600`
2. `Set-Cookie: portal_refresh_token=<RT>; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/refresh; Max-Age=604800`
3. 浏览器 DevTools 中可看到两个 Cookie 被正确设置
4. JavaScript `document.cookie` 无法读取这两个 Cookie（HttpOnly）

---

### US-H-AUTH-05：Cookie 安全属性验证

> **@req H-AUTH-005**

**作为** 安全审计人员，
**我** 验证 `portal_jwt_token` Cookie 的安全属性，
**以便** 确保 Cookie 不被 XSS 或 CSRF 攻击利用。

**验收标准：**
1. `HttpOnly`：JavaScript 无法通过 `document.cookie` 读取
2. `Secure`：生产环境下仅通过 HTTPS 传输
3. `SameSite=Lax`：阻止跨站 POST 请求携带 Cookie，允许顶级导航 GET 请求
4. `Path=/`：所有页面请求携带（refresh token 限制 Path）

---

### US-H-AUTH-06：State 验证 — 正常流程

> **@req H-AUTH-010**

**作为** 正常登录的张三，
**当** Portal 回调携带的 `state` 参数与 Cookie 中存储的 `state` 完全匹配时，
**登录** 成功完成。

**验收标准：**
1. `/api/auth/login` 生成的 `state` 存入 HttpOnly Cookie
2. Portal 回调 URL 中的 `state` 与 Cookie 一致
3. Portal BFF 验证通过后继续 Token 交换流程
4. 验证后清除 state Cookie

---

### US-H-AUTH-07：State 验证 — 篡改

> **@req H-AUTH-011**

**作为** 攻击者，
**我** 篡改 Portal 回调 URL 中的 `state` 参数为 `malicious_state`，
**结果** Portal BFF 检测到 state 不匹配，返回 `invalid_state` 错误。

**验收标准：**
1. 篡改后的 `state` 与 Cookie 不匹配
2. Portal BFF 返回错误：`{ "code": "invalid_state", "message": "State parameter mismatch" }`
3. 不执行 Token 交换
4. 清除所有认证相关 Cookie

---

### US-H-AUTH-08：State 过期

> **@req H-AUTH-012**

**作为** 在 Portal 登录页停留超过 10 分钟的赵六，
**当** 赵六完成登录后 Portal 回调到 Portal 时，
**Portal** 检测到 state Cookie 已过期（TTL 10min），返回 `invalid_state` 错误。

**验收标准：**
1. state Cookie 的 `Max-Age=600`（10 分钟）
2. 超时后 Cookie 被浏览器自动清除
3. 回调时找不到 state Cookie，返回 `invalid_state` 错误
4. 用户需重新发起登录流程

---

### US-H-AUTH-09：PKCE 验证

> **@req H-AUTH-013**

**作为** 安全审计人员，
**我** 验证整个 PKCE 流程（S256），
**以便** 确认授权码交换的安全性。

**验收标准：**
1. `/api/auth/login` 生成 `code_verifier`（随机字符串），计算 `code_challenge = BASE64URL(SHA256(code_verifier))`
2. `code_verifier` 存入 HttpOnly Cookie，`code_challenge` 作为参数发送给 Portal
3. Token 交换时 Portal BFF 发送 `code_verifier`，Portal 验证其 SHA256 与 `code_challenge` 匹配
4. 若攻击者截获 `code` 但没有 `code_verifier`，无法完成 Token 交换

---

### US-H-AUTH-10：Nonce 生成与验证

> **@req H-AUTH-014**

**作为** 安全审计人员，
**我** 验证 ID Token 中的 `nonce` 参数与授权请求中发送的一致，
**以便** 防止重放攻击。

**验收标准：**
1. 授权 URL 包含 `nonce` 参数（随机字符串）
2. `nonce` 存入 HttpOnly Cookie
3. Portal 将 `nonce` 写入 ID Token 的 `nonce` claim
4. Portal BFF 验证 ID Token 的 `nonce` 与 Cookie 一致
5. 验证后清除 nonce Cookie

---

### 9.2 Session 生命周期 (H-SESS)

### US-H-SESS-01：登录后 JWT Cookie 存在

> **@req H-SESS-001**

**作为** 成功登录的张三，
**我** 的浏览器持有 `portal_jwt_token` HttpOnly Cookie 且包含有效的 ES256 JWT，
**以便** 后续所有 API 请求自动携带认证凭证。

**验收标准：**
1. 浏览器 DevTools → Application → Cookies 可看到 `portal_jwt_token`
2. Cookie 值是有效的 JWT（三段式 base64url 编码）
3. 解码 JWT 后 `exp` 时间在当前时间之后

---

### US-H-SESS-02：JWT Claims 完整性

> **@req H-SESS-002**

**作为** 系统开发者，
**我** 验证 JWT claims 包含所有必需字段，
**以便** 下游服务和 Gateway 能正确进行权限判断。

**验收标准：**
JWT payload 包含以下 claims：
- `sub`: 用户 ID（如 `u_zhangsan`）
- `iss`: 签发者（如 `https://portal.example.com`）
- `exp`: 过期时间（Unix timestamp）
- `iat`: 签发时间
- `jti`: 唯一标识（用于紧急撤销）
- `roles`: 角色代码数组（如 `["super_admin"]`）
- `permissions`: 权限代码数组（如 `["user:list", "user:create", ...]`）

---

### US-H-SESS-03：JWT 过期时间验证

> **@req H-SESS-003**

**作为** 系统开发者，
**我** 验证 JWT 的 `exp` 为签发时间 + 1 小时，
**以便** Token 生命周期符合安全策略。

**验收标准：**
1. `exp - iat = 3600`（1 小时）
2. Gateway 的离线验证检查 `exp`，过期 Token 返回 401

---

### US-H-SESS-04：Access Token 过期后 API 返回 401

> **@req H-SESS-010**

**作为** Access Token 已过期的张三，
**我** 发起 API 请求时收到 401 响应，
**然后** 前端自动通过 Refresh Token 静默续签，
**续签** 成功后原始请求自动重试。

**验收标准：**
1. Access Token 过期后 `GET /api/users` 返回 401
2. 前端拦截 401，调用 `POST /api/auth/refresh`
3. 刷新成功后原始请求自动重试（用户无感知）
4. 刷新后 `portal_jwt_token` Cookie 被更新

---

### US-H-SESS-05：Refresh Token 过期后重新登录

> **@req H-SESS-011**

**作为** Refresh Token 已过期（超过 7 天未活跃）的赵六，
**我** 发起 API 请求时收到 401，前端尝试刷新失败，
**然后** 被重定向到 Portal 登录页重新认证。

**验收标准：**
1. Refresh Token 过期后 `POST /api/auth/refresh` 返回 401
2. 前端清除所有 Cookie 并重定向到 `/api/auth/login`
3. 用户需要重新输入用户名和密码
4. 不再自动登录

---

### US-H-SESS-06：前端静默续签

> **@req H-SESS-012, H-SESS-020, H-SESS-021**

**作为** 正在使用系统的张三，
**当** Access Token 剩余有效期 < 5 分钟时，
**前端** 自动调用 `POST /api/auth/refresh` 获取新 Token 并更新 Cookie，
**整个过程** 用户无感知。

**验收标准：**
1. 前端定时器每 60 秒检查 JWT `exp`
2. 当 `exp - now < 300s` 时触发刷新
3. `POST /api/auth/refresh` 成功后 `Set-Cookie` 更新 `portal_jwt_token`
4. 刷新期间不中断用户操作
5. 连续刷新时 Token 链不断裂

---

### US-H-SESS-07：Token 刷新失败处理

> **@req H-SESS-022**

**作为** Refresh Token 已失效（被撤销）的张三，
**前端** 尝试刷新 Token 失败后，
**清除** 所有认证 Cookie 并重定向到登录页。

**验收标准：**
1. `POST /api/auth/refresh` 返回 401
2. 前端清除 `portal_jwt_token` 和 `portal_refresh_token` Cookie
3. 重定向到 `/api/auth/login`
4. 用户看到 Portal 登录页，需要重新输入凭证

---

### US-H-SESS-08：jti 紧急撤销

> **@req H-SESS-030**

**作为** 拥有 `super_admin` 角色的张三，
**我** 在赵六的用户详情页点击「锁定」按钮后，
**赵六** 的当前 JWT 的 `jti` 被写入 Redis 黑名单，
**赵六** 的下一次 API 请求返回 401。

**验收标准：**
1. 锁定操作触发：`SET portal:jti_blocklist:{jti} 1 EX {剩余秒数}`
2. Redis TTL = JWT `exp` - 当前时间（最小 1 秒）
3. 赵六的后续 API 请求在 Gateway 或 Portal BFF 层检查到 jti 在黑名单中，返回 401
4. 赵六被重定向到登录页，但账户已锁定无法重新登录
5. Token 自然过期后 Redis key 自动清除，不占用存储

---

### 9.3 单点登录/登出 (H-SSO)

### US-H-SSO-01：Portal 已登录 → 子应用 (OIDC Client) 免登

> **@req H-SSO-001**

**作为** 已在 Portal 登录的张三，
**我** 在新标签页访问 子应用 (OIDC Client)（`http://localhost:4002`），
**子应用 (OIDC Client)** 自动完成 SSO 认证，无需重新输入凭证。

**验收标准：**
1. 子应用 (OIDC Client) 检测未登录 → 重定向到 Portal `/authorize`
2. 浏览器携带 `portal_jwt_token` Cookie 到 Portal
3. Portal 识别已有 session → 跳过登录 UI → 重定向回 子应用 (OIDC Client) 携带 `code`
4. 子应用 (OIDC Client) 用 `code` 换取 Token → 用户自动登录
5. 全程无需输入密码

---

### US-H-SSO-02：子应用 (OIDC Client) 已登录 → Portal 免登

> **@req H-SSO-002**

**作为** 已在 子应用 (OIDC Client) 登录的李四，
**我** 在新标签页访问 Portal（`http://localhost:4000`），
**Portal** 自动完成认证，无需重新登录。

**验收标准：**
1. Portal 检测无 `portal_jwt_token` → 重定向到 Portal `/authorize`
2. Portal 识别已有 session → 重定向回 Portal 携带 `code`
3. Portal BFF 用 `code` 换取 Token → 写入 `portal_jwt_token` Cookie
4. 李四自动登录到 Portal 仪表盘
5. 全程无需输入密码

---

### US-H-SSO-03：未登录访问受保护应用

> **@req H-SSO-003**

**作为** 未在任何应用登录的吴九，
**我** 访问 子应用 (OIDC Client) 时被重定向到 Portal 登录页，
**以便** 完成身份认证。

**验收标准：**
1. 子应用 (OIDC Client) → Portal `/authorize` → Portal 无 session → 展示登录表单
2. 吴九输入凭证后完成认证
3. 但因吴九无任何角色，子应用 (OIDC Client) 需根据自身业务决定是否允许访问

---

### US-H-SSO-04：Portal 登出联动 子应用 (OIDC Client)

> **@req H-SSO-010**

**作为** 同时在 Portal 和 子应用 (OIDC Client) 登录的张三，
**我** 在 Portal 点击「退出登录」后，
**两个** 应用都需重新登录。

**验收标准：**
1. Portal 登出流程：
   - JWT jti 写入 Redis 黑名单
   - Refresh Token 在 Portal 侧撤销
   - 清除 `portal_jwt_token` 和 `portal_refresh_token` Cookie
   - 调用 Portal `/api/auth/sign-out-sso` 清除 Portal Session
2. 张三再访问 子应用 (OIDC Client) → 子应用 (OIDC Client) 重定向到 Portal → Portal 无 session → 展示登录表单
3. 两个应用均需重新认证

---

### US-H-SSO-05：子应用 (OIDC Client) 登出联动 Portal

> **@req H-SSO-011**

**作为** 同时在 Portal 和 子应用 (OIDC Client) 登录的李四，
**我** 在 子应用 (OIDC Client) 点击「退出登录」后，
**Portal** 也需重新登录。

**验收标准：**
1. 子应用 (OIDC Client) 登出时调用 Portal `/api/auth/sign-out-sso`
2. Portal Session 被清除
3. 李四再访问 Portal → Portal 检测 `portal_jwt_token` 虽仍存在但刷新时失败（Portal session 已清除）
4. 李四被重定向到 Portal 登录页

---

### US-H-SSO-06：Portal Session 清除

> **@req H-SSO-020**

**作为** 执行登出操作的张三，
**Portal Session** 被同步清除（Redis 中 `auth-sso:{sessionToken}` 键被删除）。

**验收标准：**
1. Portal 调用 `POST /api/auth/logout` 后：
   - JWT jti 写入 Redis 黑名单 `portal:jti_blocklist:{jti}`
   - Refresh Token 撤销（Portal `/oauth2/revoke`）
   - Portal Session 清除（`POST /api/auth/sign-out-sso` → Redis 删除 `auth-sso:{sessionToken}`）
2. 所有认证状态被彻底清除

---

### US-H-SSO-07：登出后受保护页面拦截

> **@req H-SSO-021**

**作为** 刚登出的张三，
**我** 尝试访问 `/admin/users` 时被重定向到 Portal 登录页，
**以便** 确保登出后无法绕过认证。

**验收标准：**
1. 无 `portal_jwt_token` Cookie → Portal BFF 检测未认证
2. 重定向到 `/api/auth/login` → Portal 登录页
3. 不会展示任何受保护页面内容

---

### US-H-SSO-08：登出后重新登录

> **@req H-SSO-022**

**作为** 刚登出的李四，
**我** 需要重新输入用户名和密码才能完成 Portal 认证，
**以便** 重新获得系统访问权限。

**验收标准：**
1. Portal 登录页展示用户名/密码表单
2. 不自动填充或跳过认证（Portal Session 已清除）
3. 认证成功后重新建立完整的 Session 链

---

## 10. OIDC 协议层补充故事

### US-OIDC-01：OIDC Discovery 端点

**作为** 子应用 (OIDC Client) 开发者，
**我** 访问 `GET /api/auth/.well-known/openid-configuration` 获取 IdP 的 OIDC 配置文档，
**以便** 自动发现授权端点、Token 端点、JWKS 端点和支持的 Scope。

**验收标准：**
1. 返回标准 OIDC Discovery 文档（JSON）
2. 包含 `authorization_endpoint`、`token_endpoint`、`jwks_uri`、`userinfo_endpoint`
3. 包含 `scopes_supported`（openid, profile, email）
4. 包含 `code_challenge_methods_supported`（S256）
5. 无需认证即可访问（公开端点）

---

### US-OIDC-02：JWKS 公钥端点

**作为** Gateway（Rust/Pingora）或下游微服务，
**我** 访问 `GET /api/auth/jwks` 获取 IdP 的 ES256 公钥，
**以便** 离线验证 JWT 签名，无需网络 I/O。

**验收标准：**
1. 返回标准 JWKS 格式（JSON Web Key Set）
2. 包含 ES256 公钥（`kty: EC`, `crv: P-256`）
3. 包含 `kid`（Key ID）用于匹配 JWT Header 中的 `kid`
4. 无需认证即可访问（公开端点）
5. Gateway 缓存 JWKS 公钥，TTL 内不重复请求

---

### US-OIDC-03：UserInfo 端点

**作为** 子应用 (OIDC Client) 后端，
**我** 携带 Access Token 调用 `GET /api/auth/oauth2/userinfo` 获取用户信息，
**以便** 根据 `sub` 和 `email` 等字段识别用户身份。

**验收标准：**
1. 请求 Header 包含 `Authorization: Bearer <access_token>`
2. 返回用户基本信息：`sub`（用户 ID）、`email`、`name`
3. Token 过期或无效时返回 401
4. 用户 DISABLED 状态时返回错误

---

### US-OIDC-04：Token Introspection 端点

**作为** 下游微服务，
**我** 调用 `POST /api/auth/oauth2/introspect` 检查 Token 的有效性，
**以便** 确认 Access Token 是否仍有效（未过期、未撤销）。

**验收标准：**
1. 请求包含 `token` 参数和客户端凭证
2. 有效 Token 返回 `{ "active": true, "sub": "...", "exp": ..., "scope": "..." }`
3. 已撤销/过期 Token 返回 `{ "active": false }`
4. jti 在黑名单中的 Token 返回 `{ "active": false }`

---

### US-OIDC-05：OAuth 错误场景 — 授权码已使用

**作为** 攻击者尝试重放授权码，
**当** 同一个 `code` 被第二次提交到 Token 端点时，
**IdP** 返回 `invalid_grant` 错误。

**验收标准：**
1. 授权码一次性使用，第二次提交返回 `invalid_grant`
2. 第一次正常交换不受影响

---

### US-OIDC-06：OAuth 错误场景 — 授权码过期

**作为** Portal BFF，
**当** 收到 IdP 回调后延迟超过 60 秒才调用 Token 端点时，
**IdP** 返回 `invalid_grant` 错误（授权码已过期）。

**验收标准：**
1. 授权码有效期 60 秒（IdP 配置）
2. 超时后返回错误，Portal BFF 向用户展示「登录超时，请重试」
3. 需要重新发起登录流程

---

### US-OIDC-07：OAuth 错误场景 — 错误的 Redirect URI

**作为** 攻击者尝试篡改回调地址，
**当** Token 请求中的 `redirect_uri` 与授权请求中的不一致时，
**IdP** 返回 `invalid_grant` 错误。

**验收标准：**
1. `redirect_uri` 严格匹配（必须完全一致，包括末尾斜杠）
2. 不匹配时拒绝 Token 交换
3. 不泄露任何用户信息

---

### US-OIDC-08：OAuth 错误场景 — 错误的 Client Secret

**作为** 攻击者使用泄露但已轮换的 Client Secret，
**当** 使用旧 Client Secret 调用 Token 端点时，
**IdP** 返回 `invalid_client` 错误。

**验收标准：**
1. 仅最新轮换的 Client Secret 有效
2. 旧 Secret 立即失效
3. 错误响应不泄露 Client 配置信息

---

### US-OIDC-09：Token Revocation 端点

**作为** Portal BFF（登出流程中），
**我** 调用 `POST /api/auth/oauth2/revoke` 撤销 Refresh Token，
**以便** 该 Refresh Token 无法再用于换取新的 Access Token。

**验收标准：**
1. 请求包含 `token`（Refresh Token）和客户端凭证
2. 撤销成功后该 Refresh Token 无法再使用
3. 已撤销的 Access Token 不受影响（仍需 jti 黑名单处理）
4. 支持撤销 Access Token 和 Refresh Token 两种类型

---

## 11. 自助服务补充故事

### US-SELF-01：用户修改自己的密码

**作为** 拥有 `employee` 角色的赵六，
**我** 在「个人设置」页面输入旧密码和新密码后提交，
**以便** 我在知道当前密码的情况下自行修改密码。

**验收标准：**
1. 需验证旧密码正确性
2. 新密码需满足密码策略（最小长度、复杂度）
3. 修改成功后当前 JWT jti 写入 Redis 黑名单（强制重新登录）
4. 赵六使用新密码重新登录
5. 此功能不需要任何管理权限，所有已登录用户均可使用

---

### US-SELF-02：查看自己的权限和菜单

**作为** 拥有 `employee` 角色的赵六，
**我** 访问 `GET /api/me` 后看到自己的用户信息、权限列表和菜单列表，
**以便** 了解我在系统中能做什么。

**验收标准：**
1. 返回 `authenticated: true`
2. `user.permissions` 包含赵六拥有的权限代码数组（如 `["system:view_dashboard"]`）
3. `menus` 仅包含赵六可见的菜单项
4. 周八（audit_viewer）的 `menus` 包含审计日志相关菜单
5. 吴九（无角色）的 `permissions` 为空数组，`menus` 为空数组

---

### US-SELF-03：编辑自己的基本信息

**作为** 拥有 `employee` 角色的赵六，
**我** 在「个人设置」页面修改自己的邮箱和手机号，
**以便** 保持个人信息最新。

**验收标准：**
1. 可修改：邮箱、手机号、头像
2. 不可修改：用户名、部门、角色（需管理员操作）
3. 邮箱唯一性校验
4. 不需要 `user:update` 管理权限（自助服务）

---

## 12. 审计与日志补充故事

### US-AUDIT-01：查看审计日志

> **权限:** `audit:read`

**作为** 拥有 `audit_viewer` 角色的周八，
**我** 访问审计日志页面，按时间范围和操作类型筛选日志，
**以便** 追溯系统中的关键操作。

**验收标准：**
1. 审计日志列表分页展示
2. 筛选维度：操作人、操作类型（登录/角色变更/权限变更/用户变更）、时间范围、目标对象
3. 每条日志包含：时间戳、操作人、操作类型、目标对象、变更详情、IP 地址
4. 张三（super_admin）也能查看审计日志

---

### US-AUDIT-02：导出审计日志

> **权限:** `audit:export`

**作为** 拥有 `audit_viewer` 角色的周八，
**我** 点击「导出」按钮将筛选后的审计日志导出为 CSV 文件，
**以便** 进行离线分析或合规存档。

**验收标准：**
1. 导出内容与当前筛选条件一致
2. CSV 格式包含所有日志字段
3. 大量日志时异步导出，避免浏览器超时
4. 赵六（employee）无 `audit:export` 权限，看不到导出按钮

---

### US-AUDIT-03：查看登录日志

> **权限:** `login_log:read`

**作为** 拥有 `audit_viewer` 角色的周八，
**我** 访问登录日志页面，查看所有用户的登录历史，
**以便** 发现异常登录行为。

**验收标准：**
1. 登录日志列表分页展示
2. 每条记录包含：用户、登录时间、IP 地址、User-Agent、登录结果（成功/失败）
3. 支持按用户、时间范围筛选
4. 登录失败记录也包含在内（用于安全审计）

---

### US-AUDIT-04：导出登录日志

> **权限:** `login_log:export`

**作为** 拥有 `audit_viewer` 角色的周八，
**我** 点击「导出」将登录日志导出为 CSV，
**以便** 进行安全审计分析。

**验收标准：**
1. 导出功能与审计日志导出行为一致
2. 赵六（employee）无 `login_log:export` 权限

---


## 13. 安全场景补充故事

### US-SEC-01：连续登录失败后账户锁定与解锁

**作为** 系统安全策略，
**当** 同一用户连续 5 次输入错误密码后，
**该** 用户账户状态自动变更为 `LOCKED`，
**以便** 防止暴力破解攻击。

**验收标准：**
1. 连续 5 次错误密码后账户自动锁定（`LOCKED` 状态）
2. 错误计数器独立于成功登录（成功登录重置计数器）
3. 锁定后即使输入正确密码也无法登录，提示：「账户因连续多次密码错误被锁定，请在 15 分钟后重试或联系管理员解锁」
4. 锁定事件写入审计日志
5. 解锁途径一：15 分钟自动解除锁定（状态恢复为 ACTIVE）
6. 解锁途径二：需管理员手动在用户管理页激活账户提前恢复

---

### US-SEC-02：并发会话处理

**作为** 在两台设备上同时登录的赵六，
**我** 在设备 A 上修改密码后，
**设备** B 上的 JWT jti 被写入 Redis 黑名单，
**设备** B 的请求返回 401，需要重新登录。

**验收标准：**
1. 密码修改触发所有现有 JWT 的 jti 写入黑名单
2. 两台设备上的会话均失效
3. 两台设备均需使用新密码重新登录

---

### US-SEC-03：密码策略强制执行

**作为** 新创建用户首次登录的张三（管理员创建时设置初始密码），
**我** 创建新用户时若密码不满足策略要求（最少 8 位、包含大小写字母和数字），
**系统** 拒绝创建并提示密码策略要求。

**验收标准：**
1. 密码最小长度 8 位
2. 必须包含大写字母、小写字母和数字
3. 不满足策略时在创建对话框/密码修改表单中即时提示
4. 管理员重置密码同样受策略约束

---

### US-SEC-04：OAuth 客户端注销/角色移除后的子系统联动体验

**作为** 已通过 SSO 登录 `erp-app` 的王五，
**当** 管理员张三撤销了 `erp-app` 客户端或移除了王五的 `dept_manager` 角色后，
**我** 在 `erp-app` 中的下一次操作将被强制中断并要求重新认证，
**以便** 确保权限变更实时在所有子系统中生效。

**验收标准：**
1. 王五的当前 Access Token/Refresh Token jti 被写入 Redis 黑名单
2. `erp-app` 后续 API 调用（如果有验证）或前端路由刷新时，请求会因为 401 而失败
3. `erp-app` 拦截到 401，跳转到 Portal `/authorize`
4. Portal 发现用户会话有效，但目标应用无权访问，向王五展示统一错误页：「您无权访问该应用或应用已停用，请联系管理员」
5. 王五被迫退出子系统的业务流程，无法继续操作

---

## 14. 跨模块权限校验故事

### US-CROSS-01：权限缓存与实时生效

**作为** 拥有 `super_admin` 角色的张三，
**我** 将 `dept_manager` 角色新增 `user:reset_password` 权限后，
**王五**（拥有 `dept_manager` 角色）在 5 分钟内（Redis 缓存 TTL）获取到新权限。

**验收标准：**
1. 权限变更写入 DB
2. Redis 缓存 `portal:user_perms:{userId}` 在 TTL（300s）到期后刷新
3. 或主动清除缓存使其即时生效
4. 王五下次请求时获得新权限

---

### US-CROSS-02：多角色权限合并

**作为** 同时拥有 `org_admin` 和 `audit_viewer` 角色的李四，
**我** 的 JWT claims 中 `permissions` 数组包含两个角色的所有权限代码（并集），
**以便** 我能同时管理组织架构和查看审计日志。

**验收标准：**
1. JWT `permissions` 数组包含 `user:list`, `user:create`, ..., `audit:read`, `audit:export`（两个角色的并集）
2. 数据范围取多角色部门（含子树展开）的并集
3. 侧边栏展示两个角色对应的所有菜单

---

### US-CROSS-03：角色撤销后的即时效果

**作为** 拥有 `super_admin` 角色的张三，
**我** 移除赵六的 `dept_manager` 角色后，
**赵六** 的 JWT jti 被写入 Redis 黑名单，
**赵六** 需要重新登录以获取更新后的权限。

**验收标准：**
1. 角色移除操作触发 jti 黑名单写入
2. 赵六当前请求返回 401
3. 重新登录后 JWT claims 中不再包含 `dept_manager` 的权限
4. 侧边栏菜单相应减少

---

### US-CROSS-04：Gateway JWT 验证与权限透传

**作为** 通过 Gateway 访问 API 的张三，
**Gateway** 从 `portal_jwt_token` Cookie 提取 JWT，离线验证签名后，剥离 Cookie 并注入 `Authorization: Bearer <JWT>` Header，
**下游** 微服务从 JWT 中读取 `permissions` 进行细粒度权限校验。

**验收标准：**
1. Gateway 验证 ES256 签名（使用缓存的 JWKS 公钥）
2. Gateway 检查 `exp` 未过期
3. Gateway 检查 `jti` 不在黑名单中（可选，Redis Pub/Sub）
4. 转发请求携带 `Authorization: Bearer <JWT>` Header
5. 下游服务无需连接 Redis 或 DB 即可验证 JWT

---

### US-CROSS-05：DISABLED 用户登录拒绝

**作为** 账户状态为 DISABLED 的陈十，
**我** 尝试在 Portal 登录页输入正确凭证时，
**Portal** 拒绝认证并返回错误。

**验收标准：**
1. Portal 验证凭证正确但检查到用户状态为 DISABLED
2. 返回错误：「账户已被禁用，请联系管理员」
3. 不颁发任何 Token
4. 不创建 Portal Session

---

### US-CROSS-06：审计日志记录权限变更

**作为** 拥有 `super_admin` 角色的张三，
**我** 执行以下操作时，系统自动记录审计日志：
1. 为角色分配权限（C-ROL-PA）
2. 为用户分配角色（US-B-13）
3. 修改用户状态（US-B-12）
4. 删除角色（US-C-04）

**验收标准：**
1. 审计日志包含：操作人、操作时间、操作类型、目标对象、变更详情
2. 周八（audit_viewer）可查看审计日志（有 `audit:read`）
3. 赵六（employee）无法查看审计日志（无 `audit:read`）

---

### US-CROSS-07：跨部门数据访问（多角色方案）

> ~~v3.1：DataScope CUSTOM + role_data_scopes 表~~ → v3.2：每个角色只能属于一个部门。跨部门访问通过为用户分配多个角色实现。

**作为** 拥有 `super_admin` 角色的张三，
**我** 为赵六分配两个角色——归属「技术部」的 `developer` 和归属「产品部」的 `product_viewer`，
**以便** 赵六能同时看到两个部门的用户（数据范围取多角色部门的并集）。

**验收标准：**
1. 为用户分配多个不同部门的角色后，用户的数据范围为各部门 ID（含子树展开）的并集
2. 赵六查询用户列表时，能同时看到技术部（含子部门）和产品部的用户
3. 移除某个角色后，对应该部门的数据范围立即失效

---

## 15. RBAC 边界场景补充故事

### US-RBAC-01：用户部门变更后数据范围重算

**作为** 拥有 `super_admin` 角色的张三，
**我** 将赵六从「后端组」调到「产品部」后，
**赵六** 的数据范围跟随其角色所属部门自动更新（v3.2：角色的 `dept_id` 不变，但用户可以分配新部门的角色）。

**验收标准：**
1. 赵六分配到产品部下的角色后，下次 API 请求的数据范围包含产品部（及子部门）
2. 李四（org_admin，管理技术部）不再在用户列表中看到赵六
3. 王五（dept_manager，管理产品部）开始在用户列表中看到赵六
4. 用户换部门后需重新分配属于新部门的角色（R-USER-ROLE 部门约束）

---

### US-RBAC-02：删除仍关联用户的角色

**作为** 拥有 `super_admin` 角色的张三，
**我** 尝试删除仍关联 3 个用户的 `dept_manager` 角色时，
**系统** 提示需先解除用户绑定，或提供「强制删除并清除用户角色关联」选项。

**验收标准：**
1. 删除前检查角色关联用户数
2. 若有关联用户，弹出警告：「角色「部门经理」当前关联 3 个用户：王五、XXX、XXX。确认删除将同时解除这些用户的角色绑定。」
3. 确认后角色删除，用户角色关联同步清除
4. 受影响用户的 JWT jti 写入 Redis 黑名单，需重新登录
5. 受影响用户重新登录后权限减少

---

### US-RBAC-03：删除仍被角色引用的权限

**作为** 拥有 `super_admin` 角色的张三，
**我** 尝试删除被 `dept_manager` 角色引用的 `user:read` 权限时，
**系统** 提示需先从角色中移除该权限。

**验收标准：**
1. 删除前检查权限关联角色数
2. 若被引用，警告：「权限 `user:read` 被 2 个角色引用：dept_manager、org_admin。删除将从这些角色中移除该权限。」
3. 确认后权限删除，角色权限关联同步清除
4. 受影响用户的权限缓存被清除（Redis TTL 或主动失效）

---

### US-RBAC-04：多角色数据范围合并（并集）

> ~~v3.1：DataScope 优先级模型（ALL > DEPT_AND_SUB > DEPT > CUSTOM > SELF）~~ → v3.2：数据范围 = 所有角色所属部门（含子树展开）的并集。

**作为** 拥有 `super_admin` 角色的张三，
**我** 给赵六同时分配归属「产品部」的 `dept_manager` 和归属「后端组」的 `employee` 两个角色，
**系统** 取两个角色部门的并集作为赵六的数据范围（产品部 + 后端组及各自子部门）。

**验收标准：**
1. 多角色数据范围 = 所有角色 `dept_id`（含子树展开）的并集，权限取并集
2. 赵六的最终数据范围为「产品部 + 后端组（及子部门）」
3. JWT claims 中包含两个角色的所有权限并集和部门 ID 并集
4. 侧边栏展示两个角色对应的所有菜单

---

## 16. 菜单按钮级权限补充故事

### US-MNU-BTN-01：菜单类型 — 目录

**作为** 拥有 `super_admin` 角色的张三，
**我** 创建一个「目录」类型的菜单项「系统管理」，它不对应具体页面，仅作为子菜单的分组容器，
**以便** 侧边栏展示可展开的分组。

**验收标准：**
1. 目录类型菜单不渲染页面，仅渲染展开箭头
2. 点击目录时展开/收起子菜单，不触发路由跳转
3. 目录的权限绑定决定整个分组是否可见

---

### US-MNU-BTN-02：菜单类型 — 页面

**作为** 拥有 `super_admin` 角色的张三，
**我** 创建一个「页面」类型的菜单项「用户管理」，绑定路由 `/admin/users` 和权限 `user:list`，
**以便** 点击后导航到用户管理页面。

**验收标准：**
1. 页面类型菜单点击后跳转到绑定的路由
2. 只有拥有 `user:list` 权限的用户能看到此菜单
3. 直接访问 `/admin/users` 时，无权限用户被 403 拦截

---

### US-MNU-BTN-03：按钮级权限控制

**作为** 拥有 `super_admin` 角色的张三，
**我** 在用户管理页面配置按钮级权限：`user:create`（新建按钮）、`user:delete`（删除按钮）、`user:reset_password`（重置密码按钮），
**以便** 不同角色看到不同的操作按钮。

**验收标准：**
1. 按钮级权限是 `API` 类型权限，与菜单权限分离
2. 王五（有 `user:list`、`user:read`、`user:update`）能看到用户列表和编辑按钮，但看不到「新建」和「删除」按钮
3. 赵六（仅有 `system:view_dashboard`）看不到任何操作按钮
4. 前端根据 `GET /api/me` 返回的 `permissions` 数组动态渲染/隐藏按钮
5. 后端 API 同样校验权限（前端隐藏仅是 UX 优化，非安全边界）

---

### US-MNU-BTN-04：隐藏菜单仍可通过 URL 直接访问

**作为** 拥有 `super_admin` 角色的张三，
**我** 将「邮件配置」菜单设为「隐藏」后，
**菜单** 不在侧边栏显示，但知道 URL 的管理员仍可直接访问 `/admin/email-config`。

**验收标准：**
1. 隐藏菜单不出现在侧边栏
2. 直接输入 URL 仍可访问（前提是有对应权限）
3. 无权限用户直接输入 URL 返回 403
4. 隐藏仅影响导航可见性，不影响路由和权限校验

---

## 17. 需求追溯矩阵

| 需求 ID | 覆盖的用户故事 |
| :--- | :--- |
| **A-NAV-01** | US-A-01, US-A-02, US-A-03 |
| **A-NAV-02** | US-A-04 |
| **A-NAV-03** | US-A-05 |
| **B-USR-L** | US-B-01, US-B-02, US-B-03, US-B-04, US-B-05 |
| **B-USR-S** | US-B-06 |
| **B-USR-C** | US-B-07, US-B-08 |
| **B-USR-R** | US-B-09 |
| **B-USR-U** | US-B-10 |
| **B-USR-D** | US-B-11 |
| **B-USR-ST** | US-B-12, US-B-13, US-B-14 |
| **C-ROL-L** | US-C-01 |
| **C-ROL-C** | US-C-02 |
| **C-ROL-U** | US-C-03, US-C-06, US-C-07 |
| **C-ROL-D** | US-C-04, US-RBAC-02 |
| **C-ROL-PA** | US-C-05 |
| **C-ROL-CA** | US-C-06 |
| **C-ROL-DS** | US-C-07, US-CROSS-07 |
| **D-PRM-L** | US-D-01 |
| **D-PRM-C** | US-D-02 |
| **D-PRM-U** | US-D-03 |
| **D-PRM-D** | US-D-04, US-RBAC-03 |
| **E-MNU-L** | US-E-01 |
| **E-MNU-C** | US-E-02, US-MNU-BTN-01, US-MNU-BTN-02 |
| **E-MNU-U** | US-E-03, US-E-05 |
| **E-MNU-D** | US-E-04 |
| **E-MNU-PB** | US-E-05, US-MNU-BTN-03 |
| **F-DEP-L** | US-F-01 |
| **F-DEP-C** | US-F-02 |
| **F-DEP-U** | US-F-03, US-RBAC-01 |
| **F-DEP-D** | US-F-04 |
| **G-CLT-L** | US-G-01 |
| **G-CLT-C** | US-G-02 |
| **G-CLT-U** | US-G-03, US-G-07 |
| **G-CLT-D** | US-G-04 |
| **G-SEC-INT** | US-G-05, US-G-06 |
| **H-AUTH-001** | US-H-AUTH-01 |
| **H-AUTH-002** | US-H-AUTH-01 |
| **H-AUTH-003** | US-H-AUTH-02 |
| **H-AUTH-004** | US-H-AUTH-03, US-H-AUTH-04 |
| **H-AUTH-005** | US-H-AUTH-04 |
| **H-AUTH-006** | US-H-AUTH-05 |
| **H-AUTH-010** | US-H-AUTH-06 |
| **H-AUTH-011** | US-H-AUTH-07 |
| **H-AUTH-012** | US-H-AUTH-08 |
| **H-AUTH-013** | US-H-AUTH-09 |
| **H-AUTH-014** | US-H-AUTH-10 |
| **H-SESS-001** | US-H-SESS-01 |
| **H-SESS-002** | US-H-SESS-02 |
| **H-SESS-003** | US-H-SESS-03 |
| **H-SESS-010** | US-H-SESS-04 |
| **H-SESS-011** | US-H-SESS-05 |
| **H-SESS-012** | US-H-SESS-06 |
| **H-SESS-020** | US-H-SESS-06 |
| **H-SESS-021** | US-H-SESS-06 |
| **H-SESS-022** | US-H-SESS-07 |
| **H-SESS-030** | US-H-SESS-08 |
| **H-SSO-001** | US-H-SSO-01 |
| **H-SSO-002** | US-H-SSO-02 |
| **H-SSO-003** | US-H-SSO-03 |
| **H-SSO-010** | US-H-SSO-04 |
| **H-SSO-011** | US-H-SSO-05 |
| **H-SSO-020** | US-H-SSO-06 |
| **H-SSO-021** | US-H-SSO-07 |
| **H-SSO-022** | US-H-SSO-08 |
| **B-LOG-L** | US-AUDIT-01, US-AUDIT-03 |
| **B-LOG-D** | US-AUDIT-01 |
| **F-DEP-E** | US-F-03 |
| **F-DEP-M** | US-F-01 |
| **SCOPE-001** | US-B-01, US-B-06 |
| **SCOPE-002** | US-B-03 |
| **SCOPE-003** | US-B-02 |
| **SCOPE-004** | US-B-04 |
| **SCOPE-005** | US-CROSS-07 |
| **D-USR-C** | US-B-07 |
| **D-USR-U** | US-B-10 |
| **D-USR-D** | US-B-11 |
| **D-CLI-C** | US-G-02 |
| **D-CLI-U** | US-G-03 |
| **D-CLI-D** | US-G-04 |
| **D-DEPT-C** | US-F-02 |
| **D-DEPT-U** | US-F-03 |
| **D-DEPT-D** | US-F-04 |
| **D-MEN-C** | US-E-02 |
| **D-MEN-U** | US-E-03 |
| **D-MEN-D** | US-E-04 |
| **D-ROLE-C** | US-C-02 |
| **D-ROLE-U** | US-C-03, US-C-07 |
| **D-ROLE-D** | US-C-04 |
| **AUTH-001** | US-H-AUTH-01 |
| **AUTH-002** | US-H-AUTH-01, US-H-AUTH-02 |
| **AUTH-003** | US-CROSS-04 |
| **AUTH-004** | US-H-AUTH-01 |
| **AUTH-005** | US-MNU-BTN-03 |
| **AUTH-006** | US-CROSS-02 |
| **AUTH-FLOW-HAPPY** | US-H-AUTH-02 |
| **AUTH-FLOW-LOGOUT** | US-H-SSO-04 |
| **AUTH-FLOW-WRONG-PASSWORD** | US-H-AUTH-09 |
| **AUTH-FLOW-PROTECTED-REDIRECT** | US-H-AUTH-01 |
| **RBAC-ADMIN-FULL-ACCESS** | US-B-01 |
| **RBAC-RESTRICTED-API** | US-B-05 |
| **RBAC-UNAUTHORIZED** | US-B-03 |

---

## 18. 权限代码覆盖矩阵

| 权限代码 | 覆盖的用户故事 |
| :--- | :--- |
| `user:list` | US-B-01, US-B-02, US-B-03, US-B-04, US-B-05, US-B-06, US-RBAC-01 |
| `user:create` | US-B-07, US-B-08, US-MNU-BTN-03 |
| `user:read` | US-B-09, US-MNU-BTN-03 |
| `user:update` | US-B-10, US-B-12, US-MNU-BTN-03 |
| `user:delete` | US-B-11, US-MNU-BTN-03 |
| `user:manage` | US-B-01 (隐含) |
| `user:reset_password` | US-B-14, US-MNU-BTN-03 |
| `user:assign_role` | US-B-13 |
| `department:list` | US-F-01 |
| `department:create` | US-F-02 |
| `department:read` | US-F-01 |
| `department:update` | US-F-03, US-RBAC-01 |
| `department:delete` | US-F-04 |
| `department:manage` | US-F-01 (隐含) |
| `role:list` | US-C-01 |
| `role:create` | US-C-02 |
| `role:read` | US-C-01 |
| `role:update` | US-C-03, US-C-06, US-C-07, US-RBAC-02 |
| `role:delete` | US-C-04, US-RBAC-02 |
| `role:manage` | US-C-01 (隐含) |
| `role:assign_permission` | US-C-05, US-RBAC-03 |
| `permission:list` | US-D-01 |
| `permission:create` | US-D-02 |
| `permission:read` | US-D-01 |
| `permission:update` | US-D-03 |
| `permission:delete` | US-D-04, US-RBAC-03 |
| `permission:manage` | US-D-01 (隐含) |
| `menu:list` | US-E-01 |
| `menu:create` | US-E-02, US-MNU-BTN-01, US-MNU-BTN-02 |
| `menu:read` | US-E-01 |
| `menu:update` | US-E-03, US-E-05, US-MNU-BTN-04 |
| `menu:delete` | US-E-04 |
| `menu:manage` | US-E-01 (隐含) |
| `client:list` | US-G-01 |
| `client:create` | US-G-02 |
| `client:read` | US-G-01 |
| `client:update` | US-G-03 |
| `client:delete` | US-G-04 |
| `client:manage` | US-G-01 (隐含) |
| `client:rotate_secret` | US-G-07, US-OIDC-08 |
| `audit:read` | US-CROSS-06, US-AUDIT-01 |
| `audit:export` | US-CROSS-06, US-AUDIT-02 |
| `login_log:read` | US-AUDIT-03 |
| `login_log:export` | US-AUDIT-04 |
| `system:manage` | US-A-01 (隐含) |
| `system:view_dashboard` | US-A-05, US-SELF-02 |

---

## 19. API Endpoint 覆盖矩阵

| API Endpoint | 覆盖的用户故事 |
| :--- | :--- |
| `GET /api/me` | US-SELF-02 |
| `GET /api/me/permissions` | US-SELF-02 |
| `GET /api/me/menus` | US-SELF-02, US-A-01, US-A-02, US-A-03 |
| `GET /api/auth/login` | US-H-AUTH-01, US-H-AUTH-09 |
| `POST /api/auth/logout` | US-H-SSO-04, US-H-SSO-06 |
| `POST /api/auth/refresh` | US-H-SESS-04, US-H-SESS-05, US-H-SESS-06, US-H-SESS-07 |
| `GET /api/users` | US-B-01, US-B-02, US-B-03, US-B-04, US-B-05, US-B-06 |
| `POST /api/users` | US-B-07, US-B-08 |
| `GET /api/users/:id` | US-B-09 |
| `PUT /api/users/:id` | US-B-10, US-RBAC-01 |
| `DELETE /api/users/:id` | US-B-11 |
| `POST /api/users/:id/reset-password` | US-B-14 |
| `POST /api/users/:id/roles` | US-B-13, US-RBAC-04 |
| `GET /api/roles` | US-C-01 |
| `POST /api/roles` | US-C-02 |
| `GET /api/roles/:id` | US-C-01 |
| `PUT /api/roles/:id` | US-C-03, US-RBAC-02 |
| `DELETE /api/roles/:id` | US-C-04, US-RBAC-02 |
| `GET /api/roles/:id/permissions` | US-C-05 |
| `PUT /api/roles/:id/permissions` | US-C-05, US-RBAC-03 |
| `GET /api/roles/:id/data-scopes` | US-C-07, US-CROSS-07 |
| `PUT /api/roles/:id/data-scopes` | US-C-07, US-CROSS-07 |
| `GET /api/roles/:id/clients` | US-C-06 |
| `PUT /api/roles/:id/clients` | US-C-06 |
| `GET /api/permissions` | US-D-01 |
| `POST /api/permissions` | US-D-02 |
| `PUT /api/permissions/:id` | US-D-03 |
| `DELETE /api/permissions/:id` | US-D-04, US-RBAC-03 |
| `GET /api/departments` | US-F-01 |
| `POST /api/departments` | US-F-02 |
| `GET /api/departments/:id` | US-F-01 |
| `PUT /api/departments/:id` | US-F-03 |
| `DELETE /api/departments/:id` | US-F-04 |
| `GET /api/clients` | US-G-01 |
| `POST /api/clients` | US-G-02 |
| `GET /api/clients/:id` | US-G-01 |
| `PUT /api/clients/:id` | US-G-03 |
| `DELETE /api/clients/:id` | US-G-04 |
| `POST /api/clients/:id/secret` | US-G-07 |
| `GET /api/audit/logs` | US-AUDIT-01, US-CROSS-06 |
| `GET /api/audit/login-logs` | US-AUDIT-03 |
| `GET /api/auth/.well-known/openid-configuration` | US-OIDC-01 |
| `GET /api/auth/jwks` | US-OIDC-02, US-CROSS-04 |
| `GET /api/auth/oauth2/userinfo` | US-OIDC-03 |
| `POST /api/auth/oauth2/introspect` | US-OIDC-04 |
| `POST /api/auth/oauth2/revoke` | US-OIDC-09, US-H-SSO-06 |
| `POST /api/auth/sign-out-sso` | US-H-SSO-04, US-H-SSO-05, US-H-SSO-06 |
