-- ============================================
-- Auth-SSO 数据库初始化脚本
-- ============================================
-- 该脚本在 PostgreSQL 容器首次启动时自动执行
-- IDP 已合并进 Portal，仅需一个数据库
-- ============================================

-- 创建 Portal 统一数据库（由于 docker-compose 已通过 POSTGRES_DB 自动创建，此处无需重复创建）
-- GRANT ALL PRIVILEGES ON DATABASE auth_sso TO postgres;

-- 本地 Vitest/API 测试默认使用独立测试库，首次启动开发环境时一并创建。
SELECT 'CREATE DATABASE auth_sso_test'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = 'auth_sso_test'
)\gexec

-- 输出创建结果
\echo '============================================'
\echo '数据库创建完成:'
\echo '  - auth_sso (Portal 统一数据库，含 OIDC 认证 + 业务数据)'
\echo '  - auth_sso_test (Portal Vitest/API 测试数据库)'
\echo '============================================'
