# Auth-SSO 产品功能需求追踪矩阵 (CMMI Level 3 RTM)

> **版本**: v3.1（2026-10-23 对照代码校正：证据路径 / 状态 / 门禁表述；需求 ID 与条目数未变）
> **标准**: CMMI V3.0 Level 5 (2023) | **基线编号**: BL-2026-001
> **优先级**: 🔴关键(P0) 认证安全与核心流程 / 🟠重要(P1) 日常管理功能 / 🟡一般(P2) 辅助体验
> **风险等级**: 🔴高 / 🟠中 / 🟡低
> **验证方法**: 自动化测试 / 手动测试 / 安全审计 / E2E测试

> ⚠️ **本文档仅包含产品功能需求（WHAT）**。实现层面的架构约束（如领域模型校验规则、事务边界、缓存策略等）属于 [ARCHITECTURE_CONSTRAINTS.md](ARCHITECTURE_CONSTRAINTS.md) 的范畴，不在本矩阵中列出。

> **验证方式与追溯口径（2026-10-23 补充）**：
> 1. `@req` 注解是**测试→需求**的映射线索，不是需求本身的"验证方法"定义。没有 `@req` 的需求
>    仍有验证手段（E2E/手工/安全审计），已在本表"验证方法"列显式标注；无自动化测试的项列于
>    **附录 B**，不得据"缺 @req"推断"未实现"或"未验证"。
> 2. 带 `E2E` 标注的项由 `tests/e2e/*.spec.ts` 覆盖或部分覆盖。**E2E 只跑 Docker 验收栈**
>    （`playwright.config.ts`：`testDir: tests/e2e`，baseURL 默认 `https://127.0.0.1:19443`，无 host
>    `next dev` webServer）。现有 3 个 spec：`docker-release.spec.ts`（Gateway 登录→OAuth 回调→
>    会话下发→登出闭环）、`oidc-machine-endpoints.spec.ts`（机器端点凭证透传）、
>    `ssr-permission-snapshot.spec.ts`（SSR 权限快照 + Gateway `/healthz`）——**不是每个标 E2E 的
>    需求都有对应 spec**，未覆盖的项按"部分覆盖/未执行"读。带 `手动` 的项记录了最近一轮实机
>    审计的结论（见 [roadmap](../roadmap.md) 2026-10-19～10-23 各条）。
> 3. 密码策略以代码为准：**≥10 位 + 四类字符中≥3 类**（`domain/shared/zod-schemas.ts`）。
> 4. 本矩阵中"数据范围"一律指 ADR-014 门面 `resolveScope` 的实时计算；Redis
>    `UserPermissionContext.deptIds` 是**未展开**的角色部门 ID（ADR-002 增补），两者不可混用。
> 5. **追溯报告不是门禁**：`tests/traceability/generate-report.mjs` 生成
>    `tests/traceability/.generated/coverage-report.md`（本地生成、不提交），产物是**需求映射清单**；
>    阻断门禁是 Vitest / lint / typecheck / Docker 发布验收（`AGENTS.md`「追溯（`@req`）」节）。
>    CI 只跑该脚本产出清单（`validation-suite.yml` 的 "Generate traceability inventory" 步骤），
>    不传 `--threshold`，脚本因此永不因覆盖率不足而失败。


---

## 模块 A: 门户底座 (Portal Infrastructure)

| ID | 需求描述 | 优先级 | 验证方法 | 风险 | 来源 | 验收标准 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **A-NAV-01** | 侧边栏根据权限动态展示菜单项 | 🟡一般(P2) | 自动化测试（`app-sidebar.test.tsx` / `smoke.test.ts` + `route-access` 单测；`ssr-permission-snapshot.spec.ts` 做 SSR 边界回归） | 🟡低 | 用户体验 | 拥有不同权限的用户登录后，侧边栏仅展示其有权访问的菜单项，无权限的菜单项完全隐藏（非灰化）。 |
| **A-NAV-02** | 面包屑导航 | 🟡一般(P2) | 手动（无独立自动化、无 E2E spec；最近实机审计已覆盖，见附录 B） | 🟡低 | 用户体验 | 页面路径准确展示层级关系，点击上级节点可返回对应页面。 |
| **A-NAV-03** | 首页指标看板 | 🟡一般(P2) | 手动（工作台数据按权限裁剪；无 E2E spec；最近实机审计已覆盖，见附录 B） | 🟡低 | 用户体验 | 仪表盘展示用户总数、活跃用户数等关键指标卡片，数据范围受用户权限约束。 |

---

## 模块 B: 用户管理 (User Management)

| ID | 需求描述 | 优先级 | 验证方法 | 风险 | 来源 | 验收标准 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **B-USR-L** | 用户列表分页查询 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.2 | 管理员可查看用户列表，支持分页浏览；列表数据的可见范围受该管理员的数据权限约束。 |
| **B-USR-S** | 用户搜索过滤 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.2 | 管理员可按姓名、邮箱或用户名搜索用户，搜索结果仍受数据权限约束。 |
| **B-USR-C** | 新建用户 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.2 | 管理员可创建新用户，填写用户名、姓名、邮箱、部门、初始密码。用户名和邮箱在系统内唯一（邮箱按 ADR-026 归一化为 `trim+lower`，DB 侧 `ux_users_email_ci` 兜底），密码须满足安全策略要求（**至少 10 位，大写/小写/数字/特殊字符四类中至少三类**；2026-10-23 以代码为准统一）。部门必填（无部门用户会因数据范围 `dept_id IS NULL` 不可见）。 |
| **B-USR-R** | 查看用户详情 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.2 | 管理员可查看指定用户的完整信息（基本信息、所属部门、分配角色、账户状态），且只能查看数据权限范围内的用户。 |
| **B-USR-U** | 编辑用户资料 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.2 | 管理员可修改用户的姓名、邮箱、部门和角色分配，变更即时生效。 |
| **B-USR-D** | 删除用户（逻辑删除） | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.2 | 管理员删除用户时须二次确认；用户被删除后不可登录，但历史数据保留用于审计。 |
| **B-USR-ST** | 账户状态管理 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.2 | 管理员可切换用户状态（`USER_STATUS_VALUES = ACTIVE / DISABLED / LOCKED / DELETED`，`packages/contracts/src/index.ts`）；被禁用或锁定用户无法登录，且现有会话立即失效。状态机由领域层强制：`LOCKED → ACTIVE` 必须走专属「解锁」动作（`unlockUserAction`，2026-10-23 H-17 修复，`crud-h17-user-status.test.ts`）。**两套「锁定」不可混用**：暴力破解触发的是 Redis 计数窗口锁——登录返回 423 但 `users.status` 保持 ACTIVE，管理员解锁=清除计数，不改状态（ADR-025、`lib/auth/brute-force.ts`）。 |
| **B-USR-PW** | 重置用户密码 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.2 | 管理员可为指定用户重置密码，重置后该用户的所有活跃会话立即失效，须使用新密码重新登录。 |

