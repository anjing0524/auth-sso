-- Migration: 0003_audit_append_only.sql
--
-- 目的：为 audit_logs / login_logs 实施 append-only 数据库级别保护
--      （DC-AUDIT-IMMUTABLE），防止应用层或误操作删改历史审计记录。
--
-- 注意：此 migration 需要 DBA 权限执行，且依赖部署环境中应用连接使用的 role 名称。
--
-- 生产环境操作步骤：
--   1. 确认应用连接使用的 PostgreSQL role（通常为 DATABASE_URL 中的用户名）
--   2. 将下方 <app_role> 替换为实际 role 名称后执行
--   3. 验证方式：尝试 UPDATE/DELETE audit_logs 应返回权限错误
--
-- 开发环境：将 <app_role> 替换为 .env.local 中 DATABASE_URL 的用户名执行

-- REVOKE UPDATE, DELETE ON audit_logs FROM <app_role>;
-- REVOKE UPDATE, DELETE ON login_logs FROM <app_role>;

-- 以下为不依赖特定 role 的通用方式（如使用 Row Security Policy）：
-- ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE login_logs ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY audit_logs_insert_only ON audit_logs FOR INSERT WITH CHECK (true);
-- CREATE POLICY login_logs_insert_only ON login_logs FOR INSERT WITH CHECK (true);

-- 实际 GRANT 语句请在 DBA 介入后根据具体环境执行，本 migration 作为文档记录意图。
SELECT 1; -- 占位，使 drizzle 可识别此 migration 文件
