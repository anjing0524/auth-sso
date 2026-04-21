# Auth-SSO 环境变量配置指南

## 快速对比

| 环境 | 配置位置 | 说明 |
|------|---------|------|
| **本地开发** | 各应用 `.env.local` 文件 | 仅用于本地，不提交到 Git |
| **Vercel 生产** | Vercel Dashboard > Settings > Environment Variables | 安全存储，支持多环境 |

---

## 本地开发环境变量

### IdP (apps/idp/.env.local)

```bash
# 数据库 - 本地 PostgreSQL
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/auth_sso_idp

# Redis - 本地 Redis
REDIS_URL=redis://localhost:6379

# Better Auth - 生成: openssl rand -base64 32
BETTER_AUTH_SECRET=your-secret-min-32-chars
BETTER_AUTH_URL=http://localhost:4001

# JWT - 生成: openssl rand -base64 32
JWT_SECRET=your-jwt-secret-min-32-chars
```

### Portal (apps/portal/.env.local)

```bash
# 数据库
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/auth_sso_portal

# Redis
REDIS_URL=redis://localhost:6379

# IdP 连接
NEXT_PUBLIC_IDP_URL=http://localhost:4001
IDP_CLIENT_SECRET=portal-secret

# Session - 生成: openssl rand -base64 32
SESSION_SECRET=your-session-secret-min-32-chars
```

### Customer Graph (apps/customer-graph/.env.local)

```bash
# 应用配置
NEXT_PUBLIC_APP_URL=http://localhost:4003

# IdP 连接
NEXT_PUBLIC_IDP_URL=http://localhost:4001
NEXT_PUBLIC_CLIENT_ID=customer-graph
IDP_CLIENT_SECRET=customer-graph-secret

# Redis
REDIS_URL=redis://localhost:6379
```

### Demo App (apps/demo-app/.env.local)

```bash
# 可选 - 代码中已有默认值，如需覆盖可配置
OAUTH_ISSUER=http://localhost:4001
OAUTH_CLIENT_SECRET=demo-app-secret
```

---

## Vercel 生产环境变量

### IdP 生产环境变量

在 Vercel Dashboard > auth-sso-idp > Settings > Environment Variables 中配置：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `NODE_ENV` | `production` | 生产模式 |
| `NEXT_PUBLIC_APP_URL` | `https://your-idp-domain.vercel.app` | IdP 公开 URL |
| `DATABASE_URL` | PostgreSQL 连接字符串 | 使用 SSL |
| `REDIS_URL` | Upstash Redis URL | Serverless Redis |
| `REDIS_TOKEN` | Upstash Redis Token | 认证令牌 |
| `BETTER_AUTH_SECRET` | 随机字符串 | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | IdP 公开 URL | 与上面相同 |
| `JWT_SECRET` | 随机字符串 | `openssl rand -base64 32` |
| `PORTAL_CLIENT_SECRET` | 随机字符串 | `openssl rand -hex 32` |
| `PORTAL_REDIRECT_URL` | Portal 回调 URL | `https://portal/api/auth/callback` |
| `DEMO_APP_CLIENT_SECRET` | 随机字符串 | `openssl rand -hex 32` |
| `DEMO_APP_REDIRECT_URL` | Demo 回调 URL | `https://demo/auth/callback` |

### Portal 生产环境变量

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `NODE_ENV` | `production` | 生产模式 |
| `NEXT_PUBLIC_APP_URL` | Portal 公开 URL | `https://portal-domain.vercel.app` |
| `DATABASE_URL` | PostgreSQL 连接字符串 | 使用 SSL |
| `REDIS_URL` | Upstash Redis URL | Serverless Redis |
| `REDIS_TOKEN` | Upstash Redis Token | 认证令牌 |
| `NEXT_PUBLIC_IDP_URL` | IdP 公开 URL | `https://idp-domain.vercel.app` |
| `IDP_CLIENT_SECRET` | 与 IdP 配置相同 | `PORTAL_CLIENT_SECRET` 的值 |
| `SESSION_SECRET` | 随机字符串 | `openssl rand -base64 32` |

### Demo App 生产环境变量

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `NODE_ENV` | `production` | 生产模式 |
| `OAUTH_ISSUER` | IdP 公开 URL | `https://idp-domain.vercel.app` |
| `OAUTH_CLIENT_ID` | `demo-app` | 固定值 |
| `OAUTH_CLIENT_SECRET` | 与 IdP 配置相同 | `DEMO_APP_CLIENT_SECRET` 的值 |
| `OAUTH_REDIRECT_URI` | Demo 回调 URL | `https://demo-domain.vercel.app/auth/callback` |
| `APP_URL` | Demo 公开 URL | `https://demo-domain.vercel.app` |

---

## 生成密钥命令

```bash
# BETTER_AUTH_SECRET / JWT_SECRET / SESSION_SECRET (≥32 字符)
openssl rand -base64 32

# CLIENT_SECRET (Hex 格式)
openssl rand -hex 32
```

---

## 重要安全提示

1. **永远不要提交 `.env.local` 到 Git**
   - 已配置 `.gitignore` 自动排除
   - 示例文件 `.env.example` 可以提交

2. **本地 vs 生产分离**
   - 本地使用 `.env.local`
   - 生产使用 Vercel Dashboard

3. **敏感信息保护**
   - 数据库密码
   - JWT 密钥
   - OAuth Client Secret
   - Session 密钥

4. **Vercel 环境变量自动加密**
   - 在 Dashboard 中设置的变量自动加密存储
   - 只有项目成员可以访问
