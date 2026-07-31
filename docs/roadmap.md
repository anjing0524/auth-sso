# Auth-SSO 系统路线图

本文档记录各模块完成状态与版本规划，与 docs/spec/REQUIREMENTS_MATRIX.md 联动。

## 模块状态

| 模块 | 状态 | 版本 | 备注 |
|------|------|------|------|
| 用户管理（CRUD/状态/改密） | ⚠️ 生产复验待完成 | v1.1 | 代码已补齐自删除/最后管理员保护、角色契约、详情与重置密码；待 API/E2E 和 Vercel 角色矩阵复验 |
| 角色管理（RBAC v3.2） | ⚠️ 生产复验待完成 | v1.1 | 代码已补齐删除影响确认、描述与权限分配；待数据库集成和生产复验 |
| 权限管理（统一权限树） | ⚠️ 生产复验待完成 | v1.1 | 代码已补齐 PAGE、描述、引用计数及独立菜单管理；待迁移和生产复验 |
| 部门管理（物化路径树） | ⚠️ 生产复验待完成 | v1.1 | 代码已修复 pending、删除竞态、展开语义与父级上下文；待 Actor Matrix 数据复验 |
| OAuth 2.1 Provider | ⚠️ 生产复验待完成 | v1.1 | 无角色 Portal 登录改为 `/no-access`，登录成功审计移至授权完成边界；待真实登录链路复验 |
| OIDC Discovery | ⚠️ 生产迁移待完成 | v1.1 | 代码已统一 HTTPS issuer；部署会使旧 Token 失效，待生产强制重登与互操作复验 |
| Gateway 边缘入口 | ✅ 已交付 | v1.3 | Pingora + ES256 + HMAC；续签按 Refresh Token 去重并区分并发/失败，公开帮助与隐私路径已同步 |
| 审计日志（180天分区） | ⚠️ 生产复验待完成 | v1.1 | 代码已补齐 actor/target/change/result/trace、筛选及 CSV；待迁移、API 与生产数据复验 |
| 暴力破解防护 | ✅ 已交付 | v1.1 | Redis INCR 锁定 |
| SAML 2.0 | 🔲 待评估 | P2 | 未在本期范围，企业对接需求驱动 |
| OIDC RP-Initiated Logout | 🔲 待评估 | P2 | 当前用自定义 revoke 实现 |
| 多租户隔离 | ❌ 范围外 | - | PRD §2.2 明确排除 |

## 变更记录

