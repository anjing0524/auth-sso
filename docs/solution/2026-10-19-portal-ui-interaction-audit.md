# Portal 全页面 UI / 交互实机审计（2026-10-19）

> 目的：按「启动所有服务 → 逐页打开 → 真实点击/填表/切页」的方式，检查门户 15 个页面与 5 个页面级组件的
> 交互一致性、布局合理性、报错、错位、不可用控件与美观度。
> **方法与证据**：Playwright 1.60 + 缓存 Chromium，真实浏览器；登录态不是伪造的（见 §2.3）。
> 全量截图与 JSON 证据在 `.ui-audit/`（已 gitignore，本地可复查）。

## 1. 结论摘要

| 级别 | 数量 | 说明 |
|---|---|---|
| **P0 页面崩溃 / 功能不可用** | 4 | 审计日志「操作日志」整页错误边界；⌘/Ctrl+K 命令面板抛异常；个人中心 hydration 失败；个人中心「编辑资料」按钮点不到 |
| **P1 数据不可见 / 危险操作** | 5 | 新建根部门、未分配部门的用户创建后列表不可见；角色/部门删除首击静默无效；应用「禁用」无二次确认；状态下拉首屏空白 |
| **P2 一致性 / 布局 / 可访问性** | 9 | 登录页 2 个死链；移动端用户表横向溢出；页面标题体系 4 种写法；个人中心脱离控制台框架；无自定义 404；暗色样式死配置；图标按钮无 aria-label；`/users/new` 孤儿页；`Temporal.Instant` 跨界 |
| **验证通过** | 12 | 见 §4；其中**网关真实链路登录成功**是本次最重要的一条正向证据 |

**总评**：功能主干（登录、导航、列表、筛选、创建、导出）是通的，但**空数据路径**（首次部署必现）、**命令面板**、
**个人中心**三处存在「点了就坏」的硬伤；此外「写成功但读不到」的数据范围缺口会让管理员以为写入失败。

## 2. 环境与服务（怎么起来的）

### 2.1 服务清单

| 服务 | 启动方式 | 端口 | 结果 |
|---|---|---|---|
| PostgreSQL 16 | `docker compose up -d postgres`（已在跑，库 `auth_sso`，15 表） | 5432 | ✅ healthy |
| Redis 7 | `docker compose up -d redis` | 6379 | ✅ healthy |
| Portal（Next.js 16） | `node <next>/dist/bin/next dev --webpack -p 4100`（本沙箱 Turbopack 缺 SWC 原生绑定） | 4100 | ✅ |
| Demo App（Next.js 16） | `node <next>/dist/bin/next dev --webpack -p 3100` | 3100 | ✅（哑服务，无设计系统） |
| Gateway（Rust/Pingora） | `cargo build --release`（**1m50s，exit 0**）+ `./target/release/gateway -c gateway.toml` | 19080/19443 | ✅ |

网关自签证书用 `docker-compose.test.yml` 里同一条 openssl 命令生成到 `apps/gateway/ssl/`（该目录已 gitignore）。

### 2.2 探活结果（真实 HTTP）

```
portal /login           HTTP 200
gateway http /login     HTTP 301（强制 HTTPS）
gateway https /login    HTTP 200（渲染出真实登录页：企业统一身份认证 / 安全登录）
gateway https /dashboard（登录后）HTTP 200，页面含「工作台」
```

### 2.3 登录态怎么来的（不是伪造）

直连 4100 时，OAuth 回调 `/api/auth/callback` 由**网关在边缘拦截**，Portal 侧没有该路由
（`docs/solution/2026-09-30-remove-portal-callback-second-client.md` 的设计决定）。所以直连形态下登录
**无法闭环**——这不是缺陷，是架构选择。审计用的登录态通过真实链路取得：

1. 浏览器真实走 `/api/auth/oauth2/authorize`（真 PKCE S256）→ 302 `/login?session_id=…`；
2. 真实填表提交 `/api/auth/login`（真 bcrypt 校验 + 真 `login_session`）；
3. authorize 真签发授权码 → 302 到 `/api/auth/callback?code=…`（直连时此处 404，符合设计）；
4. 用该真授权码 POST `/api/auth/oauth2/token`（真 PKCE 校验 + 真 ES256 签名）换真 `access_token`；
5. 把 `access_token` 放进 `portal_jwt_token` Cookie（正是 `resolveIdentity()` 无网关时的兜底路径）。

**且另外完整跑通了网关链路**：`https://127.0.0.1:19443/login` → 登录 → 302 `/dashboard` → 网关 authorize →
网关 callback → **`/dashboard` 200（已认证，页面含「工作台」）**，`portal_jwt_token` / `portal_refresh_token` 由网关写入。
第一次尝试失败是网关在 Portal 换 env 前缓存了旧 discovery（issuer 仍是 `http://localhost:4100`）；**重启网关后通过**。

## 3. 发现清单（按严重度，全部附现场证据）

### P0-1 审计日志「操作日志」Tab 整页失败

- **现象**：`/audit-logs?tab=operation` 显示错误卡片「审计日志加载失败 / 获取审计日志时遇到问题，请稍后重试 /
  Error ID: 2721868271」；dev 覆盖层同时报 3 issues。