---

## 模块 C: 角色与授权 (Role & Authorization)

| ID | 需求描述 | 优先级 | 验证方法 | 风险 | 来源 | 验收标准 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **C-ROL-L** | 角色列表查看 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.3 | 管理员可查看系统内所有角色及其基本信息（名称、编码、描述、所属部门、关联用户数）。 |
| **C-ROL-C** | 新建角色 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.3 | 管理员可创建角色，指定名称、唯一编码、描述和所属部门；编码创建后不可修改。角色创建后自动获得其所属部门及子部门的数据访问范围。 |
| **C-ROL-U** | 编辑角色属性 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.3 | 管理员可修改角色的名称、描述和所属部门；**系统内置角色（`roles.is_system=true`）不可编辑、不可删除**（DC-ROLE-U/DC-ROLE-D，UI 上不渲染对应按钮）。部门变更后，拥有该角色的所有用户数据范围立即同步更新（`resolveScope` 实时计算 + 权限缓存失效）。 |
| **C-ROL-D** | 删除角色 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.3 | 管理员删除角色前须二次确认；若角色仍关联用户，须提示管理员（UI 弹窗说明“绑定用户会被解除并强制重新登录”并展示影响面）；系统内置角色不可删除；删除后相关用户被撤销授权并强制重新登录（`apps/portal/src/app/(dashboard)/roles/actions.ts` 调用 `revokeAndRefreshAuthorization`）。 |
| **C-ROL-PA** | 为角色分配权限 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.3 | 管理员可将功能权限（菜单/API）授予角色，权限变更后拥有该角色的用户权限自动更新。 |
| **C-ROL-ASGN** | 为用户分配/移除角色 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.2 | 管理员可为用户分配一个或多个角色（限定为该用户**所属部门**下的角色；跨部门分配被拒，见 H-DSCOPE-003），也可移除已分配的角色。角色变更后用户权限即时更新（RBAC 变更主动刷新 Redis 权限缓存并撤销受影响用户授权）。用户同时拥有多个角色时，权限取并集，数据范围取多角色部门 ID（含子部门）的并集。 |

---

## 模块 D: 权限管理 (Permission Management)

| ID | 需求描述 | 优先级 | 验证方法 | 风险 | 来源 | 验收标准 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **D-PRM-L** | 权限列表查看 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.4 | 管理员可按类型（菜单/API/数据）查看系统内所有权限标识及其关联角色数。 |
| **D-PRM-C** | 注册新权限 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.4 | 管理员可注册新的权限标识（编码、名称、类型），权限编码全局唯一且创建后不可修改。 |
| **D-PRM-U** | 编辑权限信息 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.4 | 管理员可修改权限的名称和描述，权限编码不可变更。 |
| **D-PRM-D** | 删除权限 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.4 | 管理员删除权限前须确认；若权限仍被角色引用，须提示并解除引用后删除。 |

---

## 模块 E: 菜单管理 (Menu Management)

> **实现形态（2026-10-23 改写，见 ADR-001 增补）**：「菜单」不是独立表/独立模块，而是**统一权限树**
> 中 `permissions.type = 'DIRECTORY' | 'PAGE'` 的节点：`path`（PAGE 必填）、`icon`、`visible`、
> `sort`、`parent_id` 为菜单属性；`type='API'` 只承载后端权限码，不混入导航字段（DB CHECK）。
> 侧边栏由 `lib/menu-tree.ts` + `lib/route-access.ts` 的**唯一路由权限映射**从用户权限码集合投影，
> 不存在第二套菜单权限判断、也没有独立 `menus` 表。因此下列需求的验收对象是"权限树节点"。

| ID | 需求描述 | 优先级 | 验证方法 | 风险 | 来源 | 验收标准 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **E-MNU-L** | 菜单树查看 | 🟡一般(P2) | 自动化测试（permissions API/UI；无 @req，见附录 B） | 🟡低 | PRD-§4.5 | 管理员可在 `/permissions` 查看权限树中 DIRECTORY/PAGE 节点的层级结构（含 path/icon/visible/sort/parentId），API 节点按类型分组展示。 |
| **E-MNU-C** | 新建菜单节点 | 🟡一般(P2) | 自动化测试（`createPermissionAction` 类型约束；无 @req，见附录 B） | 🟡低 | PRD-§4.5 | 管理员可在指定父级下创建 DIRECTORY/PAGE 节点，设置名称、路径、图标、排序与可见性；PAGE 必须提供 `path`，DIRECTORY/PAGE 不得携带 `clientId`（CHECK 约束）。 |
| **E-MNU-U** | 编辑菜单节点 | 🟡一般(P2) | 自动化测试（`updatePermissionAction`；无 @req，见附录 B） | 🟡低 | PRD-§4.5 | 管理员可修改菜单名称、路径、图标、排序、可见性与父级；**编码不可变更**；父级不得设为自身或自身后代（环检测）；类型变更时菜单字段按类型归一。 |
| **E-MNU-D** | 删除菜单节点 | 🟡一般(P2) | 自动化测试（`deletePermissionAction`；无 @req，见附录 B） | 🟡低 | PRD-§4.5 | 管理员删除 DIRECTORY/PAGE 节点时整棵子树级联删除（DB `ON DELETE CASCADE`），删除前展示影响面；核心权限码（`ALL_PERMISSIONS`）及其所在子树拒绝删除。 |
| **E-MNU-PB** | 菜单与权限绑定 | 🟡一般(P2) | 自动化测试（`role_permissions` 绑定 + 菜单投影；无 @req，见附录 B） | 🟡低 | PRD-§4.5 | 菜单节点本身即权限码：角色被授予 PAGE code 后该菜单可见；`DIRECTORY` 无自身权限码时按子节点可见性保留为容器；未授权菜单完全隐藏且对应路由拒绝访问（`route-access` 唯一映射）。 |

