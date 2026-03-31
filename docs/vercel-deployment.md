# Vercel 部署指南

## 概述

本项目是一个 pnpm monorepo，包含两个 Next.js 应用：
- **Portal** - 管理门户 (端口 4000)
- **IdP** - 身份提供者 (端口 4001)

## 前置条件

1. Vercel 账号
2. Vercel CLI（可选）: `npm i -g vercel`
3. PostgreSQL 数据库（推荐使用 Vercel Postgres、Neon 或 Supabase）
4. Redis 服务（推荐使用 Upstash Redis）

## 部署步骤

### 1. 创建 Vercel 项目

在 Vercel Dashboard 中创建两个项目：

#### Portal 项目
- **Project Name**: `auth-sso-portal`
- **Root Directory**: `apps/portal`
- **Framework Preset**: Next.js
- **Build Command**: `cd ../.. && pnpm install && pnpm --filter @auth-sso/portal build`
- **Output Directory**: `.next`
- **Install Command**: `cd ../.. && pnpm install`

#### IdP 项目
- **Project Name**: `auth-sso-idp`
- **Root Directory**: `apps/idp`
- **Framework Preset**: Next.js
- **Build Command**: `cd ../.. && pnpm install && pnpm --filter @auth-sso/idp build`
- **Output Directory**: `.next`
- **Install Command**: `cd ../.. && pnpm install`

### 2. 配置环境变量

#### Portal 环境变量

```env
# 应用配置
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://your-portal-domain.vercel.app
NEXT_PUBLIC_IDP_URL=https://your-idp-domain.vercel.app

# OAuth 配置
NEXT_PUBLIC_CLIENT_ID=portal
IDP_CLIENT_SECRET=your-portal-client-secret

# Session 配置
SESSION_IDLE_TIMEOUT_MS=1800000
SESSION_ABSOLUTE_TIMEOUT_MS=604800000

# Redis 配置 (Upstash)
REDIS_URL=your-upstash-redis-url
REDIS_TOKEN=your-upstash-redis-token

# 数据库配置
DATABASE_URL=your-postgresql-connection-string
```

#### IdP 环境变量

```env
# Better Auth 配置
BETTER_AUTH_SECRET=your-secret-min-32-characters-long
BETTER_AUTH_URL=https://your-idp-domain.vercel.app

# Session 配置
SESSION_MAX_AGE_SEC=604800

# Redis 配置 (Upstash)
REDIS_URL=your-upstash-redis-url
REDIS_TOKEN=your-upstash-redis-token

# 数据库配置
DATABASE_URL=your-postgresql-connection-string

# JWT 配置
JWT_ISSUER=auth-sso
```

### 3. 配置数据库

#### 创建数据库表

部署前需要执行数据库迁移：

```bash
# 本地执行
cd apps/idp
pnpm drizzle-kit push
```

或者在 Vercel 的构建命令中添加：

```bash
cd ../.. && pnpm install && pnpm --filter @auth-sso/idp db:push && pnpm --filter @auth-sso/idp build
```

### 4. 配置 Upstash Redis

1. 在 Upstash 创建 Redis 实例
2. 获取 `REDIS_URL` 和 `REDIS_TOKEN`
3. 在两个项目中都配置相同的 Redis 环境变量

### 5. 配置域名

#### 设置自定义域名（可选）

1. 在 Vercel Dashboard 中选择项目
2. 进入 Settings > Domains
3. 添加自定义域名

#### 推荐域名配置

- Portal: `portal.your-domain.com`
- IdP: `idp.your-domain.com` 或 `sso.your-domain.com`

### 6. 部署

#### 方式一：通过 Vercel Dashboard

1. 连接 Git 仓库
2. 选择分支
3. 点击 Deploy

#### 方式二：通过 CLI

```bash
# 登录 Vercel
vercel login

# 部署 Portal
cd apps/portal
vercel --prod

# 部署 IdP
cd ../idp
vercel --prod
```

## 环境变量说明

### 必需变量

| 变量名 | Portal | IdP | 说明 |
|--------|--------|-----|------|
| `DATABASE_URL` | ✅ | ✅ | PostgreSQL 连接字符串 |
| `REDIS_URL` | ✅ | ✅ | Redis 连接 URL |
| `BETTER_AUTH_SECRET` | ❌ | ✅ | Better Auth 加密密钥 (≥32字符) |
| `BETTER_AUTH_URL` | ❌ | ✅ | IdP 公开 URL |
| `NEXT_PUBLIC_APP_URL` | ✅ | ❌ | Portal 公开 URL |
| `NEXT_PUBLIC_IDP_URL` | ✅ | ❌ | IdP 公开 URL |

### 可选变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `SESSION_IDLE_TIMEOUT_MS` | 1800000 | Session 空闲超时 (30分钟) |
| `SESSION_ABSOLUTE_TIMEOUT_MS` | 604800000 | Session 绝对超时 (7天) |
| `SESSION_MAX_AGE_SEC` | 604800 | IdP Session 最大年龄 |

## 生成密钥

```bash
# 生成 BETTER_AUTH_SECRET
openssl rand -base64 32

# 生成 IDP_CLIENT_SECRET
openssl rand -hex 32
```

## 部署后验证

### 1. 检查 IdP 健康状态

```bash
curl https://your-idp-domain.vercel.app/api/auth/ok
# 预期返回: {"ok":true}
```

### 2. 检查 OIDC 发现端点

```bash
curl https://your-idp-domain.vercel.app/api/auth/.well-known/openid-configuration
```

### 3. 检查 JWKS 端点

```bash
curl https://your-idp-domain.vercel.app/api/auth/jwks
```

### 4. 测试 Portal 登录

访问 `https://your-portal-domain.vercel.app`，测试登录流程。

## 常见问题

### 1. 构建失败：找不到包

确保在 Vercel 项目设置中正确配置了 Root Directory 和构建命令。

### 2. 数据库连接失败

- 检查 `DATABASE_URL` 格式
- 确保数据库允许 Vercel 的 IP 地址访问
- 使用连接池模式（如 Vercel Postgres）

### 3. Redis 连接失败

- 确保使用 Upstash Redis 或兼容的 Redis 服务
- 检查 `REDIS_URL` 和 `REDIS_TOKEN` 配置

### 4. Session 无法共享

确保 Portal 和 IdP 使用相同的 Redis 实例，并且 key 前缀正确配置。

## 监控与日志

### Vercel Analytics

在 Vercel Dashboard 中启用 Analytics：
1. 进入项目 Settings
2. 选择 Analytics
3. 启用 Web Analytics

### 日志查看

```bash
# 使用 Vercel CLI 查看日志
vercel logs --follow
```

## 回滚

如果部署出现问题：

1. 在 Vercel Dashboard 中选择项目
2. 进入 Deployments
3. 选择上一个成功的部署
4. 点击 "Promote to Production"

---

## 快速部署命令参考

```bash
# 安装 Vercel CLI
npm i -g vercel

# 登录
vercel login

# 部署 Portal
cd apps/portal && vercel --prod

# 部署 IdP
cd ../idp && vercel --prod
```