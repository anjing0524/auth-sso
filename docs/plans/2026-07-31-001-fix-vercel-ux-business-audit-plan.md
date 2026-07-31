# Vercel UX 与业务审计问题修复计划

> 日期：2026-07-31
> 状态：执行中
> 来源：`docs/audit/2026-07-30-vercel-ux-business-audit.md`
> 需求基线：`docs/spec/USER_STORIES.md` v3.3、`docs/spec/REQUIREMENTS_MATRIX.md` v3.0
> 架构基线：`docs/portal-architecture-guidelines.md`、Next.js 16.2.9 本地文档

## 1. 目标

消除 2026-07-30 生产审计记录的全部 P0/P1 发布阻断，并修复同一根因下的 P2/P3 完整性、移动端、可访问性、时间与文案问题。修复结果必须满足：

1. 自删除、最后一个有效超级管理员、OIDC issuer 等安全与协议规则由服务端强制执行。
2. 内部页面写操作继续使用 Server Actions；现有外部 REST 端点保持“HTTP 状态码 + 数据直出”契约。
3. 菜单继续复用统一 `permissions` 表中的 `DIRECTORY/PAGE` 节点，不新增第二套菜单表或 Repository/Mapper。
4. 角色权限、用户角色、删除级联、审计写入等多表变更具有明确事务边界和即时会话/权限失效。
5. 页面、CSV 与 Dashboard 使用同一审计 DTO 和 Asia/Shanghai 时间语义。
6. 390px、768px、桌面端均无整页横向溢出；危险操作、表单失败、键盘和可访问名称都有自动化回归。
7. `docs/roadmap.md` 只记录已验证的状态；未部署前使用“代码修复完成，待生产复验”，不伪报生产验收通过。

## 2. 已确认的假设与取舍

### 2.1 OIDC issuer

- `NEXT_PUBLIC_APP_URL` 是公开基础 URL；`PORTAL_ISSUER` 可覆盖 issuer，但生产值必须是 HTTPS URL且不带 query/fragment。
- Discovery、Login Session、Access Token、ID Token 和 Portal 验签统一调用 `getIssuer()`。
- Access Token 的默认 audience 仍是体系内部受众标识，不把 issuer 与 audience 混为一个常量；ID Token audience 继续为 OAuth `client_id`。
- Gateway 已从 Discovery 动态构建 issuer 校验，不需要新增静态 issuer 配置。
- issuer 迁移会使旧 JWT 全部失效；发布说明明确要求一次强制重新登录。

### 2.2 无角色用户

- Portal 自身是所有已认证用户的自助入口。ACTIVE 用户即使没有角色，也允许为 `portal` 客户端完成授权并进入“暂无系统权限”落地页。
- 外部客户端仍要求用户持有该客户端对应的 API 权限；不能用 Portal 特例放宽外部应用准入。
- `LOGIN_SUCCESS` 仅在授权码已成功签发并建立可继续的认证链路后记录；密码校验成功不是登录成功。
- 侧边栏收到显式空菜单时必须保持为空，不能回退为管理员菜单。

### 2.3 菜单与权限

- `permissions.type = DIRECTORY/PAGE` 是菜单节点；`API` 是按钮/接口权限。新增 `/menus` 专用树形管理页面，但不新增菜单表。
- DIRECTORY/PAGE 节点增加可空的 `required_permission_id` 自关联，显式绑定一个 ACTIVE API 权限；侧边栏按被绑定 API 权限判断可见性。节点自身 `code` 只是菜单节点稳定标识，不再兼任访问权限。
- `required_permission_id` 只允许指向 API 节点；删除被菜单引用的 API 权限前必须给出影响提示并解除引用。系统管理页的管理操作由 `portal:menu:*` API 权限控制。
- 权限登记页允许创建三类节点并维护描述；菜单专用字段在 `/menus` 中维护，避免权限列表承担复杂树交互。
- 权限和角色 Code 创建后不可修改；类型是否允许修改按需求保留，但若存在子节点/角色引用则先通过领域规则校验。