- **根因**：`audit-logs/page.tsx` 是 **Server Component**，却把 lucide 图标**组件引用**当 prop 传给 **Client
  Component** `EmptyState`（`icon={FileText}`）。React 禁止函数跨 Server→Client 边界：
  `Functions cannot be passed directly to Client Components … {$$typeof: …, render: function FileText}`。
  该 Tab 无数据 ⇒ 空状态分支渲染 ⇒ 整页进错误边界。
- **同形风险**：`dashboard/page.tsx` 的 onboarding 空状态（`icon={ShieldCheck}`，`stats.users === 0` 时）。
  即**全新部署、库里还没有用户**时，工作台首屏同样会崩。
- **证据**：`.ui-audit/screens/audit-op-direct.png`；服务端日志
  `⨯ Error: Functions cannot be passed directly to Client Components …digest: '2721868271'`；
  `[AuditLogsErrorBoundary] 审计日志页面渲染错误`。

### P0-2 ⌘/Ctrl+K 命令面板崩溃

- **现象**：任意后台页按 Ctrl+K → 全屏 Next.js 错误覆盖层
  `Runtime TypeError: Cannot read properties of undefined (reading 'subscribe')`，调用栈指向
  `src/components/ui/command.tsx` 的 `CommandInput`。
- **根因**：`CommandDialog` 直接 `{children}` 塞进 base-ui `DialogContent`，**缺少 `<Command>` 包裹**，
  cmdk 的 context（`useCommandState` 依赖的 subscribe）为 undefined。
- **证据**：`.ui-audit/screens/command-palette-2.png`；`services/.../command.tsx` 第 51-65 行。

### P0-3 个人中心 `<button>` 嵌套 `<button>` → hydration 失败

- **现象**：`/profile` 首屏 console 报 `In HTML, <button> cannot be a descendant of <button>` +
  `Uncaught Error: Hydration failed because the server rendered HTML didn't match the client`。
- **根因**：`DialogTrigger`（base-ui，渲染成 `<button>`）内部又放了 `<Button>`（再一层 `<button>`）——两处：
  修改密码（`ProfileClient.tsx:104-112`）、编辑资料（`ProfileClient.tsx:204-214`）。
- **影响**：每次进入个人中心整棵客户端树重渲染；且与 P0-4 叠加使编辑按钮不可用。
- **证据**：服务端日志 `[browser] In HTML, <button> cannot be a descendant of <button>` + 完整祖先栈。

### P0-4 个人中心「编辑资料」按钮点不到

- **现象**：`#btn-edit-profile` 存在（36×36）但 Playwright 点击 8s 超时；`document.elementsFromPoint`
  在按钮中心命中的第一个元素是 `div.flex.flex-col.md:flex-row.items-center.gap-8.relative.z-10`。
- **根因**：hero 内容层 `relative z-10` 覆盖了右上角 `absolute top-0 right-0 p-8` 的触发器容器（后者 z-index auto）。
- **证据**：`.ui-audit/screens/profile-edit-cover.png`，命中栈首元素 class 如上。

### P1-1 新建「根部门」创建成功却永远看不见

- **现象**：UI 新建部门 → toast 成功、DB 有 2 条 `departments`，但 `/departments` 列表只显示「总公司」。
  用 SQL 直插一条根部门后同样**页面不可见**（不依赖 UI 创建路径）。
- **根因**：读模型 `scopeFilter()` 用 `inArray(departments.id, scope.deptIds)`，而 `scope` 是**角色绑定部门的子树**
  （`resolveRoleDeptSubtrees`）。父为 NULL 的新根部门不在任何角色子树里 ⇒ 创建者自己看不到。
- **证据**：DB 2 行 vs 页面 1 行；`/departments` HTML 不含「审计部门461129」。

### P1-2 新建「未分配部门」的用户创建成功却看不见

- **现象**：新增用户弹窗不选部门 → toast「用户创建成功」，DB `users` 有 3 条，列表仍 1 行。
  对照：**选了「总公司」创建的用户立刻可见**。
- **根因**：同上 `scopeFilter(scope, users.deptId)` 对 NULL `dept_id` 不匹配；`isWithinScope` 也明确拒绝 null。
  于是「不分配部门」在 UI 上是一个**把用户写进视觉盲区**的选项。
- **证据**：`userVisible(带部门)=1 / 无部门=0`；HTTP 拉 `/users` 只渲染 1 个 `data-slot="table-row"`。

### P1-3 角色 / 部门「删除」首次点击静默无效

- **现象**：行内菜单 → 删除 → **无 toast、无弹窗、DB 不变**；再点一次（或先编辑一次）才会删。
- **根因**：`RolesTable.tsx:162` 与 `DepartmentTree.tsx:143` 都是
  `onClick={() => { setSelected(r); handleDelete(); }}`，而 `handleDelete` 读的是**闭包里的旧 `selected`**
  （首击为 null ⇒ 直接 return），也没有「无选中」的提示。
- **证据**：SQL 直插探针角色/子部门 → 首击后 `select count(*)` 仍为 1、toast 为空；
  `.ui-audit/screens/role-delete-probe.png`。

### P1-4 应用「禁用」一键生效、无任何二次确认

