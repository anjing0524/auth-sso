-- Migration 0005: 日常管理员角色改名 ADMIN → PLATFORM_ADMIN（2026-11-04）
--
-- 只改内置日常管理员角色的 code/name；SUPER_ADMIN 的 code、名称、break-glass
-- 语义完全不变。user_roles / role_permissions 通过 role_id 关联，主键不变，
-- 因此已有绑定自动跟随。可重复执行。

UPDATE roles
SET code = 'PLATFORM_ADMIN',
    name = '平台管理员',
    description = '显式拥有全部权限，管理全平台（非 break-glass）',
    updated_at = now()
WHERE code = 'ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM roles existing WHERE existing.code = 'PLATFORM_ADMIN'
  );