### 2.4 审计数据

- 给 `audit_logs` 增加 `target_type`、`target_id`、`target_name`、`changes` 和 `trace_id`，而不是继续把可筛选字段塞入无约束 `params`。
- `params` 保留用于请求上下文兼容；`changes` 只记录经过脱敏的 before/after 字段，禁止密码、Secret、Token、密钥进入日志。
- 安全关键多表写操作在业务事务内插入审计记录；不能因异步 fire-and-forget 造成业务成功但日志缺失。
- 审计模块提供接收 Drizzle transaction executor 的写入函数；事务内禁止回退到全局 `db`。
- 现有审计历史允许目标字段为空；新读模型和 CSV 对旧数据提供稳定占位，不执行不可验证的数据猜测回填。

### 2.5 在线用户与会话

- “在线用户”定义为存在未撤销、未过期 Refresh Token 的去重用户数；这是当前无状态 JWT 架构可持久验证的会话近似。
- “今日登录”统计 Asia/Shanghai 自然日内的 `LOGIN_SUCCESS` 去重事件数。
- Profile 会话历史复用 Refresh Token 与登录日志，只展示真实最近登录和活跃会话，不伪造设备身份。

### 2.6 生产种子

- `seed-rbac.ts` 负责幂等的组织结构、权限、菜单和角色基线；不清空生产数据。
- 破坏性 `seed.ts` 继续仅用于干净本地/测试环境，并增加生产环境拒绝门禁。
- Actor Matrix 的演示用户和明文密码只在显式 `SEED_ACTOR_MATRIX=true` 时创建；生产默认仅创建结构性基线。

## 3. 范围与非范围

### 3.1 本次范围

- 审计报告 P0-01～02、P1-01～11、P2-01～10、P3 全部问题。
- 与上述问题同根因的 REST 契约、React stale state、Server Action pending 恢复、时间格式、Label 关联、图标按钮可访问名。
- 对应领域/API/UI/浏览器测试、迁移、种子、路线图和 `docs/solutions/` 复盘。

### 3.2 非范围

- 不新增 SAML、多租户、OIDC RP-Initiated Logout 或通用国际化框架。
- 不重写现有设计系统、不引入 Repository/Mapper、独立菜单表或新的状态管理库。
- 不在未获授权时提交、推送、创建 PR 或部署生产。
- 生产真实角色矩阵复验是部署后的放行门禁；本次先交付可部署代码、迁移、种子与自动化证据。

## 4. 总体技术设计

```mermaid
flowchart LR
  UI[Page / Client Component] --> SA[Server Action]
  EXT[外部/脚本调用] --> REST[REST Route]
  SA --> DOMAIN[纯 TS 领域规则]
  REST --> READ[data.ts 读模型]
  SA --> TX[Drizzle transaction]
  TX --> BIZ[业务表]
  TX --> AUDIT[audit_logs 结构化事件]
  BIZ --> REVOKE[缓存/JTI 失效]
  BIZ --> READ
  READ --> UI

  MENU[/menus 专用 UI] --> SA
  SA --> PERM[(permissions DIRECTORY/PAGE)]
  PERM --> SIDEBAR[动态侧边栏]
```

关键不变量：

- 所有危险操作把目标 ID 作为事件参数传递，不能先 `setState()` 再读取旧 state。
- 所有 pending 状态在 `try/catch/finally` 或 `useActionState` 中恢复。
- 所有 REST 详情成功响应数据直出；客户端不读取不存在的 `.data` 包装。
- 所有业务时间先保留 UTC 时刻，展示/导出统一格式化为 Asia/Shanghai。
- 空权限、网络错误、401、403、校验失败是不同状态，不用同一个 fallback 掩盖。

## 5. 实施单元

### 单元 0：基线与回归护栏

涉及：

- `apps/portal/node_modules/next/dist/docs/**`
- 现有 Portal/Gateway 测试配置
- 新增针对审计缺陷的失败测试

步骤：