- 2026-07-31: 完成 `2026-07-30-vercel-ux-business-audit.md` 的代码整治与横向复审：修复 2 个 P0 和 11 个 P1，补齐菜单管理、角色授权、结构化事务审计、Actor Matrix 可选种子、Dashboard/Profile/用户详情、Asia/Shanghai 时间、移动端和可访问性；Gateway 续签去重按 Refresh Token 隔离并区分并发与真实失败。三套 TypeScript 检查、165 项 Portal UI/domain 测试、Portal 生产构建、Gateway 94 项单元测试与 8 项文档测试、严格 Clippy/fmt 均通过；公开页完成 390/768/1440 浏览器复验。因本机 Docker daemon 未启动，API project、迁移实跑、登录态管理页面和 Vercel 新版本角色矩阵仍是发布阻断，不把“代码完成”误记为“生产验收完成”。计划见 `docs/plans/2026-07-31-001-fix-vercel-ux-business-audit-plan.md`，复盘见 `docs/solution/2026-07-31-vercel-ux-business-audit-remediation.md`。
- 2026-07-30: 完成 Vercel 生产环境真实 Chrome 用户故事审计，覆盖桌面端、390px 移动端、键盘、错误路径、网络/控制台、CSV、OIDC/JWKS 与源码归因；确认 Gateway OAuth/PKCE 管理员主链路可用，同时发现 2 个 P0、11 个 P1 及一组体验/可访问性问题。临时用户、角色、客户端均已清理，本轮未修改业务代码。完整证据、复现步骤与退出标准见 `docs/audit/2026-07-30-vercel-ux-business-audit.md`。
- 2026-07-30: 完成 Gateway TLS 能力的编译期隔离：新增默认 `self-managed-tls` Cargo Feature，自托管 Docker/Compose 继续包含 ACME、HTTP 重定向和 TLS 热加载；Vercel 改用 `--no-default-features` 构建，仅保留平台 TLS 终结所需的 HTTP 代理能力，并从编译单元及正常依赖图排除 `acme`/`redirect`/`tls` 模块与 `instant-acme` 等专属直接依赖。配置层对“裁剪版 + 未启用外部 TLS”执行 fail-closed，CI 同时验证两套 clippy/test、平台 release build 和 ACME 依赖缺席，最佳实践同步沉淀到两份 TLS/部署 solution。
- 2026-07-30: 完成 Vercel 生产部署拓扑收敛：Vercel 只暴露一个 Docker Service，Next.js Portal standalone 在同一容器内仅监听 `127.0.0.1:4100`，Rust Gateway 作为唯一 `$PORT` 公网入口并使用平台 TLS 模式；Neon PostgreSQL 与 Upstash Redis 由 Marketplace 注入。生产验证否决了会因容器 IPv6 `[100::1]` 无路由而间歇 502 的跨 Service binding，改为确定性的 loopback 上游；同步补齐平台客户端 IP 信任边界、OAuth 正式回调白名单、Docker 构建期公开 URL 和 GitHub/Vercel 自动部署配置，最佳实践沉淀到 `docs/solution/2026-07-30-vercel-gateway-only-production-topology.md`。
- 2026-07-29: 补齐公共 Let's Encrypt staging 的可审计预检：`scripts/run-gateway-acme-staging.sh` 在访问 Docker/公共 CA 前检查公网 DNS 名称、联系邮箱和公网 80/443 操作员声明；缺失或无效时以状态码 2 退出并在独立 `preflight/` 目录写入阻塞证据，不覆盖既有公网通过证据。用户当前提供的 `local` 是无效公共域名，`8.8.8.8` 只是递归解析器且明确没有公网入口，因此当前证据为 `blocked_invalid_prerequisites`；进入真实演练后才在 `latest/` 使用 `failed_or_incomplete`，仅全部外部断言通过才写入 `passed`。
- 2026-07-28: 完成 Gateway ACME 可复现验收闭环：新增固定 Pebble v2.8.0 官方 Release SHA-256 的本地 CA/HTTP-01 测试栈和独立 CI 门禁，真实 Gateway 从无证书状态启动后在同一容器、零进程重启条件下签发并启用 HTTPS；TLS 链/域名验证、`0700/0600` 状态权限、同指纹重启恢复及 CA 停止后保留旧证书均已通过，证据保存在 `.context/compound-engineering/acme-e2e/latest/`。同步修复生产 80/443 映射与端口环境覆盖漂移、数值环境变量静默回退、测试 profile 残留清理及动态 Redis 地址抢占验证 IP；公网 Let's Encrypt staging 脚本已就绪，因当前环境缺少真实域名/DNS/公网端口，保留为首次生产部署前强制外部验收项。
- 2026-07-28: 完成 Gateway ACME/TLS 简化复审：删除不服务生产 ACME、也非本地/E2E 需求的文件证书轮询后台服务及其配置状态，文件证书恢复为启动期单次加载；续期结果改用 `Issue/Wait` 枚举消除无效组合，内联单用途账户路径与 directory 参数，并为直接使用的 `tokio::net::TcpStream` 显式声明 `net` feature，避免依赖传递 feature union 偶然编译。保持 ACME 原子持久化、HTTP-01、ARI 与证书热加载语义不变，规则同步沉淀到 `docs/solution/2026-07-28-gateway-letsencrypt-zero-downtime.md`。
- 2026-07-28: 完成生产 Gateway TLS 生命周期收敛并修订早期 Certbot 方案：移除 `docker-compose.prod.yml` 对 `apps/gateway/ssl`、Certbot 服务和 shell 入口的依赖，由 Gateway Rust 进程使用 `instant-acme` 内建 ACME 账户恢复、HTTP-01、ECDSA P-256 签发、ARI 续期调度、指数退避与自动热加载。ACME 账户和证书/私钥单 bundle 以 `0700/0600` 权限原子持久化到专用 volume；握手与 challenge 热路径均使用 `ArcSwapOption` 内存快照，失败继续使用上一有效证书且无需重启。同步补齐生产配置校验、非 root volume 权限、部署/架构/验收文档和 Rust 单元测试；本地/E2E loopback 自签证书继续作为隔离测试设施。最佳实践沉淀到 `docs/solution/2026-07-28-gateway-letsencrypt-zero-downtime.md`。
- 2026-07-28: 修复 Gateway Release Journey 对开发机证书的隐式依赖：`docker-compose.test.yml` 不再从被 Git 忽略的 `apps/gateway/ssl` 复制 PEM，改由 `apps/gateway/Dockerfile` 的专用 `cert-init` target 在构建期固化 OpenSSL、启动期向一次性 named volume 生成带 loopback SAN 的短期自签证书。CI 与本地现在都从干净输入构造 TLS 验收环境，运行期不安装软件、不读取宿主机私钥，发布浏览器闭环本地复验 `1/1` 通过；最佳实践补充到 `docs/solution/2026-07-27-gateway-first-delivery-entrypoints.md`。
- 2026-07-28: 从根因收敛 Next.js 16 构建期数据库边界：将 `@/infrastructure/db` 改为首次真实访问才解析 `DATABASE_URL` 并创建连接的统一惰性单例，删除审计、鉴权、权限模块中逐调用方堆叠的动态 import 补丁；将公开 URL、数据库、Redis、Cookie 等环境配置改为按关注点独立校验，避免静态 OIDC Discovery 因无关数据库配置失败；共享鉴权及相关 Controller catch 通过官方 `unstable_rethrow()` 保留 headers/cookies/PPR 控制流，不再把动态路由错误预渲染为静态 500；只在无 Request 参数且必须实时探测外部依赖的 health/JWKS GET 入口使用官方 `connection()` 请求边界；同时修复 `.dockerignore` 未排除真实 `.env*` 导致本地 Docker 构建被开发机配置污染的问题。Route Handler 与页面继续遵循 Cache Components 默认动态/部分预渲染语义，不再用 `dynamic` 或 blanket `connection()` 掩盖共享边界问题，最佳实践沉淀到 `docs/solution/2026-07-28-nextjs-rsc-build-time-db-boundary.md`。
- 2026-07-27: 收敛 Docker Compose 入口：删除无消费者、与当前脚本/工作流职责重复的 `docker-compose.local.yml`，并将原 `docker-compose.ci.yml` 与 `docker-compose.e2e.yml` 合并为统一的 `docker-compose.test.yml`。收敛后的职责为三类：`docker-compose.yml` 仅服务本地开发数据库/Redis，`docker-compose.test.yml` 统一承担 CI 的 `node-test` 容器与 Gateway 发布闭环私有栈，`docker-compose.prod.yml` 保留部署用途；相关 `workflow`、`scripts/run-gateway-e2e.sh`、接入文档与最佳实践同步切换，避免再维护“同一件事三份 compose 入口”的漂移。
- 2026-07-27: 收敛 GitHub workflow 职责：新增可复用 `.github/workflows/validation-suite.yml`，让 `pr.yml`、`main.yml` 与 `release-validation.yml` 共享同一套 lint/typecheck/migrate/seed/test、Gateway Rust 质量门禁与 Gateway 发布旅程；release 不再是只跑浏览器闭环的特例，CI 与 release 的职责边界统一为“验证代码并构建/验收发布拓扑”，仅保留 artifact 命名与主干故障注入烟测的参数差异。
- 2026-07-27: 收敛 Gateway-first 交付入口：根 `pnpm dev` 改为自动拉起 `postgres`/`redis` + `portal` + `demo` + `gateway` 的本地联调入口，补充 `dev:gateway` 与 `build:gateway`，并将根 `build` 纳入 Gateway release 构建；默认 `pnpm test:e2e` 改为自动启动 `docker-compose.e2e.yml` 不可变验收栈，仅验证经 Gateway 的浏览器闭环，直连 Portal 的 Playwright 冒烟显式降为 `test:e2e:portal`；同时在 PR/Main CI 提前执行与 release workflow 同构的 Gateway 发布旅程，避免“打 tag 后才发现 Portal 不能只放在 Gateway 后面”的拓扑回归。实测闭环过程中进一步修复了 Gateway Docker 日志目录权限、e2e/ci compose 项目名污染、HTTP/2 小写 `accept` 头导致的浏览器导航误判，以及 loopback TLS 入口被错误生成为 `http://127.0.0.1:19443/...` OAuth 跳转的问题；最终 `scripts/run-gateway-e2e.sh` 本地全绿，沉淀到 `docs/solution/2026-07-27-gateway-first-delivery-entrypoints.md`。
- 2026-07-27: 收敛数据库初始化、测试与发布入口：发布验收栈 `docker-compose.e2e.yml` 改为 `db:migrate + db:seed`，并由 Playwright Docker 镜像执行 `test:e2e:release`；PR/Main CI 新增 `docker-compose.ci.yml`，由 GitHub runner 调度 `node-test`/`postgres`/`redis` 同网段执行 lint、typecheck、`db:migrate + db:seed` 与 Vitest，不再让宿主机进程直连数据库；同时明确 GitHub 只承担 CI 验证，不再保留面向外部数据库的定时分区维护 workflow，`db:maintain-partitions` 回归部署/运维平台调度；Portal Vitest 拆为 API/UI 双 project，仅 API 测试连接 Docker 中的 PostgreSQL/Redis，并显式补齐 `@ -> src` alias，修复容器内 API 测试 helper 的模块解析失败；`apps/portal` 的 `db:migrate` 改为仓库内 `scripts/migrate.ts` 直接执行基线 SQL，替代无错误上下文的 `drizzle-kit migrate` 黑盒入口；`README.md`、`AGENTS.md`、`docs/INTEGRATION_GUIDE.md` 同步移除默认 `db:push` 指引；同时删除无消费者的 `db:cleanup` 孤儿脚本、无语义增量的根 `infra:up` 空别名，以及误入库的 `apps/portal/tsc_output.txt`；契约层同步移除无运行时消费者的 `LOGIN_LOG_PERMISSIONS` 僵尸权限组，登录日志权限统一回收至 `portal:audit:*`，沉淀到 `docs/solution/2026-07-27-ci-entrypoint-convergence.md`。
- 2026-07-27: 修复本地测试数据库自举缺口：Portal `vitest.globalSetup.ts` 在连接前自动补建缺失的 `auth_sso_test`，开发环境 `docker/init-db.sql` 首次启动同步创建测试库；避免 Vitest 因本地仅有 `auth_sso` 而卡死或误用业务库跑测试。沉淀到 `docs/solution/2026-07-27-local-test-db-bootstrap.md`。
- 2026-07-27: 完成 Portal 健康检查依赖探测收尾：`/api/health` 现主动探测 PostgreSQL `SELECT 1` 与 Redis `PING`，按 `healthy/degraded/unhealthy` 返回聚合状态；补齐数据库失败与双依赖失败测试，并沉淀依赖探针最佳实践到 `docs/solution/2026-07-27-health-check-active-dependency-probes.md`。
- 2026-07-24: 整理文件归属：用户创建权限守卫下沉至 users 模块、403 视图进入 shared；需求追溯报告改为忽略的本地生成物，消除每次生成带来的工作树噪声。
- 2026-07-24: 清除四份失效 E2E（过时 REST 写路径、错误 OAuth 回调/PKCE、无 baseline 的视觉快照、以无效授权码伪装安全验证）及其动态 `skip` 伪通过；追溯脚本改为信息清单，不再作为 CI 通过率门禁，真实缺口以 55/76 明示并纳入后续测试补齐。
- 2026-07-24: 首轮无效入口清理：删除与当前 schema 漂移、无调用方的调试/种子/生产改写脚本及其 `db:clean` 命令；移除被 Docker 发布验收替代的本地 QA 编排与未配置告警脚本。当时暂保留分区维护脚本与性能基准，后续在 2026-07-27 明确前者回归部署/运维平台调度。
- 2026-07-24: 建立可执行测试防线：PR/Main 的 lint、typecheck、单元/API/组件测试改为阻断门禁；新增 Docker 发布验收栈与标签/手动发布工作流，经 Gateway HTTPS 验证登录、OAuth 回调、Secure Cookie 和登出闭环。
- 2026-07-24: 新增生产就绪测试与验证框架（`docs/plans/2026-07-24-production-readiness-validation-framework.md`）：统一产品需求、NFR、架构约束、实现、测试与执行证据；将弱 E2E、NFR 追溯、Gateway 全链路、故障与性能演练列为发布前验证重点。
- 2026-07-24: 合并 PR #24 中经 main 基线复核的测试与 CI 改进：补充 Redis 降级授权覆盖、Gateway ES256 安全验签覆盖、测试基础设施与需求追溯扫描；剔除未能形成有效断言的 E2E 草案。
- 2026-07-24: 完成全维度审计整治：OAuth scope allow-list/授权码原子领取/UserInfo 最小披露，Gateway issuer 与生产共享密钥约束，唯一数据库基线与分区调度，Controller 权限常量收敛、受控 Prometheus metrics、Temporal 领域时间边界、OAuth 浏览器授权码 E2E，以及 337 项 Vitest 全绿的共享数据库隔离修复。
- 2026-07-23: ADR-009 Gateway 重构全量完成（G1-G7），全量文档同步审计（14 份文档）；修复角色绑定事务边界、REST 错误契约、权限 SQL 分页与 OIDC 死类型
- 2026-07-16: Gateway 安全修复与性能优化完成（B1-B9/D1-D5/C1-C3/A1-A6，见下方区块）
- 2026-07-16: ADR-006/007/008 全量实现完成，合并 main（75 文件，307 测试全绿）
- 2026-07-15: ADR-006/007/008 产出，领域重构计划制定（来源：/grilling 深度访谈）
- 2026-07-13: 新增"审计驱动待办（基于 2026-07-13-code-audit.md，经代码实证勘误）"区块
- 2026-07-10: 初始化路线图，对齐 v1.1 交付状态

