# User Stories - Auth-SSO

Version: v1.0
Status: Released
Related Specs: REQUIREMENTS_MATRIX.md, PRD.md, API.md, ARCHITECTURE.md, DATABASE.md

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

| 用户 | 部门 | 角色 | DataScope | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| **张三** | 总部 | `super_admin` | `ALL` | 超级管理员，拥有全部权限 |
| **李四** | 技术部 | `org_admin` | `DEPT_AND_SUB` | 组织管理员，管理技术部及子部门 |
| **王五** | 产品部 | `dept_manager` | `DEPT` | 部门经理，仅管理产品部 |
| **赵六** | 后端组 | `employee` | `SELF` | 普通员工，仅查看自身数据 |
| **孙七** | 总部 | `app_admin` | `ALL` | 应用管理员，仅管理 OAuth 客户端 |
| **周八** | 运营部 | `audit_viewer` | `SELF` | 审计员，仅查看审计/登录日志 |
| **吴九** | 前端组 | _(无角色)_ | — | 新入职员工，无任何权限 |
| **陈十** | 产品部 | `employee`（DISABLED） | `SELF` | 已禁用账户，不可登录 |

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
| **demo-app** | `http://localhost:4002/api/auth/callback` | 全部角色 | ACTIVE |
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
2. 数据范围遵循用户 DataScope：张三看到全公司数据，李四看到技术部及子部门数据，王五只看到产品部数据
3. 无 `system:view_dashboard` 权限的用户（如吴九）看不到仪表盘

---

## 3. 模块 B：用户管理 (User Management)

### US-B-01：超级管理员查看全部用户列表

> **@req B-USR-L** | **权限:** `user:list` | **DataScope:** `ALL`

**作为** 拥有 `super_admin` 角色（DataScope: ALL）的张三，
**我** 访问用户管理页面时看到公司所有用户（包括总部、技术部、前端组、后端组、产品部、运营部的全部成员），
**以便** 我能全局管理所有用户。

**验收标准：**
1. 用户列表分页展示，默认每页 20 条
2. 列表列包含：用户名、姓名、邮箱、部门、角色、状态、操作
3. 数据不受部门限制，可看到所有部门的用户

---

### US-B-02：组织管理员查看本部门及子部门用户

> **@req B-USR-L** | **权限:** `user:list` | **DataScope:** `DEPT_AND_SUB`

**作为** 拥有 `org_admin` 角色（DataScope: DEPT_AND_SUB）的李四（隶属技术部），
**我** 访问用户管理页面时仅看到技术部及其子部门（前端组、后端组）的用户，
**以便** 我在职责范围内管理用户，不会看到产品部或运营部的用户。

**验收标准：**
1. 列表仅展示技术部、前端组、后端组的用户（赵六在列）
2. 总部、产品部、运营部的用户（王五、周八等）不出现在列表中
3. 调用 `GET /api/users` 返回数据已按 DataScope 过滤

---

### US-B-03：部门经理仅查看本部门用户

> **@req B-USR-L** | **权限:** `user:list` | **DataScope:** `DEPT`

**作为** 拥有 `dept_manager` 角色（DataScope: DEPT）的王五（隶属产品部），
**我** 访问用户管理页面时仅看到产品部的直属用户（不包含子部门），
**以便** 我管理本部门成员。

**验收标准：**
1. 列表仅展示产品部直属用户
2. 不展示其他部门（总部、技术部等）的用户

---

### US-B-04：普通员工仅查看自己

> **@req B-USR-L** | **权限:** `user:list` | **DataScope:** `SELF`

**作为** 拥有 `employee` 角色（DataScope: SELF）的赵六，
**我** 访问用户管理页面时仅看到自己一条记录，
**以便** 我能查看自己的信息但无法浏览其他同事。

**验收标准：**
1. 列表仅展示赵六本人
2. 即使使用搜索功能也无法查到其他用户

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
3. 搜索结果仍受 DataScope 约束（李四搜索时只返回技术部及子部门的匹配用户）

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
4. Portal OIDC Provider 同步创建对应身份记录（共享 DB 模式下自动完成）
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
2. 访问不在 DataScope 范围内的用户详情时返回 404（如李四访问产品部王五的详情）
3. 用户资料包含 `public_id` 而非内部 `id`

---

### US-B-10：更新用户资料

> **@req B-USR-U** | **权限:** `user:update`

**作为** 拥有 `super_admin` 角色的张三，
**我** 在赵六的详情页点击「编辑」，修改其邮箱和部门（从后端组调到前端组）后保存，
**以便** 用户资料保持最新。