---

## 模块 F: 组织架构 (Department Management)

| ID | 需求描述 | 优先级 | 验证方法 | 风险 | 来源 | 验收标准 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **F-DEP-L** | 组织树查看 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.6 | 管理员可查看公司完整的组织架构树，包括各部门名称、编码和成员数量；可见范围受角色部门子树约束。 |
| **F-DEP-C** | 创建部门 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.6 | 管理员可在指定父部门下创建子部门，部门编码全局唯一；**根部门全局唯一**（仅空树引导期由 seed/迁移建立；运行期创建第二个根被拒，且操作者须有非空数据范围）。 |
| **F-DEP-U** | 编辑部门信息 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.6 | 管理员可修改部门名称和编码，支持调整父级位置；系统须防止循环依赖；移动时级联更新整棵子树 `ancestors`（含**直接子部门**等值分支）；**不得把已有部门迁出为根**。 |
| **F-DEP-D** | 删除部门 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.6 | 管理员删除部门前，系统须检查：根部门（`CANNOT_DELETE_ROOT`）→ 子部门 → 关联用户 → 关联角色；任一存在即拒绝并给出专属业务码。 |
| **F-DEP-M** | 查看部门成员 | 🟠重要(P1) | 手动（部门行「查看成员」对话框；**无 E2E spec**；无 @req，见附录 B） | 🟠中 | PRD-§4.6 | 管理员可查看指定部门下的成员列表；范围外部门的成员接口按数据范围返回 404（ADR-014 读口）。 |

> **部门状态语义（审计 D2，2026-10-23 补充验收口径，不新增需求 ID）**：部门 `status=DISABLED`
> 后，禁止在该部门下新建子部门/用户/角色、禁止把角色/用户迁入；**不追溯**既有用户的登录、
> 授权与数据范围（ADR-002 增补）。当前实现进度：角色创建/迁移已校验 ACTIVE；用户与子部门
> 的同口径守卫为 backlog。

---

## 模块 G: 应用集成 (Application Integration)

| ID | 需求描述 | 优先级 | 验证方法 | 风险 | 来源 | 验收标准 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **G-CLT-L** | 客户端列表查看 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.7 | 管理员可查看所有已注册的 OAuth 客户端及其基本信息（名称、Client ID、回调地址、状态）。 |
| **G-CLT-C** | 注册新客户端 | 🟠重要(P1) | 自动化测试 / 安全审计 | 🟠中 | PRD-§4.7 | 管理员可注册新的 OAuth 客户端，填写名称和回调地址，系统自动生成 Client ID 和 Secret；Secret 仅在创建时展示一次。 |
| **G-CLT-U** | 编辑客户端配置 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.7 | 管理员可修改客户端名称、回调地址、状态与 **per-client 令牌有效期（`accessTokenTtl`/`refreshTokenTtl`，审计 D15 / ADR-024）**。禁用的客户端不接受任何登录请求。TTL 生效且被钳制（AT 60s–24h、RT 5min–30d），非法/缺失回退默认 3600/604800；`expires_in`、JWT `exp`、RT `expires_at`、Cookie `max-age` 四处同源同值。 |
| **G-CLT-D** | 注销客户端 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.7 | 管理员可注销客户端；注销后该 Client ID 立即失效，其 RT 行/授权码随 FK CASCADE 删除、权限读模型缓存同步失效；**已签发 AT 为无状态 JWT 不随注销撤销**，最长在 AT TTL 内自然失效（ADR-013 决策 4 有意接受；急迫场景走用户级强制下线）。 |
| **G-CLT-SEC** | 轮换客户端密钥 | 🟠重要(P1) | 自动化测试 / 安全审计 | 🟠中 | PRD-§4.7 | 管理员可轮换客户端 Secret，新 Secret 立即生效，旧 Secret 立即失效。 |

---

## 模块 H: 安全与认证 (Security & Authentication)

> 本模块统一管理所有安全相关需求，包括用户认证、会话管理、单点登录、访问控制和数据权限。

### H-AUTH: 用户认证

