-- Migration 0002: 修复 Portal 自有 API 权限的 Client 绑定（2026-10-21 权限审计）
--
-- 根因：OAuth 授权准入（checkUserClientAccess）要求非管理员角色拥有带 clientId 的权限
-- （users → roles → role_permissions → permissions.client_id → client）。
-- 但 seed 写入的 portal:* API 权限 client_id 全为 NULL ⇒ 自定义角色用户登录时
-- 被 oauth_denied 拒绝，只有内置管理员角色（isAdminRole 绕过）能进入。
--
-- 只修 API 类型：permissions_type_fields_chk 规定 DIRECTORY/PAGE 菜单必须 client_id IS NULL；
-- 菜单权限的 client 归属由授权数据层的 portal: 命名空间兜底（见 authorize/data.ts）。
-- 后续通过 Portal 权限页新建的 portal:* API 权限由 createPermissionAction 补齐 clientId。

UPDATE permissions
SET client_id = 'portal', updated_at = now()
WHERE type = 'API' AND code LIKE 'portal:%' AND client_id IS NULL;--> statement-breakpoint