**验收标准：**
1. 修改保存成功后详情页即时刷新
2. 部门变更后，DataScope 为 DEPT 的管理者列表自动反映变化
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
2. 陈十状态为 DISABLED 时尝试登录，Portal OIDC Provider 拒绝认证并返回错误
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
3. 赵六的 DataScope 更新为 `DEPT`（跟随 `dept_manager` 角色的配置）
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
1. 角色列表展示：角色名称、Code、描述、DataScope 类型、关联用户数
2. 李四（org_admin）和赵六（employee）也能看到角色列表（有 `role:list`）
3. 吴九（无角色）无法访问角色列表页面

---

### US-C-02：新建角色（含 Code 和 DataScope）

> **@req C-ROL-C** | **权限:** `role:create`

**作为** 拥有 `super_admin` 角色的张三，
**我** 点击「新建角色」，在对话框中填写角色名称「项目经理」、Code `project_manager`、描述、DataScope 选择 `DEPT_AND_SUB`，
**以便** 为项目管理岗位创建专属角色。

**验收标准：**
1. 对话框包含：角色名称（必填）、Code（必填，唯一）、描述（选填）、DataScope 类型下拉
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
3. 王五登录 ERP 时 Portal OIDC Provider 授权端点校验通过
4. 取消勾选后王五登录 ERP 时被 Portal OIDC Provider 拒绝（G-SEC-INT）

---

### US-C-07：修改角色的 DataScope 配置

> **@req C-ROL-DS** | **权限:** `role:update`

**作为** 拥有 `super_admin` 角色的张三，
**我** 将 `dept_manager` 角色的 DataScope 从 `DEPT` 修改为 `DEPT_AND_SUB`，
**以便** 部门经理能管理子部门用户。

**验收标准：**
1. DataScope 下拉包含：`ALL`、`DEPT`、`DEPT_AND_SUB`、`SELF`、`CUSTOM`
2. 选择 `CUSTOM` 时弹出部门选择器，可勾选多个部门
3. 修改保存后，拥有该角色用户的 API 查询结果范围立即变更
4. 王五（dept_manager）下次查询用户列表时能看到产品部及其子部门的用户

---

## 5. 模块 D：权限标识维护 (Permission Registry)

### US-D-01：查看权限分类列表

> **@req D-PRM-L** | **权限:** `permission:list`

**作为** 拥有 `super_admin` 角色的张三，
**我** 访问权限管理页面，看到按类型（MENU/API/DATA）分组的所有权限 Code，
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
1. 对话框包含：Code（必填，唯一）、名称（必填）、类型（MENU/API/DATA）、描述
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
**我** 访问客户端管理页面，看到所有 OAuth 客户端（demo-app、erp-app、crm-app、disabled-app），
**以便** 我了解和管理接入的应用。

**验收标准：**
1. 列表展示：客户端名称、Client ID、Redirect URI、授权角色、状态、创建时间
2. 孙七能看到完整的客户端列表（DataScope: ALL）
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
**我** 修改 `demo-app` 的 Redirect URI 从 `http://localhost:4002/callback` 改为 `http://localhost:4002/api/auth/callback`，
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
**我** 尝试通过 SSO 登录 ERP 系统时，Portal OIDC Provider 授权端点拒绝请求并显示「您没有权限访问该应用」，
**以便** 未授权用户无法登录不属于自己的系统。

**验收标准：**
1. 赵六访问 ERP → ERP 重定向到 Portal OIDC Provider → Portal OIDC Provider 校验赵六角色 `employee` 不在 `erp-app` 授权角色列表中 → 拒绝
2. 返回错误页面：「无权访问该应用，请联系管理员」
3. 张三（super_admin）和王五（dept_manager）可以正常登录 ERP（在授权角色列表中）
4. 陈十（DISABLED）尝试任何应用登录时被 Portal OIDC Provider 直接拒绝（账户状态校验优先于角色校验）

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

### US-H-AUTH-01：未登录用户首次访问跳转到 Portal OIDC Provider

> **@req H-AUTH-001**

**作为** 未登录的吴九，
**我** 在浏览器输入 `https://portal.example.com/admin/users` 时被自动重定向到 Portal OIDC Provider 登录页，
**以便** 我完成身份认证后才能访问受保护页面。

