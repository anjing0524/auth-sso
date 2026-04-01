# Vercel Dashboard 部署指南

## 概述

本项目包含三个 Next.js 应用：
- **IdP** (apps/idp) - 身份提供者，端口 4001
- **Portal** (apps/portal) - 管理门户，端口 4000
- **Demo App** (apps/demo-app) - SSO 测试应用，端口 4002

## 前置条件

- GitHub 仓库: `anjing0524/auth-sso`
- Vercel 账号
- PostgreSQL 数据库 (推荐: Neon)
- Redis (推荐: Upstash)

---

## 部署步骤

### 步骤 1: 准备密钥

```bash
# 生成 IdP 主密钥
openssl rand -base64 32

# 生成 Portal 和 Demo App 的 Client Secret
openssl rand -hex 32
openssl rand -hex 32
```

### 步骤 2: 部署 IdP

1. **Vercel Dashboard** → **Add New...** → **Project**
2. 选择 GitHub 仓库 `anjing0524/auth-sso`
3. 配置:
   - **Project Name**: `auth-sso-idp`
   - **Framework Preset**: Next.js
   - **Root Directory**: `apps/idp`
4. **Environment Variables** (参考 `docs/environment-variables.md`):
   ```
   NODE_ENV=production
   BETTER_AUTH_SECRET=<生成的密钥>
   BETTER_AUTH_URL=https://your-idp-domain.vercel.app
   DATABASE_URL=<PostgreSQL 连接串>
   REDIS_URL=<Upstash Redis URL>
   REDIS_TOKEN=<Upstash Redis Token>
   JWT_SECRET=<生成的密钥>
   PORTAL_CLIENT_SECRET=<生成的密钥>
   PORTAL_REDIRECT_URL=https://your-portal-domain.vercel.app/api/auth/callback
   DEMO_APP_CLIENT_SECRET=<生成的密钥>
   DEMO_APP_REDIRECT_URL=https://your-demo-domain.vercel.app/auth/callback
   ```
5. 点击 **Deploy**

### 步骤 3: 数据库初始化

首次部署后，在本地运行数据库迁移：

```bash
cd apps/idp
DATABASE_URL="<生产数据库URL>" pnpm drizzle-kit push
```

或连接生产数据库后通过 Drizzle Studio 初始化。

### 步骤 4: 部署 Portal

1. **Add New...** → **Project**
2. 选择仓库
3. 配置:
   - **Project Name**: `auth-sso-portal`
   - **Root Directory**: `apps/portal`
4. **Environment Variables**:
   ```
   NODE_ENV=production
   NEXT_PUBLIC_APP_URL=https://your-portal-domain.vercel.app
   DATABASE_URL=<PostgreSQL 连接串>
   REDIS_URL=<Upstash Redis URL>
   REDIS_TOKEN=<Upstash Redis Token>
   NEXT_PUBLIC_IDP_URL=https://your-idp-domain.vercel.app
   IDP_CLIENT_SECRET=<与 IdP 配置相同>
   SESSION_SECRET=<生成的密钥>
   ```
5. 点击 **Deploy**

### 步骤 5: 部署 Demo App

1. **Add New...** → **Project**
2. 选择仓库
3. 配置:
   - **Project Name**: `auth-sso-demo`
   - **Root Directory**: `apps/demo-app`
4. **Environment Variables**:
   ```
   NODE_ENV=production
   OAUTH_ISSUER=https://your-idp-domain.vercel.app
   OAUTH_CLIENT_ID=demo-app
   OAUTH_CLIENT_SECRET=<与 IdP 配置相同>
   OAUTH_REDIRECT_URI=https://your-demo-domain.vercel.app/auth/callback
   APP_URL=https://your-demo-domain.vercel.app
   ```
5. 点击 **Deploy**

### 步骤 6: 配置域名 (可选)

在各自项目的 **Settings** → **Domains** 中添加自定义域名。

---

## 验证部署

### 检查 IdP
```bash
curl https://your-idp-domain.vercel.app/api/auth/ok
# 预期: {"ok":true}
```

### 检查 OIDC 发现端点
```bash
curl https://your-idp-domain.vercel.app/api/auth/.well-known/openid-configuration
```

### 测试登录流程
访问 Portal 域名，应自动跳转到 IdP 登录页。

---

## 本地开发

```bash
# 1. 启动数据库和 Redis
cd tests
./start-services.sh

# 2. 安装依赖
pnpm install

# 3. 配置本地环境变量
# 复制 apps/idp/.env.example → apps/idp/.env.local
# 复制 apps/portal/.env.example → apps/portal/.env.local

# 4. 启动所有应用
pnpm dev
```

---

## 详细环境变量说明

参见: [`docs/environment-variables.md`](./environment-variables.md)

---

## 常见问题

### 构建失败 "pnpm: command not found"
项目根目录已配置 `packageManager: "pnpm@10.12.4"`，Vercel 会自动识别。

### 数据库连接失败
- 确保数据库允许 Vercel IP 访问
- 使用 SSL 连接: `?sslmode=require`
- 使用连接池模式

### Redis 连接失败
确保使用 Upstash Redis 或其他支持 Vercel 的 Redis 服务。

### OAuth 回调失败
- 确保 IdP 的 `PORTAL_REDIRECT_URL` 与 Portal 的回调 URL 一致
- 确保 `OAUTH_CLIENT_SECRET` 与 IdP 配置匹配
