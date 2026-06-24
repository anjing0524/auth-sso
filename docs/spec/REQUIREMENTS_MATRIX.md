# Auth-SSO 生产级功能需求追踪矩阵 (Final RTM)

## 模块 A: 门户底座 (Portal Infrastructure)
| ID | 需求点 | 验收标准 |
| :--- | :--- | :--- |
| **A-NAV-01** | 侧边栏动态渲染 | 根据登录用户权限展示菜单。 |
| **A-NAV-02** | 智能面包屑 | 路径准确，支持导航回溯。 |
| **A-NAV-03** | 指标卡片看板 | 首页数据概览加载正常。 |

## 模块 B: 用户管理 (User Management)
| ID | 需求点 | 验收标准 |
| :--- | :--- | :--- |
| **B-USR-L** | 用户分页列表 | 查看所有用户，支持分页展示。 |
| **B-USR-S** | 用户实时搜索 | 按名称/邮箱/账号过滤。 |
| **B-USR-C** | 新建用户 (Dialog) | 通过对话框创建用户。 |
| **B-USR-R** | 用户详情查看 | 进入 /users/[id] 查看详细资料。 |
| **B-USR-U** | 用户资料更新 | 修改资料并保存。 |
| **B-USR-D** | 用户逻辑删除 | 二次确认删除逻辑。 |
| **B-USR-ST** | 账户状态控制 | 锁定/激活/禁用账户。 |
| **B-LOG-L** | 审计与登录日志列表 | 支持分页展示操作审计日志与用户登录日志，支持基础过滤检索。 |
| **B-LOG-D** | 审计与登录日志详情 | 支持展示特定操作日志的详细变更参数、IP 地址、客户端 UA 及错误原因。 |

## 模块 C: 角色与授权 (Role & Authorization)
| ID | 需求点 | 验收标准 |
| :--- | :--- | :--- |
| **C-ROL-L** | 角色列表 | 查看所有系统角色。 |
| **C-ROL-C** | 新建角色 (Dialog) | 包含 Code 和数据范围选择。 |
| **C-ROL-U** | 角色编辑 | 修改角色名称和描述。 |
| **C-ROL-D** | 角色删除 | 二次确认删除角色。 |
| **C-ROL-PA** | 功能权限授予 | 勾选 API/菜单权限并保存。 |
| **C-ROL-CA** | 应用授权控制 | 控制子系统登录权限。 |
| **C-ROL-DS** | 数据沙箱配置 | 修改角色的 DataScopeType。 |
| **D-ROLE-C** | 角色领域模型创建 | 领域层 Role 实体的构建校验，必须包含唯一的 Role Code 与合法的状态。 |
| **D-ROLE-U** | 角色领域模型更新 | 领域层 Role 属性（名称、描述、数据范围）修改的校验与状态变化控制。 |
| **D-ROLE-D** | 角色领域模型删除 | 领域层 Role 销毁及关联解绑的校验（防孤儿关系）。 |
| **SCOPE-001** | 数据范围 - 全局 (ALL) | 允许跨所有部门查询所有数据。 |
| **SCOPE-002** | 数据范围 - 本部门 (DEPT) | 限制仅能访问当前用户所属部门的数据。 |
| **SCOPE-003** | 数据范围 - 本部门及子部门 | 限制能访问所属部门及其所有下属子部门的数据。 |
| **SCOPE-004** | 数据范围 - 仅个人 (SELF) | 限制仅能查询和修改当前用户自身的数据。 |
| **SCOPE-005** | 数据范围 - 自定义 (CUSTOM) | 限制仅能访问显式关联绑定并写入 role_departments 关联表的部门数据。 |
| **RBAC-ADMIN-FULL-ACCESS** | 管理员全权限访问 | 拥有 admin/super_admin 角色的账户可访问所有系统管理路由及写操作。 |
| **RBAC-RESTRICTED-API** | 受限角色权限拦截 | 普通员工尝试访问没有权限的页面或发送 API 请求时被 403 拦截。 |
| **RBAC-UNAUTHORIZED** | 跨部门越权访问拦截 | 部门经理尝试通过 API 或 URL 越权访问其他部门的数据时被拦截。 |

