-- ============================================================================
-- Auth-SSO 测试数据 Seed 脚本
-- 基于 USER_STORIES.md 构造，覆盖全部 8 个测试用户、6 个角色、43 个权限码、4 个 OAuth 客户端
--
-- 用途: psql $DATABASE_URL -f scripts/seed-test-data.sql
-- 密码: 所有测试用户统一密码 Test@123456
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
DELETE FROM oauth_consent;
DELETE FROM oauth_refresh_tokens;
DELETE FROM oauth_access_tokens;
DELETE FROM authorization_codes;
DELETE FROM clients;
DELETE FROM accounts;
DELETE FROM sessions;
DELETE FROM users;
DELETE FROM departments;
DELETE FROM menus;
DELETE FROM audit_logs;
DELETE FROM login_logs;

-- ============================================================================
-- 1. 部门 (departments) — 组织架构树
-- ============================================================================
-- 干了科技（总部）
INSERT INTO departments (id, public_id, parent_id, name, code, sort, status, created_at, updated_at)
VALUES
  ('dept_hq',            'd_hq',       NULL,        '干了科技', 'ROOT',     0, 'ACTIVE', now(), now()),
  ('dept_tech',          'd_tech',     'dept_hq',   '技术部',   'TECH',     1, 'ACTIVE', now(), now()),
  ('dept_frontend',      'd_frontend', 'dept_tech', '前端组',   'FE',       2, 'ACTIVE', now(), now()),
  ('dept_backend',       'd_backend',  'dept_tech', '后端组',   'BE',       3, 'ACTIVE', now(), now()),
  ('dept_product',       'd_product',  'dept_hq',   '产品部',   'PRODUCT',  4, 'ACTIVE', now(), now()),
  ('dept_ops',           'd_ops',      'dept_hq',   '运营部',   'OPS',      5, 'ACTIVE', now(), now());

-- ============================================================================
-- 2. 用户 (users)
-- ============================================================================
INSERT INTO users (id, public_id, username, email, email_verified, mobile, name, status, dept_id, created_at, updated_at)
VALUES
  ('usr_zhangsan', 'u_zhangsan', 'zhangsan', 'zhangsan@example.com', true,  '13800000001', '张三', 'ACTIVE',   'dept_hq',       now(), now()),
  ('usr_lisi',     'u_lisi',     'lisi',     'lisi@example.com',     true,  '13800000002', '李四', 'ACTIVE',   'dept_tech',     now(), now()),
  ('usr_wangwu',   'u_wangwu',   'wangwu',   'wangwu@example.com',   true,  '13800000003', '王五', 'ACTIVE',   'dept_product',  now(), now()),
  ('usr_zhaoliu',  'u_zhaoliu',  'zhaoliu',  'zhaoliu@example.com',  true,  '13800000004', '赵六', 'ACTIVE',   'dept_backend',  now(), now()),
  ('usr_sunqi',    'u_sunqi',    'sunqi',    'sunqi@example.com',    true,  '13800000005', '孙七', 'ACTIVE',   'dept_hq',       now(), now()),
  ('usr_zhouba',   'u_zhouba',   'zhouba',   'zhouba@example.com',   true,  '13800000006', '周八', 'ACTIVE',   'dept_ops',      now(), now()),
  ('usr_wujiu',    'u_wujiu',    'wujiu',    'wujiu@example.com',    true,  '13800000007', '吴九', 'ACTIVE',   'dept_frontend', now(), now()),
  ('usr_chenshi',  'u_chenshi',  'chenshi',  'chenshi@example.com',  true,  '13800000008', '陈十', 'DISABLED', 'dept_product',  now(), now());

