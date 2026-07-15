-- Migration: 移除 DATA 权限类型
-- 理由: ADR-002 明确数据范围由角色-部门绑定实现，DATA 权限类型无实际用途
-- 日期: 2026-07-15

-- Step 1: 删除旧 CHECK 约束
ALTER TABLE "permissions" DROP CONSTRAINT IF EXISTS "permissions_type_fields_chk";

-- Step 2: 确认没有 DATA 类型的行存在（安全校验）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM permissions WHERE type = 'DATA') THEN
    RAISE EXCEPTION 'Cannot remove DATA enum value: permissions table still contains DATA rows. Please clean data first.';
  END IF;
END $$;

-- Step 3: 创建新枚举（不含 DATA）
CREATE TYPE "permission_type_new" AS ENUM('DIRECTORY', 'PAGE', 'API');

-- Step 4: 迁移列类型
ALTER TABLE "permissions" ALTER COLUMN "type" TYPE "permission_type_new" USING "type"::text::"permission_type_new";

-- Step 5: 删除旧枚举
DROP TYPE "permission_type";

-- Step 6: 重命名新枚举
ALTER TYPE "permission_type_new" RENAME TO "permission_type";

-- Step 7: 重建 CHECK 约束
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_type_fields_chk"
  CHECK (
    (type IN ('DIRECTORY','PAGE') AND resource IS NULL AND action IS NULL AND client_id IS NULL)
    OR (type = 'API' AND resource IS NOT NULL AND action IS NOT NULL)
  );