## 模块 D: 权限标识维护 (Permission Registry)
| ID | 需求点 | 验收标准 |
| :--- | :--- | :--- |
| **D-PRM-L** | 权限分类列表 | 按类型展示权限 Code。 |
| **D-PRM-C** | 新增权限 (Dialog) | 注册新的权限标识。 |
| **D-PRM-U** | 编辑权限 (Dialog) | 修改已有权限标识。 |
| **D-PRM-D** | 删除权限 (Confirm) | 移除权限标识。 |

## 模块 E: 菜单架构管理 (Menu Management)
| ID | 需求点 | 验收标准 |
| :--- | :--- | :--- |
| **E-MNU-L** | 树形菜单列表 | 结构化展示菜单层级。 |
| **E-MNU-C** | 新建菜单 (Dialog) | 创建节点，支持父级指定。 |
| **E-MNU-U** | 菜单属性编辑 | 修改路径、排序、显隐。 |
| **E-MNU-D** | 菜单项移除 | 递归清理菜单节点。 |
| **E-MNU-PB** | 权限标识绑定 | 将菜单项与权限 Code 关联。 |
| **D-MEN-C** | 菜单领域模型创建 | 领域层 Menu 实体的构建校验，路径格式检查以及类型约束。 |
| **D-MEN-U** | 菜单领域模型更新 | 领域层 Menu 属性（路由、排序值、父级菜单、权限代码绑定）修改的校验。 |
| **D-MEN-D** | 菜单领域模型删除 | 领域层 Menu 删除以及对其所有下级子菜单的递归清理和级联关系解绑校验。 |

## 模块 F: 组织架构 (Department Management)
| ID | 需求点 | 验收标准 |
| :--- | :--- | :--- |
| **F-DEP-L** | 架构地图展示 | 查看部门组织树。 |
| **F-DEP-C** | 部门创建 | 新增子部门节点。 |
| **F-DEP-U** | 部门信息修改 | 修改部门名称或编码。 |
| **F-DEP-D** | 部门节点删除 | 移除部门节点。 |
| **F-DEP-E** | 部门属性与父级编辑 | 支持调整部门节点的属性及其在树形结构中的父级关系。 |
| **F-DEP-M** | 部门成员关系查询 | 支持获取和维护属于特定部门的成员列表。 |
| **D-DEPT-C** | 部门领域模型创建 | 领域层 Department 实体的构建，校验部门编码唯一性及上级部门存在性。 |
| **D-DEPT-U** | 部门领域模型更新 | 领域层 Department 属性修改时的闭环依赖校验（防循环依赖）。 |
| **D-DEPT-D** | 部门领域模型注销 | 领域层 Department 注销的校验，如果存在下属子部门或仍有绑定用户，拒绝直接物理删除。 |

## 模块 G: 应用与安全 (OAuth & Security)
| ID | 需求点 | 验收标准 |
| :--- | :--- | :--- |
| **G-CLT-L** | 客户端列表 | 查看接入的 OAuth 应用。 |
| **G-CLT-C** | 客户端注册 | 创建新的 Client。 |
| **G-CLT-U** | 配置更新 | 修改 Redirect URIs 等参数。 |
| **G-CLT-D** | 应用注销 | 彻底移除应用接入。 |
| **D-CLI-C** | 客户端领域模型创建 | 领域层 Client 实体的构建校验，包括 Secret 自动强生成及 Hash 规则，重定向 URL 白名单约束。 |
| **D-CLI-U** | 客户端领域模型更新 | 领域层 Client 属性修改时的安全白名单校验。 |
| **D-CLI-D** | 客户端领域模型注销 | 领域层 Client 的彻底停用和销毁逻辑，级联清理所有已签发的 Token。 |
| **G-SEC-INT** | SSO 强拦截 | **(安全核心)** 未授权禁止登录。 |
| **AUTH-003** | API 鉴权拦截器 (放行) | 后端 API Route Handler 在 JWT 校验和权限匹配通过时允许访问。 |
| **AUTH-004** | API 鉴权拦截器 (401 拦截) | 后端 API Route Handler 在 JWT Cookie 缺失或验签失败时返回 401。 |
| **AUTH-005** | API 鉴权拦截器 (403 拦截) | 后端 API Route Handler 在权限不足时返回 403。 |
| **AUTH-006** | 组合权限校验 (All 模式) | 鉴权逻辑支持 requireAll 模式，必须拥有所有指定权限才放行。 |