| ID | 需求描述 | 优先级 | 验证方法 | 风险 | 来源 | 验收标准 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **H-AUTH-001** | 未登录拦截与重定向 | 🔴关键(P0) | 自动化测试 / E2E测试（`docker-release.spec.ts`） | 🔴高 | 安全审计 | 未登录用户访问任何受保护页面时，系统自动重定向到登录页面，登录成功后可跳回原始目标页面。 |
| **H-AUTH-002** | 用户登录认证 | 🔴关键(P0) | 自动化测试 / E2E测试 / 安全审计 | 🔴高 | 安全审计 | 用户输入正确的邮箱和密码后，系统验证凭证成功并建立登录会话。禁用或锁定状态的账户无法通过认证。 |
| **H-AUTH-003** | OAuth 2.1 授权码流程 | 🔴关键(P0) | 自动化测试 / E2E测试 / 安全审计 | 🔴高 | 安全审计 | 系统遵循 OAuth 2.1 Authorization Code + PKCE 标准流程签发授权码，授权码一次性使用、有效期 5 分钟。 |
| **H-AUTH-004** | 令牌安全交换 | 🔴关键(P0) | 自动化测试 / 安全审计 | 🔴高 | 安全审计 | 授权码通过服务端到服务端（Back-Channel）的方式交换为访问令牌和刷新令牌，令牌不在浏览器 URL 或前端存储中暴露。 |
| **H-AUTH-005** | 登录成功后的令牌下发 | 🔴关键(P0) | 自动化测试 / E2E测试 | 🔴高 | 安全审计 | 登录成功后，系统向浏览器下发两个 HttpOnly Cookie：访问令牌（`portal_jwt_token`，默认有效期 1 小时 = `TOKEN_TTL.ACCESS_TOKEN`）和刷新令牌（`portal_refresh_token`，默认有效期 7 天 = `TOKEN_TTL.REFRESH_TOKEN`）。**TTL 是 per-client 的**（`clients.access_token_ttl` / `refresh_token_ttl`，ADR-024，钳制 AT 60s–24h、RT 5min–30d），1h/7d 为默认值而非恒定值。 |
| **H-AUTH-006** | 浏览器 Cookie 安全 | 🔴关键(P0) | 安全审计 | 🔴高 | 安全审计 | 认证 Cookie 必须设置为 HttpOnly（不可被 JavaScript 读取）、Secure（仅 HTTPS 传输）、SameSite=Lax（防护跨站请求）。 |
| **H-AUTH-010** | 登录防 CSRF（State 参数） | 🔴关键(P0) | 自动化测试 / 安全审计 | 🔴高 | 安全审计 | 授权请求生成随机 `state` 并在授权响应中原样回传；回调侧由 Gateway 校验 state Cookie ↔ URL 一致性。**另（ADR-023）**：`login_session` 必须与授权请求 `session_id` 绑定（`sid` claim + 一次性 HttpOnly 绑定 Cookie），未绑定/不匹配一律拒绝发码——防止"授权请求注入 / login CSRF"。 |
| **H-AUTH-011** | 登录防重放（PKCE） | 🔴关键(P0) | 自动化测试 / 安全审计 | 🔴高 | 安全审计 | 授权码交换令牌时，系统验证 PKCE code_verifier 与 code_challenge 的 SHA256 匹配，防止授权码拦截重放攻击。 |
| **H-AUTH-012** | 登录防重放（Nonce） | 🔴关键(P0) | 自动化测试（Gateway callback nonce 校验；无 @req，见附录 B） | 🔴高 | 安全审计 | 系统在 ID Token 中嵌入随机 Nonce 值（`signIdToken` 在授权请求带 nonce 时写入），Gateway 回调时 fail-close 双向闭合校验（OIDC Core §3.1.2.2）。 |
| **H-AUTH-013** | 登录流程超时保护 | 🔴关键(P0) | 自动化测试 | 🔴高 | 安全审计 | 登录流程的 State/授权请求暂存有效期为 **5 分钟**（`AUTH_REQUEST_TTL = 300` 秒（`apps/portal/src/lib/session/auth-request-store.ts`，绑定 Cookie 同生命周期），Redis `portal:auth_req:` + 绑定 Cookie；比需求原文"10 分钟"更严格——2026-10-23 以代码为准校正，未改产品阈值）。超时后需重新发起登录。 |

### H-SESS: 会话管理

| ID | 需求描述 | 优先级 | 验证方法 | 风险 | 来源 | 验收标准 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **H-SESS-001** | 会话令牌有效性 | 🔴关键(P0) | 自动化测试 / E2E测试 | 🔴高 | 安全审计 | 登录成功后，用户浏览器持有有效会话令牌（HttpOnly Cookie `portal_jwt_token`，`COOKIE_NAMES.JWT`），后续请求自动携带该令牌进行身份识别。**令牌本身只含身份与追溯断言（`sub`/`iss`/`aud`/`jti` 及 `client_id`/`sid`/`scope` 等按用途可选字段），不含角色与权限**（ADR-006 claims 最小化，`domain/auth/types.ts` 的 `PortalJwtClaims`）；权限上下文来自 Redis `portal:user_perms:{userId}`，数据范围由 `resolveScope` 按请求实时计算。 |
| **H-SESS-002** | 令牌自动过期 | 🔴关键(P0) | 自动化测试 | 🔴高 | 安全审计 | 访问令牌在签发后 1 小时自动过期，过期后的 API 请求被拒绝（返回 401）。 |
| **H-SESS-003** | 令牌静默刷新 | 🔴关键(P0) | 自动化测试（`apps/gateway/src/auth/verify.rs` 的 `REFRESH_THRESHOLD_SEC=300`：AT 剩余 <5 分钟时 Gateway 服务端续签；无 E2E 计时覆盖） | 🟠中 | 用户体验 | 访问令牌剩余有效期不足 5 分钟时，系统自动使用刷新令牌获取新令牌，用户无感知。 |
| **H-SESS-004** | 刷新令牌过期处理 | 🔴关键(P0) | 自动化测试（RT 7 天 TTL = `TOKEN_TTL.REFRESH_TOKEN`；无 E2E 覆盖） | 🔴高 | 安全审计 | 刷新令牌过期（7 天未活跃）后，用户须重新登录。 |
| **H-SESS-005** | 令牌刷新失败处理 | 🔴关键(P0) | 自动化测试（RT 撤销/重放级联撤销；无 E2E 覆盖） | 🔴高 | 安全审计 | 刷新令牌被撤销或篡改时，系统清除所有认证状态，用户须重新登录。 |
| **H-SESS-006** | 账户异常即时失效 | 🔴关键(P0) | 自动化测试（`force-logout-revocation.test.ts` / `password-reset-session-revocation.test.ts`；无 E2E 覆盖） | 🔴高 | 安全审计 | 管理员封禁/锁定账户或重置密码时，该用户所有活跃会话立即失效，正在进行的 API 请求被拒绝。 |

### H-SSO: 单点登录与登出