**验收标准：**
1. Portal BFF 检测到无 `portal_jwt_token` Cookie
2. 重定向到 `/api/auth/login`，生成 PKCE 参数并存储到 HttpOnly Cookie
3. 浏览器最终跳转到 Portal OIDC Provider `/authorize` 端点，展示登录表单
4. 登录成功后重定向回原始请求的页面 `/admin/users`

---

### US-H-AUTH-02：OAuth 授权码获取

> **@req H-AUTH-002**

**作为** 在 Portal OIDC Provider 登录页输入正确凭证的张三，
**我** 提交用户名和密码后被重定向回 Portal 并携带 `code` 参数，
**以便** Portal BFF 用授权码换取 Token。

**验收标准：**
1. Portal OIDC Provider 验证凭证成功
2. 重定向到 Portal `/api/auth/callback?code=xxx&state=yyy`
3. URL 中的 `state` 与 Cookie 中存储的 `state` 一致

---

### US-H-AUTH-03：Token 交换（Back-Channel）

> **@req H-AUTH-003**

**作为** Portal BFF（服务端），
**在** 收到 Portal OIDC Provider 回调的 `code` 参数后，
**通过** Back-Channel（服务端到服务端）向 Portal OIDC Provider `/token` 端点发送 `code` + `code_verifier` + `client_id` + `client_secret`，
**换取** `access_token`（ES256 JWT）和 `refresh_token`。

**验收标准：**
1. Token 请求使用 HTTPS，参数包含 `grant_type=authorization_code`
2. Portal OIDC Provider 验证 `code_verifier` 与之前存储的 `code_challenge` 匹配（S256）
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
**当** Portal OIDC Provider 回调携带的 `state` 参数与 Cookie 中存储的 `state` 完全匹配时，
**登录** 成功完成。

**验收标准：**
1. `/api/auth/login` 生成的 `state` 存入 HttpOnly Cookie
2. Portal OIDC Provider 回调 URL 中的 `state` 与 Cookie 一致
3. Portal BFF 验证通过后继续 Token 交换流程
4. 验证后清除 state Cookie

---

### US-H-AUTH-07：State 验证 — 篡改

> **@req H-AUTH-011**

**作为** 攻击者，
**我** 篡改 Portal OIDC Provider 回调 URL 中的 `state` 参数为 `malicious_state`，
**结果** Portal BFF 检测到 state 不匹配，返回 `invalid_state` 错误。

**验收标准：**
1. 篡改后的 `state` 与 Cookie 不匹配
2. Portal BFF 返回错误：`{ "code": "invalid_state", "message": "State parameter mismatch" }`
3. 不执行 Token 交换
4. 清除所有认证相关 Cookie

---

### US-H-AUTH-08：State 过期

> **@req H-AUTH-012**

**作为** 在 Portal OIDC Provider 登录页停留超过 10 分钟的赵六，
**当** 赵六完成登录后 Portal OIDC Provider 回调到 Portal 时，
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
2. `code_verifier` 存入 HttpOnly Cookie，`code_challenge` 作为参数发送给 Portal OIDC Provider
3. Token 交换时 Portal BFF 发送 `code_verifier`，Portal OIDC Provider 验证其 SHA256 与 `code_challenge` 匹配
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
3. Portal OIDC Provider 将 `nonce` 写入 ID Token 的 `nonce` claim
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
**然后** 被重定向到 Portal OIDC Provider 登录页重新认证。

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
4. 用户看到 Portal OIDC Provider 登录页，需要重新输入凭证

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

### US-H-SSO-01：Portal 已登录 → Demo App 免登

> **@req H-SSO-001**

**作为** 已在 Portal 登录的张三，
**我** 在新标签页访问 Demo App（`http://localhost:4002`），
**Demo App** 自动完成 SSO 认证，无需重新输入凭证。

**验收标准：**
1. Demo App 检测未登录 → 重定向到 Portal OIDC Provider `/authorize`
2. 浏览器携带 `better-auth.session_token` Cookie 到 Portal OIDC Provider
3. Portal OIDC Provider 识别已有 session → 跳过登录 UI → 重定向回 Demo App 携带 `code`
4. Demo App 用 `code` 换取 Token → 用户自动登录
5. 全程无需输入密码

---

### US-H-SSO-02：Demo App 已登录 → Portal 免登

> **@req H-SSO-002**

**作为** 已在 Demo App 登录的李四，
**我** 在新标签页访问 Portal（`http://localhost:4000`），
**Portal** 自动完成认证，无需重新登录。