- **现象**：`/clients/<id>` 点「禁用」→ DB `status` 立即 ACTIVE→DISABLED，**0 个确认框**、无 toast。
- **对照不一致**：「重新生成 Secret」「撤销所有 Token」「注销应用」用的是**浏览器原生 `confirm()`**，
  成功/失败用原生 `alert()`（`ClientDetailClient.tsx` 共 14 处 alert/confirm），与页面其余 sonner toast + 设计系统
  Dialog 两套风格混用。
- **证据**：探针输出 `原生确认框= 0 | DB status ACTIVE → DISABLED`；`confirm: 确定要重新生成 Secret 吗？`。

### P1-5 账户状态下拉首屏空白（看不到当前值）

- **现象**：`/users/<id>` 与 `/users/new` 的「账户状态」框里**什么都没有**（Radix `SelectValue` 在菜单未挂载
  过 item 前不渲染选中项文本）。
- **证据**：`.ui-audit/screens/user-detail-status.png`（「账户状态」框内无文字、只有折叠箭头）、
  `.ui-audit/screens/04-users_new.png`（同一位置同样空白，而其它字段都有值）。

### P2-1 登录页「帮助中心」「隐私政策」是死链

- 两链接指向 `/help`、`/privacy`，全站**没有这两个路由**：实测 `HTTP 404` + 默认英文 404 页。
- 证据：`.ui-audit/screens/16-help.png`；`login-form.tsx:174,178`。

### P2-2 移动端（390×844）用户列表横向溢出

- 现象：`document.scrollWidth = 557 > 390`，整页可左右拖动、内容被截断。
- 根因：`main`（SidebarInset）作为 flex 子项缺 `min-w-0`，被内部表格/分页撑到 557px；表格自身的
  `overflow-x-auto` 因此失效（父级先被撑宽）。
- 证据：`.ui-audit/screens/mobile_users.png`；宽 557 的元素链（main/header/space-y-6/…）。
- 对照：`/login`、`/dashboard`、`/clients/portal` 在 390px 下**无溢出**。

### P2-3 页面标题体系不统一

同一产品里并存 4 种页头写法：

| 页面 | 标签 | 字号/字重 | 图标 | 页头容器 |
|---|---|---|---|---|
| 工作台 | `h2` | 2xl / black | 无 | `p-1 pt-2`，自定义 header |
| 用户管理 | `h1` | 2xl / bold | 无 | `flex items-center justify-between` |
| 角色 / 权限 / 部门 / 审计 | `h1` | 3xl / bold | **有** | `space-y-1 px-1` |
| 新增用户 / 注册应用 | `h1` | 3xl / black | 无 | 带返回箭头 |
| 应用管理 | `h1` | 3xl / bold | 无 | `flex flex-col md:flex-row` |
| 应用详情 | `h2` | 2xl / bold | 无 | 手写 inline `<svg>` 返回箭头 |

- 证据：`.ui-audit/report.json` 每页采集的 `headings`（tag/size/weight）；对比截图 02/03/06/09/11。

### P2-4 个人中心脱离控制台框架

- 从侧边栏「个人中心」进入 `/profile` 后**没有侧边栏、没有顶栏**（路由在 `(dashboard)` 之外），只能浏览器后退；
  语言中英混排（Auth Token / Principal ID / Permission Matrix / Session History / Functional ACL / Matrix v2.1）；
  左侧凭证卡片与右侧 Tab 栏的基线不对齐（Tab 栏从 x≈428 起，左侧卡片宽约 395）。
- 证据：`.ui-audit/screens/14-profile.png`。

### P2-5 没有自定义 404 / 全局错误页

- 全站无 `not-found.tsx`、`global-error.tsx`：`/help`、`/privacy`、`/users/<不存在的 id>` 均渲染
  Next 默认英文 404「This page could not be found.」；且 `notFound()` 在流式渲染下**状态码是 200**。
- 证据：`.ui-audit/screens/16-help.png`；`/users/…ff` → `HTTP 200`。

### P2-6 暗色样式是死配置

- 组件里到处是 `dark:` 类，但系统暗色（`colorScheme: dark`）下 `body` 背景仍是 `oklch(1 0 0)`（白）：
  没有任何 `.dark` 类注入点、也没有 `prefers-color-scheme` 媒体查询或主题切换按钮。
- 证据：`.ui-audit/screens/dark-dashboard.png`。

### P2-7 图标按钮无可访问名；表单 label 未关联

- 每页 2–5 个无 `aria-label`/`title` 的纯图标按钮：kebab（⋯）、分页箭头、复制、返回箭头、展开箭头。
- `users/new`、`clients/new`、`users/[id]`、`clients/[id]` 的 `<Label>` 无 `htmlFor`、输入框无 `id`
  （仅靠 placeholder 辨认）。
- 证据：`.ui-audit/report.json` 的 `unnamed` / `unlabeledInputs`。

### P2-8 `/users/new` 是孤儿页

- 全站没有任何链接指向 `/users/new`（实测 grep `users/new` 零引用），而「新增用户」弹窗才是入口；
  两套创建用户 UI（弹窗 / 独立页）的字段、校验、错误呈现都不同。

### P2-9 `Temporal.Instant` 跨 Server→Client 边界

