ALTER TABLE "departments" ADD COLUMN "ancestors" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_dept_id_departments_id_fk" FOREIGN KEY ("dept_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_departments_ancestors" ON "departments" USING btree ("ancestors");--> statement-breakpoint
-- 回填现有部门的 ancestors 物化路径（最多 10 层）--> statement-breakpoint
WITH RECURSIVE dept_tree AS (
  SELECT id, parent_id, NULL::text as ancestors, 1 as depth
  FROM departments
  WHERE parent_id IS NULL
  UNION ALL
  SELECT d.id, d.parent_id,
    CASE
      WHEN dt.ancestors IS NULL THEN dt.id
      ELSE dt.ancestors || '/' || dt.id
    END,
    dt.depth + 1
  FROM departments d
  INNER JOIN dept_tree dt ON d.parent_id = dt.id
  WHERE dt.depth < 10
)
UPDATE departments d SET ancestors = dt.ancestors
FROM dept_tree dt WHERE d.id = dt.id;