1. 完整阅读与本次改动有关的 Next.js 16 authentication、forms、route handlers、error handling、redirecting、Cache Components 本地指南。
2. 记录当前 typecheck、Portal 定向测试和 Gateway 定向测试基线。
3. 为每个后续单元先补可复现失败测试，再实现。

验证：

- 基线失败须能区分既有问题与本次引入问题。
- 新测试带对应 `@req` 注解。

### 单元 1：OIDC issuer 与登录完成语义

涉及：

- `packages/config/src/env.ts`
- `apps/portal/src/lib/auth/token.ts`
- `apps/portal/src/app/.well-known/openid-configuration/route.ts`
- `apps/portal/src/app/api/auth/login/route.ts`
- `apps/portal/src/app/api/auth/oauth2/authorize/**`
- `apps/portal/src/domain/auth/**`
- `apps/portal/src/app/oauth/error/**`
- Portal/Gateway auth tests

步骤：

1. 在配置层验证 issuer：绝对 URL、无 query/fragment、生产必须 HTTPS；本地允许 http loopback。
2. 将签发、验签和 Discovery 统一到 `getIssuer()`，将内部 audience 单独命名。
3. 为 Portal client 增加“已认证即可进入自助壳”的明确领域规则，外部 client 保持权限准入。
4. 新增已认证但无需管理权限的 `/no-access` 页面；Portal callback 检测空角色/空权限后转入该页，页面保留 Profile、退出和联系管理员入口。管理路由仍由自身 guard 返回 403。
5. 将登录成功日志移动到授权码成功签发边界；避免 SSO 免登重复写成功日志。
6. 为 `unauthorized_client`、禁用客户端提供清晰中文 OAuth 错误页。
7. 更新 Gateway issuer 回归和部署说明，注明旧 Token 强制失效。

测试：

- Discovery issuer 等于配置 URL且与三类 JWT `iss` 一致。
- 无效/非 HTTPS 生产 issuer 启动或调用时失败。
- 无角色 ACTIVE 用户可登录 Portal、空权限且管理路由 403。
- 无角色 ACTIVE 用户最终落在 `/no-access`，刷新后状态稳定，不发生登录循环。
- 同用户访问外部未授权客户端仍被拒绝。
- 密码正确但授权失败不写 `LOGIN_SUCCESS`；成功授权只写一次。

### 单元 2：用户删除安全、角色 REST 契约与用户详情

涉及：

- `apps/portal/src/domain/user/**`
- `apps/portal/src/app/(dashboard)/users/actions.ts`
- `apps/portal/src/app/(dashboard)/users/[id]/**`
- `apps/portal/src/app/(dashboard)/users/components/AssignRoleDialog.tsx`
- `apps/portal/src/app/api/users/[id]/roles/route.ts`
- `apps/portal/src/app/(dashboard)/users/data.ts`
- 用户 API/Action/UI tests

步骤：

1. 增加纯领域删除守卫：禁止 actor 删除自身；禁止删除最后一个 ACTIVE SUPER_ADMIN。
2. 在事务内锁定目标用户和有效超级管理员集合，执行逻辑删除与结构化审计；成功后撤销目标用户会话。
3. UI 对自身隐藏删除入口，但服务端仍是权威边界。
4. 用户角色 GET/POST 全部遵循 REST 数据直出；POST 接受空数组，事务性替换关联并撤销目标用户会话。
5. 角色分配器正确加载已有选中项，并覆盖增加、减少、清空、失败恢复。
6. 用户详情补齐手机号、角色、最近登录、创建时间、管理员重置密码和完整面包屑。

测试：

- 自删除、最后超级管理员、两个超级管理员并发删除、普通用户删除。
- 角色读取、添加、减少到零、越权、跨部门角色约束、DB 回滚。
- 重置密码后会话撤销且 UI 错误/成功状态恢复。

### 单元 3：危险操作与部门交互可靠性

涉及：

- `apps/portal/src/app/(dashboard)/roles/**`
- `apps/portal/src/app/(dashboard)/departments/**`
- `apps/portal/src/app/(dashboard)/permissions/**`
- 对应领域规则和测试

