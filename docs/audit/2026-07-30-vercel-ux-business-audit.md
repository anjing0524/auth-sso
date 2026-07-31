# Vercel 生产环境视觉、交互与业务验收审计

审计日期：2026-07-30  
生产地址：`https://auth-sso-stack.vercel.app`  
对照基线：`docs/spec/USER_STORIES.md` v3.3  
审计方式：真实 Chrome 会话、桌面端与 390×844 移动端、键盘操作、错误路径、网络/控制台、CSV 导出、源码交叉核对  
审计边界：只诊断，不修改业务代码；测试产生的临时用户、角色和客户端均已清理

## 1. 执行摘要

生产环境的 Gateway → Portal → OAuth 2.1/PKCE → Callback → 受保护页面主链路可用，错误密码、退出登录、健康检查、Discovery 和 JWKS 也能正常响应。核心管理页面在桌面端具有较统一的卡片、表格和对话框视觉基础。

但当前版本不能按“用户故事已交付”验收。审计确认：

- 2 个 P0：管理员可删除自己且服务端无保护；OIDC `issuer` 不是 HTTPS URL，违反 OIDC Core/Discovery 的强制要求。
- 11 个 P1：命令面板整页崩溃、无角色用户静默登录失败、角色分配契约完全错配、角色删除无确认且存在状态竞态、客户端 Secret 丢失和详情页不可用、部门创建卡死、菜单管理与角色授权入口缺失、审计记录不可追责、生产种子数据与故事不一致、移动端用户管理不可用。
- 10 余个 P2/P3：用户详情能力缺失、UTC 时间误显示、个人中心点击被遮挡、抽屉不关闭、死链接、可访问性和中英文一致性问题，以及明显的首屏性能问题。

建议暂停把当前生产版本标记为完整的 RBAC/OIDC 管理门户交付；先完成 P0/P1 修复和真实角色矩阵回归，再恢复“已验收”状态。

## 2. 已验证通过的主链路

| 能力 | 结果 | 说明 |
|---|---|---|
| 未登录访问保护页 | 通过 | 访问 `/users` 经 Gateway 发起 OAuth/PKCE 并进入登录页 |
| 管理员登录与回跳 | 通过 | 完整 S256 PKCE、state、nonce、授权码、Callback 链路成功 |
| 错误密码提示 | 通过 | 页面有明确错误反馈 |
| 退出登录 | 通过 | Cookie 清理后再次访问保护页重新进入登录流程 |
| 健康检查 | 通过 | `/api/health` 返回 healthy，数据库与 Redis 均可用 |
| OIDC/JWKS 可达性 | 通过但不合规 | Discovery 200；JWKS 为 ES256/P-256 公钥且不泄露私钥 |
| 用户创建、搜索、删除 | 部分通过 | 管理员路径可完成；搜索发生 401 后回退；自删除无保护 |
| 自定义角色创建、删除 | 部分通过 | 创建成功；删除缺少确认且存在竞态 |
| 客户端创建、删除 | 部分通过 | 创建成功；Secret 未展示、详情不可用 |
| 审计 CSV 下载 | 部分通过 | UTF-8 BOM 正确；字段和时间语义不正确 |
| 桌面端基础视觉 | 基本通过 | 主列表和对话框视觉较统一 |
| 移动端仪表盘 | 基本通过 | 卡片可堆叠，侧边栏抽屉可打开 |

## 3. P0：发布阻断问题

### P0-01 管理员可以删除自己，服务端没有最后一道保护

- 对应故事：US-B-11、US-SEC-04。
- 生产表现：管理员自己的详情页正常展示“删除用户”，确认对话框可进入最终确认；为避免破坏生产管理员，本次未执行最终删除。
- 源码证据：`UserDetailForm.tsx` 无自删除隐藏/禁用；`users/actions.ts` 的 `deleteUserAction` 只校验部门范围，没有比较 `ctx.userId` 与目标用户 ID，也没有“最后一个 SUPER_ADMIN”保护。
- 风险：当前管理员可把自己逻辑删除并立即撤销自己的访问令牌；若是唯一管理员，可能造成管理面锁死。
- 建议：服务端强制禁止自删除，并在事务中保护最后一个有效超级管理员；前端仅作为体验层隐藏入口。补充自删除、最后管理员、并发删除测试。

