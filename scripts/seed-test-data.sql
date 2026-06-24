-- ============================================================================
-- Auth-SSO 测试数据 Seed 脚本 v4
-- 基于 USER_STORIES.md 构造，覆盖全部 8 个测试用户、6 个角色、43 个权限码、4 个 OAuth 客户端
--
-- v4 变更（对齐 DATABASE_REDESIGN.md）：
--   - 移除所有 public_id 列
--   - clients 以 client_id 为 PK（无 id + public_id 冗余）
--   - menus 合并进 permissions（type: DIRECTORY/PAGE/API/DATA）
--   - 关联表复合主键（无代理 id 列）
--   - 移除 consents、accounts、sessions 表引用
--   - 移除 grant_types、skip_consent 列
--   - token 表用 token_hash 替代 token
--
-- 用途: psql $DATABASE_URL -f scripts/seed-test-data.sql
-- 注意: 执行前需先运行 drizzle migration 确保表结构存在
-- ============================================================================

BEGIN;

-- ============================================================================
-- 0. 清理已有测试数据（按外键依赖逆序）
-- ============================================================================
DELETE FROM role_permissions;
DELETE FROM role_data_scopes;
DELETE FROM role_clients;
DELETE FROM user_roles;
DELETE FROM permissions;
DELETE FROM roles;
DELETE FROM refresh_tokens;
DELETE FROM access_tokens;
DELETE FROM authorization_codes;
DELETE FROM clients;
DELETE FROM users;
DELETE FROM departments;
DELETE FROM audit_logs;
DELETE FROM login_logs;

-- ============================================================================
-- 1. 部门 (departments) — 组织架构树
-- ============================================================================
INSERT INTO departments (id, parent_id, name, code, ancestors, sort, status, created_at, updated_at)
VALUES
  ('dept_hq',       NULL,          '干了科技', 'ROOT',    NULL,               0, 'ACTIVE', now(), now()),
  ('dept_tech',     'dept_hq',     '技术部',   'TECH',    'dept_hq',          1, 'ACTIVE', now(), now()),
  ('dept_frontend', 'dept_tech',   '前端组',   'FE',      'dept_hq/dept_tech',2, 'ACTIVE', now(), now()),
  ('dept_backend',  'dept_tech',   '后端组',   'BE',      'dept_hq/dept_tech',3, 'ACTIVE', now(), now()),
  ('dept_product',  'dept_hq',     '产品部',   'PRODUCT', 'dept_hq',          4, 'ACTIVE', now(), now()),
  ('dept_ops',      'dept_hq',     '运营部',   'OPS',     'dept_hq',          5, 'ACTIVE', now(), now());