步骤：

1. 删除处理器接收显式目标对象，不再依赖刚更新的 React state。
2. 角色删除前返回关联用户数/名称，确认后事务删除、审计、撤销受影响用户会话；系统角色仍不可删。
3. 权限删除前返回引用角色，确认后清理关联、审计、撤销受影响用户权限缓存。
4. 部门创建/编辑/删除统一错误恢复；树扁平化尊重 expanded；创建对话框显示父级上下文。
5. 部门删除严格拒绝有用户或子部门的节点，错误信息可操作。
6. 定位并修复生产 Server Action 401 的请求边界，不通过降低鉴权绕过。

测试：

- 每种删除的无关联/有关联/系统实体/401/403/网络失败。
- 连续选择不同角色、部门、权限时只作用于当前目标。
- 部门展开/收起、创建失败后按钮恢复、重复编码、树循环防护。

### 单元 4：OAuth Client Secret 与详情契约

涉及：

- `apps/portal/src/app/(dashboard)/clients/**`
- `apps/portal/src/app/api/clients/[id]/**`
- `apps/portal/src/domain/client/**`
- 客户端 Action/API/UI tests

步骤：

1. 创建成功停留在一次性 Secret 展示状态，支持复制和“已保存”显式确认后离开。
2. Secret 不进入 URL、日志、缓存或后续详情 DTO。
3. 客户端详情改为 Server Component 直读或正确消费 REST 直出对象；页面区分配置、Secret/Token 管理区域。
4. 轮换 Secret 同样只展示一次，旧 Secret 立即失效。
5. 纯图标复制、返回和行菜单按钮补 accessible name。

测试：

- Secret 仅创建/轮换响应出现一次；列表和详情不泄露。
- 详情直达、缺失 client、401/403、旧 Secret 失效。
- 创建后未确认离开有明确提示或可恢复展示，不发生静默丢失。

### 单元 5：菜单管理、权限维护与角色授权

涉及：

- `packages/contracts/src/permissions.ts`
- `apps/portal/src/domain/permission/**`
- 新增 `apps/portal/src/app/(dashboard)/menus/**`
- `apps/portal/src/app/(dashboard)/permissions/**`
- `apps/portal/src/app/(dashboard)/roles/**`
- `apps/portal/src/lib/menu-tree.ts`
- `apps/portal/scripts/seed-rbac.ts`

步骤：

1. 恢复 `portal:menu:*` 管理权限常量、标签和 seed；添加 `/menus` PAGE 节点。
2. `/menus` 只查询/写入 DIRECTORY/PAGE 权限节点，提供树、展开、创建、编辑、显隐、排序、父级、图标、路径和删除。
3. 菜单通过 `required_permission_id` 选择一个 ACTIVE API 权限；领域规则拒绝绑定菜单节点、禁用权限或形成父子循环。
4. 菜单路径只接受站内绝对路径（单 `/` 开头，拒绝 `//`、scheme、query 注入），图标来自既有 allow-list。
5. 权限列表补描述、关联角色数，并允许登记 DIRECTORY/PAGE/API；Code 创建后不可改。
6. 角色列表补描述和关联用户数；详情/编辑页展示按 Portal 模块和 OAuth client 分组的权限树。
7. 角色权限保存使用 Server Action + 事务替换；只读用户能看不能改；成功后撤销受影响用户权限缓存/JTI并写审计。

测试：

- 菜单树 CRUD、排序、显隐、父子级联、无权限直达 403。
- PAGE/API 类型创建、不可改 Code、角色引用提示。
- 角色权限读取、保存、清空、按客户端分组、只读模式、即时失效。
- 不同角色的侧边栏与直接 URL 权限一致。

### 单元 6：结构化审计、筛选、CSV 与统一时间

涉及：