**验收标准：**
1. Portal 检测无 `portal_jwt_token` → 重定向到 Portal OIDC Provider `/authorize`
2. Portal OIDC Provider 识别已有 session → 重定向回 Portal 携带 `code`
3. Portal BFF 用 `code` 换取 Token → 写入 `portal_jwt_token` Cookie
4. 李四自动登录到 Portal 仪表盘
5. 全程无需输入密码

---

### US-H-SSO-03：未登录访问受保护应用

> **@req H-SSO-003**

**作为** 未在任何应用登录的吴九，
**我** 访问 Demo App 时被重定向到 Portal OIDC Provider 登录页，
**以便** 完成身份认证。

**验收标准：**
1. Demo App → Portal OIDC Provider `/authorize` → Portal OIDC Provider 无 session → 展示登录表单
2. 吴九输入凭证后完成认证
3. 但因吴九无任何角色，Demo App 需根据自身业务决定是否允许访问

---

### US-H-SSO-04：Portal 登出联动 Demo App

> **@req H-SSO-010**

**作为** 同时在 Portal 和 Demo App 登录的张三，
**我** 在 Portal 点击「退出登录」后，
**两个** 应用都需重新登录。

**验收标准：**
1. Portal 登出流程：
   - JWT jti 写入 Redis 黑名单
   - Refresh Token 在 Portal OIDC Provider 侧撤销
   - 清除 `portal_jwt_token` 和 `portal_refresh_token` Cookie
   - 调用 Portal OIDC Provider `/api/auth/sign-out-sso` 清除 Portal OIDC Provider Session
2. 张三再访问 Demo App → Demo App 重定向到 Portal OIDC Provider → Portal OIDC Provider 无 session → 展示登录表单
3. 两个应用均需重新认证

---

### US-H-SSO-05：Demo App 登出联动 Portal

> **@req H-SSO-011**

**作为** 同时在 Portal 和 Demo App 登录的李四，
**我** 在 Demo App 点击「退出登录」后，
**Portal** 也需重新登录。

**验收标准：**
1. Demo App 登出时调用 Portal OIDC Provider `/api/auth/sign-out-sso`
2. Portal OIDC Provider Session 被清除
3. 李四再访问 Portal → Portal 检测 `portal_jwt_token` 虽仍存在但刷新时失败（Portal OIDC Provider session 已清除）
4. 李四被重定向到 Portal OIDC Provider 登录页

---

### US-H-SSO-06：Portal OIDC Provider Session 清除

> **@req H-SSO-020**

**作为** 执行登出操作的张三，
**Portal OIDC Provider Session** 被同步清除（Redis 中 `auth-sso:{sessionToken}` 键被删除）。

**验收标准：**
1. Portal 调用 `POST /api/auth/logout` 后：
   - JWT jti 写入 Redis 黑名单 `portal:jti_blocklist:{jti}`
   - Refresh Token 撤销（Portal OIDC Provider `/oauth2/revoke`）
   - Portal OIDC Provider Session 清除（`POST /api/auth/sign-out-sso` → Redis 删除 `auth-sso:{sessionToken}`）
2. 所有认证状态被彻底清除

---

### US-H-SSO-07：登出后受保护页面拦截

> **@req H-SSO-021**

**作为** 刚登出的张三，
**我** 尝试访问 `/admin/users` 时被重定向到 Portal OIDC Provider 登录页，
**以便** 确保登出后无法绕过认证。

**验收标准：**
1. 无 `portal_jwt_token` Cookie → Portal BFF 检测未认证
2. 重定向到 `/api/auth/login` → Portal OIDC Provider 登录页
3. 不会展示任何受保护页面内容

---

### US-H-SSO-08：登出后重新登录

> **@req H-SSO-022**

**作为** 刚登出的李四，
**我** 需要重新输入用户名和密码才能完成 Portal OIDC Provider 认证，
**以便** 重新获得系统访问权限。

**验收标准：**
1. Portal OIDC Provider 登录页展示用户名/密码表单
2. 不自动填充或跳过认证（Portal OIDC Provider Session 已清除）
3. 认证成功后重新建立完整的 Session 链

---

## 10. 跨模块权限校验故事

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
2. DataScope 取权限最大的角色值（`DEPT_AND_SUB`）
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
**我** 尝试在 Portal OIDC Provider 登录页输入正确凭证时，
**Portal OIDC Provider** 拒绝认证并返回错误。

**验收标准：**
1. Portal OIDC Provider 验证凭证正确但检查到用户状态为 DISABLED
2. 返回错误：「账户已被禁用，请联系管理员」
3. 不颁发任何 Token
4. 不创建 Portal OIDC Provider Session

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