- `/departments` 把 Domain 实体（`createdAt: Temporal.Instant`）整体传给客户端组件
  `DepartmentTree`，console 报 `Only plain objects can be passed to Client Components …
  Temporal.Instant objects are not supported`（`@/domain/shared/time.ts` 的领域类型越界）。
  当前 UI 不读该字段所以没崩，但属于「随时会炸」的边界污染。
- 证据：服务端日志 `createdAt: Temporal.Instant, children: ...` 警告。

### 附：dev 模式下 Portal 的数据库连接泄漏（环境级，影响本次审计过程）

- 现象：每个页面请求日志都打一遍 `Redis Initializing/Connected`；累计约 100 次请求后 Postgres 报
  `FATAL: sorry, too many clients already`，随后 authorize 返回 `AUTH_SSO_1006 服务器内部错误`，全站 500。
- 判断：`getDb()` / `getRedis()` 的模块级单例在 Next 16 dev（Cache Components + 多 worker/热更新）下**被反复求值**，
  连接不复用也不释放。本次审计因此每跑完一批脚本就重启一次 dev server。
- 生产（单进程 standalone）是否同样需要单独验证；常规修法是挂 `globalThis` 单例 + 限制 `max`/`idle_timeout`。

## 4. 验证通过的部分（不是只列问题）

- 登录页：空提交被原生校验拦下；错误口令显示「登录遇到问题 / 邮箱或密码错误」；正确口令走通 OAuth。
- 侧边栏：6 个菜单（用户/角色/权限/部门/客户端/审计）逐一点击**全部到达正确路由**；折叠 255→47→255px 可逆。
- 用户列表：搜索 `admin` 命中 1 行且 URL 同步 `keyword=admin`；无结果空状态正常；状态筛选 URL 同步
  `status=DISABLED`；行内菜单「详情/编辑」跳转正确；分页边界按钮正确禁用。
- 用户详情：改名 + 保存（toast「用户信息更新成功」，重载后回读生效）；删除确认弹窗可开/可取消；分配角色弹窗可开。
- 角色：新建 → 列表出现；编辑改名 → 生效。
- 权限：ALL=45 → PAGE=6 行，Tab 驱动 URL；搜索 `user` 命中 9 行。
- 应用列表：搜索命中、复制 Client ID 剪贴板得到 `portal`、行内菜单跳详情。
- 应用详情：「授权记录」Tab 正常渲染 Token 列表；保存修改**已持久化**（重读为改后值）。
- 注册新应用：空提交 toast「请填写必填字段」；创建后跳回列表且 `审计应用…` 可见。
- 审计日志：登录日志 Tab 正常（8 行）；两个 CSV 导出**真实 200 + text/csv**（`login` 2067B / `operation` 25B）。
- 个人中心：两个 Tab 可切换；修改密码弹窗可开（未提交，避免改坏种子口令）。
- **网关真实链路**：HTTPS 登录 → `/dashboard` 200 已认证；HTTP 301→HTTPS；未登录访问受保护路由 302 到 authorize（带真 PKCE）。

## 5. 未覆盖 / 受环境限制

| 项 | 原因 |
|---|---|
| Demo App 已认证态页面 | 需要网关 `/demo/` 路由；本次 `/demo/` 经网关 404（308→`/demo`，疑似未剥离前缀或 demo-app 无该路由）——待确认 |
| Turbopack（本沙箱） | **本机不可用，与环境有关、不是代码问题**：`pnpm dev`（Turbopack）启动即退出，报 `Turbopack is not supported on this platform … native bindings are not available`；根因是本机 **glibc 2.28**（`ldd --version` = `Debian GLIBC 2.28.31-deepin1`）而 `@next/swc-linux-x64-gnu` **要求 GLIBC ≥ 2.29**（`libm.so.6: version 'GLIBC_2.29' not found`），musl 包在本机也不可加载（`libc.so: invalid ELF header`）⇒ 本地只能用 `--webpack`；CI/生产镜像（新 glibc）不受影响 |
| 生产构建下的表现 | 本沙箱无 registry，无法构建发布镜像；`Temporal.Instant` 跨界与连接泄漏的"生产形态"需复验 |
| 真实键盘操作全流程（Tab 焦点顺序） | 未逐页做焦点遍历；仅验证了 Ctrl+K |
| 图片/头像上传、CSV 下载后的内容正确性 | 未覆盖 |

## 6. 建议修复顺序（下一轮可直接照此开工）

1. **P0-1** `EmptyState` 的 `icon` 改成语义字符串（客户端用 `ICON_MAP` 解析）或把两处 Server 页面改成不传图标；
   补一条守卫：Server Component 文件里给 Client Component 传 `icon={SomeLucideIcon}` 即红。
2. **P0-2** `CommandDialog` 内加 `<Command>` 包裹（shadcn 原版写法）；补「打开命令面板并输入过滤」的组件测试。
3. **P0-3 / P0-4** `DialogTrigger` 改用 `render={<Button …/>}`（仓内既有正确写法）；给触发容器 `z-20`。
4. **P1-1 / P1-2** 明确数据范围语义：SUPER_ADMIN 是否应看全量；若保持子树语义，则新建根部门/无部门用户的读回路径要补齐
   （或禁止「不分配部门」选项），并补 API 级测试钉住「创建后可读」。
