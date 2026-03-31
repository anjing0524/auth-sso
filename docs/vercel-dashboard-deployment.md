# Vercel Dashboard 部署指南

## 概述

由于本地网络 DNS 问题，推荐使用 Vercel Dashboard 进行部署。

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
| **Build Command** | `cd ../.. && pnpm install && pnpm --filter @auth-sso/idp build` |
| **Output Directory** | `.next` |
| **Install Command** | `cd ../.. && pnpm install` |

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
| **Build Command** | `cd ../.. && pnpm install && pnpm --filter @auth-sso/portal build` |
| **Output Directory** | `.next` |
| **Install Command** | `cd ../.. && pnpm install` |

### 2.2 配置环境变量

```
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://portal.longlongago.sit
NEXT_PUBLIC_IDP_URL=https://idp.longlongago.sit
NEXT_PUBLIC_CLIENT_ID=portal
IDP_CLIENT_SECRET=<与 IdP 中配置的 portal secret 相同>
DATABASE_URL=<您的 PostgreSQL 连接字符串>
REDIS_URL=<您的 Upstash Redis URL>
REDIS_TOKEN=<您的 Upstash Redis Token>
SESSION_IDLE_TIMEOUT_MS=1800000
SESSION_ABSOLUTE_TIMEOUT_MS=604800000
```

### 2.3 点击 Deploy

---

## 步骤 3: 配置域名

### 3.1 为 IdP 添加域名

1. 进入 `auth-sso-idp` 项目
2. 点击 **Settings** → **Domains**
3. 添加域名: `idp.longlongago.sit`
4. 按照提示配置 DNS 记录

### 3.2 为 Portal 添加域名

1. 进入 `auth-sso-portal` 项目
2. 点击 **Settings** → **Domains**
3. 添加域名: `portal.longlongago.sit`
4. 按照提示配置 DNS 记录

---

## 步骤 4: DNS 配置

在您的域名 DNS 管理面板添加以下记录：

| 类型 | 名称 | 值 |
|------|------|-----|
| CNAME | idp | cname.vercel-dns.com |
| CNAME | portal | cname.vercel-dns.com |

---

## 步骤 5: 更新 IdP 的 trustedClients

部署完成后，需要在 IdP 的 Better Auth 配置中更新 Portal 的回调地址：

```typescript
// apps/idp/src/lib/auth.ts
trustedClients: [
  {
    clientId: 'portal',
    clientSecret: process.env.PORTAL_CLIENT_SECRET || 'portal-secret',
    name: 'Portal',
    redirectUrls: ['https://portal.longlongago.sit/auth/callback'],
    skipConsent: true,
  },
]
```

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

---

## 数据库初始化

首次部署后需要初始化数据库：

### 方式 1: 本地执行迁移

```bash
cd apps/idp
DATABASE_URL=<生产数据库URL> pnpm drizzle-kit push
```

### 方式 2: 在 Vercel 构建命令中添加

修改 Build Command 为：
```
cd ../.. && pnpm install && pnpm --filter @auth-sso/idp db:push && pnpm --filter @auth-sso/idp build
```

---

## 生成密钥命令

```bash
# BETTER_AUTH_SECRET
openssl rand -base64 32

# IDP_CLIENT_SECRET
openssl rand -hex 32
```

---

## 常见问题

### Q: 构建失败 "pnpm: command not found"

在项目根目录添加 `packageManager` 字段：

```json
{
  "packageManager": "pnpm@10.12.4"
}
```

### Q: 数据库连接失败

确保：
1. 数据库允许 Vercel IP 访问
2. 使用 SSL 连接 (`?sslmode=require`)
3. 使用连接池模式

### Q: Redis 连接失败

确保使用 Upstash Redis 或其他支持 Vercel 的 Redis 服务。