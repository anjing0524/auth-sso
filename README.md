# Auth-SSO

企业级统一身份认证平台 (SSO)，实现 OIDC/OAuth 2.1 Provider 能力，提供一体化的身份与权限管理方案。

Portal 自身即是 OIDC Provider；Gateway 作为唯一公网入口，完成 HTTPS 终结、ES256 JWKS 离线验签、Cookie 与 Bearer 令牌转换。构建、部署与验收全部走 Docker（与 CI 同形态）。

## 核心能力

- **统一身份认证 (OIDC Provider)**：Portal 内建 OIDC Provider（`jose` + ES256 JWT），支持 OAuth 2.1 + PKCE 授权码流程，对外提供 Discovery 与 JWKS。
- **管理门户 (Portal)**：
  - **实时概览**：动态展示用户、角色、应用及部门的统计指标。
  - **最近动态**：集成操作审计日志，实时监控系统活动。
  - **智能重定向**：登录后自动跳转至 `/dashboard`；已登录用户访问首页时自动感知并跳转。
- **RBAC 权限体系**：统一权限树 + 角色部门绑定 + 部门子树数据范围（多角色并集）。Gateway 只做认证（验签 + jti 黑名单），**不做权限判定**（ADR-006）；权限判定在 Portal 的 `withAuth` / `lib/authz` 门面。
- **审计日志**：完整的登录日志与操作审计；破坏性操作（如删除权限）在确认前展示影响面。
- **信创网关 (Rust/Pingora)**：HTTPS 终结、JWKS 离线验签、Cookie↔Bearer 转换、限流与 `/healthz` 存活探针；Gateway 内建 ACME 客户端，Let's Encrypt 自动签发/续期并原子热加载证书。
- **子应用零改造接入**：Gateway 注入 `X-User-Id` / `X-User-Jti` 并转发 `Authorization: Bearer`；权限上下文缓存 `portal:user_perms:{userId}` **由 Portal 在签发路径写入**（Gateway 不读写权限缓存，ADR-006），子应用自行读取。`apps/demo-app` 是读取侧的最小示例；该示例当前没有接入任何 compose 栈（见 `docs/INTEGRATION_GUIDE.md`）。

## 演示

https://github.com/user-attachments/assets/5bf2ee77-d1e3-45de-98dd-8bd87c5c8922

完整 1080p 视频由 GitHub user-attachments 托管；上面的 bare URL 在 README 中直接渲染播放器。

覆盖登录 → 工作台 → 用户 → 角色 → 权限 → 审计 → 应用 → 个人中心。

## 项目结构

```
auth-sso/
├── apps/
│   ├── gateway/       # 信创网关 (Rust/Pingora) — HTTPS 终结 + JWKS 验签 + ACME
│   ├── portal/        # 管理门户 + OIDC Provider（宿主开发 4100 / 容器内 4000）
│   └── demo-app/      # Gateway 代理模式演示（哑服务：读 X-User-Id + Redis 权限）
├── packages/
│   ├── contracts/     # 共享类型、错误码、权限码、OIDC 常量（枚举唯一真相源）
│   └── config/        # 共享 env 配置：Zod 校验 + 公开 URL 推导
├── docker/            # compose / 镜像 / ACME fixture（唯一出处见 docker/README.md）
├── scripts/           # 可执行脚本：docker / e2e / ci / bench（索引见 scripts/README.md）
├── tests/             # E2E（Playwright）+ 需求追溯
└── docs/              # ADR、需求规格、roadmap、术语表（入口见 docs/README.md）
```

> **架构说明**: IDP (身份提供者) 已合并进 Portal。Portal 自身即是 OIDC Provider，不再需要独立的 IDP 服务。

## 技术栈

| 类别 | 选型 |
|---|---|
| 运行时 | Node.js 26、pnpm 10.12.4、TypeScript 6 |
| 应用框架 | Next.js 16（App Router / Cache Components / Turbopack 构建）、React 19、Tailwind CSS 4 |
| 认证与协议 | 自建 OIDC Provider、OAuth 2.1 + PKCE、`jose`（ES256）、bcryptjs |
| 数据 | PostgreSQL 18 + Drizzle ORM、Redis 8（JWT 撤销黑名单 / 权限缓存 / 授权请求状态） |
| 网关 | Rust 1.99+（edition 2024）、Pingora 0.9、OpenSSL（vendored） |
| 测试与工程 | Vitest 4（Projects 模式）、Playwright（仅 Chromium）、ESLint 9 flat config、Docker Compose |

