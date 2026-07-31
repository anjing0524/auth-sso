# Vercel UX 与业务审计整治

> 对应审计：`docs/audit/2026-07-30-vercel-ux-business-audit.md`  
> 实施计划：`docs/plans/2026-07-31-001-fix-vercel-ux-business-audit-plan.md`

## 问题

生产审计发现的问题并不是一组彼此独立的页面瑕疵，而是五类边界同时发生漂移：

1. 安全约束只存在于 UI，没有在事务内保护自删除、最后一个超级管理员和数据范围。
2. OIDC issuer、REST DTO、菜单权限和页面读取模型各自维护了不同的隐式契约。
3. 删除、创建、Secret 展示等有副作用流程依赖 React 旧 state，或没有失败后的状态恢复。
4. 审计事件与业务写入分离，缺少 actor、target、change、result、trace 等可追责字段。
5. Cache Components、时区、响应式和可访问性没有作为跨模块规则统一执行。

这些问题会相互放大。例如用户角色 REST 契约错配使 UI 显示错误，错误的危险操作目标又可能被无审计地写入；无角色登录在密码校验阶段提前记录成功，随后却因授权失败回到登录页。

## 核心决策

### 安全约束归业务事务所有

- 删除用户时锁定目标用户和有效超级管理员集合，在同一事务内禁止自删除及删除最后一个有效 `SUPER_ADMIN`。
- 用户详情先解析身份、权限和部门数据范围；超出数据范围返回 404，缺少功能权限返回 403。按钮隐藏仅用于体验，不作为授权边界。
- 角色、权限、菜单、部门、客户端和用户的关键写入都在业务事务内追加结构化审计；业务或审计任一失败，整体回滚。
- 生产种子入口默认拒绝破坏性重置。Actor Matrix 仅在显式开关开启且密码由专用环境变量提供时创建。

### 契约只有一个真相源

- OIDC issuer 由 `getIssuer()` 统一解析，生产必须是 HTTPS URL；Discovery、JWT 签发、Portal 验签与 Gateway 从 Discovery 建立的验签规则保持一致。`aud` 继续使用独立的资源标识，不能与 issuer 混用。
- 用户角色 GET 直接返回共享 `UserRoleDto[]`，POST 只接受 `{ roleIds }`，空数组表示清空角色；调用方不再猜测 `data` 包装。
- 菜单节点与 API 权限分离：`DIRECTORY/PAGE` 表示导航结构，`requiredPermissionId` 显式绑定可见权限；菜单本身的 CRUD 使用独立 `portal:menu:*` 权限。
- 状态、角色编码、菜单图标和权限码全部从 `@auth-sso/contracts` 派生，禁止页面手写同义常量。

### 危险交互显式携带目标

- 删除处理器接收明确目标对象，不在 `setState()` 后立即读取可能过期的选择状态。
- 删除确认展示目标名称及用户、角色或菜单绑定影响范围。
- 所有异步提交使用 `try/catch/finally` 恢复 pending 状态；成功、服务端拒绝和网络异常都必须可继续操作。
- OAuth Client Secret 创建成功后停留在一次性展示状态，用户明确确认已保存后才能离开。

### 审计是强类型业务数据

`audit_logs` 增加：

- `target_type`、`target_id`、`target_name`
- `changes`（脱敏的 before/after）
- `trace_id`

操作人用户名在写入时冗余保存，避免用户删除后无法追责。页面与 CSV 复用相同字段语义；日期筛选和展示都按 `Asia/Shanghai` 自然日处理。IP、User-Agent 和 varchar 字段在入库前验证或截断，避免异常请求头反向导致业务事务失败。

### Next.js 16 运行期边界必须可构建

菜单读模型使用 `"use cache"`、`cacheLife()` 和 `cacheTag()`。因为菜单页没有 `searchParams` 等天然运行期信号，页面在查询前显式调用 `connection()`，让数据库填充发生在真实请求期；否则 `next build` 会在静态壳生成阶段连接 PostgreSQL。

这条规则只适用于确实需要请求期外部数据、又没有其他运行期边界的入口，不扩散为全局 `dynamic` 配置。

## 同类问题审阅与修订

完成首轮实现后，按相同根因对所有改动做了横向复查，并追加以下修订：

- 权限与数据范围：用户详情补上服务端部门范围校验及更新、删除、分配角色、重置密码的独立能力门禁。
- 审计可靠性：请求头字段增加长度限制，IP 必须是合法字面量；日期筛选从服务器本地时区修正为上海自然日。
- 数据一致性：Dashboard 的用户总数、在线用户和今日登录使用相同部门范围；在线数按有效 Refresh Token 的用户去重。
- 删除影响：权限删除确认补充角色绑定和菜单绑定数量。
- 部署配置：`/help`、`/privacy` 同步加入四份 Gateway 配置，避免 Portal 有页面但 Gateway 仍把它们拦截。
- 迁移可靠性：新增列、索引和自引用外键支持重复执行；避免部署中断后重跑 migration 失败。
- 构建边界：生产构建发现 `/menus` 在预渲染期访问数据库后，补充请求期边界并再次完整构建通过。
- 文案一致性：清理审计涉及页面中的 `Unknown`、`Success`、`Sign Out` 等残留英文，并补齐图标按钮 accessible name 与表单 label 关联。

没有借本轮审计扩展 SAML、多租户或其他范围外能力；仓库既有的 Rust `#[async_trait]` 使用也未在与本次 Gateway 续签无关的模块中顺带重构。

## 数据库与发布顺序

1. 备份生产数据库。
2. 执行 `pnpm db:migrate`，应用 `0001_menu_required_permission.sql` 和 `0002_structured_audit.sql`。
3. 执行结构性 `pnpm db:seed`；仅验收环境按需设置 `SEED_ACTOR_MATRIX=true` 和 `SEED_ACTOR_PASSWORD`。
4. 配置生产 `PORTAL_ISSUER=https://auth-sso-stack.vercel.app`，并确保公开基础 URL 一致。
5. 部署 Gateway 与 Portal。issuer 迁移会使旧 Token 失效，应按一次强制重新登录发布。
6. 用六类 Actor Matrix 角色验证菜单、按钮、直接 URL、数据范围和外部 OAuth Client 准入。
7. 核对审计页面与 CSV 的 actor、target、change、result、time、IP 一致性。

回滚应用版本时，新增数据库列可保留；不要在紧急回滚中删除审计数据或菜单权限绑定。

## 验证

本地已通过：

- contracts、config、Portal 三套 TypeScript 检查。
- Portal UI/domain：23 个测试文件、165 项测试。
- Portal ESLint：0 error；287 条历史 warning 仍为非阻断基线。
- Next.js 16.2.9 生产构建，47 个路由完成生成，`/menus` 为 Partial Prerender。
- Gateway `cargo test --all-features`：94 项单元测试及 8 项文档测试通过，6 项忽略。
- Gateway `cargo clippy --all-targets --all-features -- -D warnings` 和 `cargo fmt --all -- --check`。
- 浏览器公开页：390、768、1440 三档下登录、帮助、隐私无整页横向溢出，中文语义与可访问名称可用。
- `git diff --check`。

当前本机 Docker daemon 未启动，PostgreSQL/Redis 不可用，因此 Portal API project、迁移实跑、登录态管理页和完整 Gateway 发布旅程尚未在本轮本地执行。代码完成不等同生产验收完成；这些门禁必须在 CI 或恢复 Docker 后通过，并在 Vercel 新版本部署后完成真实角色矩阵复验。