### US-CROSS-07：DataScope CUSTOM 自定义部门

**作为** 拥有 `super_admin` 角色的张三，
**我** 创建一个新角色「跨部门协调员」，DataScope 选择 `CUSTOM`，并勾选「技术部」和「产品部」，
**以便** 拥有该角色的用户能同时看到两个部门的用户。

**验收标准：**
1. DataScope 选择 `CUSTOM` 时展示部门选择器
2. 可勾选多个任意部门（不限于当前用户的部门范围）
3. 拥有该角色的用户查询用户列表时，结果包含所选部门的用户
4. 存储到 `role_departments` 关联表

---

## 11. 需求追溯矩阵

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
| **C-ROL-D** | US-C-04 |
| **C-ROL-PA** | US-C-05 |
| **C-ROL-CA** | US-C-06 |
| **C-ROL-DS** | US-C-07 |
| **D-PRM-L** | US-D-01 |
| **D-PRM-C** | US-D-02 |
| **D-PRM-U** | US-D-03 |
| **D-PRM-D** | US-D-04 |
| **E-MNU-L** | US-E-01 |
| **E-MNU-C** | US-E-02 |
| **E-MNU-U** | US-E-03, US-E-05 |
| **E-MNU-D** | US-E-04 |
| **E-MNU-PB** | US-E-05 |
| **F-DEP-L** | US-F-01 |
| **F-DEP-C** | US-F-02 |
| **F-DEP-U** | US-F-03 |
| **F-DEP-D** | US-F-04 |
| **G-CLT-L** | US-G-01 |
| **G-CLT-C** | US-G-02 |
| **G-CLT-U** | US-G-03, US-G-07 |
| **G-CLT-D** | US-G-04 |
| **G-SEC-INT** | US-G-05, US-G-06 |
| **H-AUTH-001** | US-H-AUTH-01 |
| **H-AUTH-002** | US-H-AUTH-02 |
| **H-AUTH-003** | US-H-AUTH-03 |
| **H-AUTH-004** | US-H-AUTH-04 |
| **H-AUTH-005** | US-H-AUTH-05 |
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

---

## 12. 权限代码覆盖矩阵

| 权限代码 | 覆盖的用户故事 |
| :--- | :--- |
| `user:list` | US-B-01, US-B-02, US-B-03, US-B-04, US-B-05, US-B-06 |
| `user:create` | US-B-07, US-B-08 |
| `user:read` | US-B-09 |
| `user:update` | US-B-10, US-B-12 |
| `user:delete` | US-B-11 |
| `user:manage` | US-B-01 (隐含) |
| `user:reset_password` | US-B-14 |
| `user:assign_role` | US-B-13 |
| `department:list` | US-F-01 |
| `department:create` | US-F-02 |
| `department:read` | US-F-01 |
| `department:update` | US-F-03 |
| `department:delete` | US-F-04 |
| `department:manage` | US-F-01 (隐含) |
| `role:list` | US-C-01 |
| `role:create` | US-C-02 |
| `role:read` | US-C-01 |
| `role:update` | US-C-03, US-C-06, US-C-07 |
| `role:delete` | US-C-04 |
| `role:manage` | US-C-01 (隐含) |
| `role:assign_permission` | US-C-05 |
| `permission:list` | US-D-01 |
| `permission:create` | US-D-02 |
| `permission:read` | US-D-01 |
| `permission:update` | US-D-03 |
| `permission:delete` | US-D-04 |
| `permission:manage` | US-D-01 (隐含) |
| `menu:list` | US-E-01 |
| `menu:create` | US-E-02 |
| `menu:read` | US-E-01 |
| `menu:update` | US-E-03, US-E-05 |
| `menu:delete` | US-E-04 |
| `menu:manage` | US-E-01 (隐含) |
| `client:list` | US-G-01 |
| `client:create` | US-G-02 |
| `client:read` | US-G-01 |
| `client:update` | US-G-03 |
| `client:delete` | US-G-04 |
| `client:manage` | US-G-01 (隐含) |
| `client:rotate_secret` | US-G-07 |
| `audit:read` | US-CROSS-06 |
| `audit:export` | US-CROSS-06 |
| `login_log:read` | _(审计员角色相关)_ |
| `login_log:export` | _(审计员角色相关)_ |
| `system:manage` | US-A-01 (隐含) |
| `system:view_dashboard` | US-A-05 |
| `customer_graph:view` | _(客户关系图相关)_ |
| `customer_graph:export` | _(客户关系图相关)_ |
