# 回滚预案

## 1. 回滚场景定义

### 1.1 需要回滚的场景

| 场景 | 触发条件 | 回滚方式 |
|------|----------|----------|
| 应用启动失败 | 服务无法启动 | 代码回滚 |
| 数据库迁移失败 | Schema 不兼容 | 数据库回滚 |
| 认证功能异常 | 登录/登出失败 | 代码回滚 |
| SSO 功能异常 | 子应用无法认证 | 代码回滚 |
| 性能严重下降 | 响应时间 > 10s | 代码回滚 |
| 安全漏洞 | 发现严重安全漏洞 | 紧急回滚 |

### 1.2 回滚决策矩阵

| 影响范围 | 严重程度 | 决策 |
|----------|----------|------|
| 全部用户 | 严重 | 立即回滚 |
| 全部用户 | 一般 | 评估后决定 |
| 部分用户 | 严重 | 30分钟内回滚 |
| 部分用户 | 一般 | 评估后决定 |

---

## 2. 代码回滚

### 2.1 Git 回滚步骤

```bash
# 1. 确认当前版本
git log -1 --oneline

# 2. 查看上一个稳定版本
git log --oneline -10

# 3. 回滚到指定版本（保留历史）
git revert HEAD
git push origin main

# 或者硬回滚（谨慎使用）
git reset --hard <stable-commit>
git push origin main --force

# 4. 重新部署
./deploy.sh
```

### 2.2 版本标签管理

```bash
# 创建发布标签
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0

# 回滚到指定标签
git checkout v0.9.0
./deploy.sh
```

---

## 3. 数据库回滚

### 3.1 Drizzle 迁移回滚

```bash
# 查看迁移历史
ls -la drizzle/

# 如果有回滚脚本
pnpm drizzle-kit push

# 手动回滚（谨慎）
psql $DATABASE_URL -f drizzle/revert.sql
```

### 3.2 数据库备份恢复

```bash
# 备份当前数据库（回滚前）
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# 恢复到备份点
psql $DATABASE_URL < backup_20250330_100000.sql
```

### 3.3 数据库回滚检查清单

- [ ] 确认备份文件存在
- [ ] 确认备份文件完整性
- [ ] 通知所有相关人员
- [ ] 停止应用服务
- [ ] 执行数据库恢复
- [ ] 验证数据完整性
- [ ] 重启应用服务

---

## 4. Redis 回滚

### 4.1 Redis 数据恢复

```bash
# 如果开启了 RDB 持久化
# 1. 停止 Redis
redis-cli SHUTDOWN

# 2. 恢复 dump.rdb 文件
cp /backup/dump.rdb /var/lib/redis/

# 3. 启动 Redis
redis-server /etc/redis/redis.conf
```

### 4.2 Session 清理

```bash
# 清除所有 Portal Session
redis-cli KEYS "portal:session:*" | xargs redis-cli DEL

# 清除所有 IdP Session
redis-cli KEYS "idp:session:*" | xargs redis-cli DEL
```

---

## 5. 应用回滚

### 5.1 Portal 回滚

```bash
# 1. 停止当前服务
pm2 stop portal

# 2. 切换到稳定版本
cd /opt/apps/portal
git checkout v1.0.0

# 3. 安装依赖
pnpm install

# 4. 构建
pnpm build

# 5. 启动服务
pm2 start portal

# 6. 验证服务
curl https://portal.example.com/api/me
```

### 5.2 IdP 回滚

```bash
# 1. 停止当前服务
pm2 stop idp

# 2. 切换到稳定版本
cd /opt/apps/idp
git checkout v1.0.0

# 3. 安装依赖
pnpm install

# 4. 构建
pnpm build

# 5. 启动服务
pm2 start idp

# 6. 验证服务
curl https://idp.example.com/api/auth/ok
```

---

## 6. 紧急回滚流程

### 6.1 快速回滚命令

```bash
#!/bin/bash
# emergency-rollback.sh

set -e

echo "=== 开始紧急回滚 ==="

# 记录当前版本
CURRENT_VERSION=$(git log -1 --oneline)
echo "当前版本: $CURRENT_VERSION"

# 停止服务
echo "停止服务..."
pm2 stop all

# 回滚代码
echo "回滚代码..."
git fetch origin
git checkout v1.0.0

# 更新依赖
echo "更新依赖..."
pnpm install

# 构建
echo "构建应用..."
pnpm build

# 启动服务
echo "启动服务..."
pm2 start all

# 验证
echo "验证服务..."
sleep 5
curl -s https://portal.example.com/api/me || echo "Portal 异常"
curl -s https://idp.example.com/api/auth/ok || echo "IdP 异常"

echo "=== 回滚完成 ==="
```

### 6.2 紧急回滚检查清单

- [ ] 通知所有相关人员
- [ ] 记录当前版本信息
- [ ] 执行回滚脚本
- [ ] 验证服务正常
- [ ] 通知用户恢复
- [ ] 记录回滚原因

---

## 7. 回滚后验证

### 7.1 功能验证

| 功能 | 验证方法 | 状态 |
|------|----------|------|
| 用户登录 | 测试账号登录 | [ ] |
| 用户登出 | 登出后无法访问 | [ ] |
| 权限验证 | 无权限访问被拒绝 | [ ] |
| SSO 功能 | 子应用免登测试 | [ ] |

### 7.2 性能验证

| 指标 | 预期值 | 实际值 | 状态 |
|------|--------|--------|------|
| 登录响应时间 | < 2s | | [ ] |
| API 响应时间 | < 500ms | | [ ] |
| 错误率 | < 0.1% | | [ ] |

---

## 8. 回滚记录模板

```
回滚记录
========

日期时间：YYYY-MM-DD HH:MM
回滚人员：
回滚原因：

回滚前版本：
回滚后版本：

回滚步骤：
1.
2.
3.

验证结果：
- 登录功能：正常/异常
- SSO 功能：正常/异常
- 权限功能：正常/异常

问题分析：
[描述导致回滚的问题]

后续措施：
[防止再次发生的措施]
```

---

## 9. 联系人

| 角色 | 姓名 | 电话 | 邮箱 |
|------|------|------|------|
| 技术负责人 | | | |
| 运维负责人 | | | |
| 产品负责人 | | | |
| 测试负责人 | | | |