## 2026-07-30 Vercel 审计整治状态

### P0 / P1

| 审计项 | 代码状态 | 发布退出条件 |
|---|:--:|---|
| P0-01 自删除/最后管理员 | ✅ | API 并发删除测试和生产只读保护确认 |
| P0-02 OIDC issuer | ✅ | 生产设置 HTTPS issuer、强制重登并验证 Discovery/JWT/Gateway 一致 |
| P1-01 命令面板 | ✅ | 登录态键盘打开、搜索、选择、Esc 浏览器回归 |
| P1-02 无角色登录 | ✅ | 无角色 Actor 落入 `/no-access` 且不产生登录循环 |
| P1-03 用户角色契约 | ✅ | 真实数据库验证读取、增加、减少到零及失败回滚 |
| P1-04 角色删除 | ✅ | 验证关联用户影响数量、系统角色保护与审计 |
| P1-05 Client Secret/详情 | ✅ | 验证一次性 Secret、显式确认和详情错误恢复 |
| P1-06 部门交互 | ✅ | 验证 401/403/网络异常后 pending 恢复及树结构一致 |
| P1-07 菜单管理 | ✅ | 应用 `0001` migration，按角色验证菜单、直接 URL 和按钮权限 |
| P1-08 角色授权 | ✅ | 验证只读/授权能力分离、缓存失效和会话撤销 |
| P1-09 审计/CSV | ✅ | 应用 `0002` migration，页面与 CSV 对照真实写操作 |
| P1-10 角色/组织种子 | ✅ | 验收环境显式启用 Actor Matrix，禁止生产默认创建演示账号 |
| P1-11 移动端 | ✅ | 登录态 390/768/桌面验证用户表、抽屉关闭和危险操作 |

