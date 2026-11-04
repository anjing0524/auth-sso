-- Migration 0004: 日常管理员回到显式 RBAC（ADR-032，2026-11-03）
--
-- 旧语义：SUPER_ADMIN 与 ADMIN 都靠角色码硬编码绕过权限检查；seed 只给两者绑定
-- API 权限，菜单靠 isAdmin 绕过。新语义：只有 SUPER_ADMIN 是 break-glass，日常管理员
-- 必须由 role_permissions 显式持有全部权限（含 PAGE 菜单）才能管理平台。
--
-- 已经部署过的库需要在代码升级时补齐日常管理员的显式权限；新库此时 roles 为空，
-- 语句不插入任何行，随后 seed-rbac 会建立角色并绑定。ON CONFLICT 保证可重复执行。

INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, now()
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('ADMIN', 'PLATFORM_ADMIN')
ON CONFLICT DO NOTHING;
