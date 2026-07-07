-- ============================================================================
-- access_logs: 按月分区，180 天保留期（合规追溯）
-- ============================================================================
-- ⚠️ 本文件不纳入 drizzle _journal.json，需手动执行：
--    psql $DATABASE_URL -f apps/portal/drizzle/0004_access_logs_partitioned.sql
--
-- Drizzle schema（logs.ts 的 accessLogs）仅用于 TypeScript 类型推导，
-- 实际分区表由此脚本创建（Drizzle 无法生成 PARTITION BY DDL）。
--
-- 保留策略：每月初执行 scripts/maintain-access-log-partitions.ts
--   1. 预创建未来 2 个月分区
--   2. DROP 超过 180 天的分区
-- ============================================================================

CREATE TABLE IF NOT EXISTS access_logs (
  id uuid DEFAULT gen_random_uuid(),
  user_id uuid,
  username varchar(50),
  method varchar(10) NOT NULL,
  path varchar(500) NOT NULL,
  resource_type varchar(50),
  resource_id varchar(64),
  ip inet,
  user_agent varchar(500),
  status smallint,
  duration integer,
  created_at timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

-- 初始分区：本月 + 下月（执行时按需调整）
CREATE TABLE IF NOT EXISTS access_logs_2026_07 PARTITION OF access_logs
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS access_logs_2026_08 PARTITION OF access_logs
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

-- 索引（分区表索引自动级联到所有子分区）
CREATE INDEX IF NOT EXISTS idx_access_logs_user ON access_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_created ON access_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_access_logs_resource ON access_logs (resource_type, resource_id);

-- append-only（与 audit_logs 一致）
REVOKE UPDATE, DELETE ON access_logs FROM PUBLIC;