| ID | 需求描述 | 优先级 | 验证方法 | 风险 | 来源 | 验收标准 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **H-SSO-001** | 单点登录（已登录态免登） | 🔴关键(P0) | E2E测试（`tests/e2e/docker-release.spec.ts` 登录→OAuth 回调闭环；无 @req，见附录 B） | 🔴高 | 安全审计 | 用户在一个应用中已登录后，访问其他已集成的子系统时无需重新输入密码，系统自动完成认证（authorize 分支 B 的 SSO 免登）。 |
| **H-SSO-002** | 未登录统一拦截 | 🔴关键(P0) | 手动/代码审查（未登录 HTML 导航 302 `/authorize`、API 401；**现无对应 E2E spec**，见附录 B） | 🔴高 | 安全审计 | 用户未在任何应用中登录时，访问任何受保护的子系统均被重定向到统一登录页面（Gateway HTML 导航 302 `/authorize`，API 401）。 |
| **H-SSO-003** | 单点登出 | 🔴关键(P0) | **部分实现**（无 E2E 覆盖）：本 Portal 内登出=撤销 AT(jti 黑名单)+撤销 RT+清 Cookie（见 H-SSO-004、`docker-release.spec.ts`）；**不存在跨子系统全量登出**——无 `end_session_endpoint`、无 back/front-channel logout 契约，其他客户端已签发的无状态 AT 在 TTL 内仍有效（ADR-013 决策 4） | 🔴高 | 安全审计 | 用户任一处登出后，所有子系统的会话均同步失效，再次访问需重新认证。 |
| **H-SSO-004** | 全链路登出清理 | 🔴关键(P0) | 自动化测试 / E2E（`docker-release.spec.ts` 断言登出后两个 Cookie 均被清除且再次访问 `/dashboard` 回到登录页） | 🔴高 | 安全审计 | 登出操作同时执行三项清理：访问令牌即时失效、刷新令牌撤销、浏览器认证 Cookie 清除。 |

### H-FLOW: 端到端流程验证

| ID | 需求描述 | 优先级 | 验证方法 | 风险 | 来源 | 验收标准 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **H-FLOW-001** | E2E 登录成功全流程 | 🔴关键(P0) | E2E（`docker-release.spec.ts`：登录 → `/dashboard` → 侧边栏可见） | 🔴高 | 用户体验 | 用户在登录页输入正确凭证后成功登录，自动重定向到 Dashboard 首页并渲染侧边栏菜单。 |
| **H-FLOW-002** | E2E 登出全流程 | 🔴关键(P0) | E2E（`docker-release.spec.ts`：`POST /api/auth/logout` → 200 → Cookie 清除 → 再访问回登录页） | 🔴高 | 用户体验 | 用户点击登出后，系统清除会话并重定向到登录页，再次访问受保护页面需重新认证。 |
| **H-FLOW-003** | E2E 登录失败提示 | 🔴关键(P0) | 手动（无 @req；**无 E2E spec 覆盖**；登录失败映射为中文可执行提示，见附录 B） | 🟠中 | 用户体验 | 用户输入错误密码时，登录页面显示错误提示信息；`oauth_denied` 等错误码映射为中文提示。 |
| **H-FLOW-004** | E2E 路由重定向保护 | 🔴关键(P0) | E2E（`docker-release.spec.ts`：直接访问 `/dashboard` → 重定向 `/login?session_id=`） | 🟠中 | 安全审计 | 未登录用户直接访问受保护页面 URL 时，系统自动重定向到登录页，登录后可跳回原始目标页面。 |

### H-ACL: 访问控制

| ID | 需求描述 | 优先级 | 验证方法 | 风险 | 来源 | 验收标准 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **H-ACL-001** | 权限不足拒绝访问 | 🔴关键(P0) | 自动化测试 / E2E测试 | 🔴高 | 安全审计 | 用户尝试访问无权限的功能页面或 API 时，系统返回 403 禁止访问。 |
| **H-ACL-002** | 跨部门越权拦截 | 🔴关键(P0) | 自动化测试（`data-scope.test.ts` / `user-detail-scope.test.ts` / `authz-write.test.ts`；**无 E2E 覆盖**） | 🔴高 | 安全审计 | 用户无法通过直接输入 URL 或修改 API 参数的方式访问其角色所属部门（含子部门）范围之外的信息。 |
| **H-ACL-003** | 权限组合校验 | 🔴关键(P0) | 自动化测试 | 🔴高 | 安全审计 | 系统支持要求用户同时拥有多个权限才能执行特定操作（如：同时拥有「用户管理」和「角色分配」权限才能为用户分配角色）。 |

### H-DSCOPE: 数据范围控制

> **v3.2 重构**：数据范围不再由角色的 `data_scope_type` 枚举控制，改为由角色所属部门（`roles.dept_id`）隐式决定。每个角色必须属于一个部门。角色的数据可见范围 = 角色所属部门 + 其所有子部门（通过 `ancestors` 物化路径展开）。部门 ID 通过角色 ID 即可拿到：`user → user_roles → roles.dept_id`。

| ID | 需求描述 | 优先级 | 验证方法 | 风险 | 来源 | 验收标准 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **H-DSCOPE-001** | 部门数据范围 | 🟠重要(P1) | 自动化测试（`data-scope.test.ts` 等；**无 E2E 覆盖**） | 🟠中 | PRD-§4.3 | 用户的角色所属部门决定了其数据可见范围。用户只能查看和操作其角色所属部门（含所有子部门）范围内的数据。数据查询自动包含子部门——例如角色属于「研发部」则自动包含「前端组」「后端组」等子部门数据。 |
| **H-DSCOPE-002** | 多角色数据范围合并 | 🟠重要(P1) | 自动化测试（`data-scope` 并集用例；无 @req，见附录 B） | 🟠中 | PRD-§4.3 | 用户拥有多个角色时，数据范围取各角色所属部门（含子部门）的**并集**（`resolveScope` 实时计算；注意 Redis `deptIds` 未展开子树，ADR-002 增补）。 |
| **H-DSCOPE-003** | 用户角色分配部门约束 | 🟠重要(P1) | 自动化测试 | 🟠中 | PRD-§4.2 | 用户只能被分配其所属部门（`users.dept_id`）下的角色。跨部门角色分配应被系统拒绝。 |

---


## 模块 J: 审计与日志 (Audit & Logging)