### P2 / P3

代码已补齐 Dashboard 三项真实指标、用户详情、上海时区、审计筛选、Profile 真实会话与安全活动、`/settings`、`/help`、`/privacy`、自定义 404、移动端内部滚动、抽屉关闭、中文化、表单 label 和图标按钮 accessible name。公开页面已完成三档视口复验；登录态页面、首屏性能和六角色权限矩阵仍需在新版本部署后采集证据。

### 本轮验证与阻断

- ✅ contracts、config、Portal TypeScript 检查。
- ✅ Portal UI/domain：23 个文件、165 项测试。
- ✅ Portal ESLint 0 error；287 条既有 warning 仍为非阻断基线。
- ✅ Next.js 16.2.9 生产构建，47 个路由生成完成。
- ✅ Gateway tests、严格 Clippy 和 fmt。
- ✅ 登录、帮助、隐私公开页面 390/768/1440 无整页横向溢出。
- ⚠️ Docker daemon 未启动，Portal API project、migration/seed 实跑和 Gateway 发布旅程未执行。
- ⚠️ 工作树尚未部署，Vercel 登录态和 Actor Matrix 生产复验未执行。

## 审计驱动待办（基于 2026-07-13-code-audit.md）

> 下表条目均经过对 HEAD 代码的实证复核；审计报告本身的 3 处事实错误（13.1 CI、2.1 audit success、6.1 遗漏项）已在报告中勘误，此处不再重复。