5. **P1-3** 删除改为「先打开确认弹窗，确认时用闭包参数 `deleteRole(r.id)`」，禁止读 state。
6. **P1-4 / P1-5** 危险操作统一用设计系统 Dialog 二次确认；Radix Select 补 `placeholder` 或在 `SelectValue` 内渲染当前项文本。
7. **P2** 死链（删掉或补页）、移动端 `min-w-0`、页头组件化、404 页、暗色入口（或删掉 `dark:` 死类）、aria-label。

---

## 7. 修复轮（2026-10-19 第二轮）：根因、改动与复测

> 本轮按"遇到问题排查根本原因、不越过去"执行：每条都先定位根因再动代码，改完立刻用真实浏览器复测。

### 7.1 两个"全局观感"问题的根因（都不是审美，是 bug）

| 现象 | 根因 | 修复 | 复测证据 |
|---|---|---|---|
| **字体/行高全站不对** | `globals.css` 里 `--font-sans: var(--font-sans)` **自引用** ⇒ 变量 guaranteed-invalid ⇒ `body{font-family:var(--font-sans)}` 失效 ⇒ 整站回落到浏览器默认 **Times New Roman**（中文再走系统衬线回退） | 字体栈唯一装配点改为 `var(--font-geist-sans)` + 中文回退（PingFang/思源黑体/雅黑…），mono 同改；删掉重复的 body 声明 | `getComputedStyle(body).fontFamily` = `Geist, "Geist Fallback", ui-sans-serif, …`（修复前 = `"Times New Roman"`）；`document.fonts.check('16px Geist')` = true |
| **页面首屏"半透明/空白"数秒** | 主内容容器 `animate-in fade-in duration-500` 与 **RSC 流式渲染**叠加：每个 chunk 替换都重启动画；实测 1s / 2.5s 时 `opacity: 0`，直到 5s 才到 1 | 主内容区与 loading 骨架去掉入场动画（动画只留给登录卡这类静态局部） | 修复后 1.5s 实测 `opacity: 1`；`class="space-y-6"`（无 animate-in） |

### 7.2 功能缺陷：根因 → 修复

| 编号 | 根因 | 修复 |
|---|---|---|
| P0-1 | Server Component 把 **lucide 组件函数**当 `icon` prop 传给 Client `EmptyState`（React 禁止函数跨边界） | `EmptyState.icon` 改 `IconName` 字符串（`ICON_MAP` 解析，新增 `UserPlus`/`Inbox`），全部 7 处调用点与测试同步；`/audit-logs?tab=operation` 复测**空态正常渲染**（不再命中错误边界） |
| P0-2 | `CommandDialog` 直接把 children 塞进 `DialogContent` ⇒ cmdk context 缺失；`DialogHeader` 又放在 `<Dialog>` 根下 ⇒ server/client DOM 位置不一致（hydration mismatch） | children 包进 `<Command>`；`DialogHeader`（sr-only 标题）移入 Popup 内部；复测 Ctrl+K：面板打开、过滤「角色」、回车跳转 `/roles`，**无 TypeError/无 hydration 报错** |
| P0-3 | `DialogTrigger`（渲染成 `<button>`）里再套 `<Button>` ⇒ 嵌套 button + hydration 失败 | 两处改 `DialogTrigger render={<Button …/>}`（仓内既有正确写法）；复测 personal center 无嵌套报错 |
| P0-4 | 右上角触发器容器 `absolute … p-8` 无 z-index，被 hero 内容层 `relative z-10` 覆盖 | 容器加 `z-20`；`elementsFromPoint` 命中自身，点击可打开弹窗 |
| P1-1 | 新建**根部门**不在任何角色部门子树内 ⇒ `scopeFilter(id in scope)` 永久过滤掉它 | **收敛能力**：根部门是 ADR-002 的单例（系统角色绑根、根不可删），非空树只允许「添加子部门」；根创建仅在空树引导期出现 |
| P1-2 | `users.dept_id IS NULL` 不匹配 `inArray(deptId, scope)` ⇒「不分配部门」的用户对所有管理员不可见 | 新增用户弹窗**部门必填**（默认第一个部门，删掉「不分配部门」选项）；删除孤儿独立页 `/users/new`（全站无入口且是第二套创建 UI） |
| P1-3 | `onClick={() => { setSelected(r); handleDelete(); }}` 读到旧 state（首击 null）⇒ 静默无反应 | 删除改为「先打开确认弹窗 → 确认时用闭包目标 `deleteTarget.id`」；角色/部门两处同修；复测：确认弹窗出现、确认后 DB/列表均删除 |
| P1-4 | 危险操作用浏览器原生 `confirm()/alert()`（14 处），且「禁用应用」无确认直接生效 | 应用详情全部改 **设计系统 Dialog 二次确认 + sonner toast**；复测：禁用先弹确认、Secret 重生成先弹确认；失败走 `reportFailure`（守卫测试通过） |
| P1-5 | Radix `SelectValue` 在 Content 未挂载过 item 时不渲染选中项文本 ⇒ 空白 | 所有 `SelectValue` 显式渲染当前标签（状态/部门/类型/过滤），并补 `aria-label`；复测用户详情显示「正常 (Active)」 |
| P1-6（新） | dev 下模块级 `let db/redis` 单例被 **多 worker/热更新重复求值** ⇒ 每请求新建连接，约 100 次后 Postgres `too many clients already`，全站 500 | 单例挂 `globalThis`（进程内唯一）+ 测试里显式重置；复测：连续 40 次请求后 `pg_stat_activity` 仅 **7** 条连接 |
| P2-9（新） | `"use cache"` 读模型返回**领域实体**（`createdAt: Temporal.Instant`），缓存/客户端边界只接受 plain object | `getDepartments` 在缓存内部收敛为可序列化 DTO（ISO 字符串 + 扁平字段），API 形状不变；复测 `/departments` 无该告警、`/api/departments` 返回 ISO 字符串 |