| ID | 需求描述 | 优先级 | 验证方法 | 风险 | 来源 | 验收标准 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **J-LOG-001** | 操作审计日志查询 | 🟡一般(P2) | 自动化测试（筛选/分页/导出；无 @req，见附录 B） | 🟡低 | PRD-§4.8 | 审计员可按操作人、操作类型、时间范围查询操作审计日志，每条日志包含时间戳、操作人、操作类型、目标资源、变更参数（JSON）和 IP 地址。**可见范围为全量、不按部门过滤**（决策 D3；`audit:read` 属合规只读职能）。 |
| **J-LOG-002** | 登录日志查询 | 🟡一般(P2) | 自动化测试（事件类型/日期筛选；无 @req，见附录 B） | 🟡低 | PRD-§4.8 | 审计员可查看所有用户的登录历史（成功/失败/刷新/登出），包含时间、IP、User-Agent、失败原因；可见范围为全量（决策 D3）。 |
| **J-LOG-003** | 关键操作自动记录 | 🔴关键(P0) | 自动化测试 / 代码审查 | 🔴高 | 安全审计 | 系统自动记录以下关键操作：用户登录/登出、权限变更、角色变更、用户状态变更、客户端密钥轮换。日志不可篡改、不可删除（应用层 append-only；生产 DB 角色建议 REVOKE UPDATE/DELETE）。 |
| **J-LOG-004** | 审计日志导出 | 🟡一般(P2) | 自动化测试（`audit-export.test.ts`；无 @req，见附录 B） | 🟡低 | PRD-§4.8 | 审计员可将查询结果导出为 CSV（`audit:export` 权限）：时间列 ISO 8601、`params` 输出 JSON、筛选参数（类型/日期/用户）透传、全量分页循环上限 10 万行、RFC 4180 转义 + 公式注入防护。规模：5,238 行 ≈138ms；>3 万行改流式为 backlog（D11）。 |

---

## 模块 K: Portal 设计打磨 (Design Polish)

| ID | 描述 | 优先级 | 验证方法 | 风险 | 来源 | 验收标准 |
|----|------|--------|----------|------|------|---------|
| **D-POLISH-001** | 全局 CSS 颜色体系统一为 oklch，移除 hex | P1 | 手动/E2E 快照（无 @req；最近实机 UI 审计已覆盖，见附录 B） | 低 | /autoplan | 登录页、Dashboard、用户列表视觉快照匹配 baseline；组件使用语义 token，禁止硬编码调色板（Canvas 登录背景为 DESIGN 显式例外）。 |
| **D-POLISH-002** | DataTable 共享组件激活 + EmptyState 集成 | P1 | 组件测试（`data-table`/`empty-state`） | 中 | /autoplan | 4 个列表页使用 DataTable，空数据展示 EmptyState |
| **D-POLISH-003** | 审计日志页 shadcn Table + 暗黑模式 | P1 | E2E 快照（无 @req，见附录 B） | 低 | /autoplan | 双 Tab 渲染正确，暗黑模式徽章可读 |
| **D-POLISH-004** | 登录页品牌渐变 + 圆角收敛 + 标题规范 | P2 | E2E 快照（无 @req，见附录 B） | 低 | /autoplan | 渐变背景 + 白色卡片 + 规范圆角值 |
| **D-POLISH-005** | Command Palette (Cmd+K) + Toast 反馈 | P2 | 组件测试（`command-palette`） | 低 | /autoplan | Cmd+K 搜索过滤 + 导航跳转正常 |
| **D-POLISH-006** | 操作入口统一 (Sheet→Dialog) + 视觉快照防线 | P2 | 组件测试 + E2E（无 @req，见附录 B） | 中 | /autoplan | CreateUserDialog 正常，无 Sheet 残留 |

---

## 需求汇总

| 模块 | 需求数 | P0 关键 | P1 重要 | P2 一般 |
|------|--------|---------|---------|---------|
| A: 门户底座 | 3 | 0 | 0 | 3 |
| B: 用户管理 | 8 | 0 | 8 | 0 |
| C: 角色与授权 | 6 | 0 | 6 | 0 |
| D: 权限管理 | 4 | 0 | 4 | 0 |
| E: 菜单管理 | 5 | 0 | 0 | 5 |
| F: 组织架构 | 5 | 0 | 5 | 0 |
| G: 应用集成 | 5 | 0 | 5 | 0 |
| H: 安全与认证 | 30 | 27 | 3 | 0 |
| J: 审计与日志 | 4 | 1 | 0 | 3 |
| **合计** | **70** | **28** | **31** | **11** |

---

## 附录: 非功能需求追溯 (NFR Traceability)

> NFR 项定义在 PRD.md §6，此处建立其与设计文档、约束和测试的追溯关系。

### NFR 性能类

