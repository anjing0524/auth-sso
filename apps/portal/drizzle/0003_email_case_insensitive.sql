-- Migration 0003: 邮箱大小写不敏感（H-18，2026-10-23 质量审计）
--
-- 问题：`ux_users_email` 按原值比较 ⇒ `Admin@Example.com` 与 `admin@example.com`
-- 可注册成两个身份；登录查询也是原值等值匹配 ⇒ 只有注册时那种大小写能登录。
-- 应用层已统一 trim+lower（`EmailSchema`），本迁移负责：
--   1) 归一化存量邮箱（若归一化后出现重复，CREATE UNIQUE INDEX 会失败并暴露数据冲突，
--      需要人工合并 —— 这是有意的：不能静默丢弃身份）；
--   2) 用 `lower(email)` 的部分唯一索引替换旧索引（WHERE deleted_at IS NULL 语义保留）。

UPDATE users
SET email = lower(trim(email)), updated_at = now()
WHERE email IS NOT NULL AND email <> lower(trim(email));--> statement-breakpoint

DROP INDEX IF EXISTS ux_users_email;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_ci ON users (lower(email)) WHERE deleted_at IS NULL;--> statement-breakpoint
