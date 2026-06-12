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

## 模块 F: 组织架构 (Department Management)
| ID | 需求点 | 验收标准 |
| :--- | :--- | :--- |
| **F-DEP-L** | 架构地图展示 | 查看部门组织树。 |
| **F-DEP-C** | 部门创建 | 新增子部门节点。 |
| **F-DEP-U** | 部门信息修改 | 修改部门名称或编码。 |
| **F-DEP-D** | 部门节点删除 | 移除部门节点。 |

## 模块 G: 应用与安全 (OAuth & Security)
| ID | 需求点 | 验收标准 |
| :--- | :--- | :--- |
| **G-CLT-L** | 客户端列表 | 查看接入的 OAuth 应用。 |
| **G-CLT-C** | 客户端注册 | 创建新的 Client。 |
| **G-CLT-U** | 配置更新 | 修改 Redirect URIs 等参数。 |
| **G-CLT-D** | 应用注销 | 彻底移除应用接入。 |
| **G-SEC-INT** | SSO 强拦截 | **(安全核心)** 未授权禁止登录。 |

## 模块 H: 认证与身份生命周期 (Authentication & Session)

### H-AUTH: OAuth 2.1 认证流程

| ID | 需求点 | 验收标准 |
| :--- | :--- | :--- |
| **H-AUTH-001** | 首次登录跳转 | 未登录访问受保护页面时自动跳转到 IdP 登录页 |
| **H-AUTH-002** | OAuth 授权码获取 | 输入正确凭证后跳转回 Portal 并携带 code 参数 |
| **H-AUTH-003** | Token 交换 | 系统自动用授权码换取 access_token |
| **H-AUTH-004** | Session 创建 | Token 交换成功后自动在 Redis 中创建 Session |
| **H-AUTH-005** | Cookie 安全设置 | portal_session_id Cookie 正确设置 HttpOnly/SameSite 属性 |
| **H-AUTH-010** | State 验证 — 正确 | 正常登录流程中 state 匹配，登录成功 |
| **H-AUTH-011** | State 验证 — 错误 | 篡改 URL 中的 state 返回 invalid_state 错误 |
| **H-AUTH-012** | State 过期 | 登录流程暂停超过 10 分钟后返回 state_expired 错误 |
| **H-AUTH-013** | PKCE 验证 | Token 请求中包含 code_verifier 参数 |
| **H-AUTH-014** | Nonce 生成 | 授权 URL 中包含 nonce 参数 |

### H-SESS: Portal Session 生命周期

| ID | 需求点 | 验收标准 |
| :--- | :--- | :--- |
| **H-SESS-001** | Redis 存储 | 登录后 Redis 中 portal:session:{id} key 存在 |
| **H-SESS-002** | Session 内容完整性 | Session 包含 userId、accessToken、createdAt 等必要字段 |
| **H-SESS-003** | TTL 过期设置 | TTL 等于 absolute timeout 配置值 |
| **H-SESS-010** | Idle timeout | 登录后 30 分钟无操作时返回 401 |
| **H-SESS-011** | Absolute timeout | 登录后 7 天强制过期返回 401 |
| **H-SESS-012** | 活跃续期 | 持续操作时 lastAccessAt 自动更新 |
| **H-SESS-020** | Token 即将过期自动刷新 | access_token 剩余 < 5 分钟时自动刷新 |
| **H-SESS-021** | Token 刷新成功 | 刷新后 Session 中 access_token 正确更新 |
| **H-SESS-022** | Token 刷新失败处理 | refresh_token 失效时 Session 销毁并重定向登录页 |

### H-SSO: 单点登录/登出

| ID | 需求点 | 验收标准 |
| :--- | :--- | :--- |
| **H-SSO-001** | Portal 登录后 Demo 免登 | Portal 已登录时 Demo App 自动完成 SSO 认证 |
| **H-SSO-002** | Demo 登录后 Portal 免登 | Demo App 已登录时 Portal 自动完成认证 |
| **H-SSO-003** | 未登录访问受保护应用 | 未在任何应用登录时跳转到 IdP 登录页 |
| **H-SSO-010** | Portal 登出联动 Demo | Portal 登出后 Demo App 也需重新登录 |
| **H-SSO-011** | Demo 登出联动 Portal | Demo App 登出后 Portal 也需重新登录 |
| **H-SSO-020** | IdP Session 清除 | Portal 登出时 IdP Session 同步清除 |
| **H-SSO-021** | 登出后受保护页拦截 | 登出后访问受保护页面重定向到登录页 |
| **H-SSO-022** | 登出后重新登录 | 登出后需要重新输入凭证完成 IdP 认证 |