| NFR ID | 需求描述 | 量化阈值 | 验证方法 | 架构约束 | 关联测试 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| NFR-PERF-01 | Portal API 响应时间 | `/api/me` P95 < 200ms | 实测（2026-10-23 真实栈观测）：Admin UI 首屏 37–101ms（含服务端渲染）；**完整 `/api/me` P95 未单独采样**（无 k6 负载脚本，`tests/performance/api-benchmark.mjs` 已于 roadmap 续九十四删除，属历史假绿） | R14（DB 查询规范） | 无独立门禁；规模数据审计有实测记录 |
| NFR-PERF-02 | 登录全流程耗时 | 登录→Dashboard P95 < 1.5s | 实测（真实栈）：**≈1.2s**（Playwright，含 OAuth 回调与 Cookie 下发） | R8（三层鉴权） | `tests/e2e/docker-release.spec.ts` 覆盖链路，**未做计时断言**（只断言跳转与 Cookie，不采集耗时） |
| NFR-PERF-03 | Gateway JWT 验签延迟 | < 5ms（不含网络） | Rust [criterion](https://github.com/bheisler/criterion.rs) 基准（`Cargo.toml` `[[bench]] harness = false`）：`jwks/key_lookup_hit` ≈84–93ns、`jwks/verify_path_combined` ≈121ns（ADR-021，本地开发机；不含 ES256 验签主体 50–200µs 量级） | — | `apps/gateway/benches/{jwks_cache_bench,cookie_bench,path_classify_bench,jwt_payload_bench,rate_limit_bench}.rs` |
| NFR-PERF-04 | 列表查询分页响应 | 1000 条 P95 < 500ms | 实测（真实栈，211 用户/5,223 日志规模）：列表翻页 **331–758ms**（含 SSR 与缓存失效后的首读）；**未达阈值、无 P95 门禁**，规模上量前需压测 | R12（缓存策略） | — |
| NFR-PERF-05 | 并发用户支持 | 500 并发，错误率 < 1% | **未验证**（无 k6/负载门禁；`scripts/bench/gateway.mjs` 是单机只读基准——`/healthz`、`/login`、静态资源各取 RPS/p50，非并发压测） | — | — |

> **NFR 性能口径**：上表"实测"来自真实栈观测（非门禁、非手抄估算），原始记录见 [roadmap](../roadmap.md)
> 2026-10-23 条目与 `.zcode/audit/`（本地审计目录，gitignore，不随仓库分发）。
> `tests/performance/api-benchmark.mjs` 已删除（默认打已移除的 host 入口、0 请求也 exit 0，属假绿基准）；
> 当前可直接运行的基准入口是 `scripts/bench/gateway.mjs`（`node scripts/bench/gateway.mjs --n 200 --c 20`）。

### NFR 安全类（归属模块 H）

| NFR ID | 需求描述 | 量化阈值 | 验证方法 | 架构约束 | 关联 Matrix ID |
| :--- | :--- | :--- | :--- | :--- | :--- |
| NFR-SEC-01 | 通信加密 | 所有业务通信强制 HTTPS；自托管生产证书由 Gateway Rust 内建 ACME 自动续期并热加载，平台部署由平台终结 TLS 且 Gateway 在编译期排除 ACME | 安全审计 + 自托管 Pebble E2E/公共 staging + 平台 `--no-default-features` 双构建门禁和依赖图断言 | R1~R14 架构规则 | H-AUTH-001 |
| NFR-SEC-02 | Cookie 安全属性 | HttpOnly + Secure + SameSite=Lax | 代码审查 + 渗透测试 | — | H-SESS-001 |
| NFR-SEC-03 | Token 安全 | 无敏感令牌存前端存储 | 代码审查 | — | H-SESS-001 |
| NFR-SEC-04 | JWT 签名算法 | ES256 非对称，密钥 90 天有效期、到期前 24h 自动轮换 | 自动化测试（`apps/portal/__tests__/api/jwks-rotation.test.ts`：真实 `jwks` 表验证提前轮换与重叠宽限窗口）+ 代码审查（`lib/auth/token/signing-keys.ts` 的 `90 * 24h` 有效期、`JWKS_RENEW_AHEAD_SECS = 24 * 3600`） | — | H-AUTH-005~006 |
| NFR-SEC-05 | 密码策略 | **≥10 位，大写/小写/数字/特殊字符四类中≥3 类**（2026-10-23 以代码为准统一：`domain/shared/zod-schemas.ts` 的 `PasswordSchema`；此前写 8 位） | 自动化测试 | DC-USR-C | B-USR-C |
| NFR-SEC-06 | 暴力破解防护 | **双维度**（ADR-025，`lib/auth/brute-force.ts`）：账户×客户端 IP 5 次失败 / 15 分钟 → **423**；同一 IP 跨账户 20 次失败 / 15 分钟 → **429 `RATE_LIMITED`**。锁定基于 Redis 计数窗口，`users.status` 保持 ACTIVE；管理员解锁=清除该用户全部 IP 的账户计数。不存在邮箱同样执行等值 bcrypt（抹平时延 + 提高枚举成本）。阈值可经 `BRUTE_FORCE_*` 环境变量覆盖（H-03/H-04） | 自动化测试（`brute-force.test.ts`） | — | H-AUTH-002 |
| NFR-SEC-07 | 审计追溯 | 所有关键操作写入审计日志 | 代码审查 | DC-AUDIT-IMMUTABLE | J-LOG-003 |
| NFR-SEC-08 | CSRF 防护 | State 参数验证，OAuth 2.1 强制 | 安全审计 | — | H-AUTH-010 |
| NFR-SEC-09 | 授权码一次性使用 | 二次提交 → invalid_grant | 自动化测试 | DC-AUTH-003 | H-AUTH-004 |
| NFR-SEC-10 | 授权码过期保护 | 5 分钟 TTL | 自动化测试 | DC-AUTH-003 | H-AUTH-004 |
| NFR-SEC-11 | Redirect URI 严格匹配 | 完全一致（含末尾斜杠） | 自动化测试 | DC-AUTH-002 | H-AUTH-003 |
| NFR-SEC-12 | Client Secret 轮换即时生效 | 旧 Secret 立即失效 | 自动化测试 | DC-CLI-U | G-CLT-U |
| NFR-SEC-13 | 密码修改强制重新登录 | jti 写入黑名单 + RT 全部撤销（重置密码路径为事务内 fail-close） | 自动化测试 | DC-AUTH-004 | H-SESS-006 |
| NFR-SEC-14 | 角色撤销即时生效 | 当前用户 jti 写入黑名单（`revokeAndRefreshAuthorization`：先撤销后刷缓存） | 自动化测试 | DC-ROLE-D | H-ACL-002 |
| NFR-SEC-15 | 密码历史禁止重用 | 禁止重用**最近 5 次密码及当前密码**（`users.password_history` + `domain/auth/password.ts` 的 `isPasswordReused`；H-C-06 补当前密码） | 自动化测试 | — | B-USR-PW |
| NFR-SEC-16 | 会话并发控制（最多 3 个活跃会话） | **未实现（backlog）**：当前无会话数上限/驱逐机制，仅有「管理员强制下线」与「RBAC 变更撤销」两条失效路径；需 jti 计数 + 驱逐策略 + 测试 | **无验证**（在 `apps/` / `packages/` 中检索会话数上限相关标识零命中） | — | 见 [roadmap](../roadmap.md) 2026-10-23 已知限制 ④ |
| NFR-SEC-17 | 邮箱身份规范化 | 写入/登录统一 `trim+lower`；DB `ux_users_email_ci`（`lower(email)` 部分唯一索引）；大小写变体判重 409（ADR-026） | 自动化测试 + 迁移 `apps/portal/drizzle/0003_email_case_insensitive.sql` | — | B-USR-C |
| NFR-COMP-01 | 审计日志 180 天保留 | `access_logs` 按月分区（`apps/portal/drizzle/0000_initial.sql` 的 `PARTITION BY RANGE (created_at)`）并由维护脚本删除 >180 天的分区 | 配置审查（维护脚本：`apps/portal/scripts/maintain-access-log-partitions.ts`，入口 `pnpm --filter @auth-sso/portal db:maintain-partitions`；**未纳入自动化门禁、本轮未跑环境验证**）。`audit_logs` / `login_logs` 分区与 90 天归档**未实现**（见回报事项：PRD §6.2 的完整口径超出当前代码） | — | — |

---

## 附录 B: 无 `@req` 注解的需求与验证方式（2026-10-23，决策 D17）

> 下表各 ID 在当前测试文件中**没有 `@req` 注解**（逐项核实）。这不等于"未实现/未验证"：多数由组件测试、
> 实机审计覆盖，只是未做需求号映射。逐项标注如下；补 `@req` 属各修复线后续小改动，
> 本表为**过渡期的准确记录**（避免追溯报告把"缺注解"读成"缺实现"）。

| ID | 验证方式 | 说明 |
|---|---|---|
| A-NAV-02 | 手动 | 面包屑由 `components/ui/breadcrumb.tsx` + 页面 `PageHeader` 组合实现；最近 UI 审计逐页验证（**无自动化测试**） |
| A-NAV-03 | 手动 | 工作台指标按权限裁剪；2026-10-21 权限审计修复越权入口（**无自动化测试**） |
| E-MNU-L | 自动化（permissions API/UI） | 见模块 E 说明；菜单=权限树节点 |
| E-MNU-C | 自动化（`createPermissionAction` 类型约束） | DB CHECK + 领域归一 |
| E-MNU-U | 自动化（`updatePermissionAction`） | code 不可变、环检测、类型归一 |
| E-MNU-D | 自动化（`deletePermissionAction`） | 子树 CASCADE + 保留码拒绝 |
| E-MNU-PB | 自动化（菜单投影 + `route-access`） | 菜单可见 == 路由可达的唯一映射 |
| F-DEP-M | 手动（部门行「查看成员」） | 范围读口返回 404 语义（**无自动化测试**） |
| H-AUTH-012 | 自动化（Gateway nonce 校验） | `oauth_flow` 的 `nonce_matches`（Rust 单测；**无 E2E**） |
| H-AUTH-013 | 自动化 | `AUTH_REQUEST_TTL = 300` 秒（`lib/session/auth-request-store.ts`，Redis + 绑定 Cookie），比需求原文 10 分钟严格 |
| H-SSO-001 | E2E（`tests/e2e/docker-release.spec.ts`） | 经 Gateway 的 OAuth 闭环 |
| H-SSO-002 | 手动/代码审查 | 未登录 HTML 导航→302 `/authorize`；API→401（**现无 E2E spec 覆盖**） |
| H-FLOW-003 | 手动 | 登录失败错误映射与中文提示（**现无 E2E spec 覆盖**） |
| H-DSCOPE-002 | 自动化（`data-scope.test.ts` 并集用例） | `resolveScope` 并集 |
| J-LOG-001 | 自动化（列表/筛选/分页） | 可见范围全量（决策 D3） |
| J-LOG-002 | 自动化（事件类型/日期筛选） | 可见范围全量（决策 D3） |
| J-LOG-004 | 自动化（`audit-export.test.ts`） | CSV 序列化/筛选/上限；该文件 `@req` 标注为 `H-AUDIT-001`（矩阵中无此 ID，属未识别 `@req`） |
| D-POLISH-001 | 手动/E2E 快照 | oklch/语义 token；Canvas 登录背景为 DESIGN 显式例外 |
| D-POLISH-002 | 组件测试 | `data-table`/`empty-state` |
| D-POLISH-005 | 组件测试 | `command-palette` |

> 另：D-POLISH-003/004/006 在组件测试/实机审计中有覆盖，未逐一列入上表（同属"无 `@req` 但已验证"）。
> 上表 19 个 ID 与"另"行合计 22 项；数量以本表为准，不再写"20 个"这类手抄总数。

---

## 追溯关系

- **[PRD.md](PRD.md)**：所有需求的业务来源和优先级依据（含 CMMI Level 5 CAR 程序与过程性能基线）
- **[ARCHITECTURE.md](ARCHITECTURE.md)**：安全需求的技术实现架构（11 层认证授权链路）
- **[ARCHITECTURE_CONSTRAINTS.md](ARCHITECTURE_CONSTRAINTS.md)**：实现层面的编码约束（领域模型校验规则等）
- **`tests/traceability/.generated/coverage-report.md`**：需求映射报告（`node tests/traceability/generate-report.mjs` 本地生成，不提交；**不是门禁**，见文件头口径 5）

## CMMI Level 5 闭环机制

- **缺陷追溯**：测试失败时通过 `@req` 注解 → 需求 ID → CAR 程序（5-Why 根因分析 → 纠正/预防措施 → 经验教训沉淀）
- **过程度量**：测试通过率（基线 100%，LCL 95%）由 CI 门禁（Vitest / lint / typecheck / Docker 发布验收）保障；追溯性覆盖率（目标 85%）由 `generate-report.mjs` 产出，**属观测指标、不阻断流水线**
- **持续改进**：P0/P1 缺陷触发 CAR → 预防措施更新架构约束/Red Flags → Pilot → 度量 → 推广/回滚
- **经验教训**：每次 CAR 输出写入 [roadmap](../roadmap.md) 的变更记录，作为组织级过程资产积累
