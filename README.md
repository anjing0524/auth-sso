# Auth-SSO

企业级统一身份认证平台 (SSO)，实现 OIDC/OAuth 2.1 Provider 能力，提供一体化的身份与权限管理方案。

## 核心能力

- **统一身份认证 (OIDC Provider)**: Portal 内建 Better Auth OIDC Provider，支持 OAuth 2.1 PKCE 流程，确保认证安全。
- **管理门户 (Portal)**:
  - **实时概览**: 动态展示用户、角色、应用及部门的统计指标。
  - **最近动态**: 集成操作审计日志，实时监控系统活动。
  - **智能重定向**: 登录后自动跳转至 `/dashboard`；已登录用户访问首页时自动感知并跳转。
- **RBAC 权限体系**: 支持数据范围（Data Scope）过滤，包含全部、本部门、本部门及下属部门、本人及自定义范围。
- **审计日志**: 提供完整的登录日志与操作审计追踪。
- **信创网关**: 自研 Pingora (Rust) 网关，ES256 JWKS 离线验签，Cookie-to-Bearer 令牌转换。

## 项目结构

```
auth-sso/
├── apps/
│   ├── gateway/       # 信创网关 (Pingora/Rust) — HTTPS 终结 + JWT 验签
│   ├── portal/        # 管理门户 + OIDC Provider (含认证中心) — 端口 4000
│   └── demo-app/      # SSO 演示应用 — 端口 4002
├── packages/
│   ├── contracts/     # 共享类型定义、错误码、权限码契约
│   └── config/        # 共享 TypeScript/ESLint 配置
├── tests/             # 自动化测试脚本 (API, SSO, Security, RBAC, E2E)
└── docs/              # 项目文档与 SOP
```

> **架构说明**: IDP (身份提供者) 已合并进 Portal。Portal 自身即是 OIDC Provider，不再需要独立的 IDP 服务。

## 技术栈

- **Next.js 16** - React 核心框架
- **Better Auth** - 身份认证基座，扩展 OIDC Provider
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
# 编辑 .env.local，配置 DATABASE_URL、REDIS_URL、BETTER_AUTH_SECRET 等
```

### 3. 启动服务

```bash
# 一键启动所有服务 (Portal, Demo App)
pnpm dev
```

访问地址:
- **Portal (管理门户 + 认证中心)**: http://localhost:4000
- **Demo App (演示应用)**: http://localhost:4002

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

- [产品需求 (docs/spec/PRD.md)](docs/spec/PRD.md) - 核心功能、业务范围与用户模型
- [系统架构 (docs/spec/ARCHITECTURE.md)](docs/spec/ARCHITECTURE.md) - 系统组成、技术选型、认证与 SSO 流程
- [数据库设计 (docs/spec/DATABASE.md)](docs/spec/DATABASE.md) - 数据模型、存储落位与物理规范
- [接口契约 (docs/spec/API.md)](docs/spec/API.md) - 核心接口清单与字段级契约
- [测试驱动开发计划 (docs/spec/TDD-MASTER-PLAN.md)](docs/spec/TDD-MASTER-PLAN.md) - 自动化测试覆盖与质量保证方案
- [项目计划与里程碑 (docs/spec/PROJECT_PLAN.md)](docs/spec/PROJECT_PLAN.md) - 研发进度与关键里程碑
- [设计规范 (DESIGN.md)](DESIGN.md) - UI/UX 规范与品牌定义
- [SSO 集成指南 (docs/sso-integration-guide.md)](docs/sso-integration-guide.md) - 子应用接入流程
- [环境变量详细说明 (docs/environment-variables.md)](docs/environment-variables.md)

## 安全提醒

- 生产环境务必生成强密钥：`openssl rand -base64 32`。
- 敏感配置请通过部署平台的环境变量管理功能设置。

## License

MIT