-- ============================================================================
-- 3. Better Auth 账号 (accounts) — 统一密码 Test@123456
-- ============================================================================
INSERT INTO accounts (id, user_id, account_id, provider_id, password, created_at, updated_at)
VALUES
  ('acc_zhangsan', 'usr_zhangsan', 'zhangsan@example.com', 'credential', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', now(), now()),
  ('acc_lisi',     'usr_lisi',     'lisi@example.com',     'credential', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', now(), now()),
  ('acc_wangwu',   'usr_wangwu',   'wangwu@example.com',   'credential', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', now(), now()),
  ('acc_zhaoliu',  'usr_zhaoliu',  'zhaoliu@example.com',  'credential', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', now(), now()),
  ('acc_sunqi',    'usr_sunqi',    'sunqi@example.com',    'credential', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', now(), now()),
  ('acc_zhouba',   'usr_zhouba',   'zhouba@example.com',   'credential', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', now(), now()),
  ('acc_wujiu',    'usr_wujiu',    'wujiu@example.com',    'credential', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', now(), now()),
  ('acc_chenshi',  'usr_chenshi',  'chenshi@example.com',  'credential', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', now(), now());

-- ============================================================================
-- 4. OAuth 客户端 (clients)
-- ============================================================================
INSERT INTO clients (id, public_id, name, client_id, client_secret, redirect_uris, grant_types, scopes, status, skip_consent, created_at, updated_at)
VALUES
  ('cli_portal',    'cli_portal',    'Auth-SSO Portal', 'portal',      'portal-secret-dev',      '["http://localhost:4000/api/auth/callback"]',                     '["authorization_code","refresh_token"]', 'openid profile email offline_access', 'ACTIVE',   true,  now(), now()),
  ('cli_demo',      'cli_demo',      'Demo SSO App',    'demo-app',    'demo-app-secret-dev',    '["http://localhost:4002/api/auth/callback"]',                     '["authorization_code","refresh_token"]', 'openid profile email offline_access', 'ACTIVE',   true,  now(), now()),
  ('cli_erp',       'cli_erp',       'ERP 系统',        'erp-app',     'erp-app-secret-dev',     '["https://erp.example.com/callback"]',                            '["authorization_code","refresh_token"]', 'openid profile email offline_access', 'ACTIVE',   false, now(), now()),
  ('cli_crm',       'cli_crm',       'CRM 系统',        'crm-app',     'crm-app-secret-dev',     '["https://crm.example.com/callback"]',                            '["authorization_code","refresh_token"]', 'openid profile email offline_access', 'ACTIVE',   false, now(), now()),
  ('cli_disabled',  'cli_disabled',  '已废弃系统',      'disabled-app','disabled-app-secret-dev','["https://disabled.example.com/callback"]',                       '["authorization_code","refresh_token"]', 'openid profile email offline_access', 'DISABLED', false, now(), now());

-- ============================================================================
-- 5. 角色 (roles)
-- ============================================================================
INSERT INTO roles (id, public_id, name, code, description, data_scope_type, is_system, status, sort, created_at, updated_at)
VALUES
  ('role_super_admin',  'r_super_admin',  '超级管理员', 'SUPER_ADMIN',  '拥有全部权限，不受数据范围限制',                             'ALL',          true,  'ACTIVE', 0, now(), now()),
  ('role_org_admin',    'r_org_admin',    '组织管理员', 'ORG_ADMIN',    '管理指定部门及子部门的用户和配置',                           'DEPT_AND_SUB', false, 'ACTIVE', 1, now(), now()),
  ('role_dept_manager', 'r_dept_manager', '部门经理',   'DEPT_MANAGER', '管理本部门用户',                                             'DEPT',         false, 'ACTIVE', 2, now(), now()),
  ('role_employee',     'r_employee',     '普通员工',   'EMPLOYEE',     '仅查看个人数据',                                             'SELF',         false, 'ACTIVE', 3, now(), now()),
  ('role_app_admin',    'r_app_admin',    '应用管理员', 'APP_ADMIN',    '管理 OAuth 客户端接入',                                       'ALL',          false, 'ACTIVE', 4, now(), now()),
  ('role_audit_viewer', 'r_audit_viewer', '审计员',     'AUDIT_VIEWER', '查看审计日志和登录日志',                                       'SELF',         false, 'ACTIVE', 5, now(), now());

-- ============================================================================
-- 6. 权限 (permissions) — 全部 43 个权限码，匹配 @auth-sso/contracts
-- ============================================================================
INSERT INTO permissions (id, public_id, name, code, type, resource, action, sort, status, created_at, updated_at)
VALUES
  -- 用户管理 (8)
  ('perm_user_list',          'p_user_list',          '查看用户列表', 'user:list',          'API', 'user',          'list',          0,  'ACTIVE', now(), now()),
  ('perm_user_create',        'p_user_create',        '创建用户',     'user:create',        'API', 'user',          'create',        1,  'ACTIVE', now(), now()),
  ('perm_user_read',          'p_user_read',          '查看用户详情', 'user:read',          'API', 'user',          'read',          2,  'ACTIVE', now(), now()),
  ('perm_user_update',        'p_user_update',        '修改用户',     'user:update',        'API', 'user',          'update',        3,  'ACTIVE', now(), now()),
  ('perm_user_delete',        'p_user_delete',        '删除用户',     'user:delete',        'API', 'user',          'delete',        4,  'ACTIVE', now(), now()),
  ('perm_user_manage',        'p_user_manage',        '用户管理',     'user:manage',        'API', 'user',          'manage',        5,  'ACTIVE', now(), now()),
  ('perm_user_reset_password','p_user_reset_password','重置密码',     'user:reset_password','API', 'user',          'reset_password', 6, 'ACTIVE', now(), now()),
  ('perm_user_assign_role',   'p_user_assign_role',   '分配角色',     'user:assign_role',   'API', 'user',          'assign_role',   7,  'ACTIVE', now(), now()),
  -- 部门管理 (6)
  ('perm_dept_list',     'p_dept_list',     '查看部门列表', 'department:list',     'API', 'department', 'list',     8,  'ACTIVE', now(), now()),
  ('perm_dept_create',   'p_dept_create',   '创建部门',     'department:create',   'API', 'department', 'create',   9,  'ACTIVE', now(), now()),
  ('perm_dept_read',     'p_dept_read',     '查看部门详情', 'department:read',     'API', 'department', 'read',     10, 'ACTIVE', now(), now()),
  ('perm_dept_update',   'p_dept_update',   '修改部门',     'department:update',   'API', 'department', 'update',   11, 'ACTIVE', now(), now()),
  ('perm_dept_delete',   'p_dept_delete',   '删除部门',     'department:delete',   'API', 'department', 'delete',   12, 'ACTIVE', now(), now()),
  ('perm_dept_manage',   'p_dept_manage',   '部门管理',     'department:manage',   'API', 'department', 'manage',   13, 'ACTIVE', now(), now()),
  -- 角色管理 (7)
  ('perm_role_list',              'p_role_list',              '查看角色列表', 'role:list',              'API', 'role', 'list',              14, 'ACTIVE', now(), now()),
  ('perm_role_create',            'p_role_create',            '创建角色',     'role:create',            'API', 'role', 'create',            15, 'ACTIVE', now(), now()),
  ('perm_role_read',              'p_role_read',              '查看角色详情', 'role:read',              'API', 'role', 'read',              16, 'ACTIVE', now(), now()),
  ('perm_role_update',            'p_role_update',            '修改角色',     'role:update',            'API', 'role', 'update',            17, 'ACTIVE', now(), now()),
  ('perm_role_delete',            'p_role_delete',            '删除角色',     'role:delete',            'API', 'role', 'delete',            18, 'ACTIVE', now(), now()),
  ('perm_role_manage',            'p_role_manage',            '角色管理',     'role:manage',            'API', 'role', 'manage',            19, 'ACTIVE', now(), now()),
  ('perm_role_assign_permission', 'p_role_assign_permission', '分配权限',     'role:assign_permission', 'API', 'role', 'assign_permission', 20, 'ACTIVE', now(), now()),
  -- 权限管理 (6)
  ('perm_perm_list',    'p_perm_list',    '查看权限列表', 'permission:list',    'API', 'permission', 'list',    21, 'ACTIVE', now(), now()),
  ('perm_perm_create',  'p_perm_create',  '创建权限',     'permission:create',  'API', 'permission', 'create',  22, 'ACTIVE', now(), now()),
  ('perm_perm_read',    'p_perm_read',    '查看权限详情', 'permission:read',    'API', 'permission', 'read',    23, 'ACTIVE', now(), now()),
  ('perm_perm_update',  'p_perm_update',  '修改权限',     'permission:update',  'API', 'permission', 'update',  24, 'ACTIVE', now(), now()),
  ('perm_perm_delete',  'p_perm_delete',  '删除权限',     'permission:delete',  'API', 'permission', 'delete',  25, 'ACTIVE', now(), now()),
  ('perm_perm_manage',  'p_perm_manage',  '权限管理',     'permission:manage',  'API', 'permission', 'manage',  26, 'ACTIVE', now(), now()),
  -- 菜单管理 (6)
  ('perm_menu_list',   'p_menu_list',   '查看菜单列表', 'menu:list',   'API', 'menu', 'list',   27, 'ACTIVE', now(), now()),
  ('perm_menu_create', 'p_menu_create', '创建菜单',     'menu:create', 'API', 'menu', 'create', 28, 'ACTIVE', now(), now()),
  ('perm_menu_read',   'p_menu_read',   '查看菜单详情', 'menu:read',   'API', 'menu', 'read',   29, 'ACTIVE', now(), now()),
  ('perm_menu_update', 'p_menu_update', '修改菜单',     'menu:update', 'API', 'menu', 'update', 30, 'ACTIVE', now(), now()),
  ('perm_menu_delete', 'p_menu_delete', '删除菜单',     'menu:delete', 'API', 'menu', 'delete', 31, 'ACTIVE', now(), now()),
  ('perm_menu_manage', 'p_menu_manage', '菜单管理',     'menu:manage', 'API', 'menu', 'manage', 32, 'ACTIVE', now(), now()),
  -- 客户端管理 (7)
  ('perm_client_list',          'p_client_list',          '查看应用列表', 'client:list',          'API', 'client', 'list',          33, 'ACTIVE', now(), now()),
  ('perm_client_create',        'p_client_create',        '创建应用',     'client:create',        'API', 'client', 'create',        34, 'ACTIVE', now(), now()),
  ('perm_client_read',          'p_client_read',          '查看应用详情', 'client:read',          'API', 'client', 'read',          35, 'ACTIVE', now(), now()),
  ('perm_client_update',        'p_client_update',        '修改应用',     'client:update',        'API', 'client', 'update',        36, 'ACTIVE', now(), now()),
  ('perm_client_delete',        'p_client_delete',        '删除应用',     'client:delete',        'API', 'client', 'delete',        37, 'ACTIVE', now(), now()),
  ('perm_client_manage',        'p_client_manage',        '应用管理',     'client:manage',        'API', 'client', 'manage',        38, 'ACTIVE', now(), now()),
  ('perm_client_rotate_secret', 'p_client_rotate_secret', '轮换密钥',     'client:rotate_secret', 'API', 'client', 'rotate_secret', 39, 'ACTIVE', now(), now()),
  -- 审计日志 (2)
  ('perm_audit_read',   'p_audit_read',   '查看审计日志', 'audit:read',   'API', 'audit',     'read',   40, 'ACTIVE', now(), now()),
  ('perm_audit_export', 'p_audit_export', '导出审计日志', 'audit:export', 'API', 'audit',     'export', 41, 'ACTIVE', now(), now()),
  -- 登录日志 (2)
  ('perm_login_log_read',   'p_login_log_read',   '查看登录日志', 'login_log:read',   'API', 'login_log', 'read',   42, 'ACTIVE', now(), now()),
  ('perm_login_log_export', 'p_login_log_export', '导出登录日志', 'login_log:export', 'API', 'login_log', 'export', 43, 'ACTIVE', now(), now()),
  -- 系统管理 (2)
  ('perm_system_manage',        'p_system_manage',        '系统管理',   'system:manage',        'API', 'system', 'manage',        44, 'ACTIVE', now(), now()),
  ('perm_system_view_dashboard','p_system_view_dashboard','查看仪表盘', 'system:view_dashboard', 'API', 'system', 'view_dashboard', 45, 'ACTIVE', now(), now()),
  -- 客户关系图 (2)
  ('perm_customer_graph_view',  'p_customer_graph_view',  '查看客户关系图', 'customer_graph:view',  'API', 'customer_graph', 'view',   46, 'ACTIVE', now(), now()),
  ('perm_customer_graph_export','p_customer_graph_export','导出客户关系图', 'customer_graph:export','API', 'customer_graph', 'export', 47, 'ACTIVE', now(), now());

-- ============================================================================
-- 7. 用户-角色关联 (user_roles)
-- ============================================================================
INSERT INTO user_roles (id, user_id, role_id, created_at)
VALUES
  -- 张三 → 超级管理员
  ('ur_zhangsan_super',  'usr_zhangsan', 'role_super_admin',  now()),
  -- 李四 → 组织管理员
  ('ur_lisi_org',        'usr_lisi',     'role_org_admin',    now()),
  -- 王五 → 部门经理
  ('ur_wangwu_dept',     'usr_wangwu',   'role_dept_manager', now()),
  -- 赵六 → 普通员工
  ('ur_zhaoliu_emp',     'usr_zhaoliu',  'role_employee',     now()),
  -- 孙七 → 应用管理员
  ('ur_sunqi_app',       'usr_sunqi',    'role_app_admin',    now()),
  -- 周八 → 审计员
  ('ur_zhouba_audit',    'usr_zhouba',   'role_audit_viewer', now());
  -- 吴九 → 无角色（不插入）
  -- 陈十 → DISABLED，保留 employee 角色关联用于状态恢复测试
-- （陈十角色关联暂不插入，DISABLED 状态优先测试）

-- ============================================================================
-- 8. 角色-权限关联 (role_permissions)
-- ============================================================================

-- 8.1 超级管理员 (SUPER_ADMIN) — 全部权限
INSERT INTO role_permissions (id, role_id, permission_id, created_at)
SELECT
  'rp_super_' || p.id,
  'role_super_admin',
  p.id,
  now()
FROM permissions p;

-- 8.2 组织管理员 (ORG_ADMIN) — 用户管理 + 部门/角色只读 + 仪表盘
INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES
  ('rp_org_user_list',      'role_org_admin', 'perm_user_list',          now()),
  ('rp_org_user_create',    'role_org_admin', 'perm_user_create',        now()),
  ('rp_org_user_read',      'role_org_admin', 'perm_user_read',          now()),
  ('rp_org_user_update',    'role_org_admin', 'perm_user_update',        now()),
  ('rp_org_user_reset_pwd', 'role_org_admin', 'perm_user_reset_password',now()),
  ('rp_org_user_assign',    'role_org_admin', 'perm_user_assign_role',   now()),
  ('rp_org_dept_list',      'role_org_admin', 'perm_dept_list',          now()),
  ('rp_org_dept_read',      'role_org_admin', 'perm_dept_read',          now()),
  ('rp_org_role_list',      'role_org_admin', 'perm_role_list',          now()),
  ('rp_org_role_read',      'role_org_admin', 'perm_role_read',          now()),
  ('rp_org_dashboard',      'role_org_admin', 'perm_system_view_dashboard', now());

-- 8.3 部门经理 (DEPT_MANAGER) — 用户列表/详情/编辑 + 部门/角色只读 + 仪表盘
INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES
  ('rp_dept_user_list',   'role_dept_manager', 'perm_user_list',          now()),
  ('rp_dept_user_read',   'role_dept_manager', 'perm_user_read',          now()),
  ('rp_dept_user_update', 'role_dept_manager', 'perm_user_update',        now()),
  ('rp_dept_dept_list',   'role_dept_manager', 'perm_dept_list',          now()),
  ('rp_dept_dept_read',   'role_dept_manager', 'perm_dept_read',          now()),
  ('rp_dept_role_list',   'role_dept_manager', 'perm_role_list',          now()),
  ('rp_dept_role_read',   'role_dept_manager', 'perm_role_read',          now()),
  ('rp_dept_dashboard',   'role_dept_manager', 'perm_system_view_dashboard', now());

-- 8.4 普通员工 (EMPLOYEE) — 仅仪表盘
INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES
  ('rp_emp_dashboard',    'role_employee', 'perm_system_view_dashboard', now());

-- 8.5 应用管理员 (APP_ADMIN) — 客户端全部权限
INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES
  ('rp_app_client_list',    'role_app_admin', 'perm_client_list',          now()),
  ('rp_app_client_create',  'role_app_admin', 'perm_client_create',        now()),
  ('rp_app_client_read',    'role_app_admin', 'perm_client_read',          now()),
  ('rp_app_client_update',  'role_app_admin', 'perm_client_update',        now()),
  ('rp_app_client_delete',  'role_app_admin', 'perm_client_delete',        now()),
  ('rp_app_client_manage',  'role_app_admin', 'perm_client_manage',        now()),
  ('rp_app_client_rotate',  'role_app_admin', 'perm_client_rotate_secret', now());

-- 8.6 审计员 (AUDIT_VIEWER) — 审计日志 + 登录日志
INSERT INTO role_permissions (id, role_id, permission_id, created_at) VALUES
  ('rp_audit_audit_read',   'role_audit_viewer', 'perm_audit_read',       now()),
  ('rp_audit_audit_export', 'role_audit_viewer', 'perm_audit_export',     now()),
  ('rp_audit_log_read',     'role_audit_viewer', 'perm_login_log_read',   now()),
  ('rp_audit_log_export',   'role_audit_viewer', 'perm_login_log_export', now());

-- ============================================================================
-- 9. 角色-客户端关联 (role_clients) — 控制 SSO 应用接入权限
-- ============================================================================
-- demo-app: 全部角色可访问
INSERT INTO role_clients (id, role_id, client_id, created_at) VALUES
  ('rc_super_demo',  'role_super_admin',  'demo-app', now()),
  ('rc_org_demo',    'role_org_admin',    'demo-app', now()),
  ('rc_dept_demo',   'role_dept_manager', 'demo-app', now()),
  ('rc_emp_demo',    'role_employee',     'demo-app', now()),
  ('rc_app_demo',    'role_app_admin',    'demo-app', now()),
  ('rc_audit_demo',  'role_audit_viewer', 'demo-app', now());

-- erp-app: 仅 super_admin, org_admin, dept_manager
INSERT INTO role_clients (id, role_id, client_id, created_at) VALUES
  ('rc_super_erp',   'role_super_admin',  'erp-app', now()),
  ('rc_org_erp',     'role_org_admin',    'erp-app', now()),
  ('rc_dept_erp',    'role_dept_manager', 'erp-app', now());

-- crm-app: 仅 super_admin, org_admin
INSERT INTO role_clients (id, role_id, client_id, created_at) VALUES
  ('rc_super_crm',   'role_super_admin',  'crm-app', now()),
  ('rc_org_crm',     'role_org_admin',    'crm-app', now());

-- disabled-app: 无角色绑定（DISABLED 客户端）
-- portal: 无需角色绑定（Portal 自身作为 OIDC Client）

-- ============================================================================
-- 10. 菜单树 (menus) — 目录/页面/按钮三级结构
-- ============================================================================
-- 一级：目录
INSERT INTO menus (id, public_id, parent_id, name, path, permission_code, icon, menu_type, visible, sort, status, created_at, updated_at)
VALUES
  ('menu_dashboard', 'm_dashboard', NULL,          '仪表盘',   '/dashboard',        'system:view_dashboard', 'LayoutDashboard', 'MENU',      true,  0, 'ACTIVE', now(), now()),
  ('menu_system',    'm_system',    NULL,          '系统管理', NULL,                  'system:manage',         'Settings',        'DIRECTORY', true,  1, 'ACTIVE', now(), now()),
  ('menu_user',      'm_user',      NULL,          '用户管理', '/admin/users',       'user:list',             'Users',           'MENU',      true,  2, 'ACTIVE', now(), now()),
  ('menu_dept',      'm_dept',      NULL,          '部门管理', '/admin/departments', 'department:list',       'Building2',       'MENU',      true,  3, 'ACTIVE', now(), now()),
  ('menu_role',      'm_role',      NULL,          '角色管理', '/admin/roles',       'role:list',             'Shield',          'MENU',      true,  4, 'ACTIVE', now(), now()),
  ('menu_perm',      'm_perm',      NULL,          '权限管理', '/admin/permissions', 'permission:list',       'KeyRound',        'MENU',      true,  5, 'ACTIVE', now(), now()),
  ('menu_menu',      'm_menu',      NULL,          '菜单管理', '/admin/menus',       'menu:list',             'Menu',            'MENU',      true,  6, 'ACTIVE', now(), now()),
  ('menu_client',    'm_client',    NULL,          '客户端管理','/admin/clients',    'client:list',           'AppWindow',       'MENU',      true,  7, 'ACTIVE', now(), now()),
  ('menu_audit',     'm_audit',     NULL,          '审计日志', '/admin/audit',       'audit:read',            'FileText',        'MENU',      true,  8, 'ACTIVE', now(), now()),
  ('menu_login_log', 'm_login_log', NULL,          '登录日志', '/admin/login-logs',  'login_log:read',        'LogIn',           'MENU',      true,  9, 'ACTIVE', now(), now());

-- 用户管理 → 按钮级权限
INSERT INTO menus (id, public_id, parent_id, name, path, permission_code, icon, menu_type, visible, sort, status, created_at, updated_at)
VALUES
  ('menu_user_create',  'm_user_create',  'menu_user', '新建用户',   NULL, 'user:create',         NULL, 'BUTTON', true, 1, 'ACTIVE', now(), now()),
  ('menu_user_edit',    'm_user_edit',     'menu_user', '编辑用户',   NULL, 'user:update',         NULL, 'BUTTON', true, 2, 'ACTIVE', now(), now()),
  ('menu_user_delete',  'm_user_delete',   'menu_user', '删除用户',   NULL, 'user:delete',         NULL, 'BUTTON', true, 3, 'ACTIVE', now(), now()),
  ('menu_user_reset',   'm_user_reset',    'menu_user', '重置密码',   NULL, 'user:reset_password', NULL, 'BUTTON', true, 4, 'ACTIVE', now(), now()),
  ('menu_user_assign',  'm_user_assign',   'menu_user', '分配角色',   NULL, 'user:assign_role',    NULL, 'BUTTON', true, 5, 'ACTIVE', now(), now());

-- 系统管理 → 子页面（隐藏菜单，测试 US-MNU-BTN-04）
INSERT INTO menus (id, public_id, parent_id, name, path, permission_code, icon, menu_type, visible, sort, status, created_at, updated_at)
VALUES
  ('menu_email_config', 'm_email_config', 'menu_system', '邮件配置', '/admin/email-config', 'system:manage', 'Mail', 'MENU', false, 1, 'ACTIVE', now(), now());

-- ============================================================================
-- 11. 审计日志样例 (audit_logs) — 用于验证 US-AUDIT-01/02
-- ============================================================================
INSERT INTO audit_logs (id, user_id, username, operation, method, url, ip, status, duration, created_at)
VALUES
  ('alog_01', 'usr_zhangsan', 'zhangsan', '用户登录',    'POST', '/api/auth/login',        '127.0.0.1', 200, 150, now() - interval '2 hours'),
  ('alog_02', 'usr_zhangsan', 'zhangsan', '创建用户',    'POST', '/api/users',             '127.0.0.1', 201, 89,  now() - interval '90 minutes'),
  ('alog_03', 'usr_zhangsan', 'zhangsan', '分配角色',    'POST', '/api/users/usr_zhaoliu/roles', '127.0.0.1', 200, 45, now() - interval '1 hour'),
  ('alog_04', 'usr_zhangsan', 'zhangsan', '修改角色权限','PUT',  '/api/roles/role_dept_manager/permissions', '127.0.0.1', 200, 67, now() - interval '30 minutes'),
  ('alog_05', 'usr_zhangsan', 'zhangsan', '锁定用户',    'PUT',  '/api/users/usr_chenshi', '127.0.0.1', 200, 32,  now() - interval '15 minutes');

-- ============================================================================
-- 12. 登录日志样例 (login_logs) — 用于验证 US-AUDIT-03/04
-- ============================================================================
INSERT INTO login_logs (id, user_id, username, event_type, ip, user_agent, location, fail_reason, created_at)
VALUES
  ('llog_01', 'usr_zhangsan', 'zhangsan', 'LOGIN_SUCCESS', '127.0.0.1', 'Chrome/120', '北京', NULL,      now() - interval '2 hours'),
  ('llog_02', 'usr_lisi',     'lisi',     'LOGIN_SUCCESS', '192.168.1.5','Firefox/121','上海', NULL,      now() - interval '3 hours'),
  ('llog_03', 'usr_chenshi',  'chenshi',  'LOGIN_FAIL',    '10.0.0.1',  'Safari/17',  NULL,   '账户已禁用', now() - interval '4 hours'),
  ('llog_04', 'usr_wujiu',    'wujiu',    'LOGIN_SUCCESS', '172.16.0.1','Chrome/120', '深圳', NULL,      now() - interval '5 hours'),
  ('llog_05', 'usr_zhaoliu',  'zhaoliu',  'LOGIN_FAIL',    '192.168.1.20','Edge/120', NULL,   '密码错误',  now() - interval '1 hour'),
  ('llog_06', 'usr_zhaoliu',  'zhaoliu',  'LOGIN_SUCCESS', '192.168.1.20','Edge/120', '广州', NULL,      now() - interval '55 minutes');

COMMIT;