## 环境要求

- **Node.js >= 26**（`package.json` 的 `engines`；Temporal 在该版本默认开启，不需要 V8 旗标）。
- **pnpm 10.12.4**（CI 使用 `--frozen-lockfile`）。
- **Docker + Docker Compose v2**：构建、部署、验收的主路径。
- **Rust 1.99+**（可选）：仅在宿主机直接编译 `apps/gateway` 时需要；走 Docker 构建无需安装。

## 本地启动（开发）

```bash
pnpm install
pnpm dev:reset   # 首次/清空本地数据：本地 PG18/Redis8 + migrate + seed
pnpm dev         # 启动本地 PG/Redis + migrate + Next dev（http://localhost:4100）
```

本地只启动 Portal（4100）；完整 OIDC/Gateway 登录与验收走 Docker 栈：
`pnpm stack up` → `https://127.0.0.1:19443/login`。详见 [`docs/local-development.md`](docs/local-development.md)。

## Docker 验收 / 生产同形态

### 1. 安装依赖（构建镜像前需要）

```bash
pnpm install
```

### 2. 构建镜像

```bash
pnpm stack build     # portal（Next 16 / Turbopack build）+ gateway（cargo release）+ cert-init / db-init
```

### 3. 启动完整栈

```bash
pnpm stack up        # postgres + redis + cert-init + db-init + portal + gateway
pnpm stack status    # 确认全部 healthy（一次性服务 Exited (0) 属正常）
```

浏览器打开 **https://127.0.0.1:19443**（Gateway 统一入口，自签证书，点一次"继续访问"）。
种子管理员：`admin@example.com` / `Admin@123456`（由 `db-init` 的 migrate + seed 写入）。

Portal 只在 compose 网络内提供 4000 端口，不对宿主暴露；宿主入口只有 Gateway。

```bash
pnpm stack logs portal   # 跟随日志（gateway/postgres/redis 同理）
pnpm stack down          # 停机并删卷（compose down --volumes；要保留数据请改跑 stop，见 docker/README.md §7.2）
```

### 4. 验收

```bash
pnpm test:e2e   # 构建 → 起栈 → tests/e2e 全部 spec（登录/OAuth 回调/会话/登出 + 边界回归）→ 清理
```

### 5. 只跑单元 / API 测试

```bash
docker compose -f docker/compose/local.yml up -d postgres redis   # 测试用基础设施（PG 18 + Redis 8）
pnpm test
```

> Docker 文件矩阵、命令、健康检查与故障排查见 **[docker/README.md](docker/README.md)**（唯一出处）；
> 生产 ACME 部署见 `docker/README.md` §0–§6，本地验收栈见 §7。

## 自动化测试

Vitest 4 以 Projects 模式聚合 `apps/portal` 与 `packages/contracts` 的测试；E2E 只跑 Docker 验收栈。

| 层 | 位置 | 运行方式 |
|---|---|---|
| 单元 / 组件 / 契约 / API | `apps/portal/__tests__/{components,domain,api,helpers}`、`apps/portal/src/**/*.test.ts`、`packages/contracts/src/*.test.ts` | 随 `pnpm test`（jsdom + 真实 PostgreSQL/Redis） |
| E2E | `tests/e2e/*.spec.ts` | `pnpm test:e2e`（Playwright，Docker 验收栈） |
| 全量 | 以上全部 | `pnpm test`（阻断门禁） |
| 需求追溯 | `tests/traceability/generate-report.mjs` | `node tests/traceability/generate-report.mjs`（生成物不提交，非门禁） |

补充命令（基准类需先起验收栈）：

```bash
./scripts/e2e/acme-e2e.sh           # 本地 Pebble ACME 闭环（首签 / 重启恢复 / 续期失败保留旧证书）
./scripts/e2e/acme-staging.sh   # 公网 Let's Encrypt staging 联调（需真实 DNS 与 80/443 可达）
node scripts/bench/gateway.mjs --url https://127.0.0.1:19443 --n 200 --c 20   # Gateway 性能基准
```

## 部署

生产部署只有两类目标；**日常运维主路径是自托管 Docker Compose**（唯一备份/升级/回滚/ACME 流程）：

| 目标 | 入口 | 定位 |
|---|---|---|
| 自托管生产 | `docker/compose/prod.yml` + `scripts/docker/deploy.sh` | 唯一日常运维主路径 |
| Vercel 平台 | `vercel.json` + `docker/images/vercel.Dockerfile` | NFR-SEC-01 要求的平台托管变体，非日常运维 |

