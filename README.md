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
- **信创网关**: 自研 Pingora (Rust) 网关，ES256 JWKS 离线验签，Cookie-to-Bearer 令牌转换。

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

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
# Portal (含 OIDC Provider)
cp apps/portal/.env.example apps/portal/.env.local
# 编辑 .env.local，配置 DATABASE_URL、REDIS_URL、PORTAL_CLIENT_SECRET 等
```

### 3. 启动服务

```bash
# 一键启动 Portal
pnpm dev
```

访问地址:
- **Portal (管理门户 + 认证中心)**: http://localhost:4100

```bash
# 启动 Gateway 信创网关 (可选)
cd apps/gateway
cargo run
```

网关访问地址 (代理至 Portal):
- **HTTP**: http://localhost:19080
- **HTTPS**: https://localhost:19443

### 4. 数据库初始化

```bash
# 推送数据库模型
pnpm db:push

# 插入基础测试数据
pnpm db:seed
```

## 自动化测试

项目内置了完整的分层测试体系与需求追溯：

```bash
pnpm test                 # 全量 Vitest 测试
pnpm test:api             # API 层测试
pnpm test:components      # 组件层测试
pnpm test:e2e             # Playwright E2E 端到端测试
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
- [用户故事 (docs/spec/USER_STORIES.md)](docs/spec/USER_STORIES.md) — 角色驱动的功能验收场景
- [Portal 架构规范 (docs/portal-architecture-guidelines.md)](docs/portal-architecture-guidelines.md) — 开发规范、组件模式与 Next.js 16 适配
- [设计规范 (DESIGN.md)](DESIGN.md) — UI/UX 规范与品牌定义

## 安全提醒

- 生产环境务必生成强密钥：`openssl rand -base64 32`。
- 敏感配置请通过部署平台的环境变量管理功能设置。

## License

MIT
