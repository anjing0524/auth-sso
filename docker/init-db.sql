-- ============================================
-- Auth-SSO 数据库初始化脚本
-- ============================================
-- 该脚本在 PostgreSQL 容器首次启动时自动执行
-- ============================================

-- 创建 IdP 数据库
CREATE DATABASE auth_sso_idp;

-- 创建 Portal 数据库 (如果需要单独的数据库)
CREATE DATABASE auth_sso_portal;

-- 授权 postgres 用户所有权限
GRANT ALL PRIVILEGES ON DATABASE auth_sso_idp TO postgres;
GRANT ALL PRIVILEGES ON DATABASE auth_sso_portal TO postgres;

-- 输出创建结果
\echo '============================================'
\echo '数据库创建完成:'
\echo '  - auth_sso_idp (IdP 数据库)'
\echo '  - auth_sso_portal (Portal 数据库)'
\echo '============================================'