# Auth-SSO

企业级统一身份认证平台 (SSO)，实现 OIDC/OAuth 2.1 Provider 能力，提供一体化的身份与权限管理方案。

## 核心能力

- **统一身份认证 (IdP)**: 提供基于 OIDC/OAuth 2.1 的认证服务，支持 PKCE 流程，确保认证安全。
- **管理门户 (Portal)**: 
  - **实时概览**: 动态展示用户、角色、应用及部门的统计指标。
  - **最近动态**: 集成操作审计日志，实时监控系统活动。
  - **智能重定向**: 登录后自动跳转至 `/dashboard`；已登录用户访问首页时自动感知并跳转。
- **RBAC 权限体系**: 支持数据范围（Data Scope）过滤，包含全部、本部门、本人等多种数据访问模式。
- **审计日志**: 提供完整的登录日志与操作审计追踪。

## 项目结构

```
auth-sso/
├── apps/
│   ├── idp/           # 身份提供者 (Identity Provider) - 端口 4001
│   ├── portal/        # 管理门户 (Portal) - 端口 4000
│   └── demo-app/      # SSO 演示应用 - 端口 4002
├── packages/
│   ├── contracts/     # 共享类型定义、错误码、权限码契约
│   └── config/        # 共享 TypeScript/ESLint/PostCSS 配置
├── tests/             # 自动化测试脚本 (API, SSO, Security)
└── docs/              # 项目文档与 SOP
```

## 技术栈

- **Next.js 15/16** - React 核心框架
- **Better Auth** - 身份认证基座，扩展 OIDC Provider
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
# IdP
cp apps/idp/.env.example apps/idp/.env.local
# 编辑 .env.local，配置 DATABASE_URL 和 REDIS_URL

# Portal
cp apps/portal/.env.example apps/portal/.env.local
# 编辑 .env.local，配置 IDP 连接 (默认 localhost:4001)
```

### 3. 启动服务

```bash
# 一键启动所有服务 (IdP, Portal, Demo App)
pnpm dev
```

访问地址:
- **IdP (认证中心)**: http://localhost:4001
- **Portal (管理门户)**: http://localhost:4000
- **Demo App (演示应用)**: http://localhost:4002

### 4. 数据库初始化

```bash
# 推送数据库模型
pnpm db:push

# 插入基础测试数据
pnpm db:seed
```

## 自动化测试

项目内置了完整的冒烟测试与 SSO 流程验证：

```bash
# 运行所有自动化测试
pnpm start:services
```

## 文档指引

- [设计规范系统 (DESIGN.md)](DESIGN.md) - UI/UX 规范与品牌定义
- [环境变量详细说明](docs/environment-variables.md)
- [Vercel 部署指南](docs/vercel-dashboard-deployment.md)
- [SSO 集成指南](docs/sso-integration-guide.md)

## 安全提醒

- 生产环境务必生成强密钥：`openssl rand -base64 32`。
- 确保 IdP 与 Portal 的 `CLIENT_SECRET` 在生产环境保持同步。
- 敏感配置请通过 Vercel Dashboard 设置。

## License

MIT