### P0-02 OIDC `issuer` 不符合标准，标准客户端可能拒绝接入

- 对应故事：US-OIDC-01、US-H-SESS-02。
- 生产表现：Discovery 返回 `"issuer": "auth-sso"`，ID Token/Access Token 同样使用该值。
- 源码证据：`.well-known/openid-configuration/route.ts:27` 硬编码 `issuer: 'auth-sso'`；`lib/auth/token.ts` 的三类 JWT 通过 `AUTH_SSO` 设置 issuer。
- 标准依据：OpenID Connect Core 1.0 要求 Issuer Identifier 是区分大小写的 HTTPS URL；Discovery 返回的 `issuer` 还必须与 ID Token 的 `iss` 完全一致。当前虽然内部 Gateway 能自洽验签，但不满足外部 OIDC RP 的互操作前提。
- 建议：以生产 HTTPS 基础 URL 作为唯一 issuer 真相源，Discovery、JWT 签发、Portal 验签和 Gateway 验签同步迁移；明确旧 Token 失效策略并执行 OIDC conformance 回归。

标准参考：<https://openid.net/specs/openid-connect-core-1_0-final.html>

## 4. P1：核心用户故事不可用

### P1-01 `⌘K`/`Ctrl+K` 会让整个管理页面崩溃

- 对应故事：US-A-01、全局导航体验。
- 复现：在 `/dashboard` 或 `/users` 按 `⌘K`，稳定进入 “This page couldn’t load” 错误边界；重复三次一致。
- 控制台核心错误：`TypeError: Cannot read properties of undefined (reading 'subscribe')`。
- 根因：`components/ui/command.tsx` 的 `CommandDialog` 直接渲染 `CommandInput`、`CommandList` 和 `CommandItem`，没有用 `CommandPrimitive`/`Command` 根组件提供 cmdk context。
- 建议：恢复正确的 cmdk 根结构，并补充快捷键打开、搜索、选择、Esc 关闭的浏览器测试。

### P1-02 无角色用户凭证正确却静默回到登录页

- 对应故事：US-A-03、US-H-SSO-03、US-G-05。
- 复现：创建 ACTIVE、无角色用户后，登录 API 返回 200，登录审计记为成功，但浏览器没有建立最终认证 Cookie，只停留/回到登录页，页面没有“暂无权限”或错误信息。
- 根因：
  - `login/route.ts:91` 在仅完成密码校验后就写入 `LOGIN_SUCCESS`。
  - OAuth authorize 随后通过 `validateAuthorization` 返回 `no_roles`，错误交给 OAuth Callback/Gateway 后没有回显到登录页。
- 风险：用户无法判断是密码、账号还是授权问题；审计日志产生认证成功的假阳性。
- 建议：区分“凭证校验成功”和“会话建立成功”；为 `no_roles`/`unauthorized_client` 提供统一错误页或登录页反馈；按 US-A-03 提供无权限落地页。

### P1-03 用户角色分配前后端 REST 契约完全错配

- 对应故事：US-B-13、US-RBAC-04。
- 生产表现：管理员明明有 1 个已验证角色，分配角色对话框中 SUPER_ADMIN、ADMIN 均显示未勾选。
- 根因：
  - GET `/api/users/:id/roles` 使用 `restSuccess(roles)` 直接返回数组，前端却读取 `userRolesData.data`。
  - POST 成功直接返回 `{ assignedCount }`，前端只认可 `body.success || body.data`，会把成功响应显示为失败。
  - POST Schema 使用 `.min(1)`，UI 却允许取消所有勾选，无法清空角色。
- 建议：只保留一种 REST 成功契约并以共享类型约束；覆盖“读取已有角色、增加、减少到零、服务端失败”的集成测试。