### P0 紧急修复（安全 / 可独立上线）

| # | 状态 | 任务 | 文件:行 | 来源发现 |
|---|:--:|------|---------|:--:|
| A0-1 | ✅ | 安全关键撤销/缓存更新改为 await，业务写入与审计同事务 | `app/(dashboard)/users/actions.ts` + `app/profile/actions.ts` | 6.1 勘误 |
| A0-2 | ✅ | `revokeAllRefreshTokens` JTI 撤销 fire-and-forget（工作树已修复） | `lib/auth/token.ts:568-577` | 7.4（升级为严重） |
| A0-3 | 🔲 | CI 增补 `pnpm audit` / `cargo audit` 依赖安全扫描 | `.github/workflows/*` | 13.2 |
| A0-4 | ✅ | permissions 列表接口补 SQL 分页（page/pageSize/pagination） | `api/permissions/route.ts` + `permissions/data.ts` | 5.2 |
| A0-5 | 🔲 | 分页参数统一校验 + 提取 `MAX_PAGE_SIZE` 常量 | `contracts` + 4 个路由 | 5.1 |

### P1 规范统一

| # | 状态 | 任务 | 文件:行 | 来源发现 |
|---|:--:|------|---------|:--:|
| A1-1 | 🔲 | facade.ts 错误响应补 `success: false`（统一 ApiResponse 契约） | `lib/auth/facade.ts:56-59,64-67,78-81` | 2.1 |
| A1-2 | 🔲 | register 路由成功响应用 `data` 替代 `stats` | `api/permissions/register/route.ts:178` | 2.1 |
| A1-3 | 🔲 | `LOG_LEVEL` 生效 + 全量日志结构化 | `packages/config/src/env.ts:39` + Portal 全局 | 10.1, 10.2 |
| A1-4 | ✅ | 管理员角色硬编码改为引用 `ADMIN_ROLE_CODES` | `app/profile/ProfileClient.tsx` | 11.1 |

