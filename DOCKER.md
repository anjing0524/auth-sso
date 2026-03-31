# Auth-SSO 开发环境

## 快速启动

### 1. 启动基础设施服务

```bash
# 启动 PostgreSQL 和 Redis
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f
```

### 2. 初始化数据库

```bash
# 生成数据库迁移
pnpm db:generate

# 推送 Schema 到数据库
pnpm db:push
```

### 3. 启动应用

```bash
# 启动 IdP (端口 3001)
pnpm dev:idp

# 启动 Portal (端口 3000)
pnpm dev:portal

# 同时启动两者
pnpm dev
```

## 服务地址

| 服务 | 地址 | 说明 |
|------|------|------|
| Portal | http://localhost:3000 | 管理门户 |
| IdP | http://localhost:3001 | 身份提供者 |
| PostgreSQL | localhost:5432 | 数据库 |
| Redis | localhost:6379 | 缓存/Session |

## 可选工具

```bash
# 启动 Redis 管理界面 (http://localhost:6380)
docker-compose --profile tools up -d redis-commander
```

## 常用命令

```bash
# 停止所有服务
docker-compose down

# 重置所有数据（删除数据卷）
docker-compose down -v

# 进入 PostgreSQL 命令行
docker exec -it auth-sso-postgres psql -U postgres

# 进入 Redis 命令行
docker exec -it auth-sso-redis redis-cli
```

## 测试账户

初始化脚本会创建以下测试账户：

| 用户名 | 密码 | 说明 |
|--------|------|------|
| admin | test123456 | 系统管理员 |

## OAuth Client 配置

| Client ID | Client Secret | Redirect URI |
|-----------|---------------|--------------|
| portal | portal-secret | http://localhost:3000/api/auth/callback |

## 环境变量

环境变量已配置在对应的 `.env` 文件中：
- `apps/idp/.env` - IdP 配置
- `apps/portal/.env` - Portal 配置