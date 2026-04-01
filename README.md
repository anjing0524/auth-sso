# Auth-SSO

企业统一身份认证平台，实现 SSO (Single Sign-On) 与 OIDC Provider 能力。

## 项目结构

```
auth-sso/
├── apps/
│   ├── idp/           # 身份提供者 (Identity Provider) - 端口 4001
│   ├── portal/        # 管理门户 - 端口 4000
│   └── demo-app/      # SSO 演示应用 - 端口 4002
├── packages/
│   ├── contracts/     # 共享类型、错误码、权限码
│   └── config/        # 共享 TypeScript/ESLint 配置
├── tests/             # 测试脚本
└── docs/              # 文档
```

## 技术栈

- **Next.js 16** - React 框架
- **Better Auth** - 认证库，支持 OIDC Provider
- **Drizzle ORM** - 数据库 ORM
- **PostgreSQL** - 主数据库
- **Redis** - 会话存储
- **Tailwind CSS 4** - 样式
- **pnpm** - 包管理器

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
# IdP
cp apps/idp/.env.example apps/idp/.env.local
# 编辑 apps/idp/.env.local，配置数据库和密钥

# Portal
cp apps/portal/.env.example apps/portal/.env.local
# 编辑 apps/portal/.env.local，配置数据库和 IdP 连接
```

### 3. 启动服务

```bash
# 方法1: 使用脚本启动所有服务
pnpm start:services

# 方法2: 分别启动
pnpm dev:idp     # 启动 IdP
pnpm dev:portal  # 启动 Portal
pnpm dev:demo    # 启动 Demo App
```

访问:
- IdP: http://localhost:4001
- Portal: http://localhost:4000
- Demo App: http://localhost:4002

### 4. 数据库初始化

首次运行需要初始化数据库：

```bash
# 推送数据库 schema
pnpm db:push

# 可选: 插入测试数据
pnpm db:seed
```

## 部署到 Vercel

### 1. 准备密钥

```bash
# 生成 IdP 密钥
openssl rand -base64 32

# 生成 Client Secrets
openssl rand -hex 32
openssl rand -hex 32
```

### 2. 部署 IdP

1. Vercel Dashboard → Add New... → Project
2. 选择 GitHub 仓库
3. 配置:
   - **Project Name**: `auth-sso-idp`
   - **Root Directory**: `apps/idp`
4. 添加环境变量 (参考 `docs/environment-variables.md`)
5. 点击 Deploy

### 3. 数据库初始化

```bash
cd apps/idp
DATABASE_URL="<生产数据库URL>" pnpm drizzle-kit push
```

### 4. 部署 Portal

1. 创建新项目
2. **Root Directory**: `apps/portal`
3. 配置环境变量
4. 点击 Deploy

### 5. 部署 Demo App

1. 创建新项目
2. **Root Directory**: `apps/demo-app`
3. 配置环境变量
4. 点击 Deploy

详细部署指南: [`docs/vercel-dashboard-deployment.md`](./docs/vercel-dashboard-deployment.md)

## 环境变量配置

| 环境 | 配置位置 |
|------|---------|
| 本地开发 | 各应用 `.env.local` 文件 |
| Vercel 生产 | Dashboard > Settings > Environment Variables |

详细说明: [`docs/environment-variables.md`](./docs/environment-variables.md)

## 常用命令

```bash
# 开发
pnpm dev              # 启动所有应用
pnpm dev:idp          # 只启动 IdP
pnpm dev:portal       # 只启动 Portal
pnpm dev:demo         # 只启动 Demo App

# 构建
pnpm build            # 构建所有应用
pnpm build:idp        # 只构建 IdP

# 数据库
pnpm db:push          # 推送 schema 到数据库
pnpm db:studio        # 打开 Drizzle Studio
pnpm db:seed          # 插入测试数据

# 其他
pnpm lint             # 代码检查
pnpm typecheck        # TypeScript 检查
pnpm start:services   # 启动本地服务
```

## 安全提醒

- **永远不要提交 `.env.local` 文件到 Git**
- 所有密钥文件已配置 `.gitignore` 自动排除
- 生产环境密钥通过 Vercel Dashboard 设置

## 文档

- [环境变量配置](docs/environment-variables.md)
- [Vercel 部署指南](docs/vercel-dashboard-deployment.md)
- [CLAUDE.md](CLAUDE.md) - 项目开发指南

## License

MIT
