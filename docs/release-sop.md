# 发布 SOP（标准操作流程）

## 1. 发布前准备

### 1.1 代码准备

- [ ] 代码已合并到 main 分支
- [ ] 所有测试通过
- [ ] 代码审查完成
- [ ] 版本标签已创建

```bash
# 创建版本标签
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

### 1.2 配置准备

- [ ] 环境变量已确认
- [ ] 数据库迁移脚本已准备
- [ ] 备份已完成

### 1.3 通知准备

- [ ] 发布时间已确定
- [ ] 相关人员已通知
- [ ] 用户公告已准备

---

## 2. 发布流程

### 2.1 发布时间窗口

| 环境 | 发布时间 | 维护窗口 |
|------|----------|----------|
| 测试环境 | 工作日 10:00-18:00 | 无限制 |
| 生产环境 | 工作日 22:00-次日 06:00 | 2 小时 |

### 2.2 发布步骤

#### 步骤 1：备份数据库

```bash
# 备份 PostgreSQL
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# 备份 Redis（如果需要）
redis-cli BGSAVE
cp /var/lib/redis/dump.rdb /backup/redis_$(date +%Y%m%d_%H%M%S).rdb
```

#### 步骤 2：拉取最新代码

```bash
# Portal
cd /opt/apps/portal
git fetch origin
git checkout v1.0.0

# IdP
cd /opt/apps/idp
git fetch origin
git checkout v1.0.0
```

#### 步骤 3：安装依赖

```bash
# Portal
cd /opt/apps/portal
pnpm install

# IdP
cd /opt/apps/idp
pnpm install
```

#### 步骤 4：执行数据库迁移

```bash
# 如果有迁移脚本
cd /opt/apps/idp
pnpm drizzle-kit push
```

#### 步骤 5：构建应用

```bash
# Portal
cd /opt/apps/portal
pnpm build

# IdP
cd /opt/apps/idp
pnpm build
```

#### 步骤 6：停止服务

```bash
pm2 stop portal
pm2 stop idp
```

#### 步骤 7：启动服务

```bash
pm2 start portal
pm2 start idp
```

#### 步骤 8：验证服务

```bash
# 验证 Portal
curl https://portal.example.com/api/me

# 验证 IdP
curl https://idp.example.com/api/auth/ok
```

---

## 3. 发布检查清单

### 3.1 发布前检查（发布前 1 小时）

- [ ] 代码已合并到 main 分支
- [ ] 版本标签已创建
- [ ] 测试环境验证通过
- [ ] 发布说明已准备
- [ ] 相关人员已通知

### 3.2 发布中检查

- [ ] 数据库备份完成
- [ ] 代码拉取成功
- [ ] 依赖安装成功
- [ ] 构建成功
- [ ] 服务启动成功

### 3.3 发布后检查（发布后 30 分钟）

- [ ] Portal 功能正常
- [ ] IdP 功能正常
- [ ] 登录功能正常
- [ ] SSO 功能正常
- [ ] 监控正常
- [ ] 日志正常

---

## 4. 发布脚本

### 4.1 完整发布脚本

```bash
#!/bin/bash
# deploy.sh - Auth-SSO 发布脚本

set -e

VERSION=${1:-"latest"}
APP_NAME="auth-sso"

echo "=== 开始发布 $APP_NAME v$VERSION ==="

# 1. 备份数据库
echo "[1/8] 备份数据库..."
pg_dump $DATABASE_URL > /backup/db_$(date +%Y%m%d_%H%M%S).sql

# 2. 拉取代码
echo "[2/8] 拉取代码..."
cd /opt/apps/portal
git fetch origin
if [ "$VERSION" != "latest" ]; then
  git checkout $VERSION
else
  git pull origin main
fi

cd /opt/apps/idp
git fetch origin
if [ "$VERSION" != "latest" ]; then
  git checkout $VERSION
else
  git pull origin main
fi

# 3. 安装依赖
echo "[3/8] 安装依赖..."
cd /opt/apps/portal && pnpm install
cd /opt/apps/idp && pnpm install

