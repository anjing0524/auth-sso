# ADR-026: 邮箱身份规范化（trim + 小写 + 大小写不敏感唯一索引）

| 属性 | 值 |
|---|---|
| **状态** | implemented (2026-10-23) |
| **日期** | 2026-10-23 |
| **决策者** | Auth-SSO 团队（质量审计 H-18 的 Lead 决策） |
| **影响范围** | `domain/shared/zod-schemas.ts`（`EmailSchema`）、用户创建/编辑、登录、自助改资料、`db/schema/users.ts`、迁移 `0003`、DATABASE.md |

## 背景

旧实现全链路按**原始字符串**比较邮箱：

- 唯一索引 `ux_users_email` 对 `email` 原值比较 ⇒ `Admin@Example.com` 与 `admin@example.com`
  可以注册成两个身份；
- 登录按原始值等值查询 ⇒ 只有注册时那种大小写拼法能登录，另一种拼法报"凭证错误"；
- 前后空白直接导致 400。

审计（H-18）确认这是"身份标识规范化缺失"导致的重复身份/登录困惑，且企业 SSO 场景邮箱通常不区分大小写。

## 决策

1. **应用层单点规范化**：所有用户可写邮箱字段（创建用户、编辑用户、自助改资料）与登录查询
   统一走 `EmailSchema`（`trim()` → `toLowerCase()` → 格式校验）。禁止在任何调用点手写 `.email()`。
2. **DB 第二道防线**：迁移 `0003_email_case_insensitive.sql`
   - 先把存量邮箱归一化为 `lower(trim(email))`；
   - 删除 `ux_users_email`，建立 `ux_users_email_ci ON users (lower(email)) WHERE deleted_at IS NULL`
     （保留软删除后释放邮箱的语义）。
   - 若归一化后出现重复，索引创建会失败并暴露冲突——**刻意不静默丢弃身份**，需人工合并。
3. **规范化位置**：`domain/shared/zod-schemas.ts` 的 `normalizeEmail` 是唯一实现；
   `CreateUserInputSchema` / `UpdateUserInputSchema` / 自助资料 schema / 登录 schema 全部复用 `EmailSchema`。

## 后果

- 正面：同一邮箱不再能注册两种大小写；用户可用任意大小写/带空白登录；与标准身份系统（企业邮箱）语义一致。
- 代价：迁移需扫描并更新 `users.email`（小表）；若存在历史重复数据，迁移会显式失败，需要人工合并
  （这是有意的安全行为，优于自动丢弃或合并）。
- 数据库之外（如 `login_logs.username` 记录的是用户输入）保持原样：日志用于取证，不应改写用户输入。

## 验证

- `apps/portal/__tests__/api/user-actions.test.ts`：创建时归一化落库；大小写变体判重（`EMAIL_ALREADY_EXISTS`）；
  编辑邮箱同样归一化。
- `apps/portal/__tests__/api/auth-login.test.ts`：`'  User@Example.COM  '` 可登录成功。
- 迁移在 `pnpm test` 的 globalSetup 中真实执行；运行栈 `db-init` 重建时执行。

## 相关 ADR

- ADR-002（用户/RBAC 身份模型）
- 后续若引入 case-insensitive 的 `citext`/函数索引替代方案，需重评本 ADR