- `apps/portal/src/db/schema/logs.ts`
- `apps/portal/src/db/schema/rbac.ts`
- 新增 `apps/portal/drizzle/0001_audit_and_menu_binding.sql`
- `apps/portal/src/lib/audit.ts`
- 所有关键 Server Actions
- `apps/portal/src/app/audit/data.ts`
- `apps/portal/src/app/(dashboard)/audit-logs/page.tsx`
- `apps/portal/src/app/api/audit/export/route.ts`
- 新增共享服务端时间格式工具

步骤：

1. 新增结构化目标、变更和 trace 字段、目标索引及菜单 `required_permission_id` 自关联约束；迁移只做向前兼容 ADD，不修改历史日志。
2. 定义强类型 `AuditEvent`；脱敏器递归剔除 password、secret、token、key 等字段。
3. 定义 `insertAuditEvent(executor, event)`，由业务 transaction 传入 `tx`；安全关键写操作在同一事务写 actor username、target、before/after、result、IP、UA、trace。
4. 读模型支持操作人、操作类型、目标、日期范围；登录日志支持用户和日期范围。
5. 页面显示 actor/target/change/result/IP/UA，筛选参数由 URL 驱动。
6. CSV 复用当前筛选和同一 DTO，补状态、UA、目标、变化；继续防公式注入。
7. 页面、Dashboard、CSV 使用明确 `Asia/Shanghai` 格式，并在文案中标注时区。

测试：

- 关键操作 audit 行完整且与业务事务同成败。
- 敏感字段永不进入 audit row/CSV。
- 每个筛选项和组合筛选正确；CSV 与页面 DTO 同源。
- 夏令时无关的 Asia/Shanghai 边界、自然日统计和公式注入。

### 单元 7：Actor Matrix、组织结构与数据完整性

涉及：

- `apps/portal/scripts/seed.ts`
- `apps/portal/scripts/seed-rbac.ts`
- 新增 seed 纯数据定义/完整性检查
- seed tests

步骤：

1. 幂等创建总部、技术部、前端组、后端组、产品部、运营部及唯一 code/ancestors。
2. 幂等创建 super_admin、org_admin、dept_manager、employee、app_admin、audit_viewer，按用户故事绑定精确权限。
3. 创建 erp/crm/disabled client 的结构性测试配置时不输出/提交固定生产 Secret。
4. 仅在显式开关下创建 Actor Matrix 用户；密码来自环境变量或测试专用默认值。
5. 增加只读完整性检查：重复 code、孤儿 parent、错误 ancestors、缺角色、缺权限绑定、重复同名部门。
6. `NODE_ENV=production` 下拒绝破坏性全量清空 seed。

测试：

- seed 重跑不重复、不漂移、不清空业务数据。
- 角色权限集合与 USER_STORIES Actor Matrix 精确匹配。
- 生产模式破坏性 seed 被拒绝；Actor 用户默认不创建。

### 单元 8：Dashboard、自助 Profile 与公共页面

涉及：

- `apps/portal/src/app/(dashboard)/dashboard/**`
- `apps/portal/src/app/profile/**`（迁入 dashboard route group，URL 保持 `/profile`）
- 新增 `/settings`、`/help`、`/privacy`
- `apps/portal/src/components/layout/**`

步骤：

1. Dashboard 改为用户总数、在线用户、今日登录，全部受部门范围约束；删除无来源的 “Stable” 宣称。
2. 页面只有一个 `main` landmark和一个 `h1`，减少不必要数据请求与阻塞串行。
3. Profile 使用 Dashboard 壳和统一中文文案，修复被遮挡层级和 Base UI 嵌套按钮。
4. Profile 展示语义化权限分组、真实最近登录和活跃会话，不展示虚构 Session History。
5. `/settings` 提供账号/安全入口；`/help`、`/privacy` 提供非 404 的公开内容并从登录页正确链接。
6. 账户菜单“系统设置”指向 `/settings`，个人资料指向 `/profile`。

测试：

- Dashboard 三指标的全局/部门范围/当天边界。
- 本地 warm run 的 Dashboard FCP/LCP 不劣于审计基线，并以 FCP ≤2.5s、LCP ≤3.5s 作为发布候选预算；生产冷启动单独记录 Server-Timing，不用调参掩盖。
- Profile 鼠标和键盘均能打开编辑/改密；DOM 无嵌套 button。
- Session 数据来自 DB；无数据时为空状态。
- help/privacy/settings 路由可达且访问控制正确。