### P2 公共抽取

| # | 状态 | 任务 | 文件 | 来源发现 |
|---|:--:|------|------|:--:|
| A2-1 | ✅ | 审计日志写入抽取公共工厂，并提供事务内安全审计入口 | `lib/audit.ts` | 7.2 |
| A2-2 | 🔲 | 分页参数解析工具 `parsePagination()` | 新建 `lib/pagination.ts` | 14.5 |
| A2-3 | ✅ | 日期范围过滤统一按 Asia/Shanghai 自然日构建 | `app/audit/data.ts` + `lib/format-time.ts` | 14.2 |
| A2-4 | 🔲 | 密钥导入模式去重（`importJwk`） | `lib/auth/token.ts` | 3.4 |

### P3 架构优化

| # | 状态 | 任务 | 文件（实测行数） | 来源发现 |
|---|:--:|------|------|:--:|
| A3-1 | 🔲 | 拆分 token.ts（584 行 → sign/keys/rotate/revoke 四模块） | `lib/auth/token.ts` | 3.1 |
| A3-2 | 🔲 | 分离 gateway.rs 的 OAuth client 逻辑（853 行） | `gateway/src/gateway.rs` | 3.2 |
| A3-3 | ✅ | 删除无逻辑的 facade re-export，公开入口直接导出实际模块 | `lib/auth/index.ts` | 3.5 |
| A3-4 | ✅ | 健康检查加 DB/Redis 连通性探测与失败边界测试 | `api/health/route.ts` + `__tests__/api/health.test.ts` | 10.3 |

### P4 质量防护

| # | 状态 | 任务 | 文件 | 来源发现 |
|---|:--:|------|------|:--:|
| A4-1 | 🔲 | 重写虚假覆盖率测试（audit-logging、user-actions 等） | `__tests__/api/*` | 12.1-12.3 |
| A4-2 | 🔲 | 补充 CRUD write 路径的受控 API/浏览器集成测试 | `apps/portal/__tests__/api/`、`tests/e2e/` | 12.6 |
| A4-3 | 🔲 | auth-login 测试降低 mock 粒度，真实测密码验证 | `__tests__/api/auth-login.test.ts` | 12.4 |
| A4-4 | 🔲 | session-lifecycle 测试恢复 jose 真实验签 | `__tests__/api/session-lifecycle.test.ts` | 12.5 |

### P5 细节清洁

| # | 状态 | 任务 | 文件 | 来源发现 |
|---|:--:|------|------|:--:|
| A5-1 | 🔲 | Dockerfile 层缓存优化（先 COPY lockfile 后 install） | `apps/portal/Dockerfile` | 13.3 |
| A5-2 | 🔲 | 恢复 tsconfig 3 个 strict 子选项 | `apps/portal/tsconfig.json:14-16` | 13.4 |
| A5-3 | 🔲 | PortalJwtClaims 跨语言契约（JSON Schema 权威定义） | `domain/auth/types.ts` + `gateway/auth/mod.rs` | 7.5 |
| A5-4 | 🔲 | trace-id 跨服务传播 | `lib/auth/server-logger.ts` | 10.4 |
| A5-5 | 🔲 | Cookie Secure 增加独立配置（非仅依赖 NODE_ENV） | `lib/session/cookies.ts` | 9.3 |
| A5-6 | 🔲 | 文档版本号统一 | `docs/spec/API.md` 等 | 2.4 |

---