## 模块 H: 认证与身份生命周期 (Authentication & Session)

### H-AUTH: OAuth 2.1 认证流程

| ID | 需求点 | 验收标准 |
| :--- | :--- | :--- |
| H-AUTH-001 | 首次登录跳转 | [已废弃 - 独立 IDP 已清理] 未登录访问受保护页面时自动跳转到 IdP 登录页 |
| H-AUTH-002 | OAuth 授权码获取 | [已废弃 - 独立 IDP 已清理] 输入正确凭证后跳转回 Portal 并携带 code 参数 |
| H-AUTH-003 | Token 交换 | [已废弃 - 独立 IDP 已清理] Portal BFF 通过 Back-Channel 用授权码换取 access_token (ES256 JWT) 和 refresh_token |
| H-AUTH-004 | JWT Cookie 写入 | [已废弃 - 独立 IDP 已清理] Token 交换成功后 `portal_jwt_token` HttpOnly Cookie 被正确设置，包含有效 JWT |
| H-AUTH-005 | Cookie 安全设置 | [已废弃 - 独立 IDP 已清理] `portal_jwt_token` Cookie 正确设置 HttpOnly、Secure (生产环境)、SameSite=Lax 属性 |
| H-AUTH-010 | State 验证 — 正确 | [已废弃 - 独立 IDP 已清理] 正常登录流程中 state 与 Cookie 中存储的 state 匹配，登录成功 |
| H-AUTH-011 | State 验证 — 错误 | [已废弃 - 独立 IDP 已清理] 篡改 URL 中的 state 返回 invalid_state 错误 |
| H-AUTH-012 | State 过期 | [已废弃 - 独立 IDP 已清理] 登录流程暂停超过 10 分钟后 state Cookie 过期，返回 invalid_state 错误 |
| H-AUTH-013 | PKCE 验证 | [已废弃 - 独立 IDP 已清理] Token 请求中包含 code_verifier 参数，IdP 验证 code_challenge (S256) |
| H-AUTH-014 | Nonce 生成与验证 | [已废弃 - 独立 IDP 已清理] 授权 URL 中包含 nonce 参数，回调时校验 ID Token 中的 nonce 匹配 |
| **AUTH-FLOW-HAPPY** | E2E 登录成功全流程 | 用户在 IdP 输入正确凭证后成功登录，自动重定向到 Portal 首页并渲染侧边栏。 |
| **AUTH-FLOW-LOGOUT** | E2E 登出全流程 | 用户在 Portal 点击登出，清除 Cookie 缓存，再次访问受保护页面重定向到登录页。 |
| **AUTH-FLOW-WRONG-PASSWORD** | E2E 登录失败提示 | 输入错误密码时，前端登录页面显示相应的红色错误气泡或提示。 |
| **AUTH-FLOW-PROTECTED-REDIRECT** | E2E 路由重定向保护 | 未登录用户直接访问受保护页面，自动拦截并重定向到登录页，登录后可跳回原页面。 |

### H-SESS: Portal JWT Cookie 生命周期