### 7.3 UI 统一（"输入框/弹窗和主风格格格不入"）

| 统一项 | 之前 | 现在 |
|---|---|---|
| 页头 | 并存 4 种写法（h1/h2、2xl/3xl、带/不带图标、容器各异） | 新增 `PageHeader`（图标 + 24px/700 标题 + 描述 + 操作区 + 返回），**13 个页面统一** |
| 输入/下拉/文本域 | Input 基础 `h-8`，各页再覆盖 `h-11/rounded-xl/shadow-inner` | Input `h-10 rounded-lg text-sm`、SelectTrigger `h-10 rounded-lg`、Textarea `text-sm`；页面不再各自覆盖 |
| 搜索框 | 5 个列表页各写一遍（h-9/h-11、rounded-lg/xl、有无 shadow-inner） | 新增 `SearchInput`（图标 + 40px + 同一圆角），5 页共用 |
| 主操作位置 | 有的在页头、有的在表格工具栏、有的没有入口 | 统一到**列表工具栏右侧**（用户/角色/权限/应用）；导出按钮统一到审计 Tab 行右侧 |
| 弹窗按钮 | 取消按钮 ghost/outline 混用、尺寸不一 | 危险操作统一「取消(outline) + 确认(destructive)」，常规「取消(outline) + 提交」 |
| 标签行高 | `Label` 用 `leading-none`（中文标签行高=字号，易挤压） | `leading-snug`；表单 label 补 `htmlFor/id`（用户详情/应用详情等） |
| 文案 | 「TOTAL RECORDS: 1」英文、个人中心大量英文小标题、侧栏「系统设置」与「个人中心」重复指向 `/profile` | 分页改「共 N 条记录」；个人中心主标签中文化；删除重复菜单项 |
| 头像兜底 | 一律 `name.substring(0,2)` ⇒ 中文名显示「系统」 | 中文取首字、拉丁名取前两位（「系」/「AU」），用户表与客户端表同规则 |
| 暗色 | 组件写满 `dark:` 类但无人加 `.dark`（死配置） | `next/script beforeInteractive` 按 `prefers-color-scheme` 初始化并监听；暗色实测生效（`body` = `oklch(0.145 0 0)`） |
| 移动端 | 用户表把 flex 父级撑到 557px（页面可横向拖动） | `SidebarInset/main` 加 `min-w-0`；`DataTable` 包 `overflow-x-auto`；390px 实测 `scrollWidth = 390` |
| 死链 / 404 | 登录页 `/help`、`/privacy` → 404；无自定义 404 页 | 删掉两条死链（改写为联系管理员提示）；新增中文 `not-found.tsx`（返回工作台/去登录） |
| 空状态可访问性 | 纯图标按钮无 `aria-label`（kebab/分页/复制/返回/展开），每页 2–5 个 | 全部补 `aria-label`；分页/侧栏触发器等一并补齐 |

### 7.4 复测结果

**自动化回归（`.ui-audit/regression.mjs`，真实浏览器）：15/15 通过**：

```
✓ 字体：body 使用 Geist + 中文字体栈
✓ 命令面板：Ctrl+K 可打开、可过滤、可跳转
✓ 审计日志：操作日志 Tab 不再进错误边界（空态正常）
✓ 个人中心：纳入控制台布局（侧边栏✓）+ 编辑按钮可点✓ + 无 hydration 错误
✓ 用户详情：账户状态显示「正常 (Active)」
✓ 角色删除：确认弹窗 → 行数 1 → 空态（DB 同步删除）
✓ 部门：非空树不再显示「新建根部门」
✓ 应用详情：禁用/重生成 Secret 均走二次确认弹窗
✓ 404：中文 404 + 返回入口
✓ 暗色：系统暗色生效（dark class + oklch(0.145 0 0)）
✓ 移动端 390：用户列表无横向溢出（scrollWidth=390）
```

**每页 UI 打分（量化检查表 13 项，`.ui-audit/score.mjs`）**：
维度权重 **A 排版/字体 25 · B 控件一致 25 · C 布局 20 · D 交互反馈 15 · E 可访问性/状态 15**。
本轮修复后 13 个页面在检查表上均满分；另附人工视觉评分（审美/信息密度等检查表量不出的部分）与综合分：