### P1-04 角色删除无确认，且可能删除上一次选择的角色

- 对应故事：US-C-04、US-RBAC-02。
- 生产表现：自定义角色点击删除后直接消失，没有用户数提示或二次确认。
- 根因：`RolesTable.tsx:155` 在同一事件中先 `setSelected(r)` 再调用读取旧 state 的 `handleDelete()`，存在 React 状态竞态；服务端会直接级联删除用户角色与权限关联。
- 风险：首次点击可能无操作，也可能删除先前编辑/选择的角色；有关联用户时也不会先告知影响范围。
- 建议：把目标 ID 作为参数传给删除处理器；删除前查询关联用户并展示明确确认；系统角色和受影响用户应有服务端保护与审计。

### P1-05 客户端创建后 Secret 永久丢失，详情页也不可用

- 对应故事：US-G-02、US-G-03、US-G-07。
- 生产表现：
  - 创建页承诺 Secret 仅展示一次，但提交后直接返回列表，页面从未展示 Secret。
  - 点击新客户端的“编辑 OAuth 配置”或“管理 Secret & Tokens”均进入同一个详情 URL，并显示 `Client 不存在`。
- 根因：
  - `createClientAction` 已返回明文 `clientSecret`，`clients/new/page.tsx:53` 忽略结果并立即 `router.push('/clients')`。
  - GET `/api/clients/:id` 通过 `restSuccess(client)` 直接返回对象，详情页却读取 `data.data.name`，触发 `Cannot read properties of undefined`。
- 建议：创建成功后停留在一次性 Secret 展示页，要求用户显式确认已保存；详情页改为 Server Component 或统一 REST DTO；Secret/Token 入口使用明确 Tab 或独立路由。

### P1-06 部门创建进入永久“创建中”，删除也存在旧 state 竞态

- 对应故事：US-F-02、US-F-04。
- 生产表现：在根部门新增子部门时 POST 返回 401，按钮永久停在“创建中...”，没有错误提示；临时数据未写入。
- 根因：
  - `DepartmentTree.tsx` 的创建函数没有 `try/finally`，Server Action reject 后永远不恢复 `saving`。
  - 删除同样使用 `setSelected(dept); handleDelete()`，会读取旧选择。
  - `flattenTree` 无条件递归 children，展开/收起状态不影响实际渲染。
- 建议：先定位生产 Server Action 401 的认证边界，再用 `try/catch/finally` 恢复状态；删除目标显式传参并添加确认；树的 flatten 必须尊重 expanded 集合。

### P1-07 菜单管理模块缺失，权限维护无法创建 PAGE

- 对应故事：US-E-01～05、US-MNU-BTN-01～04、US-D-02。
- 生产表现：侧边栏没有菜单管理；权限页只有 ALL/DIRECTORY/PAGE/API 列表，创建/编辑类型下拉只有 API 和 DIRECTORY，无法创建 PAGE；也没有路径、图标、父级、排序、显隐或权限绑定。
- 数据异常：`portal:menu:dashboard` 被归类到 API，PAGE 仅覆盖部分管理页。
- 建议：明确“菜单”和“原子 API 权限”的领域边界，补齐独立树形菜单管理，不要用权限列表冒充菜单配置。

### P1-08 角色没有权限分配入口，角色 CRUD 也缺描述字段

- 对应故事：US-C-02、US-C-03、US-C-05、US-C-06。
- 生产表现：角色创建/编辑只有名称、Code、部门；没有描述输入、权限树或客户端权限分组。源码虽保留 `description` state 和 `rolePermissions` Action，但 UI 不可达。
- 建议：先实现角色详情/编辑页和按模块、客户端分组的权限树，再声明 RBAC 管理已交付；读权限用户应可只读查看。

### P1-09 操作审计不可追责，CSV 导出字段映射错误