# 4. 构建
echo "[4/8] 构建应用..."
cd /opt/apps/portal && pnpm build
cd /opt/apps/idp && pnpm build

# 5. 停止服务
echo "[5/8] 停止服务..."
pm2 stop portal || true
pm2 stop idp || true

# 6. 启动服务
echo "[6/8] 启动服务..."
pm2 start /opt/apps/portal/ecosystem.config.js
pm2 start /opt/apps/idp/ecosystem.config.js

# 7. 等待服务启动
echo "[7/8] 等待服务启动..."
sleep 10

# 8. 验证服务
echo "[8/8] 验证服务..."
curl -sf https://portal.example.com/api/me > /dev/null && echo "Portal: OK" || echo "Portal: FAILED"
curl -sf https://idp.example.com/api/auth/ok > /dev/null && echo "IdP: OK" || echo "IdP: FAILED"

echo "=== 发布完成 ==="
```

### 4.2 PM2 配置文件

```javascript
// ecosystem.config.js (Portal)
module.exports = {
  apps: [{
    name: 'portal',
    cwd: '/opt/apps/portal',
    script: 'node_modules/next/dist/bin/next',
    args: 'start',
    instances: 2,
    exec_mode: 'cluster',
    env_production: {
      NODE_ENV: 'production',
      PORT: 4000
    }
  }]
};

// ecosystem.config.js (IdP)
module.exports = {
  apps: [{
    name: 'idp',
    cwd: '/opt/apps/idp',
    script: 'node_modules/next/dist/bin/next',
    args: 'start',
    instances: 2,
    exec_mode: 'cluster',
    env_production: {
      NODE_ENV: 'production',
      PORT: 4001
    }
  }]
};
```

---

## 5. 发布后验证

### 5.1 功能验证清单

```bash
#!/bin/bash
# verify.sh - 发布后验证脚本

echo "=== 功能验证 ==="

# 1. 健康检查
echo "1. 健康检查..."
curl -sf https://portal.example.com/api/me || exit 1
curl -sf https://idp.example.com/api/auth/ok || exit 1

# 2. 登录测试
echo "2. 登录测试..."
# 使用测试账号进行登录测试

# 3. SSO 测试
echo "3. SSO 测试..."
# 测试子应用免登

echo "=== 验证完成 ==="
```

### 5.2 性能验证

| 接口 | 预期响应时间 | 实际响应时间 |
|------|--------------|--------------|
| GET /api/me | < 100ms | |
| POST /api/auth/login | < 2s | |
| GET /api/users | < 500ms | |

---

## 6. 发布通知模板

### 6.1 发布前通知

```
【发布通知】

发布时间：YYYY-MM-DD HH:MM - HH:MM
发布内容：Auth-SSO v1.0.0
影响范围：系统维护期间暂停服务

发布内容：
1. 新功能：[列表]
2. 修复：[列表]
3. 优化：[列表]

请提前做好相关准备。

技术团队
YYYY-MM-DD
```

### 6.2 发布完成通知

```
【发布完成通知】

发布时间：YYYY-MM-DD HH:MM
发布结果：成功
系统状态：正常运行

本次发布内容：
1. 新功能：[列表]
2. 修复：[列表]
3. 优化：[列表]

如有问题请联系技术支持。

技术团队
YYYY-MM-DD
```

---

## 7. 应急处理

### 7.1 发布失败处理

1. 立即停止发布
2. 评估是否需要回滚
3. 通知相关人员
4. 执行回滚（如需要）
5. 记录问题原因
6. 制定修复方案

### 7.2 发布后问题处理

| 问题级别 | 响应时间 | 处理方式 |
|----------|----------|----------|
| P0 - 严重 | 5 分钟 | 立即回滚 |
| P1 - 严重 | 15 分钟 | 评估后决定 |
| P2 - 一般 | 1 小时 | 计划修复 |
| P3 - 轻微 | 24 小时 | 计划修复 |

---

## 8. 发布记录

每次发布需记录以下信息：

| 字段 | 内容 |
|------|------|
| 发布日期 | |
| 发布版本 | |
| 发布人员 | |
| 发布内容 | |
| 发布结果 | |
| 问题记录 | |
| 改进措施 | |