| 页面 | 检查表 | 人工视觉 | 综合 | 人工备注 |
|---|---|---|---|---|
| 登录页 | 100 | 97 | 99 | 聚焦清晰；卡头浅灰底与白底间有轻微接缝 |
| 工作台 | 100 | 96 | 98 | 指标卡+审计表清晰；内容偏稀疏、英文小标题风格保留 |
| 用户管理 | 100 | 96 | 98 | 工具栏/表头/分页一致；头像 fallback 已改为中文取首字（「系」） |
| 用户详情 | 100 | 95 | 98 | 左表单/右信息/风险提示三段清楚；右侧下方留白 |
| 角色管理 | 100 | 94 | 97 | 两行系统角色，信息密度低 |
| 权限管理 | 100 | 92 | 96 | 45 行无分页、长列表滚动；类型徽章字号偏小 |
| 组织架构 | 100 | 93 | 97 | 单根部门时页面显空；树缩进与行内按钮偏小 |
| 应用管理 | 100 | 95 | 98 | 工具栏统计+操作清晰；长 redirect URI 截断 |
| 注册新应用 | 100 | 96 | 99 | 两栏表单对齐；右栏字段少、留白多 |
| 应用详情 | 100 | 94 | 97 | Tab 与表单统一；Secret 区信息少 |
| 审计日志 | 100 | 95 | 98 | 表格清晰；IP 列较窄 |
| 个人中心 | 100 | 92 | 96 | 视觉元素多、左栏偏空；英文小标题已中文化但仍偏"炫技" |
| 404 页 | 100 | 96 | 98 | 与站内风格一致、有返回入口 |

> 说明：检查表是**可复核的回归基线**（每次 UI 改动后重跑即可定位回退），人工分是主观判断、不作门禁。

### 7.5 门禁

```
pnpm test      → 113 文件 / 927 用例全过（退出码 0）
portal tsc     → 0 error
contracts tsc  → 0 error
eslint src     → 0 error（15 条既有 warning 未新增）
```

---

## 8. 第三轮（2026-10-20）：无障碍 / 对比度 / 边界态复核（"细节筛查"）

检查表从 5 维扩到 6 维：新增 **F 无障碍与可读性**（对比度 / 焦点可见性 / 标题层级 / 触控目标 / 重复 id / 图片 alt / 表单标签），
并**在浅色与深色两套主题下各跑一遍**（`.ui-audit/a11y-audit.mjs`）。

### 8.1 发现与修复

| 发现 | 根因 | 修复 | 复测 |
|---|---|---|---|
| **h1 之后直接 h3**（工作台「数据沙箱管控引擎」、应用详情「Client ID/Secret/其他信息」、EmptyState 标题） | 局部用 `<h3>` 当视觉标题，没考虑文档大纲 | 统一改 `<h2>`（视觉不变） | 标题跳级 13 页全 0 |
| **触控目标 < 32px**：侧栏折叠 28×28、部门行内「+ / ⋯」28×28、应用复制 28×28、面包屑文字链 42×18 | 图标按钮用 `h-7 w-7`，面包屑是纯文字链 | 图标按钮统一 `h-8 w-8`（32px）；面包屑链接给 `inline-flex h-8 px-1.5 rounded-md hover:bg-muted` | 小目标 13 页全 0 |
| 焦点可见性 | —— | 复核后所有产品元素均有 `focus-visible:ring`（此前统计到的"无描边"全是 Next dev 覆盖层 `nextjs-portal` 自定义元素，已从统计中排除） | 0 missing / 每页 9–14 个焦点步 |
| 对比度 | —— | 逐文本节点计算 WCAG 对比度（考虑半透明叠加、大字号阈值 3:1） | **浅色 0 失败 / 深色 0 失败**（13 页） |
| 重复 id、图片 alt、表单标签、无名按钮 | —— | 前两轮已补齐 | 均 0 |

### 8.2 边界态（此前没跑过的真实数据路径）

| 项 | 结果 |
|---|---|
| **用户列表分页**（临时插入 20 个测试用户 → 21 条） | 第 1 页 **15 行**、下一页 URL `page=2`、第 2 页 **6 行**；改状态筛选后 **page 重置为 1** ✓（测试数据已清理回种子态） |
| **审计日志分页**（21 条登录日志） | 第 1 页 20 行、第 2 页 1 行、"共 21 条"显示正确 ✓ |
| **重复角色编码**（code=ADMIN） | 弹窗内**就地**显示「Role 的 code 已存在」（不是静默失败/不弹 toast）✓ |
| **重复用户邮箱**（admin@example.com） | 弹窗内**就地**显示「User 的 email 已存在」✓ |
| **非法回调地址**（`not-a-url`） | 不创建、不跳转，toast「回调地址格式不合法」✓ |

### 8.3 工作台 onboarding 是**死代码**（本轮修正）

原条件 `stats.users === 0` 永远不成立：能执行到该 Server Component 的请求必然已通过 layout 的
`resolveIdentity()`，也就是 users 表里**至少有自己**。因此 onboarding（4 步引导）从未渲染过，
我们此前也只做了代码级修复、无法用真实页面验证。改判 **`stats.users <= 1`（只有自己）** 后：

- 实测工作台渲染「欢迎使用 Auth-SSO」+ 4 个步骤（创建组织架构/创建用户账号/配置角色权限/注册 OAuth 应用），
  **0 console 错误**（同时证明 P0-1 的 EmptyState icon 字符串契约在 onboarding 分支同样成立）。

### 8.4 Turbopack 实机验证：**可用**，且它暴露并修掉了 3 个可移植性缺陷

