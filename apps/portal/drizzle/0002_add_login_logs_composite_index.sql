-- 补充 login_logs 复合索引 idx_login_logs_user_event_created
-- 用于暴力破解防护 DB 回退查询（按 userId + eventType + createdAt 范围扫描），高频使用
-- 原 Drizzle schema 已定义该索引，但迁移 SQL 中遗漏，此处补上
CREATE INDEX IF NOT EXISTS "idx_login_logs_user_event_created" ON "login_logs" USING btree ("user_id", "event_type", "created_at");
