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
  ('4b24f88a-2e66-73f0-b15b-f0387ef5a9bc',       NULL,          '干了科技', 'ROOT',    NULL,               0, 'ACTIVE', now(), now()),
  ('3c05fc52-e11e-40f3-2b90-183ca6387665',     '4b24f88a-2e66-73f0-b15b-f0387ef5a9bc',     '技术部',   'TECH',    '4b24f88a-2e66-73f0-b15b-f0387ef5a9bc',          1, 'ACTIVE', now(), now()),
  ('5b3fa068-f8e1-e3f4-7a49-5aa99cd7fe25', '3c05fc52-e11e-40f3-2b90-183ca6387665',   '前端组',   'FE',      '4b24f88a-2e66-73f0-b15b-f0387ef5a9bc/3c05fc52-e11e-40f3-2b90-183ca6387665',2, 'ACTIVE', now(), now()),
  ('f9b0891b-f6e4-1cf2-d533-5068cab38248',  '3c05fc52-e11e-40f3-2b90-183ca6387665',   '后端组',   'BE',      '4b24f88a-2e66-73f0-b15b-f0387ef5a9bc/3c05fc52-e11e-40f3-2b90-183ca6387665',3, 'ACTIVE', now(), now()),
  ('83b2cfdb-0a15-20cf-7e8c-96a08bb2e817',  '4b24f88a-2e66-73f0-b15b-f0387ef5a9bc',     '产品部',   'PRODUCT', '4b24f88a-2e66-73f0-b15b-f0387ef5a9bc',          4, 'ACTIVE', now(), now()),
  ('8da87e43-0855-e2ff-1def-9b13479ed741',      '4b24f88a-2e66-73f0-b15b-f0387ef5a9bc',     '运营部',   'OPS',     '4b24f88a-2e66-73f0-b15b-f0387ef5a9bc',          5, 'ACTIVE', now(), now());

