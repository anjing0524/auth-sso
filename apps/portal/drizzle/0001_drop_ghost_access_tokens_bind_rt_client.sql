-- Migration 0001: H-2 remediation (audit 2026-09-28)
-- 1) DROP access_tokens: ADR-004 "预留表" was never written by the stateless JWT
--    architecture, yet three consumer paths treated it as live data
--    (introspect scope/client_id, admin token list, admin revoke action) —
--    the admin revoke was a silent no-op returning success.
-- 2) refresh_tokens.client_id: bind RT to its issuing OAuth client
--    (minimal RFC 9700 token-family semantics). Existing rows are SSO session
--    tokens exchanged by the Gateway with client_id = 'portal'.

DROP TABLE IF EXISTS access_tokens;--> statement-breakpoint
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS client_id varchar(50);--> statement-breakpoint
UPDATE refresh_tokens SET client_id = 'portal' WHERE client_id IS NULL;--> statement-breakpoint
ALTER TABLE refresh_tokens ALTER COLUMN client_id SET NOT NULL;--> statement-breakpoint
ALTER TABLE refresh_tokens
  ADD CONSTRAINT fk_refresh_tokens_client
  FOREIGN KEY (client_id) REFERENCES clients(client_id) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_client ON refresh_tokens (client_id);