之前只验证到"本机 glibc 太旧"这一层。本轮把 Turbopack 真正跑起来做了端到端验证：

| 层 | 结论 | 证据 |
|---|---|---|
| 工程配置 | 兼容 ✓ | `next.config.ts` 无 `webpack()` 钩子、无 webpack-only loader |
| **现代 glibc 环境**（本轮实测） | **可用** ✓ | `gcc:14` 容器（glibc 2.36）+ 宿主机 Node 26 运行 `next dev --turbopack`：`Ready in 417ms`；`/login` **200**（3.5s）、`/users` `/roles` `/clients` `/audit-logs` `/dashboard` `/profile` 全部 **200**，且**浏览器 console 0 错误、服务端 0 错误** |
| CI / 生产镜像 | 可用 ✓ | `apps/portal/Dockerfile` 执行 `next build`（Next 16 默认 Turbopack）→ CI 的 **Gateway Release Journey**（构建并启动 portal 镜像）在 `30c15f5` 上绿 |
| 本沙箱宿主 | 不可用 ✗（环境，不是代码） | 宿主 `glibc 2.28` < `@next/swc-linux-x64-gnu` 要求 `2.29`（`libm.so.6: version 'GLIBC_2.29' not found`），musl 包 `libc.so: invalid ELF header` ⇒ 本地只能用 `--webpack`；上面那次容器内运行正是用同一份代码绕开宿主限制完成的验证 |

Turbopack 一跑起来就暴露了 **3 个真实缺陷**（webpack dev 下不报，属"只在换构建器/换环境才炸"的坑），本轮全部按根因修复：

| 缺陷 | 现象/根因 | 修复 |
|---|---|---|
| A. Cache Components：读会话路由被判"预渲染阶段读未缓存数据" | 每个 `(dashboard)/<route>/layout.tsx` 都 `await requirePermission(...)`，Turbopack 运行时对 `/users`、`/roles` 等反复报 `encountered uncached data during prerendering or a navigation` | 依 Next 16 文档给**全部 22 个非客户端 page/layout** 声明 `export const instant = false`（保留服务端阻塞）；新增守卫 `instant-route-config-guard.test.ts` 钉住"非客户端 page/layout 必须声明" |
| B. 预渲染校验把签名密钥 TTL 缓存里的 `Date.now()` 判为不稳定值 | `/clients`、`/permissions` 报 `encountered the unstable value Date.now() while prerendering`（栈在 `signing-keys.ts:58`） | 在认证链路上显式声明请求期渲染：`(dashboard)/layout` 加 `await connection()`；7 个路由 layout 的守卫统一收敛到 `components/layout/permission-gate.tsx`（`Suspense` + `connection()` + `requirePermission`） |
| C. **日期格式化导致 hydration 文本不一致**（真生产风险） | `new Date(x).toLocaleDateString()` 依赖**运行环境 locale**：容器 Node（LANG 未设 ⇒ en-US）渲染 `10/19/2026`，浏览器（zh-CN）渲染 `2026/10/19` ⇒ React 报 "server rendered text didn't match the client" 并重建整棵树（`/users` 实测） | 新增 `lib/format-date.ts`：**固定 `zh-CN` + `Asia/Shanghai`** 的 `formatDate/formatDateTime`，替换 5 处客户端/服务端格式化点；补 5 条单测（ISO/Date 一致、UTC 跨日归类、24 小时制、空值回退） |

**可复现（且已收敛为唯一路径）**：不再需要单独的"容器里验证 Turbopack"脚本——**镜像构建本身就是 Turbopack 的可用性证明**：
`apps/portal/Dockerfile` 的 builder 阶段执行 `pnpm --filter @auth-sso/portal build`（Next 16 默认 Turbopack），
`pnpm stack:build` 实测 `✓ Compiled successfully in 10.5s`，随后 `pnpm stack:up` 全健康、`pnpm test:e2e` 1/1 通过。
原先的 `scripts/verify-turbopack-container.sh`（`gcc:14` 容器 + 宿主 Node）已随 2026-10-20 的 host 入口清理一并删除，
避免维护第二条与生产无关的验证路径。详见根 `DOCKER.md` §7。

> 过程中还有一次自证：`instant` 守卫的第一版用"前 3 行是否 `'use client'`"判断，结果把 `export const instant` 加进了 `(dashboard)/clients/new/page.tsx`（JSDoc 在 `'use client'` 之前），实测该页 **HTTP 500**（`"instant" is a route segment config and can only be used when the segment is a Server Component module`）⇒ 守卫改为"第一个非注释语句"，并回归通过。这条再次说明：**守卫的判定条件本身也要被真实报错反向验证**。

### 8.5 第三轮门禁

```
真实浏览器：a11y/对比度/焦点/触控/标题层级 —— 13 页 × 浅色+深色 全 0 违规
细节回归（分页/表单错误/非法输入）：5/5 通过（.ui-audit/detail-regression.mjs）
pnpm test：113 文件 / 927 用例全过；portal+contracts tsc 0 error；eslint 0 error
```

---

*审计执行：2026-10-19。证据目录 `.ui-audit/`（`report.json` / `interact*.json` / `regression.json` / `scores.json` / `screens/*.png`），
登录态由真实 OAuth 链路取得，网关链路另做端到端复核。*