`test.yml`（发布验收/CI）、`local.yml`（本地 PG/Redis）、`acme-staging.yml`（首次公网 ACME 演练）
都不是生产部署方向。决策见 [ADR-030](docs/adr/ADR-030-deployment-targets.md)。

最简自托管流程：

```bash
cp .env.example .env.prod            # 再按 docker/README.md §3 补齐必填项
pnpm deploy -- --check                    # 逐项校验环境文件与 compose 配置，不启动
pnpm deploy                       # 构建 → db-init（migrate + seed）→ 启动 → 健康检查
pnpm deploy -- --status                   # 容器状态
pnpm deploy -- --rollback                 # 切回上次镜像（数据不回滚，需自行备份）
```

Gateway 在进程内完成 ACME HTTP-01 验证、证书签发与热加载，无需 Certbot 或宿主证书脚本。
Vercel 单镜像变体仅作为平台托管目标保留，不替代上述自托管运维流程。

## 文档指引

- [文档地图 (docs/README.md)](docs/README.md) — 先看这里：每份文档的职责与权威性
- [工程约定 (AGENTS.md)](AGENTS.md) — 项目结构、环境、测试体系与门禁规则（唯一出处）
- [AI Agent 治理工作流与技能标准 (docs/agent-governance.md)](docs/agent-governance.md) — 技能格式与路由、六阶段治理工作流、守卫台账
- [产品需求 (docs/spec/PRD.md)](docs/spec/PRD.md) — 核心功能、业务范围与用户模型
- [系统架构 (docs/spec/ARCHITECTURE.md)](docs/spec/ARCHITECTURE.md) — 系统组成、技术选型、认证与 SSO 流程
- [架构约束指南 (docs/spec/ARCHITECTURE_CONSTRAINTS.md)](docs/spec/ARCHITECTURE_CONSTRAINTS.md) — 代码规范、分层约束与 Code Review 红线
- [数据库设计 (docs/spec/DATABASE.md)](docs/spec/DATABASE.md) — 数据模型、存储落位与物理规范
- [接口契约 (docs/spec/API.md)](docs/spec/API.md) — 核心接口清单与字段级契约
- [第三方集成说明 (docs/spec/third-party-integration.md)](docs/spec/third-party-integration.md) — 企微、飞书、钉钉等三方登录集成规范
- [需求追踪矩阵 (docs/spec/REQUIREMENTS_MATRIX.md)](docs/spec/REQUIREMENTS_MATRIX.md) — 需求→验收标准全覆盖
- [架构决策记录 (docs/adr/)](docs/adr/) — ADR-001～030（共 30 篇）：与代码冲突时先信代码，再查这里的理由
- [里程碑与取舍 (docs/roadmap.md)](docs/roadmap.md) — 变更记录（按时间倒序）
- [领域词汇表 (docs/glossary.md)](docs/glossary.md) — 领域概念的唯一真相源
- [接入验证指南 (docs/INTEGRATION_GUIDE.md)](docs/INTEGRATION_GUIDE.md) — Gateway 代理模式与子应用接入
- [Portal 架构规范 (docs/portal-architecture-guidelines.md)](docs/portal-architecture-guidelines.md) — 分层、组件模式与 Next.js 16 适配
- [Docker 构建 / 部署 / 验收 (docker/README.md)](docker/README.md) — 唯一出处
- [脚本索引 (scripts/README.md)](scripts/README.md) — `docker/`、`e2e/`、`ci/`、`bench/` 的职责与归属
- [设计规范 (DESIGN.md)](DESIGN.md) — UI/UX 规范与品牌定义

## 安全提醒

- 生产环境务必生成强密钥：`openssl rand -base64 32`（至少用于 `PORTAL_CLIENT_SECRET`、`GATEWAY_SHARED_SECRET`）。
- 敏感配置通过部署平台的环境变量管理；`.env` / `.env.*` 不会入库，模板见 [.env.example](.env.example)。
- 生产 `NODE_ENV=production` 时 Cookie 默认 `Secure`（可用 `COOKIE_SECURE` 显式覆盖）；Gateway 是唯一公网入口，Portal / PostgreSQL / Redis 只在 compose 内网可达。
- 生产 TLS 证书必须由 `docker/compose/prod.yml` 中 Gateway 的 Rust 内建 ACME 客户端获取和续期；不要引入 Certbot 脚本，也不要挂载仓库内或开发机生成的自签证书。

## License

MIT
