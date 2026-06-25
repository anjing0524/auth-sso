-- RBAC 模型重构 (v3.2)
-- 1. 新增 roles.dept_id 列（先允许 NULL）
ALTER TABLE "roles" ADD COLUMN "dept_id" uuid;--> statement-breakpoint

-- 2. 设置现有角色的 dept_id（假设有根部门，请根据实际情况调整）
--    如果没有根部门，需要先创建部门再执行此迁移
-- UPDATE "roles" SET "dept_id" = (SELECT "id" FROM "departments" WHERE "parent_id" IS NULL LIMIT 1);--> statement-breakpoint

-- 3. 添加外键约束
ALTER TABLE "roles" ADD CONSTRAINT "roles_dept_id_departments_id_fk"
  FOREIGN KEY ("dept_id") REFERENCES "departments"("id") ON DELETE cascade;--> statement-breakpoint

-- 4. 删除旧列和旧表
ALTER TABLE "roles" DROP COLUMN "data_scope_type";--> statement-breakpoint

DROP TABLE IF EXISTS "role_data_scopes" CASCADE;--> statement-breakpoint

DROP TABLE IF EXISTS "role_clients" CASCADE;--> statement-breakpoint
