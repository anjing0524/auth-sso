# 权限系统安全加固与修复计划 (Security Fix Plan)

## 1. 目标 (Objective)
修复目前系统中存在的几项严重安全漏洞，包括明文密码存储、SSO 授权端点的状态校验缺失，以及数据权限 (Data Scope) 校验中的 SQL 注入风险，以确保系统在生产环境中的数据隔离与安全性。

## 2. 影响的文件 (Key Files & Context)
- `apps/portal/src/db/schema.ts`
- `apps/portal/src/app/api/users/route.ts`
- `apps/idp/src/app/api/auth/oauth2/authorize/route.ts`
- `apps/portal/src/lib/auth-middleware.ts`

## 3. 实施步骤 (Implementation Steps)

### 步骤 1: 修复明文密码存储 (CRITICAL)
- **数据库模型**：在 `apps/portal/src/db/schema.ts` 中，从 `users` 表的定义中彻底移除 `password` 字段（保留 `passwordHash` 即可，另外 `accounts` 表中本身也有一份凭证记录）。
- **用户创建接口**：修改 `apps/portal/src/app/api/users/route.ts` 的 `POST` 逻辑，删除在 `tx.insert(schema.users).values(...)` 中对 `password: password` 的显式赋值。

### 步骤 2: 加固 SSO 授权拦截器 (HIGH)
- 修改 `apps/idp/src/app/api/auth/oauth2/authorize/route.ts`。
- 在拦截器逻辑中，增加对 `Client` 自身状态（`client.status === 'ACTIVE'`）和禁用标记（`client.disabled === false`）的检查。
- 增加对当前 `User` 自身状态（`user.status === 'ACTIVE'`）的检查，防止被锁定或停用的账号继续获取 SSO 授权。

### 步骤 3: 消除数据范围校验的 SQL 风险 (HIGH)
- 审查并修改 `apps/portal/src/lib/auth-middleware.ts` 中的 `checkDataScope` 函数。
- 目前 `CUSTOM` 类型的校验使用了 `drizzleSql.raw` 拼接 `roleIds`，存在 SQL 注入或潜在的安全隐患。将其重构为使用原生的 Drizzle ORM `inArray` 条件查询，确保完全参数化。

## 4. 验证与测试 (Verification & Testing)
1. **密码存储验证**：通过 API 创建新用户，直接查询数据库确认不存在 `password` 明文字段。
2. **SSO 拦截验证**：
   - 将某客户端状态设置为 `DISABLED`，尝试发起 SSO 登录，验证是否被拦截并重定向到错误页。
   - 将某用户状态设置为 `LOCKED`，尝试发起 SSO 登录，验证是否被拦截。
3. **数据权限验证**：执行包含 `CUSTOM` 数据权限的用户查询，确保 API 正常返回且不报错。
4. **编译与全量测试**：运行 `pnpm build` 或现有测试脚本确认无类型错误。

## 5. 回滚策略 (Rollback Strategy)
如果修改导致现有的 Better Auth 逻辑异常或出现编译失败，通过 `git checkout` 恢复涉及到的 4 个核心文件至当前 commit，并重新梳理 `schema.ts` 与 Better Auth 预期的兼容性。