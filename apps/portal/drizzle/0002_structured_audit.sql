ALTER TABLE audit_logs
ADD COLUMN IF NOT EXISTS target_type varchar(50),
ADD COLUMN IF NOT EXISTS target_id varchar(150),
ADD COLUMN IF NOT EXISTS target_name varchar(200),
ADD COLUMN IF NOT EXISTS changes jsonb,
ADD COLUMN IF NOT EXISTS trace_id varchar(100);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_audit_logs_target
ON audit_logs(target_type, target_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_audit_logs_trace
ON audit_logs(trace_id);
