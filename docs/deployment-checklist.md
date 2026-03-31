# 上线检查单

## 1. 环境检查

### 1.1 基础设施

| 检查项 | 检查内容 | 状态 | 备注 |
|--------|----------|------|------|
| Redis | 连接正常，内存充足 | [ ] | |
| PostgreSQL | 连接正常，磁盘空间充足 | [ ] | |
| 域名 | 域名解析正确 | [ ] | |
| HTTPS | SSL 证书有效 | [ ] | |
| 防火墙 | 端口开放正确 | [ ] | |

### 1.2 服务器配置

| 检查项 | 检查内容 | 状态 | 备注 |
|--------|----------|------|------|
| Node.js 版本 | >= 20.x | [ ] | |
| 内存 | >= 2GB 可用 | [ ] | |
| CPU | >= 2 核 | [ ] | |
| 磁盘 | >= 10GB 可用 | [ ] | |

---

## 2. 配置检查

### 2.1 环境变量

#### Portal 必需配置

```env
# 应用配置
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://portal.example.com
NEXT_PUBLIC_IDP_URL=https://idp.example.com

# OAuth 配置
NEXT_PUBLIC_CLIENT_ID=portal
IDP_CLIENT_SECRET=<your-secret>

# Session 配置
SESSION_IDLE_TIMEOUT_MS=1800000
SESSION_ABSOLUTE_TIMEOUT_MS=604800000

# Redis 配置
REDIS_URL=redis://localhost:6379

# 数据库配置
DATABASE_URL=postgresql://user:pass@localhost:5432/auth_sso
```

#### IdP 必需配置

```env
# Better Auth 配置
BETTER_AUTH_SECRET=<min-32-chars-secret>
BETTER_AUTH_URL=https://idp.example.com

# Session 配置
SESSION_MAX_AGE_SEC=604800

# Redis 配置
REDIS_URL=redis://localhost:6379

# 数据库配置
DATABASE_URL=postgresql://user:pass@localhost:5432/auth_sso
```

### 2.2 配置检查清单

| 检查项 | 状态 | 备注 |
|--------|------|------|
| BETTER_AUTH_SECRET 长度 >= 32 字符 | [ ] | |
| BETTER_AUTH_URL 正确设置 | [ ] | |
| DATABASE_URL 正确设置 | [ ] | |
| REDIS_URL 正确设置 | [ ] | |
| 所有密钥已更换为生产密钥 | [ ] | |

---

## 3. 安全检查

### 3.1 Cookie 安全

| 检查项 | 预期值 | 状态 |
|--------|--------|------|
| HttpOnly | true | [ ] |
| Secure | true | [ ] |
| SameSite | lax/strict | [ ] |

### 3.2 HTTPS 检查

| 检查项 | 状态 | 备注 |
|--------|------|------|
| SSL 证书有效 | [ ] | |
| 强制 HTTPS 跳转 | [ ] | |
| HSTS 头设置 | [ ] | |

### 3.3 端口检查

| 服务 | 端口 | 状态 |
|------|------|------|
| Portal | 443 (HTTPS) | [ ] |
| IdP | 443 (HTTPS) | [ ] |
| PostgreSQL | 5432 (内网) | [ ] |
| Redis | 6379 (内网) | [ ] |

---

## 4. 数据库检查

### 4.1 表结构检查

```bash
# 检查所有表是否存在
psql $DATABASE_URL -c "\dt"
```

必需表：
- [ ] users
- [ ] sessions
- [ ] accounts
- [ ] roles
- [ ] permissions
- [ ] user_roles
- [ ] role_permissions
- [ ] departments
- [ ] clients
- [ ] oauth_access_tokens
- [ ] oauth_refresh_tokens
- [ ] audit_logs
- [ ] login_logs

### 4.2 初始数据检查

- [ ] 存在超级管理员角色
- [ ] 存在基础权限数据
- [ ] 存在管理用户

### 4.3 索引检查

```sql
-- 检查关键索引
SELECT indexname FROM pg_indexes WHERE tablename = 'users';
SELECT indexname FROM pg_indexes WHERE tablename = 'sessions';
SELECT indexname FROM pg_indexes WHERE tablename = 'oauth_access_tokens';
```

---

## 5. 功能验证

### 5.1 核心功能验证

| 功能 | 测试步骤 | 状态 |
|------|----------|------|
| 用户登录 | 使用测试账号登录 | [ ] |
| 获取用户信息 | 调用 /api/me | [ ] |
| 用户登出 | 点击登出 | [ ] |
| SSO 登录 | 子应用免登测试 | [ ] |

### 5.2 管理功能验证

| 功能 | 状态 |
|------|------|
| 用户管理 | [ ] |
| 角色管理 | [ ] |
| 权限管理 | [ ] |
| 部门管理 | [ ] |
| Client 管理 | [ ] |

---

## 6. 监控检查

### 6.1 日志检查

| 检查项 | 状态 |
|--------|------|
| 应用日志正常输出 | [ ] |
| 错误日志记录正常 | [ ] |
| 审计日志记录正常 | [ ] |

### 6.2 告警检查

| 告警项 | 状态 |
|--------|------|
| Redis 连接断开告警 | [ ] |
| 数据库连接断开告警 | [ ] |
| 登录失败次数告警 | [ ] |

---

## 7. 备份检查

| 检查项 | 状态 | 备注 |
|--------|------|------|
| 数据库备份策略已配置 | [ ] | |
| Redis 持久化已配置 | [ ] | |
| 备份恢复测试通过 | [ ] | |

---

## 8. 上线批准

| 角色 | 签名 | 日期 |
|------|------|------|
| 开发负责人 | | |
| 测试负责人 | | |
| 运维负责人 | | |
| 产品负责人 | | |

---

## 上线时间安排

- 计划上线时间：YYYY-MM-DD HH:MM
- 预计完成时间：YYYY-MM-DD HH:MM
- 回滚触发条件：[描述]
- 回滚负责人：[姓名]