| ID | 需求点 | 验收标准 |
| :--- | :--- | :--- |
| H-SESS-001 | JWT Cookie 存在 | [已废弃 - 独立 IDP 已清理] 登录成功后浏览器持有 `portal_jwt_token` HttpOnly Cookie 且包含有效 JWT |
| H-SESS-002 | JWT Claims 完整性 | [已废弃 - 独立 IDP 已清理] JWT claims 包含 sub (用户ID)、iss (签发者)、exp (过期时间)、jti (唯一标识)、roles、permissions |
| H-SESS-003 | JWT 过期时间 | [已废弃 - 独立 IDP 已清理] JWT exp 为签发时间 + 1 小时（IdP 配置） |
| H-SESS-010 | Access Token 过期处理 | [已废弃 - 独立 IDP 已清理] Access Token (1h) 过期后 API 返回 401，前端通过 Refresh Token 静默续签 |
| H-SESS-011 | Refresh Token 过期 | [已废弃 - 独立 IDP 已清理] Refresh Token 7 天过期后需重新走完整登录流程 |
| H-SESS-012 | 前端静默续签 | [已废弃 - 独立 IDP 已清理] Access Token 过期前 5 分钟，前端自动调用 /api/auth/refresh 换取新 Token 并更新 Cookie |
| H-SESS-020 | Token 即将过期自动刷新 | [已废弃 - 独立 IDP 已清理] Access Token 剩余有效期 < 5 分钟时前端触发静默刷新 |
| H-SESS-021 | Token 刷新成功 | [已废弃 - 独立 IDP 已清理] 刷新后 `portal_jwt_token` Cookie 被更新为新的 JWT |
| H-SESS-022 | Token 刷新失败处理 | [已废弃 - 独立 IDP 已清理] Refresh Token 失效时清除所有 Cookie 并重定向到登录页 |
| H-SESS-030 | jti 紧急撤销 | [已废弃 - 独立 IDP 已清理] 登出或封禁时 JWT 的 jti 写入 Redis 黑名单 (TTL = Token 剩余有效期)，后续请求返回 401 |

### H-SSO: 单点登录/登出

| ID | 需求点 | 验收标准 |
| :--- | :--- | :--- |
| H-SSO-001 | Portal 登录后 Demo 免登 | [已废弃 - 独立 Demo App 已清理] Portal 已登录时 Demo App 自动完成 SSO 认证 |
| H-SSO-002 | Demo 登录后 Portal 免登 | [已废弃 - 独立 Demo App 已清理] Demo App 已登录时 Portal 自动完成认证 |
| H-SSO-003 | 未登录访问受保护应用 | [已废弃 - 独立 IDP 已清理] 未在任何应用登录时跳转到 IdP 登录页 |
| H-SSO-010 | Portal 登出联动 Demo | [已废弃 - 独立 Demo App 已清理] Portal 登出后 Demo App 也需重新登录 |
| H-SSO-011 | Demo 登出联动 Portal | [已废弃 - 独立 Demo App 已清理] Demo App 登出后 Portal 也需重新登录 |
| H-SSO-020 | IdP Session 清除 | [已废弃 - 独立 IDP 已清理] Portal 登出时 IdP Session 同步清除 (jti 黑名单 + Refresh Token 撤销) |
| H-SSO-021 | 登出后受保护页拦截 | [已废弃 - 独立 IDP 已清理] 登出后访问受保护页面重定向到登录页 |
| H-SSO-022 | 登出后重新登录 | [已废弃 - 独立 IDP 已清理] 登出后需要重新输入凭证完成 IdP 认证 |
| SSO-CROSS-APP | 跨应用单点免登 | [已废弃 - 独立 Demo App 已清理] Portal 登录后，Demo App 无需输入密码自动建立 Session 登录。 |
| SSO-DIRECT-ACCESS | 免登直接访问 | [已废弃 - 独立 Demo App 已清理] 演示应用识别到 Portal 活动会话后，直接放行访问无需重复认证。 |
| SSO-LOGOUT-PROPAGATION | 单点登出联动 | [已废弃 - 独立 Demo App 已清理] 任何一个应用（如 Portal）登出后，其他关联应用的会话自动失效。 |