-- ============================================================================
-- 2. 用户 (users) — 密码统一 Test@123456
-- ============================================================================
INSERT INTO users (id, username, email, email_verified, mobile, name, password_hash, status, dept_id, created_at, updated_at)
VALUES
  ('8bf5fc46-767b-712b-c646-a8f8282a292c', 'zhangsan', 'zhangsan@example.com', true,  '13800000001', '张三', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', 'ACTIVE',   '4b24f88a-2e66-73f0-b15b-f0387ef5a9bc',       now(), now()),
  ('a2dd7e4d-054d-ec36-67ce-f79d07042f66',     'lisi',     'lisi@example.com',     true,  '13800000002', '李四', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', 'ACTIVE',   '3c05fc52-e11e-40f3-2b90-183ca6387665',     now(), now()),
  ('7b1aefc5-4f5c-6058-24d9-90d995bc1782',   'wangwu',   'wangwu@example.com',   true,  '13800000003', '王五', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', 'ACTIVE',   '83b2cfdb-0a15-20cf-7e8c-96a08bb2e817',  now(), now()),
  ('6afd0197-a580-8cb1-ac34-9d83e44e8e02',  'zhaoliu',  'zhaoliu@example.com',  true,  '13800000004', '赵六', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', 'ACTIVE',   'f9b0891b-f6e4-1cf2-d533-5068cab38248',  now(), now()),
  ('a2dc53c7-f7f6-84da-484f-48bb2ac33952',    'sunqi',    'sunqi@example.com',    true,  '13800000005', '孙七', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', 'ACTIVE',   '4b24f88a-2e66-73f0-b15b-f0387ef5a9bc',       now(), now()),
  ('f463c282-bbd4-cafe-fffe-d15488786332',   'zhouba',   'zhouba@example.com',   true,  '13800000006', '周八', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', 'ACTIVE',   '8da87e43-0855-e2ff-1def-9b13479ed741',      now(), now()),
  ('99a9b8ac-acff-42b9-655c-ecafc798e64e',    'wujiu',    'wujiu@example.com',    true,  '13800000007', '吴九', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', 'ACTIVE',   '5b3fa068-f8e1-e3f4-7a49-5aa99cd7fe25', now(), now()),
  ('e5ca48ea-d6c3-7fe1-e82f-9af85928e15f',  'chenshi',  'chenshi@example.com',  true,  '13800000008', '陈十', '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe', 'DISABLED', '83b2cfdb-0a15-20cf-7e8c-96a08bb2e817',  now(), now());

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
  ('91e47d8a-0df5-e7c7-d2d1-faf35e24fe5a',  '超级管理员', 'SUPER_ADMIN',  '拥有全部权限，不受数据范围限制',              'ALL',          true,  'ACTIVE', 0, now(), now()),
  ('0c20de86-8e7c-8148-2a43-91bfba639cee',    '组织管理员', 'ORG_ADMIN',    '管理指定部门及子部门的用户和配置',            'DEPT_AND_SUB', false, 'ACTIVE', 1, now(), now()),
  ('6964a379-1528-db7d-aa6a-d120e140047c', '部门经理',   'DEPT_MANAGER', '管理本部门用户',                              'DEPT',         false, 'ACTIVE', 2, now(), now()),
  ('b4f0e996-62f9-6592-4610-0f07a9478efc',     '普通员工',   'EMPLOYEE',     '仅查看个人数据',                              'SELF',         false, 'ACTIVE', 3, now(), now()),
  ('fe98c776-6e05-04cc-0445-ea07d298405c',    '应用管理员', 'APP_ADMIN',    '管理 OAuth 客户端接入',                        'ALL',          false, 'ACTIVE', 4, now(), now()),
  ('522b2129-18fc-7425-e026-701958925732', '审计员',     'AUDIT_VIEWER', '查看审计日志和登录日志',                        'SELF',         false, 'ACTIVE', 5, now(), now());

-- ============================================================================
-- 5. 权限统一树 (permissions) — type: DIRECTORY | PAGE | API | DATA
-- ============================================================================

-- 5.1 菜单目录 (DIRECTORY) — 侧边栏折叠组
INSERT INTO permissions (id, code, name, type, icon, visible, parent_id, sort, status, created_at, updated_at) VALUES
  ('1a16cdf1-3bcc-b9fa-01fc-262631ff97bb',  'dir:dashboard',  '仪表盘',     'DIRECTORY', 'LayoutDashboard', true, NULL, 0, 'ACTIVE', now(), now()),
  ('7504dfca-a1fc-c324-575c-e4e3808aa533',     'dir:system',     '系统管理',   'DIRECTORY', 'Settings',        true, NULL, 1, 'ACTIVE', now(), now()),
  ('cc56e77a-163e-0ce5-305e-2034f46bafda',  'dir:user_mgmt',  '用户权限',   'DIRECTORY', 'Users',           true, NULL, 2, 'ACTIVE', now(), now()),
  ('b6972037-7c19-42e0-5d36-a005e8c04a60',        'dir:org',        '组织架构',   'DIRECTORY', 'Building2',       true, NULL, 3, 'ACTIVE', now(), now()),
  ('c5037b10-2173-91d4-1587-c2bbafd47280',     'dir:client',     '应用管理',   'DIRECTORY', 'AppWindow',       true, NULL, 4, 'ACTIVE', now(), now()),
  ('0aff0ff5-f7f3-4204-1413-e8b04ae10850',      'dir:audit',      '审计日志',   'DIRECTORY', 'FileText',        true, NULL, 5, 'ACTIVE', now(), now());

-- 5.2 菜单页面 (PAGE) — 侧边栏路由项
INSERT INTO permissions (id, code, name, type, path, icon, visible, parent_id, sort, status, created_at, updated_at) VALUES
  ('8f9e4759-b452-4b33-dff5-37a2c02f2e98',  'menu:dashboard',   '仪表盘',     'PAGE', '/dashboard',          'LayoutDashboard', true, '1a16cdf1-3bcc-b9fa-01fc-262631ff97bb', 0, 'ACTIVE', now(), now()),
  ('5f18c278-5d3e-6ded-2785-ca26b7637fba',      'menu:users',       '用户管理',   'PAGE', '/admin/users',        'Users',           true, 'cc56e77a-163e-0ce5-305e-2034f46bafda', 0, 'ACTIVE', now(), now()),
  ('4690621e-3b74-c30d-aedf-48500979d213',      'menu:roles',       '角色管理',   'PAGE', '/admin/roles',        'Shield',          true, 'cc56e77a-163e-0ce5-305e-2034f46bafda', 1, 'ACTIVE', now(), now()),
  ('48b029fd-549e-0d61-3d74-768b60787735','menu:permissions', '权限管理',   'PAGE', '/admin/permissions',  'KeyRound',        true, 'cc56e77a-163e-0ce5-305e-2034f46bafda', 2, 'ACTIVE', now(), now()),
  ('5387447a-43dd-1e64-1d99-a3a610b5faa1',      'menu:departments', '部门管理',   'PAGE', '/admin/departments',  'Building2',       true, 'b6972037-7c19-42e0-5d36-a005e8c04a60',      0, 'ACTIVE', now(), now()),
  ('5cdda215-b766-975d-0883-425890d5a066',    'menu:clients',     '客户端管理', 'PAGE', '/admin/clients',      'AppWindow',       true, 'c5037b10-2173-91d4-1587-c2bbafd47280',   0, 'ACTIVE', now(), now()),
  ('61475a5e-9140-8367-8e59-ce13be2d93b9',      'menu:audit-logs',  '审计日志',   'PAGE', '/admin/audit',        'FileText',        true, '0aff0ff5-f7f3-4204-1413-e8b04ae10850',    0, 'ACTIVE', now(), now()),
  ('96874343-c6b4-7f9e-9a02-4cfde85a33fe',  'menu:login-logs',  '登录日志',   'PAGE', '/admin/login-logs',   'LogIn',           true, '0aff0ff5-f7f3-4204-1413-e8b04ae10850',    1, 'ACTIVE', now(), now()),
  -- 隐藏页面（测试 US-MNU-BTN-04）
  ('fb3481fa-52a6-1953-e3c7-b96b6b888a18',      'menu:email',       '邮件配置',   'PAGE', '/admin/email-config', 'Mail',            false,'7504dfca-a1fc-c324-575c-e4e3808aa533',   0, 'ACTIVE', now(), now());

-- 5.3 API 权限点 — 43 个权限码
INSERT INTO permissions (id, code, name, type, resource, action, parent_id, sort, status, created_at, updated_at) VALUES
  -- 用户管理 (8)
  ('72d4cd72-bf51-cd51-f3cf-0e158d0cc0e3',        'user:create',        '创建用户',  'API', 'user', 'create',        '5f18c278-5d3e-6ded-2785-ca26b7637fba', 0, 'ACTIVE', now(), now()),
  ('b0b24a04-1d57-9726-9f3f-05e4eb2f1685',          'user:read',          '查看用户详情','API', 'user', 'read',         '5f18c278-5d3e-6ded-2785-ca26b7637fba', 1, 'ACTIVE', now(), now()),
  ('991504aa-344e-acb6-e131-9bb1b7977e1b',        'user:update',        '修改用户',  'API', 'user', 'update',        '5f18c278-5d3e-6ded-2785-ca26b7637fba', 2, 'ACTIVE', now(), now()),
  ('02c64ec0-92e9-587f-c7c7-feed51dccfe9',        'user:delete',        '删除用户',  'API', 'user', 'delete',        '5f18c278-5d3e-6ded-2785-ca26b7637fba', 3, 'ACTIVE', now(), now()),
  ('8bbde3a0-713c-f0e4-bc07-1df4f377d41b',        'user:manage',        '用户管理',  'API', 'user', 'manage',        '5f18c278-5d3e-6ded-2785-ca26b7637fba', 4, 'ACTIVE', now(), now()),
  ('28bd03e3-6c7f-fd22-e214-f0a2728a89c7','user:reset_password','重置密码',  'API', 'user', 'reset_password','5f18c278-5d3e-6ded-2785-ca26b7637fba', 5, 'ACTIVE', now(), now()),
  ('089ea296-7349-db24-6526-2b21d9afe26d',   'user:assign_role',   '分配角色',  'API', 'user', 'assign_role',   '5f18c278-5d3e-6ded-2785-ca26b7637fba', 6, 'ACTIVE', now(), now()),
  -- 部门管理 (6)
  ('2d7bcb4b-ebcd-0a63-d5da-85460d466794',  'department:create',  '创建部门',  'API', 'department', 'create',  '5387447a-43dd-1e64-1d99-a3a610b5faa1', 0, 'ACTIVE', now(), now()),
  ('053afff7-e297-f2ba-6455-f47fbbeddd1e',    'department:read',    '查看部门详情','API','department', 'read',    '5387447a-43dd-1e64-1d99-a3a610b5faa1', 1, 'ACTIVE', now(), now()),
  ('33c9734b-ed03-a3d9-30f6-45fa52f617a1',  'department:update',  '修改部门',  'API', 'department', 'update',  '5387447a-43dd-1e64-1d99-a3a610b5faa1', 2, 'ACTIVE', now(), now()),
  ('57b5c8c0-5bb8-f143-ee37-2abf6667ddc3',  'department:delete',  '删除部门',  'API', 'department', 'delete',  '5387447a-43dd-1e64-1d99-a3a610b5faa1', 3, 'ACTIVE', now(), now()),
  ('ef284ab5-62b5-1193-eadd-eecf24b3cf85',  'department:manage',  '部门管理',  'API', 'department', 'manage',  '5387447a-43dd-1e64-1d99-a3a610b5faa1', 4, 'ACTIVE', now(), now()),
  -- 角色管理 (7)
  ('b8d3cd73-d0ef-7687-ac3d-a426d00ab2bc',            'role:create',            '创建角色',  'API', 'role', 'create',            '4690621e-3b74-c30d-aedf-48500979d213', 0, 'ACTIVE', now(), now()),
  ('9e990abf-52f6-304c-f63f-fdc43e9f839f',              'role:read',              '查看角色详情','API','role', 'read',             '4690621e-3b74-c30d-aedf-48500979d213', 1, 'ACTIVE', now(), now()),
  ('e976dc1a-860e-7218-af0b-d0cff73e611d',            'role:update',            '修改角色',  'API', 'role', 'update',            '4690621e-3b74-c30d-aedf-48500979d213', 2, 'ACTIVE', now(), now()),
  ('22982a9a-3d05-4dd8-ecb0-43ae56428e80',            'role:delete',            '删除角色',  'API', 'role', 'delete',            '4690621e-3b74-c30d-aedf-48500979d213', 3, 'ACTIVE', now(), now()),
  ('35ef9061-4bcb-4129-9f60-ef055cd6fbdd',            'role:manage',            '角色管理',  'API', 'role', 'manage',            '4690621e-3b74-c30d-aedf-48500979d213', 4, 'ACTIVE', now(), now()),
  ('472b873b-eb97-a8e3-5b55-588e061658af', 'role:assign_permission', '分配权限',  'API', 'role', 'assign_permission', '4690621e-3b74-c30d-aedf-48500979d213', 5, 'ACTIVE', now(), now()),
  -- 权限管理 (6)
  ('a7786281-b035-875a-7174-e47a81a02a36',  'permission:create',  '创建权限',  'API', 'permission', 'create',  '48b029fd-549e-0d61-3d74-768b60787735', 0, 'ACTIVE', now(), now()),
  ('788a2cbb-bd01-0d42-71ce-15dd27894610',    'permission:read',    '查看权限详情','API','permission', 'read',    '48b029fd-549e-0d61-3d74-768b60787735', 1, 'ACTIVE', now(), now()),
  ('98e6aabb-e20f-7fb0-ab01-c57b33c9794c',  'permission:update',  '修改权限',  'API', 'permission', 'update',  '48b029fd-549e-0d61-3d74-768b60787735', 2, 'ACTIVE', now(), now()),
  ('9a3918b5-18f4-5cc9-61d9-8c1b355a08e7',  'permission:delete',  '删除权限',  'API', 'permission', 'delete',  '48b029fd-549e-0d61-3d74-768b60787735', 3, 'ACTIVE', now(), now()),
  ('5f9e95a4-e55f-48b0-0fe5-8de422084133',  'permission:manage',  '权限管理',  'API', 'permission', 'manage',  '48b029fd-549e-0d61-3d74-768b60787735', 4, 'ACTIVE', now(), now()),
  -- 菜单管理 (6) — 现在由 permissions 统一管理
  ('09394290-a6fd-7a19-5528-22d957859e87',  'menu:create',  '创建菜单项', 'API', 'permission', 'create',  '48b029fd-549e-0d61-3d74-768b60787735', 5, 'ACTIVE', now(), now()),
  ('d814e85b-6976-9a8e-b04a-5b372f5694b4',    'menu:read',    '查看菜单详情','API','permission', 'read',    '48b029fd-549e-0d61-3d74-768b60787735', 6, 'ACTIVE', now(), now()),
  ('e1a1f1d2-a17b-5068-493a-8a8a3b711dfe',  'menu:update',  '修改菜单项', 'API', 'permission', 'update',  '48b029fd-549e-0d61-3d74-768b60787735', 7, 'ACTIVE', now(), now()),
  ('5430ad85-808b-7710-92fd-1264977e6ee9',  'menu:delete',  '删除菜单项', 'API', 'permission', 'delete',  '48b029fd-549e-0d61-3d74-768b60787735', 8, 'ACTIVE', now(), now()),
  ('4c479681-0e08-00d7-1feb-90626123a6e6',  'menu:manage',  '菜单管理',   'API', 'permission', 'manage',  '48b029fd-549e-0d61-3d74-768b60787735', 9, 'ACTIVE', now(), now()),
  -- 客户端管理 (7)
  ('63f2e157-5b51-e91b-97e4-1680b2d023b1',        'client:create',        '创建应用',  'API', 'client', 'create',         '5cdda215-b766-975d-0883-425890d5a066', 0, 'ACTIVE', now(), now()),
  ('e65672dd-1e28-4bab-23c5-f8646300c5c6',          'client:read',          '查看应用详情','API','client', 'read',          '5cdda215-b766-975d-0883-425890d5a066', 1, 'ACTIVE', now(), now()),
  ('702c0773-d819-ef22-fa13-35b096c7a888',        'client:update',        '修改应用',  'API', 'client', 'update',         '5cdda215-b766-975d-0883-425890d5a066', 2, 'ACTIVE', now(), now()),
  ('d79ed634-f438-0cde-4437-13159c6cf929',        'client:delete',        '删除应用',  'API', 'client', 'delete',         '5cdda215-b766-975d-0883-425890d5a066', 3, 'ACTIVE', now(), now()),
  ('3fe595f1-5b40-1645-c361-fbcaf3a3430b',        'client:manage',        '应用管理',  'API', 'client', 'manage',         '5cdda215-b766-975d-0883-425890d5a066', 4, 'ACTIVE', now(), now()),
  ('2e80c103-9667-8405-cf12-6d19f37ee95d', 'client:rotate_secret', '轮换密钥',  'API', 'client', 'rotate_secret',  '5cdda215-b766-975d-0883-425890d5a066', 5, 'ACTIVE', now(), now()),
  -- 审计日志 (2)
  ('286f00fa-c59b-3ae7-8074-cbccc8038477',   'audit:read',   '查看审计日志', 'API', 'audit', 'read',   '61475a5e-9140-8367-8e59-ce13be2d93b9', 0, 'ACTIVE', now(), now()),
  ('51ee2b64-1566-63ae-9883-cafa2c534b33', 'audit:export', '导出审计日志', 'API', 'audit', 'export', '61475a5e-9140-8367-8e59-ce13be2d93b9', 1, 'ACTIVE', now(), now()),
  -- 登录日志 (2)
  ('71d5fb9a-d1c4-91e5-9ed8-43758736a812',   'login_log:read',   '查看登录日志', 'API', 'login_log', 'read',   '96874343-c6b4-7f9e-9a02-4cfde85a33fe', 0, 'ACTIVE', now(), now()),
  ('0064c653-432a-ec27-0f0b-8bae168b00fd', 'login_log:export', '导出登录日志', 'API', 'login_log', 'export', '96874343-c6b4-7f9e-9a02-4cfde85a33fe', 1, 'ACTIVE', now(), now()),
  -- 系统管理 (2)
  ('2e577d7f-c813-922f-19f1-51596c563638',         'system:manage',         '系统管理',  'API', 'system', 'manage',         NULL, 0, 'ACTIVE', now(), now()),
  ('125cf492-8d3a-1d62-9c1f-0e579b4f34db', 'system:view_dashboard', '查看仪表盘','API', 'system', 'view_dashboard', NULL, 1, 'ACTIVE', now(), now()),
  -- 客户关系图 (2)
  ('2848a06d-c625-768d-c503-c90b6aeb0f52',   'customer_graph:view',   '查看客户关系图','API', 'customer_graph', 'view',  NULL, 0, 'ACTIVE', now(), now()),
  ('84304377-9412-8a4b-64de-30f3dd55f753', 'customer_graph:export', '导出客户关系图','API', 'customer_graph', 'export',NULL, 1, 'ACTIVE', now(), now());

-- ============================================================================
-- 6. 用户-角色关联 (user_roles) — 复合主键 (user_id, role_id)
-- ============================================================================
INSERT INTO user_roles (user_id, role_id, created_at) VALUES
  ('8bf5fc46-767b-712b-c646-a8f8282a292c', '91e47d8a-0df5-e7c7-d2d1-faf35e24fe5a',  now()),
  ('a2dd7e4d-054d-ec36-67ce-f79d07042f66',     '0c20de86-8e7c-8148-2a43-91bfba639cee',    now()),
  ('7b1aefc5-4f5c-6058-24d9-90d995bc1782',   '6964a379-1528-db7d-aa6a-d120e140047c', now()),
  ('6afd0197-a580-8cb1-ac34-9d83e44e8e02',  'b4f0e996-62f9-6592-4610-0f07a9478efc',     now()),
  ('a2dc53c7-f7f6-84da-484f-48bb2ac33952',    'fe98c776-6e05-04cc-0445-ea07d298405c',    now()),
  ('f463c282-bbd4-cafe-fffe-d15488786332',   '522b2129-18fc-7425-e026-701958925732', now());
  -- 吴九 → 无角色 / 陈十 → DISABLED

-- ============================================================================
-- 7. 角色-权限关联 (role_permissions) — 复合主键 (role_id, permission_id)
-- ============================================================================

-- 7.1 超级管理员 — 所有 API 类型权限
INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT '91e47d8a-0df5-e7c7-d2d1-faf35e24fe5a', p.id, now()
FROM permissions p WHERE p.type = 'API';

-- 7.2 组织管理员
INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES
  ('0c20de86-8e7c-8148-2a43-91bfba639cee', '5f18c278-5d3e-6ded-2785-ca26b7637fba',              now()),
  ('0c20de86-8e7c-8148-2a43-91bfba639cee', '72d4cd72-bf51-cd51-f3cf-0e158d0cc0e3',         now()),
  ('0c20de86-8e7c-8148-2a43-91bfba639cee', 'b0b24a04-1d57-9726-9f3f-05e4eb2f1685',           now()),
  ('0c20de86-8e7c-8148-2a43-91bfba639cee', '991504aa-344e-acb6-e131-9bb1b7977e1b',         now()),
  ('0c20de86-8e7c-8148-2a43-91bfba639cee', '28bd03e3-6c7f-fd22-e214-f0a2728a89c7', now()),
  ('0c20de86-8e7c-8148-2a43-91bfba639cee', '089ea296-7349-db24-6526-2b21d9afe26d',    now()),
  ('0c20de86-8e7c-8148-2a43-91bfba639cee', '5387447a-43dd-1e64-1d99-a3a610b5faa1',              now()),
  ('0c20de86-8e7c-8148-2a43-91bfba639cee', '053afff7-e297-f2ba-6455-f47fbbeddd1e',           now()),
  ('0c20de86-8e7c-8148-2a43-91bfba639cee', '4690621e-3b74-c30d-aedf-48500979d213',              now()),
  ('0c20de86-8e7c-8148-2a43-91bfba639cee', '9e990abf-52f6-304c-f63f-fdc43e9f839f',           now()),
  ('0c20de86-8e7c-8148-2a43-91bfba639cee', '125cf492-8d3a-1d62-9c1f-0e579b4f34db',now());

-- 7.3 部门经理
INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES
  ('6964a379-1528-db7d-aa6a-d120e140047c', '5f18c278-5d3e-6ded-2785-ca26b7637fba',               now()),
  ('6964a379-1528-db7d-aa6a-d120e140047c', 'b0b24a04-1d57-9726-9f3f-05e4eb2f1685',            now()),
  ('6964a379-1528-db7d-aa6a-d120e140047c', '991504aa-344e-acb6-e131-9bb1b7977e1b',          now()),
  ('6964a379-1528-db7d-aa6a-d120e140047c', '5387447a-43dd-1e64-1d99-a3a610b5faa1',               now()),
  ('6964a379-1528-db7d-aa6a-d120e140047c', '053afff7-e297-f2ba-6455-f47fbbeddd1e',            now()),
  ('6964a379-1528-db7d-aa6a-d120e140047c', '4690621e-3b74-c30d-aedf-48500979d213',               now()),
  ('6964a379-1528-db7d-aa6a-d120e140047c', '9e990abf-52f6-304c-f63f-fdc43e9f839f',            now()),
  ('6964a379-1528-db7d-aa6a-d120e140047c', '125cf492-8d3a-1d62-9c1f-0e579b4f34db',now());

-- 7.4 普通员工
INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES
  ('b4f0e996-62f9-6592-4610-0f07a9478efc', '8f9e4759-b452-4b33-dff5-37a2c02f2e98',              now()),
  ('b4f0e996-62f9-6592-4610-0f07a9478efc', '125cf492-8d3a-1d62-9c1f-0e579b4f34db',   now());

-- 7.5 应用管理员
INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES
  ('fe98c776-6e05-04cc-0445-ea07d298405c', '5cdda215-b766-975d-0883-425890d5a066',              now()),
  ('fe98c776-6e05-04cc-0445-ea07d298405c', '63f2e157-5b51-e91b-97e4-1680b2d023b1',         now()),
  ('fe98c776-6e05-04cc-0445-ea07d298405c', 'e65672dd-1e28-4bab-23c5-f8646300c5c6',           now()),
  ('fe98c776-6e05-04cc-0445-ea07d298405c', '702c0773-d819-ef22-fa13-35b096c7a888',         now()),
  ('fe98c776-6e05-04cc-0445-ea07d298405c', 'd79ed634-f438-0cde-4437-13159c6cf929',         now()),
  ('fe98c776-6e05-04cc-0445-ea07d298405c', '3fe595f1-5b40-1645-c361-fbcaf3a3430b',         now()),
  ('fe98c776-6e05-04cc-0445-ea07d298405c', '2e80c103-9667-8405-cf12-6d19f37ee95d',  now());

-- 7.6 审计员
INSERT INTO role_permissions (role_id, permission_id, created_at) VALUES
  ('522b2129-18fc-7425-e026-701958925732', '61475a5e-9140-8367-8e59-ce13be2d93b9',             now()),
  ('522b2129-18fc-7425-e026-701958925732', '286f00fa-c59b-3ae7-8074-cbccc8038477',         now()),
  ('522b2129-18fc-7425-e026-701958925732', '51ee2b64-1566-63ae-9883-cafa2c534b33',       now()),
  ('522b2129-18fc-7425-e026-701958925732', '96874343-c6b4-7f9e-9a02-4cfde85a33fe',         now()),
  ('522b2129-18fc-7425-e026-701958925732', '71d5fb9a-d1c4-91e5-9ed8-43758736a812',     now()),
  ('522b2129-18fc-7425-e026-701958925732', '0064c653-432a-ec27-0f0b-8bae168b00fd',   now());

-- erp-app: 仅 super_admin, org_admin, dept_manager
INSERT INTO role_clients (role_id, client_id, created_at) VALUES
  ('91e47d8a-0df5-e7c7-d2d1-faf35e24fe5a',  'erp-app', now()),
  ('0c20de86-8e7c-8148-2a43-91bfba639cee',    'erp-app', now()),
  ('6964a379-1528-db7d-aa6a-d120e140047c', 'erp-app', now());
-- crm-app: 仅 super_admin, org_admin
INSERT INTO role_clients (role_id, client_id, created_at) VALUES
  ('91e47d8a-0df5-e7c7-d2d1-faf35e24fe5a',  'crm-app', now()),
  ('0c20de86-8e7c-8148-2a43-91bfba639cee',    'crm-app', now());

-- ============================================================================
-- 9. 审计日志样例 (audit_logs)
-- ============================================================================
INSERT INTO audit_logs (id, user_id, username, operation, method, url, ip, status, duration, created_at) VALUES
  ('48674e30-eea8-0b1e-c915-e24139c7e6f6','8bf5fc46-767b-712b-c646-a8f8282a292c','zhangsan','USER_CREATE','POST','/api/users','127.0.0.1',200,150,now()-interval'2 hours'),
  ('dd67d727-857f-6a01-94da-929e0052aa35','8bf5fc46-767b-712b-c646-a8f8282a292c','zhangsan','USER_ROLE_ASSIGN','POST','/api/users/usr_zhaoliu/roles','127.0.0.1',200,45,now()-interval'1 hour'),
  ('6ea5b67b-dc44-5e8a-1599-9a90595cc71e','8bf5fc46-767b-712b-c646-a8f8282a292c','zhangsan','ROLE_PERMISSION_ASSIGN','PUT','/api/roles/role_dept_manager/permissions','127.0.0.1',200,67,now()-interval'30 minutes'),
  ('e8ded06a-8526-0a09-92a7-3831e4fc00e1','8bf5fc46-767b-712b-c646-a8f8282a292c','zhangsan','USER_UPDATE','PUT','/api/users/usr_chenshi','127.0.0.1',200,32,now()-interval'15 minutes');

-- ============================================================================
-- 10. 登录日志样例 (login_logs)
-- ============================================================================
INSERT INTO login_logs (id, user_id, username, event_type, ip, user_agent, location, fail_reason, created_at) VALUES
  ('fe180f8f-bd1b-0a70-a459-11c3d5cadf8f','8bf5fc46-767b-712b-c646-a8f8282a292c','zhangsan','LOGIN_SUCCESS','127.0.0.1','Chrome/120','北京',NULL,    now()-interval'2 hours'),
  ('f920c10a-8c5e-2be8-4fa9-8dbd280cfbb3','a2dd7e4d-054d-ec36-67ce-f79d07042f66',    'lisi',    'LOGIN_SUCCESS','192.168.1.5','Firefox/121','上海',NULL,  now()-interval'3 hours'),
  ('3a8d2ee0-b325-f927-4858-13f1d59c0515','e5ca48ea-d6c3-7fe1-e82f-9af85928e15f', 'chenshi', 'LOGIN_FAILED', '10.0.0.1',  'Safari/17',  NULL,  '账户已禁用',now()-interval'4 hours'),
  ('e204b1e2-afb4-ba83-1ede-fb1e802682c9','99a9b8ac-acff-42b9-655c-ecafc798e64e',   'wujiu',   'LOGIN_SUCCESS','172.16.0.1','Chrome/120','深圳',NULL,   now()-interval'5 hours'),
  ('13605b98-3f22-b3c0-82f4-1e16438b7970','6afd0197-a580-8cb1-ac34-9d83e44e8e02', 'zhaoliu', 'LOGIN_FAILED', '192.168.1.20','Edge/120',NULL,  '密码错误',now()-interval'1 hour'),
  ('7906cd6b-23d1-4079-c31a-b35cd7004ba0','6afd0197-a580-8cb1-ac34-9d83e44e8e02', 'zhaoliu', 'LOGIN_SUCCESS','192.168.1.20','Edge/120','广州',NULL,   now()-interval'55 minutes');

COMMIT;
