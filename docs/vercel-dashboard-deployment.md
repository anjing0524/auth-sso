# Vercel Dashboard 部署指南

## 概述

由于本地网络 DNS 问题，推荐使用 Vercel Dashboard 进行部署。

本项目包含三个 Next.js 应用：
- **IdP** - 身份提供者 (端口 4001)
- **Portal** - 管理门户 (端口 4000)
- **Demo App** - SSO 测试应用 (端口 4002)

## 前置条件

- GitHub 仓库已创建: https://github.com/anjing0524/auth-sso
- 目标域名: `longlongago.sit`

---

## 步骤 1: 部署 IdP 项目

### 1.1 创建项目

1. 访问 [Vercel Dashboard](https://vercel.com/dashboard)
2. 点击 **Add New...** → **Project**
3. 选择 GitHub 仓库 `anjing0524/auth-sso`
4. 配置项目：

| 配置项 | 值 |
|--------|-----|
| **Project Name** | `auth-sso-idp` |
| **Framework Preset** | Next.js |
| **Root Directory** | `apps/idp` |

> **注意**: Vercel 会自动检测 pnpm monorepo 配置，无需手动设置 Build/Install Command。

### 1.2 配置环境变量

点击 **Environment Variables** 添加以下变量：

```
NODE_ENV=production
BETTER_AUTH_SECRET=<生成密钥: openssl rand -base64 32>
BETTER_AUTH_URL=https://idp.longlongago.sit
DATABASE_URL=<您的 PostgreSQL 连接字符串>
REDIS_URL=<您的 Upstash Redis URL>
REDIS_TOKEN=<您的 Upstash Redis Token>
JWT_ISSUER=auth-sso
SESSION_MAX_AGE_SEC=604800
PORTAL_CLIENT_SECRET=<生成密钥: openssl rand -hex 32>
PORTAL_REDIRECT_URL=https://portal.longlongago.sit/api/auth/callback
DEMO_APP_CLIENT_SECRET=<生成密钥: openssl rand -hex 32>
DEMO_APP_REDIRECT_URL=https://demo.longlongago.sit/auth/callback
```

### 1.3 点击 Deploy

---

## 步骤 2: 部署 Portal 项目

### 2.1 创建项目

1. 访问 [Vercel Dashboard](https://vercel.com/dashboard)
2. 点击 **Add New...** → **Project**
3. 选择 GitHub 仓库 `anjing0524/auth-sso`
4. 配置项目：

| 配置项 | 值 |
|--------|-----|
| **Project Name** | `auth-sso-portal` |
| **Framework Preset** | Next.js |
| **Root Directory** | `apps/portal` |

### 2.2 配置环境变量

```
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://portal.longlongago.sit
NEXT_PUBLIC_IDP_URL=https://idp.longlongago.sit
NEXT_PUBLIC_CLIENT_ID=portal
IDP_CLIENT_SECRET=<与 IdP 中配置的 PORTAL_CLIENT_SECRET 相同>
DATABASE_URL=<您的 PostgreSQL 连接字符串>
REDIS_URL=<您的 Upstash Redis URL>
REDIS_TOKEN=<您的 Upstash Redis Token>
SESSION_IDLE_TIMEOUT_MS=1800000
SESSION_ABSOLUTE_TIMEOUT_MS=604800000
```

### 2.3 点击 Deploy

---

## 步骤 3: 部署 Demo App 项目

### 3.1 创建项目

1. 访问 [Vercel Dashboard](https://vercel.com/dashboard)
2. 点击 **Add New...** → **Project**
3. 选择 GitHub 仓库 `anjing0524/auth-sso`
4. 配置项目：

| 配置项 | 值 |
|--------|-----|
| **Project Name** | `auth-sso-demo` |
| **Framework Preset** | Next.js |
| **Root Directory** | `apps/demo-app` |

### 3.2 配置环境变量

```
NODE_ENV=production
OAUTH_ISSUER=https://idp.longlongago.sit
OAUTH_AUTH_ENDPOINT=https://idp.longlongago.sit/api/auth/authorize
OAUTH_TOKEN_ENDPOINT=https://idp.longlongago.sit/api/auth/token
OAUTH_USERINFO_ENDPOINT=https://idp.longlongago.sit/api/auth/userinfo
OAUTH_JWKS_ENDPOINT=https://idp.longlongago.sit/api/auth/jwks
OAUTH_LOGOUT_ENDPOINT=https://idp.longlongago.sit/api/auth/sign-out
OAUTH_CLIENT_ID=demo-app
OAUTH_CLIENT_SECRET=<与 IdP 中配置的 DEMO_APP_CLIENT_SECRET 相同>
OAUTH_REDIRECT_URI=https://demo.longlongago.sit/auth/callback
APP_URL=https://demo.longlongago.sit
```

### 3.3 点击 Deploy

---

## 步骤 4: 配置域名

### 4.1 为 IdP 添加域名

1. 进入 `auth-sso-idp` 项目
2. 点击 **Settings** → **Domains**
3. 添加域名: `idp.longlongago.sit`
4. 按照提示配置 DNS 记录

### 4.2 为 Portal 添加域名

1. 进入 `auth-sso-portal` 项目
2. 点击 **Settings** → **Domains**
3. 添加域名: `portal.longlongago.sit`
4. 按照提示配置 DNS 记录

### 4.3 为 Demo App 添加域名

1. 进入 `auth-sso-demo` 项目
2. 点击 **Settings** → **Domains**
3. 添加域名: `demo.longlongago.sit`
4. 按照提示配置 DNS 记录

---

## 步骤 5: DNS 配置

在您的域名 DNS 管理面板添加以下记录：

| 类型 | 名称 | 值 |
|------|------|-----|
| CNAME | idp | cname.vercel-dns.com |
| CNAME | portal | cname.vercel-dns.com |
| CNAME | demo | cname.vercel-dns.com |

---

## 部署后验证

### 检查 IdP

```bash
curl https://idp.longlongago.sit/api/auth/ok
# 预期: {"ok":true}
```

### 检查 OIDC 发现端点

```bash
curl https://idp.longlongago.sit/api/auth/.well-known/openid-configuration
```

### 检查 Portal

访问 https://portal.longlongago.sit 应该自动跳转到登录页面。

### 检查 Demo App

访问 https://demo.longlongago.sit 点击 "SSO 登录" 测试单点登录。

---

## 数据库初始化

首次部署后需要初始化数据库：

```bash
cd apps/idp
DATABASE_URL=<生产数据库URL> pnpm drizzle-kit push
```

---

## 生成密钥命令

```bash
# BETTER_AUTH_SECRET (≥32 字符)
openssl rand -base64 32

# PORTAL_CLIENT_SECRET / DEMO_APP_CLIENT_SECRET
openssl rand -hex 32
```

---

## 环境变量说明

### IdP 环境变量

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `BETTER_AUTH_SECRET` | ✅ | 加密密钥 (≥32字符) |
| `BETTER_AUTH_URL` | ✅ | IdP 公开 URL |
| `DATABASE_URL` | ✅ | PostgreSQL 连接字符串 |
| `REDIS_URL` | ✅ | Redis 连接 URL |
| `REDIS_TOKEN` | ✅ | Redis Token |
| `PORTAL_CLIENT_SECRET` | ✅ | Portal OAuth Secret |
| `PORTAL_REDIRECT_URL` | ✅ | Portal 回调 URL |
| `DEMO_APP_CLIENT_SECRET` | ✅ | Demo App OAuth Secret |
| `DEMO_APP_REDIRECT_URL` | ✅ | Demo App 回调 URL |

### Portal 环境变量

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `NEXT_PUBLIC_APP_URL` | ✅ | Portal 公开 URL |
| `NEXT_PUBLIC_IDP_URL` | ✅ | IdP 公开 URL |
| `IDP_CLIENT_SECRET` | ✅ | 与 IdP 的 PORTAL_CLIENT_SECRET 相同 |
| `DATABASE_URL` | ✅ | PostgreSQL 连接字符串 |
| `REDIS_URL` | ✅ | Redis 连接 URL |
| `REDIS_TOKEN` | ✅ | Redis Token |

### Demo App 环境变量

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `OAUTH_ISSUER` | ✅ | IdP Issuer URL |
| `OAUTH_CLIENT_ID` | ✅ | 固定为 `demo-app` |
| `OAUTH_CLIENT_SECRET` | ✅ | 与 IdP 的 DEMO_APP_CLIENT_SECRET 相同 |
| `OAUTH_REDIRECT_URI` | ✅ | Demo App 回调 URL |
| `APP_URL` | ✅ | Demo App 公开 URL |

---

## 常见问题

### Q: 构建失败 "pnpm: command not found"

在项目根目录 `package.json` 已配置 `packageManager: "pnpm@10.12.4"`，Vercel 会自动使用。

### Q: 数据库连接失败

确保：
1. 数据库允许 Vercel IP 访问
2. 使用 SSL 连接 (`?sslmode=require`)
3. 使用连接池模式

### Q: Redis 连接失败

确保使用 Upstash Redis 或其他支持 Vercel 的 Redis 服务。

### Q: OAuth 回调失败

确保：
1. IdP 的 `PORTAL_REDIRECT_URL` / `DEMO_APP_REDIRECT_URL` 与对应应用的回调 URL 一致
2. 各应用的 `OAUTH_CLIENT_SECRET` 与 IdP 中配置的对应 Secret 一致