## ADR-006/007/008 领域重构（2026-07-15 /grilling 产出）

> 详细计划：`docs/plans/2026-07-15-adr-006-007-008-implementation.md`

### Phase 1: Schema & Migrations

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D1-1 | ✅ | permissions: 删除 `resource`/`action` 列，扩展 `code`→varchar(150)，更新 CHECK | `db/schema/rbac.ts` |
| D1-2 | ✅ | refresh_tokens: 删除 `client_id` 列及索引 | `db/schema/auth.ts` |
| D1-3 | ✅ | 生成并执行迁移 SQL | Drizzle migration |

### Phase 2: Contracts

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D2-1 | ✅ | 所有权限常量加 `portal:` 前缀 | `packages/contracts/src/permissions.ts` |
| D2-2 | ✅ | `PortalJwtClaims` 最小化（移除 roles/permissions/deptIds） | `domain/auth/types.ts` |
| D2-3 | ✅ | `aud` 使用 `"auth-sso"`；原固定 issuer 已于 2026-07-31 迁移为 HTTPS URL 真相源 | `packages/contracts/src/oidc.ts` + `packages/config/src/env.ts` |

### Phase 3: JWT Token 签发/验证

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D3-1 | ✅ | `signAccessToken` 最小化 claims | `lib/auth/token.ts` |
| D3-2 | ✅ | `verifyAccessToken` 校验独立 `aud` 与 HTTPS issuer | `lib/auth/token.ts` |
| D3-3 | ✅ | `resolveTokenClaims` 不再返回鉴权数据供 JWT 嵌入 | `lib/auth/permissions.ts` |

### Phase 4: 权限上下文 Redis 化

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D4-1 | ✅ | RBAC 变更时主动更新 Redis `user:{sub}:perms` | `lib/permissions.ts` |
| D4-2 | ✅ | Token 续签时预填充 Redis 权限缓存 | `lib/permissions.ts` |

### Phase 5: Portal 自身鉴权改造

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D5-1 | ✅ | `checkPermission` 改为读 Redis | `lib/auth/check-permission.ts` |
| D5-2 | ✅ | `withPermission` 移除 claims 注入 | `lib/auth/guard.ts` |
| D5-3 | ✅ | `withAuth` AuthContext 简化为 `{ userId }` | `lib/auth/guard.ts` |
| D5-4 | ✅ | 所有 Controller/Page 去除 `claims.deptIds` 直接引用，改为 Redis 获取 | `app/(dashboard)/**`, `app/api/**` |

### Phase 6: Refresh Token 去 ClientId

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D6-1 | ✅ | `issueRefreshToken` 移除 clientId 参数 | `lib/auth/token.ts` |
| D6-2 | ✅ | `rotateRefreshToken` 移除 clientId 参数 | `lib/auth/token.ts` |
| D6-3 | ✅ | 调用方更新（/token /refresh 端点） | `app/api/auth/oauth2/token/route.ts`, `app/api/auth/refresh/route.ts` |

### Phase 7: Gateway 改造 (Rust)

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D7-1 | ✅ | Claims 结构体移除 roles/permissions/dept_ids | `gateway/src/auth/mod.rs` |
| D7-2 | ✅ | Gateway 从 OIDC Discovery 缓存 issuer 并严格校验；aud 按 ADR-006 不在 Gateway 校验 | `gateway/src/auth/verify.rs` + `gateway/src/jwks.rs` |
| D7-3 | ✅ | 移除 X-User-Roles/Permissions/DeptIds 注入 | `gateway/src/gateway.rs` |

### Phase 8: Seed 数据

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D8-1 | ✅ | 权限 code 加 `portal:` 前缀；删除 resource/action 赋值 | `scripts/seed-rbac.ts` |
| D8-2 | ✅ | Portal 菜单 code 加 `portal:` 前缀 | `scripts/seed-rbac.ts` |

### Phase 9: 测试更新

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D9-1 | ✅ | 鉴权测试适配（mock Redis 替代 JWT claims） | `__tests__/lib/auth/*` |
| D9-2 | ✅ | API 测试适配（aud/iss claims 移除） | `__tests__/api/*` |
| D9-3 | ✅ | Gateway 测试适配（Claims 结构体） | `apps/gateway/src/auth/tests.rs` |

---

## ADR-009 Gateway 重构（2026-07-16 /grilling 产出）