- 对应故事：US-AUDIT-01～04、US-CROSS-06。
- 生产表现：操作日志的操作人和详情普遍为 `-`；Dashboard 近期日志却显示 `admin`，同一数据语义不一致。
- 根因：
  - `recordActionAudit` 只传 userId，不解析/写入 username，也通常没有目标资源与变更详情。
  - 操作 CSV 读取不存在的 `operator`、`resource`、`detail` 字段，而读模型实际返回 `username`、`url`、`params`。
- CSV 结果：操作人、目标资源、详情为空，且操作导出缺少状态字段。
- 建议：定义统一、强类型的审计事件模型；安全写操作在业务事务内记录 actor、target、before/after、result、trace ID；导出复用同一 DTO 并保留筛选条件。

### P1-10 生产角色与组织数据不满足用户故事基线

- 对应故事：Actor Matrix、US-C-01、US-F-01。
- 生产表现：角色页只有 SUPER_ADMIN、ADMIN，缺少故事要求的 org_admin、dept_manager、employee、app_admin、audit_viewer；部门树只显示“总公司”，用户表单却出现两个无法区分的“技术部”。
- 影响：无法在生产验收普通员工、组织管理员、应用管理员、审计员的数据范围、菜单隐藏和按钮权限故事。
- 建议：把生产验收种子与 USER_STORIES Actor Matrix 对齐；建立唯一部门编码和孤儿节点检测；部署后跑只读数据完整性检查。

### P1-11 移动端用户管理页面超出视口

- 对应故事：管理门户通用可用性。
- 复现：390×844 下 `/users` 文档宽约 511px；“新建用户”按钮和表格右侧操作列被挤出屏幕，页面底部出现整页横向滚动。
- 伴随问题：侧边栏抽屉点击导航后不关闭，Esc 也不关闭，必须点遮罩。
- 建议：移动端将标题/CTA 垂直布局，表格横向滚动限制在卡片内部或改为卡片列表；路由选择后显式关闭 mobile sidebar；加入 390px Playwright 截图与交互回归。

## 5. P2：重要体验与完整性问题

| ID | 问题 | 证据与影响 |
|---|---|---|
| P2-01 | 仪表盘指标与故事不一致 | 故事要求用户总数、在线用户、今日登录；当前展示用户、活跃角色、应用、Stable。FCP 约 3.4s、LCP 约 5.0s。 |
| P2-02 | 用户详情能力不完整 | 缺手机号、角色列表、最近登录；没有管理员重置密码入口；面包屑只有“工作台/用户管理”。 |
| P2-03 | 用户搜索发生认证失败回退 | 第一次 RSC 请求返回 401，随后整页 GET 200；结果正确但会增加延迟和闪烁风险。 |
| P2-04 | 部门树/选择器数据矛盾 | 树只显示根节点，表单出现重复“技术部”；新增子部门弹窗也不显示父级上下文。 |
| P2-05 | 时间以 UTC 当本地时间展示 | Vercel Server Component 使用未指定 `timeZone` 的 `toLocaleString('zh-CN')`，生产比 Asia/Shanghai 少 8 小时；CSV 输出原始 GMT 字符串。 |
| P2-06 | 审计筛选缺失 | 用户故事要求操作人、类型、时间、目标对象筛选；页面只有登录/操作两个 Tab 与分页。登录表也不显示 User-Agent。 |
| P2-07 | 个人中心关键按钮鼠标不可点击 | 编辑按钮被更高层 `z-10` 内容覆盖；键盘聚焦 Enter 才能打开。 |
| P2-08 | 个人中心生成非法嵌套按钮 | Base UI `DialogTrigger` 自身渲染 button，内部又放 `Button`，产生 `<button><button>`；修改密码同样存在。 |
| P2-09 | Session History 是静态占位 | 页面显示 “Device Identity Verification Active / Global SSO Node”，没有真实设备、IP、登录时间或撤销入口。 |
| P2-10 | 公共链接和系统设置不可达 | 登录页 `/help`、`/privacy` 进入 404；账户菜单“系统设置”实际仍链接 `/profile`，直接 `/settings` 也是 404。 |

## 6. P3：视觉、文案与可访问性