### 单元 9：命令面板、移动端、RSC 搜索与可访问性

涉及：

- `apps/portal/src/components/ui/command.tsx`
- `apps/portal/src/components/layout/app-sidebar.tsx`
- `apps/portal/src/components/layout/DashboardLayout.tsx`
- 用户、角色、权限、部门、客户端、审计 UI
- `apps/portal/src/proxy.ts` 与 Gateway 路由分类（只在证据指向时修改）

步骤：

1. `CommandDialog` 在 cmdk root context 内渲染；覆盖打开、搜索、选择、Esc。
2. 移动侧栏在选择导航与 Esc 后关闭，并恢复焦点。
3. 用户页标题/CTA 在窄屏纵向排列；表格滚动限制在卡片内部；390px 无文档级溢出。
4. 定位 RSC 搜索第一次 401 的真实 Gateway/Proxy 请求差异，修正请求分类或认证透传，不添加静默整页 fallback。
5. 统一页面术语与中文状态；原始权限 Code 只作为次要技术信息。
6. 所有图标按钮加 `aria-label`/可见文本；`Label` 与输入 `id` 绑定；Dialog 标题/描述和错误反馈可被辅助技术读取。
7. 审计等宽表格提供可发现的横向滚动提示。

测试：

- cmdk 组件测试和浏览器快捷键测试。
- 390×844、768px、桌面截图；`scrollWidth === clientWidth` 作用于 document。
- 移动抽屉导航/Esc/焦点。
- RSC 搜索只发成功请求且保留过滤结果。
- 关键页面 axe/语义断言和键盘旅程。

主要交互状态约定：

| 场景 | Loading | Empty | Error | Success/Exit |
|---|---|---|---|---|
| 菜单/权限树 | 局部骨架，不清空旧树 | 说明如何创建首个节点 | 保留表单输入并可重试 | 刷新树并聚焦变更节点 |
| 角色授权 | 保存按钮 pending | 明确“未授予权限” | 保留勾选状态并显示错误 | Toast + 刷新权限摘要 |
| Secret 一次展示 | 提交按钮 pending | 不适用 | 保留创建表单 | 显示一次性 Secret；确认保存后退出 |
| 危险删除 | 加载影响范围 | 关联数为 0 仍需确认 | Dialog 保持打开 | 关闭 Dialog、刷新列表、焦点回到稳定位置 |
| 无角色登录 | OAuth 处理中 | `/no-access` 明确空权限 | OAuth 错误页给出重试/退出 | Profile、退出或联系管理员 |

### 单元 10：全量验证、同类审阅与文档闭环

步骤：

1. 执行 contracts、config、Portal typecheck/lint、Vitest UI/API、Playwright、Gateway fmt/clippy/test。
2. 扫描同类反模式：`.data` 契约猜测、`setSelected(); handle*()`、无 finally pending、嵌套按钮、未标时区、无 Label 绑定、无 accessible name。
3. 运行 Tier 2 代码审阅：correctness、security、testing、maintainability、project standards，并按变更触发 API/data migration/reliability/UI reviewer。
4. 对高置信发现修订后重跑受影响测试。
5. 新增 `docs/solutions/2026-07-31-vercel-ux-business-audit-remediation.md`，记录根因、预防模式、验证与发布迁移。
6. 修改前重新完整读取 `docs/roadmap.md` 和审计报告；更新为“代码修复完成，待生产复验”或真实通过状态。
7. 输出部署后生产复验清单：迁移、issuer 强制重登、Actor Matrix、六角色、移动端、CSV、回滚。

## 6. 需求与审计追溯