> ADR-009 已于 2026-07-23 全量实现完成，经 `cargo clippy` + `cargo fmt` + `cargo test` 全绿验证。详见 `apps/gateway/src/auth/mod.rs`、`gateway/src/authenticate.rs`、`gateway/src/config.rs`。

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| G1-1 | ✅ | 新增 `AuthDecision` 枚举（Pass/Interrupted/PkceRequired） | `gateway/src/auth/mod.rs` |
| G1-2 | ✅ | `authenticate::check` 重写：`Result<bool>`→`Result<AuthDecision>`，`match expiry` 替代 `matches!`，删除 `respond_auth_failure` | `gateway/src/authenticate.rs` |
| G2-1 | ✅ | 删除 `request_filter` step 7（`hasJwt` Cookie 预判） | `gateway/src/gateway.rs` |
| G2-2 | ✅ | 删除 callback 中 `oidc_provider_name` 跳过分支 | `gateway/src/gateway.rs` |
| G2-3 | ✅ | 删除 callback 透传分支（`client_secret.is_some()` 检查 + passthrough） | `gateway/src/gateway.rs` |
| G2-4 | ✅ | step 8 替换为 `match AuthDecision` 统一分支 | `gateway/src/gateway.rs` |
| G3-1 | ✅ | `OAuthConfig.client_secret` → `String`（必填），`UpstreamConfig.oauth` → 必填 | `gateway/src/config.rs` |
| G3-2 | ✅ | 删除 `Gateway.oidc_provider_name`、`GatewayCtx.oauth_passthrough_verifier` | `gateway/src/gateway.rs` |
| G3-3 | ✅ | `resolve_oauth` 返回 `&OAuthConfig`（不再 `Option`） | `gateway/src/gateway.rs` |
| G4-1 | ✅ | 删除 `upstream_request_filter` 中 `X-OAuth-Code-Verifier` 注入 | `gateway/src/gateway.rs` |
| G4-2 | ✅ | `handle_oauth_callback` 删除 `client_secret.is_some()` 分支 + passthrough | `gateway/src/gateway.rs` |
| G5-1 | ✅ | 增补 `AuthDecision` 单元测试 | `gateway/src/auth/tests.rs` |
| G6-1 | ✅ | `gateway.toml` + `gateway.docker.toml` 增加必填 `client_secret` | 配置文件 |
| G7-1 | ✅ | `cargo clippy` + `cargo fmt` + `cargo test` 全绿验证 | CI |

---

## Gateway 安全修复与性能优化（2026-07-16 审计驱动）

> 计划：`.kilo/plans/1784180149059-gateway-security-fixes.md`；最佳实践沉淀见 `docs/solution/`。

| # | 状态 | 任务 | 审计项 |
|---|:--:|------|:--:|
| S1 | ✅ | 扩展名白名单边界收窄（/api/ 命名空间禁止扩展名旁路，优先级降至 Microservice 后） | B1/D5 |
| S2 | ✅ | 客户端 IP 改用 socket 真实地址；XFF/X-Real-IP/X-Client-IP 权威覆写 | B2/B7 |
| S3 | ✅ | scheme 判定统一为 `is_secure_host`（IP 解析 + is_loopback），删除重复实现 | B3 |
| S4 | ✅ | 续签去重改 Redis SET NX EX 前置抢占 + 失败释放（消除 TOCTOU） | B4 |
| S5 | ✅ | Token 交换跨节点故障转移（网络错误换节点，非 2xx 确定性拒绝） | B5 |
| S6 | ✅ | PKCE return_to 保留 query | B6 |
| S7 | ✅ | `query_param` 重写（大小写敏感、零分配）+ IdP error 回调显式处理 | C3/B8/B9 |
| S8 | ✅ | 单一路由表 RouteEntry（prefix+LB+OAuth 同源）+ 上游 TLS 生效 | D2/A2/A3 |
| S9 | ✅ | JWKS 缓存 ArcSwap 快照化（删除锁中毒分支）+ upstream_scheme 显式注入 | D1/A1 |
| S10 | ✅ | Cookie 热路径：ctx 缓存一次 collapse + 单遍重写 + strip 零分配 | D3/C1/C2 |
| S11 | ✅ | public_paths 归属校验（越界白名单启动期拒绝） | A4 |
| S12 | ✅ | 删除 get_host `:authority` 死分支；callback 判定零分配 | A6/D4 |

不做（Out of scope）：trusted-proxy 层级配置、Redis 缓存新 AT、C4 Bearer 拼接微优化、分布式限流。

### 状态图例

- 🔲 待处理 ｜ ⏳ 进行中 ｜ ✅ 已完成 ｜ ⚠️ 有阻塞