-- ============================================================================
-- 2. 用户 (users) — 密码统一 Test@123456
-- ============================================================================
INSERT INTO users (id, username, email, email_verified, mobile, name, password_hash, status, dept_id, created_at, updated_at)
VALUES
  ('usr_zhangsan', 'zhangsan', 'zhangsan@example.com', true,  '13800000001', '张三', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', 'ACTIVE',   'dept_hq',       now(), now()),
  ('usr_lisi',     'lisi',     'lisi@example.com',     true,  '13800000002', '李四', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', 'ACTIVE',   'dept_tech',     now(), now()),
  ('usr_wangwu',   'wangwu',   'wangwu@example.com',   true,  '13800000003', '王五', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', 'ACTIVE',   'dept_product',  now(), now()),
  ('usr_zhaoliu',  'zhaoliu',  'zhaoliu@example.com',  true,  '13800000004', '赵六', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', 'ACTIVE',   'dept_backend',  now(), now()),
  ('usr_sunqi',    'sunqi',    'sunqi@example.com',    true,  '13800000005', '孙七', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', 'ACTIVE',   'dept_hq',       now(), now()),
  ('usr_zhouba',   'zhouba',   'zhouba@example.com',   true,  '13800000006', '周八', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', 'ACTIVE',   'dept_ops',      now(), now()),
  ('usr_wujiu',    'wujiu',    'wujiu@example.com',    true,  '13800000007', '吴九', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', 'ACTIVE',   'dept_frontend', now(), now()),
  ('usr_chenshi',  'chenshi',  'chenshi@example.com',  true,  '13800000008', '陈十', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', 'DISABLED', 'dept_product',  now(), now());

-- ============================================================================
-- 3. OAuth 客户端 (clients) — client_id 为 PK
-- ============================================================================
INSERT INTO clients (client_id, name, client_secret, redirect_uris, scopes, status, created_at, updated_at)
VALUES
  ('portal',      'Auth-SSO Portal', 'portal-secret-dev',      '{"http://localhost:4100/api/auth/callback"}',                      'openid profile email offline_access', 'ACTIVE',   now(), now()),
  ('erp-app',     'ERP 系统',        'erp-app-secret-dev',     '{"https://erp.example.com/callback"}',                             'openid profile email offline_access', 'ACTIVE',   now(), now()),
  ('crm-app',     'CRM 系统',        'crm-app-secret-dev',     '{"https://crm.example.com/callback"}',                             'openid profile email offline_access', 'ACTIVE',   now(), now()),
  ('disabled-app','已废弃系统',      'disabled-app-secret-dev','{"https://disabled.example.com/callback"}',                        'openid profile email offline_access', 'DISABLED', now(), now());

-- ============================================================================
-- 4. 角色 (roles)
-- ============================================================================
INSERT INTO roles (id, name, code, description, data_scope_type, is_system, status, sort, created_at, updated_at)
VALUES
  ('role_super_admin',  '超级管理员', 'SUPER_ADMIN',  '拥有全部权限，不受数据范围限制',              'ALL',          true,  'ACTIVE', 0, now(), now()),
  ('role_org_admin',    '组织管理员', 'ORG_ADMIN',    '管理指定部门及子部门的用户和配置',            'DEPT_AND_SUB', false, 'ACTIVE', 1, now(), now()),
  ('role_dept_manager', '部门经理',   'DEPT_MANAGER', '管理本部门用户',                              'DEPT',         false, 'ACTIVE', 2, now(), now()),
  ('role_employee',     '普通员工',   'EMPLOYEE',     '仅查看个人数据',                              'SELF',         false, 'ACTIVE', 3, now(), now()),
  ('role_app_admin',    '应用管理员', 'APP_ADMIN',    '管理 OAuth 客户端接入',                        'ALL',          false, 'ACTIVE', 4, now(), now()),
  ('role_audit_viewer', '审计员',     'AUDIT_VIEWER', '查看审计日志和登录日志',                        'SELF',         false, 'ACTIVE', 5, now(), now());

-- ============================================================================
-- 5. 权限统一树 (permissions) — type: DIRECTORY | PAGE | API | DATA
-- ============================================================================

-- 5.1 菜单目录 (DIRECTORY) — 侧边栏折叠组
INSERT INTO permissions (id, code, name, type, icon, visible, parent_id, sort, status, created_at, updated_at) VALUES
  ('perm_dir_dashboard',  'dir:dashboard',  '仪表盘',     'DIRECTORY', 'LayoutDashboard', true, NULL, 0, 'ACTIVE', now(), now()),
  ('perm_dir_system',     'dir:system',     '系统管理',   'DIRECTORY', 'Settings',        true, NULL, 1, 'ACTIVE', now(), now()),
  ('perm_dir_user_mgmt',  'dir:user_mgmt',  '用户权限',   'DIRECTORY', 'Users',           true, NULL, 2, 'ACTIVE', now(), now()),
  ('perm_dir_org',        'dir:org',        '组织架构',   'DIRECTORY', 'Building2',       true, NULL, 3, 'ACTIVE', now(), now()),
  ('perm_dir_client',     'dir:client',     '应用管理',   'DIRECTORY', 'AppWindow',       true, NULL, 4, 'ACTIVE', now(), now()),
  ('perm_dir_audit',      'dir:audit',      '审计日志',   'DIRECTORY', 'FileText',        true, NULL, 5, 'ACTIVE', now(), now());

-- 5.2 菜单页面 (PAGE) — 侧边栏路由项
INSERT INTO permissions (id, code, name, type, path, icon, visible, parent_id, sort, status, created_at, updated_at) VALUES
  ('perm_page_dashboard',  'menu:dashboard',   '仪表盘',     'PAGE', '/dashboard',          'LayoutDashboard', true, 'perm_dir_dashboard', 0, 'ACTIVE', now(), now()),
  ('perm_page_users',      'menu:users',       '用户管理',   'PAGE', '/admin/users',        'Users',           true, 'perm_dir_user_mgmt', 0, 'ACTIVE', now(), now()),
  ('perm_page_roles',      'menu:roles',       '角色管理',   'PAGE', '/admin/roles',        'Shield',          true, 'perm_dir_user_mgmt', 1, 'ACTIVE', now(), now()),
  ('perm_page_permissions','menu:permissions', '权限管理',   'PAGE', '/admin/permissions',  'KeyRound',        true, 'perm_dir_user_mgmt', 2, 'ACTIVE', now(), now()),
  ('perm_page_depts',      'menu:departments', '部门管理',   'PAGE', '/admin/departments',  'Building2',       true, 'perm_dir_org',      0, 'ACTIVE', now(), now()),
  ('perm_page_clients',    'menu:clients',     '客户端管理', 'PAGE', '/admin/clients',      'AppWindow',       true, 'perm_dir_client',   0, 'ACTIVE', now(), now()),
  ('perm_page_audit',      'menu:audit-logs',  '审计日志',   'PAGE', '/admin/audit',        'FileText',        true, 'perm_dir_audit',    0, 'ACTIVE', now(), now()),
  ('perm_page_login_log',  'menu:login-logs',  '登录日志',   'PAGE', '/admin/login-logs',   'LogIn',           true, 'perm_dir_audit',    1, 'ACTIVE', now(), now()),
  -- 隐藏页面（测试 US-MNU-BTN-04）
  ('perm_page_email',      'menu:email',       '邮件配置',   'PAGE', '/admin/email-config', 'Mail',            false,'perm_dir_system',   0, 'ACTIVE', now(), now());

-- 5.3 API 权限点 — 43 个权限码
INSERT INTO permissions (id, code, name, type, resource, action, parent_id, sort, status, created_at, updated_at) VALUES
  -- 用户管理 (8)
  ('perm_api_user_create',        'user:create',        '创建用户',  'API', 'user', 'create',        'perm_page_users', 0, 'ACTIVE', now(), now()),
  ('perm_api_user_read',          'user:read',          '查看用户详情','API', 'user', 'read',         'perm_page_users', 1, 'ACTIVE', now(), now()),
  ('perm_api_user_update',        'user:update',        '修改用户',  'API', 'user', 'update',        'perm_page_users', 2, 'ACTIVE', now(), now()),
  ('perm_api_user_delete',        'user:delete',        '删除用户',  'API', 'user', 'delete',        'perm_page_users', 3, 'ACTIVE', now(), now()),
  ('perm_api_user_manage',        'user:manage',        '用户管理',  'API', 'user', 'manage',        'perm_page_users', 4, 'ACTIVE', now(), now()),
  ('perm_api_user_reset_password','user:reset_password','重置密码',  'API', 'user', 'reset_password','perm_page_users', 5, 'ACTIVE', now(), now()),
  ('perm_api_user_assign_role',   'user:assign_role',   '分配角色',  'API', 'user', 'assign_role',   'perm_page_users', 6, 'ACTIVE', now(), now()),
  -- 部门管理 (6)
  ('perm_api_dept_create',  'department:create',  '创建部门',  'API', 'department', 'create',  'perm_page_depts', 0, 'ACTIVE', now(), now()),
  ('perm_api_dept_read',    'department:read',    '查看部门详情','API','department', 'read',    'perm_page_depts', 1, 'ACTIVE', now(), now()),
  ('perm_api_dept_update',  'department:update',  '修改部门',  'API', 'department', 'update',  'perm_page_depts', 2, 'ACTIVE', now(), now()),
  ('perm_api_dept_delete',  'department:delete',  '删除部门',  'API', 'department', 'delete',  'perm_page_depts', 3, 'ACTIVE', now(), now()),
  ('perm_api_dept_manage',  'department:manage',  '部门管理',  'API', 'department', 'manage',  'perm_page_depts', 4, 'ACTIVE', now(), now()),
  -- 角色管理 (7)
  ('perm_api_role_create',            'role:create',            '创建角色',  'API', 'role', 'create',            'perm_page_roles', 0, 'ACTIVE', now(), now()),
  ('perm_api_role_read',              'role:read',              '查看角色详情','API','role', 'read',             'perm_page_roles', 1, 'ACTIVE', now(), now()),
  ('perm_api_role_update',            'role:update',            '修改角色',  'API', 'role', 'update',            'perm_page_roles', 2, 'ACTIVE', now(), now()),
  ('perm_api_role_delete',            'role:delete',            '删除角色',  'API', 'role', 'delete',            'perm_page_roles', 3, 'ACTIVE', now(), now()),
  ('perm_api_role_manage',            'role:manage',            '角色管理',  'API', 'role', 'manage',            'perm_page_roles', 4, 'ACTIVE', now(), now()),
  ('perm_api_role_assign_permission', 'role:assign_permission', '分配权限',  'API', 'role', 'assign_permission', 'perm_page_roles', 5, 'ACTIVE', now(), now()),
  -- 权限管理 (6)
  ('perm_api_perm_create',  'permission:create',  '创建权限',  'API', 'permission', 'create',  'perm_page_permissions', 0, 'ACTIVE', now(), now()),
  ('perm_api_perm_read',    'permission:read',    '查看权限详情','API','permission', 'read',    'perm_page_permissions', 1, 'ACTIVE', now(), now()),
  ('perm_api_perm_update',  'permission:update',  '修改权限',  'API', 'permission', 'update',  'perm_page_permissions', 2, 'ACTIVE', now(), now()),
  ('perm_api_perm_delete',  'permission:delete',  '删除权限',  'API', 'permission', 'delete',  'perm_page_permissions', 3, 'ACTIVE', now(), now()),
  ('perm_api_perm_manage',  'permission:manage',  '权限管理',  'API', 'permission', 'manage',  'perm_page_permissions', 4, 'ACTIVE', now(), now()),
  -- 菜单管理 (6) — 现在由 permissions 统一管理
  ('perm_api_menu_create',  'menu:create',  '创建菜单项', 'API', 'permission', 'create',  'perm_page_permissions', 5, 'ACTIVE', now(), now()),
  ('perm_api_menu_read',    'menu:read',    '查看菜单详情','API','permission', 'read',    'perm_page_permissions', 6, 'ACTIVE', now(), now()),
  ('perm_api_menu_update',  'menu:update',  '修改菜单项', 'API', 'permission', 'update',  'perm_page_permissions', 7, 'ACTIVE', now(), now()),
  ('perm_api_menu_delete',  'menu:delete',  '删除菜单项', 'API', 'permission', 'delete',  'perm_page_permissions', 8, 'ACTIVE', now(), now()),
  ('perm_api_menu_manage',  'menu:manage',  '菜单管理',   'API', 'permission', 'manage',  'perm_page_permissions', 9, 'ACTIVE', now(), now()),
  -- 客户端管理 (7)
  ('perm_api_client_create',        'client:create',        '创建应用',  'API', 'client', 'create',         'perm_page_clients', 0, 'ACTIVE', now(), now()),
  ('perm_api_client_read',          'client:read',          '查看应用详情','API','client', 'read',          'perm_page_clients', 1, 'ACTIVE', now(), now()),
  ('perm_api_client_update',        'client:update',        '修改应用',  'API', 'client', 'update',         'perm_page_clients', 2, 'ACTIVE', now(), now()),
  ('perm_api_client_delete',        'client:delete',        '删除应用',  'API', 'client', 'delete',         'perm_page_clients', 3, 'ACTIVE', now(), now()),
  ('perm_api_client_manage',        'client:manage',        '应用管理',  'API', 'client', 'manage',         'perm_page_clients', 4, 'ACTIVE', now(), now()),
  ('perm_api_client_rotate_secret', 'client:rotate_secret', '轮换密钥',  'API', 'client', 'rotate_secret',  'perm_page_clients', 5, 'ACTIVE', now(), now()),
  -- 审计日志 (2)
  ('perm_api_audit_read',   'audit:read',   '查看审计日志', 'API', 'audit', 'read',   'perm_page_audit', 0, 'ACTIVE', now(), now()),
  ('perm_api_audit_export', 'audit:export', '导出审计日志', 'API', 'audit', 'export', 'perm_page_audit', 1, 'ACTIVE', now(), now()),
  -- 登录日志 (2)
  ('perm_api_login_log_read',   'login_log:read',   '查看登录日志', 'API', 'login_log', 'read',   'perm_page_login_log', 0, 'ACTIVE', now(), now()),
  ('perm_api_login_log_export', 'login_log:export', '导出登录日志', 'API', 'login_log', 'export', 'perm_page_login_log', 1, 'ACTIVE', now(), now()),
  -- 系统管理 (2)
  ('perm_api_system_manage',         'system:manage',         '系统管理',  'API', 'system', 'manage',         NULL, 0, 'ACTIVE', now(), now()),
  ('perm_api_system_view_dashboard', 'system:view_dashboard', '查看仪表盘','API', 'system', 'view_dashboard', NULL, 1, 'ACTIVE', now(), now()),
  -- 客户关系图 (2)
  ('perm_api_customer_graph_view',   'customer_graph:view',   '查看客户关系图','API', 'customer_graph', 'view',  NULL, 0, 'ACTIVE', now(), now()),
  ('perm_api_customer_graph_export', 'customer_graph:export', '导出客户关系图','API', 'customer_graph', 'export',NULL, 1, 'ACTIVE', now(), now());

-- ============================================================================
-- 6. 用户-角色关联 (user_roles) — 复合主键 (user_id, role_id)
-- ============================================================================
INSERT INTO user_roles (user_id, role_id, created_at) VALUES
  ('usr_zhangsan', 'role_super_admin',  now()),
  ('usr_lisi',     'role_org_admin',    now()),
  ('usr_wangwu',   'role_dept_manager', now()),
  ('usr_zhaoliu',  'role_employee',     now()),
  ('usr_sunqi',    'role_app_admin',    now()),
  ('usr_zhouba',   'role_audit_viewer', now());
  -- 吴九 → 无角色 / 陈十 → DISABLED

-- ============================================================================
-- 7. 角色-权限关联 (role_permissions) — 复合主键 (role_id, permission_id)
-- ============================================================================

-- 7.1 超级管理员 — 所有 API 类型权限
INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT 'role_super_admin', p.id, now()
FROM permissions p WHERE p.type = 'API';

-- 7.2 组织管理员
INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES
  ('role_org_admin', 'perm_page_users',              now()),
  ('role_org_admin', 'perm_api_user_create',         now()),
  ('role_org_admin', 'perm_api_user_read',           now()),
  ('role_org_admin', 'perm_api_user_update',         now()),
  ('role_org_admin', 'perm_api_user_reset_password', now()),
  ('role_org_admin', 'perm_api_user_assign_role',    now()),
  ('role_org_admin', 'perm_page_depts',              now()),
  ('role_org_admin', 'perm_api_dept_read',           now()),
  ('role_org_admin', 'perm_page_roles',              now()),
  ('role_org_admin', 'perm_api_role_read',           now()),
  ('role_org_admin', 'perm_api_system_view_dashboard',now());

-- 7.3 部门经理
INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES
  ('role_dept_manager', 'perm_page_users',               now()),
  ('role_dept_manager', 'perm_api_user_read',            now()),
  ('role_dept_manager', 'perm_api_user_update',          now()),
  ('role_dept_manager', 'perm_page_depts',               now()),
  ('role_dept_manager', 'perm_api_dept_read',            now()),
  ('role_dept_manager', 'perm_page_roles',               now()),
  ('role_dept_manager', 'perm_api_role_read',            now()),
  ('role_dept_manager', 'perm_api_system_view_dashboard',now());

-- 7.4 普通员工
INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES
  ('role_employee', 'perm_page_dashboard',              now()),
  ('role_employee', 'perm_api_system_view_dashboard',   now());

-- 7.5 应用管理员
INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES
  ('role_app_admin', 'perm_page_clients',              now()),
  ('role_app_admin', 'perm_api_client_create',         now()),
  ('role_app_admin', 'perm_api_client_read',           now()),
  ('role_app_admin', 'perm_api_client_update',         now()),
  ('role_app_admin', 'perm_api_client_delete',         now()),
  ('role_app_admin', 'perm_api_client_manage',         now()),
  ('role_app_admin', 'perm_api_client_rotate_secret',  now());

-- 7.6 审计员
INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES
  ('role_audit_viewer', 'perm_page_audit',             now()),
  ('role_audit_viewer', 'perm_api_audit_read',         now()),
  ('role_audit_viewer', 'perm_api_audit_export',       now()),
  ('role_audit_viewer', 'perm_page_login_log',         now()),
  ('role_audit_viewer', 'perm_api_login_log_read',     now()),
  ('role_audit_viewer', 'perm_api_login_log_export',   now());

-- erp-app: 仅 super_admin, org_admin, dept_manager
INSERT INTO role_clients (role_id, client_id, created_at) VALUES
  ('role_super_admin',  'erp-app', now()),
  ('role_org_admin',    'erp-app', now()),
  ('role_dept_manager', 'erp-app', now());
-- crm-app: 仅 super_admin, org_admin
INSERT INTO role_clients (role_id, client_id, created_at) VALUES
  ('role_super_admin',  'crm-app', now()),
  ('role_org_admin',    'crm-app', now());

-- ============================================================================
-- 9. 审计日志样例 (audit_logs)
-- ============================================================================
INSERT INTO audit_logs (id, user_id, username, operation, method, url, ip, status, duration, created_at) VALUES
  ('alog_01','usr_zhangsan','zhangsan','USER_CREATE','POST','/api/users','127.0.0.1',200,150,now()-interval'2 hours'),
  ('alog_02','usr_zhangsan','zhangsan','USER_ROLE_ASSIGN','POST','/api/users/usr_zhaoliu/roles','127.0.0.1',200,45,now()-interval'1 hour'),
  ('alog_03','usr_zhangsan','zhangsan','ROLE_PERMISSION_ASSIGN','PUT','/api/roles/role_dept_manager/permissions','127.0.0.1',200,67,now()-interval'30 minutes'),
  ('alog_04','usr_zhangsan','zhangsan','USER_UPDATE','PUT','/api/users/usr_chenshi','127.0.0.1',200,32,now()-interval'15 minutes');

-- ============================================================================
-- 10. 登录日志样例 (login_logs)
-- ============================================================================
INSERT INTO login_logs (id, user_id, username, event_type, ip, user_agent, location, fail_reason, created_at) VALUES
  ('llog_01','usr_zhangsan','zhangsan','LOGIN_SUCCESS','127.0.0.1','Chrome/120','北京',NULL,    now()-interval'2 hours'),
  ('llog_02','usr_lisi',    'lisi',    'LOGIN_SUCCESS','192.168.1.5','Firefox/121','上海',NULL,  now()-interval'3 hours'),
  ('llog_03','usr_chenshi', 'chenshi', 'LOGIN_FAILED', '10.0.0.1',  'Safari/17',  NULL,  '账户已禁用',now()-interval'4 hours'),
  ('llog_04','usr_wujiu',   'wujiu',   'LOGIN_SUCCESS','172.16.0.1','Chrome/120','深圳',NULL,   now()-interval'5 hours'),
  ('llog_05','usr_zhaoliu', 'zhaoliu', 'LOGIN_FAILED', '192.168.1.20','Edge/120',NULL,  '密码错误',now()-interval'1 hour'),
  ('llog_06','usr_zhaoliu', 'zhaoliu', 'LOGIN_SUCCESS','192.168.1.20','Edge/120','广州',NULL,   now()-interval'55 minutes');

COMMIT;