- 管理页、个人中心和 404 页面像三套产品：个人中心大量使用 Administrator、Auth Token、Principal ID、Permission Matrix、Functional ACL 等英文。
- 侧边栏含 System Control、Authenticated Account、Sign Out；表格含 ACTIVE、TOTAL RECORDS、Stable、Success 等未本地化状态。
- 多个纯图标按钮没有 accessible name，包括用户/客户端行菜单、复制按钮、返回箭头和部门行菜单。
- 多数 `Label` 没有 `htmlFor`，快照中输入框无法获得字段名称。
- Dashboard 没有一级标题并出现两个 `main` landmark；移动端审计表虽能内部横向滚动，但没有可发现性提示。
- 角色页标题“角色管理”、面包屑“角色权限”；客户端侧边栏“客户端管理”、页面“应用管理”，术语不统一。
- Profile 的权限矩阵直接展示 39 个原始权限代码，适合调试，不适合作为终端用户的自助权限说明。

## 7. 用户故事覆盖结论

| 模块 | 覆盖结果 | 结论 |
|---|---|---|
| A 门户底座 | 管理员菜单、面包屑、仪表盘、移动端、命令面板 | 部分通过；无角色落地、指标、面包屑、命令面板失败 |
| B 用户管理 | 列表、搜索、创建、详情、角色、删除 | 部分通过；角色分配和详情能力失败，自删除高风险 |
| C 角色授权 | 列表、创建、编辑、删除 | CRUD 部分可用；授权核心入口缺失 |
| D 权限标识 | 分类、搜索、创建表单 | 部分可用；PAGE、描述、角色引用信息缺失 |
| E 菜单管理 | 侧边栏动态结果 | 管理模块未实现/不可达 |
| F 组织架构 | 树、创建错误路径 | 未通过；数据不完整且创建卡死 |
| G OAuth 客户端 | 列表、创建、详情、删除 | 未通过；Secret 丢失、详情契约错误 |
| H 认证会话 | 登录、PKCE、回调、登出、无角色 | 管理员主链路通过；无角色错误体验失败 |
| OIDC | Discovery、JWKS | 可达但 issuer 不合规 |
| 审计 | 页面、CSV、登录/操作事件 | 未通过；不能可靠回答“谁在何时改了什么” |
| 自助服务 | 资料、密码、权限、Session | 部分可达；交互、内容完整性和视觉一致性失败 |

受生产测试数据限制，本次不能真实验收 org_admin、dept_manager、employee、app_admin、audit_viewer 的菜单、按钮与数据范围；这本身也是 P1-10 的发布验收阻塞。未执行会破坏唯一管理员或锁定测试账号的操作。

## 8. 推荐修复顺序与退出标准

1. 安全与协议：自删除/最后管理员保护、OIDC issuer 迁移。
2. 契约收敛：客户端详情、用户角色分配、审计 DTO；禁止页面自行猜测 `data` 包装。
3. 不可逆操作：角色、部门、权限删除目标显式传参，统一二次确认和影响范围。
4. 核心能力：一次性 Secret、角色权限树、菜单管理、部门 CRUD、无角色统一错误页。
5. 生产数据：补齐 Actor Matrix 和组织树，运行真实 RBAC 角色回归。
6. 交互质量：cmdk 根组件、移动端布局、抽屉关闭、Profile trigger/层级。
7. 合规与体验：审计 actor/target/diff、Asia/Shanghai 展示策略、i18n、可访问性和性能。

恢复“已交付/已验收”状态前，至少满足：

- P0、P1 全部有自动化回归并在 Vercel 生产复验通过。
- 六类测试角色逐一验证侧边栏、按钮、直接 URL、数据范围与 OAuth 应用准入。
- 所有创建/编辑/删除路径同时验证成功、401/403、校验失败和网络异常状态恢复。
- 390px、768px、桌面三档无整页横向溢出；键盘可完成导航、对话框和表单操作。
- 审计能从页面和 CSV 一致回答 actor、target、change、result、time、IP。

