-- Migration 0007: 首登强制改密（2026-11-05）
--
-- password_changed_at 自建表起存在，但此前只在自助改密时写入；登录/鉴权链路不读取，
-- 因此种子账号与管理员重置过的账号可以永久使用初值密码。
--
-- 本文件只执行一次（用 schema_migrations 标记）：迁移脚本每次启动都会重放全部
-- SQL，若直接 UPDATE 会把迁移之后新建用户的 NULL 再次回填，等于永久关闭门禁。
--
-- 迁移策略：
-- - 存量用户回填为 now()：他们已经完成过一次密码设置，不能因上线新门禁被整体锁死；
-- - 种子 admin 保留 NULL：首次登录必须改密；
-- - 新建用户、管理员重置密码的用户由写路径显式写 NULL，首次登录必须改密。
CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM schema_migrations WHERE id = '0007_password_change_required'
  ) THEN
    UPDATE users
    SET password_changed_at = now()
    WHERE password_changed_at IS NULL
      AND password_hash IS NOT NULL
      AND username <> 'admin';

    INSERT INTO schema_migrations (id) VALUES ('0007_password_change_required');
  END IF;
END $$;
