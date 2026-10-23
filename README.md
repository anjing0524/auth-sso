# Auth-SSO

企业级统一身份认证平台 (SSO)，实现 OIDC/OAuth 2.1 Provider 能力，提供一体化的身份与权限管理方案。

## 核心能力

- **统一身份认证 (OIDC Provider)**: Portal 内建纯自定义 OIDC Provider（基于 `jose` 库，ES256 JWT 无状态签发），支持 OAuth 2.1 + PKCE 授权码流程。
- **管理门户 (Portal)**:
  - **实时概览**: 动态展示用户、角色、应用及部门的统计指标。
  - **最近动态**: 集成操作审计日志，实时监控系统活动。
  - **智能重定向**: 登录后自动跳转至 `/dashboard`；已登录用户访问首页时自动感知并跳转。
- **RBAC 权限体系**: 基于角色所属部门的精细化数据范围控制，支持多角色部门并集与子树自动展开。
- **审计日志**: 提供完整的登录日志与操作审计追踪。
- **信创网关**: 自研 Pingora (Rust) 网关，Let's Encrypt 自动签发/续期与证书热加载，ES256 JWKS 离线验签，Cookie-to-Bearer 令牌转换。

## 项目结构

```
auth-sso/
├── apps/
│   ├── gateway/       # 信创网关 (Pingora/Rust) — HTTPS 终结 + JWT 验签
│   └── portal/        # 管理门户 + OIDC Provider (含认证中心) — 端口 4100
├── packages/
│   ├── contracts/     # 共享类型定义、错误码、权限码契约
│   └── config/        # 共享 env 配置 (Zod + URL 推导)、TypeScript/ESLint
├── tests/             # 自动化测试脚本 (API, SSO, Security, RBAC, E2E)
└── docs/              # 项目文档与 SOP
```

> **架构说明**: IDP (身份提供者) 已合并进 Portal。Portal 自身即是 OIDC Provider，不再需要独立的 IDP 服务。

## 技术栈

- **Next.js 16** - React 核心框架
- **jose (Web Crypto)** - ES256 JWT 签发与验签，密钥对存储于 PostgreSQL
- **Pingora** - 自研 Rust 网关 (HTTPS 终结 + JWT 验签)
- **Drizzle ORM** - 类型安全的数据库操作层
- **PostgreSQL** - 结构化数据存储
- **Redis** - 高性能 Session 与缓存存储
- **Tailwind CSS 4** - 现代 UI 样式系统
- **pnpm** - 高效的包管理工具

## 快速开始（Docker —— 与 CI / 生产同形态）

### 1. 安装依赖（构建镜像前需要）

```bash
pnpm install
```

### 2. 构建镜像

```bash
pnpm stack:build     # portal（Next 16 / Turbopack build）+ gateway（cargo release）+ 初始化镜像
```

### 3. 启动完整栈

```bash
pnpm stack:up        # postgres + redis + cert-init + db-init + portal + gateway
pnpm stack:status    # 确认全部 healthy
```

浏览器打开 **https://127.0.0.1:19443**（Gateway 统一入口，自签证书，点一次"继续访问"）。
Portal 只在 compose 网络内提供 4000 端口，不对宿主暴露。

```bash
pnpm stack:logs portal   # 跟随日志（gateway/postgres/redis 同理）
pnpm stack:down          # 停机（保留卷）；./scripts/docker/stack.sh clean 连卷与镜像一起删
```

### 4. 验收

```bash
pnpm test:e2e   # 构建 → 起栈 → 浏览器闭环（登录/OAuth 回调/会话/登出）→ 清理
```

### 5. 只跑单元 / API 测试

```bash
docker compose -f docker/compose/local.yml up -d postgres redis   # 测试用基础设施（PG 16 + Redis 7）
pnpm test
```

> Docker 文件矩阵、命令、健康检查与故障排查见 **[docker/README.md](docker/README.md)**（唯一出处）；
> 生产 ACME 部署见 `docker/README.md` §1–§6。

## 自动化测试

项目内置了完整的分层测试体系与需求追溯：

```bash
docker compose -f docker/compose/local.yml up -d postgres redis  # API 测试前先启动本地数据库基础设施
pnpm test                 # 全量 Vitest 测试
pnpm test:api             # API project（真实 PostgreSQL/Redis）
pnpm test:components      # UI/domain project（不依赖 DB）
pnpm test:e2e             # 自动拉起 Gateway 发布拓扑并验证真实浏览器闭环
pnpm test:report          # 需求追溯性覆盖率报告
```

## 文档指引

- [产品需求 (docs/spec/PRD.md)](docs/spec/PRD.md) — 核心功能、业务范围与用户模型
- [系统架构 (docs/spec/ARCHITECTURE.md)](docs/spec/ARCHITECTURE.md) — 系统组成、技术选型、认证与 SSO 流程
- [架构约束指南 (docs/spec/ARCHITECTURE_CONSTRAINTS.md)](docs/spec/ARCHITECTURE_CONSTRAINTS.md) — 代码规范、分层约束与 Code Review 红线
- [数据库设计 (docs/spec/DATABASE.md)](docs/spec/DATABASE.md) — 数据模型、存储落位与物理规范
- [接口契约 (docs/spec/API.md)](docs/spec/API.md) — 核心接口清单与字段级契约
- [第三方集成说明 (docs/spec/third-party-integration.md)](docs/spec/third-party-integration.md) — 企微、飞书、钉钉等三方登录集成规范
- [需求追踪矩阵 (docs/spec/REQUIREMENTS_MATRIX.md)](docs/spec/REQUIREMENTS_MATRIX.md) — 需求→验收标准全覆盖
- [Portal 架构规范 (docs/portal-architecture-guidelines.md)](docs/portal-architecture-guidelines.md) — 开发规范、组件模式与 Next.js 16 适配
- [生产 Docker 部署 (docker/README.md)](docker/README.md) — Let's Encrypt 自动签发、续期、热加载与部署验证
- [设计规范 (DESIGN.md)](DESIGN.md) — UI/UX 规范与品牌定义

## 安全提醒

- 生产环境务必生成强密钥：`openssl rand -base64 32`。
- 敏感配置请通过部署平台的环境变量管理功能设置。
- 生产 TLS 证书必须由 `docker/compose/prod.yml` 中 Gateway 的 Rust 内建 ACME 客户端获取和续期；不要引入 Certbot 脚本，也不要挂载仓库内或开发机生成的自签证书。

## License

MIT
