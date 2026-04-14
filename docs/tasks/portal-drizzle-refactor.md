# Portal Drizzle ORM 重构任务跟踪

## 任务概述
Portal 从 postgres-js 原生查询迁移到 Drizzle ORM + neon-http，与 IdP 保持技术栈一致。

## 任务列表

### 1. 数据库连接层
- [ ] 更新 Portal `src/lib/db.ts` - 使用 Drizzle ORM + neon-http
- [ ] 创建 Portal Drizzle schema 文件

### 2. API 路由重构
- [ ] `src/app/api/users/route.ts`
- [ ] `src/app/api/users/[id]/route.ts`
- [ ] `src/app/api/users/[id]/roles/route.ts`
- [ ] `src/app/api/roles/route.ts`
- [ ] `src/app/api/roles/[id]/route.ts`
- [ ] `src/app/api/roles/[id]/permissions/route.ts`
- [ ] `src/app/api/roles/[id]/data-scopes/route.ts`
- [ ] `src/app/api/permissions/route.ts`
- [ ] `src/app/api/departments/route.ts`
- [ ] `src/app/api/departments/[id]/route.ts`
- [ ] `src/app/api/clients/route.ts`
- [ ] `src/app/api/clients/[id]/route.ts`
- [ ] `src/app/api/clients/[id]/tokens/route.ts`
- [ ] `src/app/api/clients/[id]/secret/route.ts`
- [ ] `src/app/api/audit/logs/route.ts`
- [ ] `src/app/api/audit/login-logs/route.ts`

### 3. 工具函数重构
- [ ] `src/lib/permissions.ts`
- [ ] `src/lib/auth-middleware.ts`
- [ ] `src/lib/audit.ts`

### 4. 清理
- [ ] 移除 postgres-js 依赖（可选保留）
- [ ] 更新环境变量示例文件

## 进度记录
- 开始时间: 2026-04-08