| 修复单元 | 审计项 | 需求 |
|---|---|---|
| 1 | P0-02、P1-02 | H-AUTH-002/003、H-SSO-001/002、H-ACL-001、US-A-03、US-G-05、US-OIDC-01 |
| 2 | P0-01、P1-03、P2-02 | B-USR-D/ST/PW、C-ROL-ASGN、H-ACL-002、US-SEC-04 |
| 3 | P1-04、P1-06、P2-04 | C-ROL-D、D-PRM-D、F-DEP-C/D、US-RBAC-02/03 |
| 4 | P1-05 | G-CLT-C/U/SEC、US-G-02/03/07 |
| 5 | P1-07、P1-08 | C-ROL-PA、D-PRM-*、E-MNU-*、US-MNU-BTN-* |
| 6 | P1-09、P2-05/06 | J-LOG-001～004、US-AUDIT-01～04、US-CROSS-06 |
| 7 | P1-10 | Actor Matrix、H-DSCOPE-001～003 |
| 8 | P2-01、P2-07～10 | A-NAV-03、US-SELF-01～03 |
| 9 | P1-01、P1-11、P2-03、P3 | A-NAV-01/02、D-POLISH-005、通用可用性 |

## 7. 验证矩阵与放行门禁

| 层级 | 必须通过 |
|---|---|
| 领域 | 自删除/最后管理员、授权、树、脱敏、时间边界纯函数测试 |
| API/Action | 真实 PostgreSQL/Redis CRUD、事务回滚、401/403、审计读回 |
| UI | cmdk、危险确认、pending 恢复、角色树、Secret 一次展示、DOM 语义 |
| Browser | 登录/无角色、用户角色、菜单/角色权限、客户端、部门、审计、Profile |
| Mobile/a11y | 390/768/桌面截图、无 document 溢出、键盘、可访问名称 |
| Gateway | issuer、RSC 搜索、JWT、OAuth 回调链路 |
| Static | typecheck、ESLint、contracts、迁移/schema 对齐 |
| Rust（若修改） | `cargo fmt --all -- --check`、`cargo clippy --all-targets --all-features -- -D warnings`、`cargo test --all-targets --all-features` |

本地代码完成门禁：

- 全部 P0/P1 有失败前复现和通过后回归。
- P2/P3 有定向组件/浏览器/静态扫描证据。
- 无新增 skipped 测试、宽泛“非 500 即通过”断言或静默降级。
- 迁移在空库和已有 `0000_initial` 数据库各执行一次成功，再次执行不破坏数据。

生产恢复验收门禁（部署后）：

- Discovery 与三类 JWT 的 issuer 完全一致且为生产 HTTPS URL。
- 六类角色逐一验证菜单、按钮、直接 URL、数据范围和外部客户端授权。
- 390px、768px、桌面无整页溢出；命令面板与 Profile 可用。
- 页面与 CSV 一致回答 actor、target、change、result、time、IP、UA。
- 观察登录/401/5xx 指标，确认 issuer 强制重登后的错误率恢复。

## 8. 回滚与部署顺序

1. 先部署向前兼容的 `audit_logs` ADD COLUMN/INDEX 迁移。
2. 部署 Portal 代码和幂等结构 seed；issuer 改变会主动使旧 Token 失效。
3. Gateway 下一次 Discovery/JWKS 刷新自动接受新 issuer；若缓存未刷新，滚动重启 Gateway。
4. 验证管理员、无角色用户和外部客户端链路，再执行六角色矩阵。
5. 回滚应用代码时新增审计列可保留；不要回滚删除列。issuer 回滚同样会再次使新 Token 失效。

## 9. 风险

- issuer 切换的必然强制登出：通过发布窗口、监控和明确提示管理，不能兼容双 issuer 而削弱校验。
- 审计写入事务化可能增加写路径延迟：字段与索引保持最小化，失败必须阻止安全关键业务提交。
- Actor Matrix 可能污染生产：默认只 seed 结构，用户创建需显式开关。
- 菜单树与 API 权限共表：所有查询必须显式按 type 分区，避免 PAGE 节点被误当 API 授权。
- 改动跨度大：按单元逐步测试和审阅，每个单元完成后保持主测试集可运行。
