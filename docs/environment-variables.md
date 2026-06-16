# Auth-SSO 环境变量配置指南

## 本地开发环境变量

### Portal OIDC Provider (apps/idp/.env.local)

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

# Portal OIDC Provider 连接
NEXT_PUBLIC_PORTAL_URL=http://localhost:4001
PORTAL_CLIENT_SECRET=portal-secret

# Session - 生成: openssl rand -base64 32
SESSION_SECRET=your-session-secret-min-32-chars
```

### Customer Graph (apps/customer-graph/.env.local)

```bash
# 应用配置
NEXT_PUBLIC_APP_URL=http://localhost:4003

# Portal OIDC Provider 连接
NEXT_PUBLIC_PORTAL_URL=http://localhost:4001
NEXT_PUBLIC_CLIENT_ID=customer-graph
PORTAL_CLIENT_SECRET=customer-graph-secret

# Redis
REDIS_URL=redis://localhost:6379
```

---

## 生产环境变量

### Portal OIDC Provider 生产环境变量

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `NODE_ENV` | `production` | 生产模式 |
| `NEXT_PUBLIC_APP_URL` | Portal OIDC Provider 公开 URL | 应用访问地址 |
| `DATABASE_URL` | PostgreSQL 连接字符串 | 使用 SSL |
| `REDIS_URL` | Redis URL | Redis 连接地址 |
| `BETTER_AUTH_SECRET` | 随机字符串 | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Portal OIDC Provider 公开 URL | 与 NEXT_PUBLIC_APP_URL 相同 |
| `JWT_SECRET` | 随机字符串 | `openssl rand -base64 32` |
| `PORTAL_CLIENT_SECRET` | 随机字符串 | `openssl rand -hex 32` |
| `PORTAL_REDIRECT_URL` | Portal 回调 URL | `https://portal/api/auth/callback` |
| `DEMO_APP_CLIENT_SECRET` | 随机字符串 | `openssl rand -hex 32` |
| `DEMO_APP_REDIRECT_URL` | Demo 回调 URL | `https://demo/auth/callback` |

### Portal 生产环境变量

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `NODE_ENV` | `production` | 生产模式 |
| `NEXT_PUBLIC_APP_URL` | Portal 公开 URL | 应用访问地址 |
| `DATABASE_URL` | PostgreSQL 连接字符串 | 使用 SSL |
| `REDIS_URL` | Redis URL | Redis 连接地址 |
| `NEXT_PUBLIC_PORTAL_URL` | Portal OIDC Provider 公开 URL | Portal OIDC Provider 访问地址 |
| `PORTAL_CLIENT_SECRET` | 与 Portal OIDC Provider 配置相同 | `PORTAL_CLIENT_SECRET` 的值 |
| `SESSION_SECRET` | 随机字符串 | `openssl rand -base64 32` |

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
   - 生产通过部署平台的环境变量管理

3. **敏感信息保护**
   - 数据库密码
   - JWT 密钥
   - OAuth Client Secret
   - Session 密钥
