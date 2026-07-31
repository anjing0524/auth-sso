ALTER TABLE permissions
ADD COLUMN IF NOT EXISTS required_permission_id uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'permissions_required_permission_id_permissions_id_fk'
  ) THEN
    ALTER TABLE permissions
    ADD CONSTRAINT permissions_required_permission_id_permissions_id_fk
    FOREIGN KEY (required_permission_id)
    REFERENCES permissions(id)
    ON DELETE SET NULL;
  END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_permissions_required_permission
ON permissions(required_permission_id);
