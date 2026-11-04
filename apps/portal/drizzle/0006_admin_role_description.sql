-- Migration 0006: 去掉平台管理员描述里的实现术语（2026-11-04）
--
-- 用户界面不应出现 break-glass 等工程概念；只清理旧描述文本。
-- 可重复执行；不影响角色 code/权限绑定。

UPDATE roles
SET description = '显式拥有全部权限，可管理全平台',
    updated_at = now()
WHERE code = 'PLATFORM_ADMIN'
  AND description LIKE '%break-glass%';
