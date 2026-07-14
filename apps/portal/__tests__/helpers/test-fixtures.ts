/**
 * 测试数据 Fixture 工厂
 * 提供各业务实体的快速构造函数，字段与当前 Drizzle Schema (v3.2) 完全对齐。
 * 用于 API 单元测试中的测试数据准备。
 */

/** 创建测试用户数据 */
export function createTestUser(overrides: Record<string, any> = {}) {
  return {
    id: 'user-1',
    username: 'testuser',
    email: 'test@example.com',
    name: '测试用户',
    status: 'ACTIVE',
    deptId: 'dept-1',
    avatarUrl: null,
    emailVerified: false,
    mobile: null,
    mobileVerified: false,
    passwordHash: null,
    passwordHistory: null,
    lastLoginAt: null,
    deletedAt: null,
    passwordChangedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    userRoles: [] as Array<{ role: Record<string, any> }>,
    ...overrides,
  };
}

/** 创建测试角色数据 */
export function createTestRole(overrides: Record<string, any> = {}) {
  return {
    id: 'role-1',
    code: 'TEST_ROLE',
    name: '测试角色',
    description: '用于测试的角色',
    deptId: 'dept-1',
    isSystem: false,
    status: 'ACTIVE',
    sort: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/** 创建测试权限数据 */
export function createTestPermission(overrides: Record<string, any> = {}) {
  return {
    id: 'perm-1',
    code: 'user:list',
    name: '用户列表',
    type: 'API',
    resource: 'user',
    action: 'list',
    status: 'ACTIVE',
    sort: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/** 创建测试部门数据 */
export function createTestDepartment(overrides: Record<string, any> = {}) {
  return {
    id: 'dept-1',
    name: '测试部门',
    code: 'TEST_DEPT',
    parentId: null,
    ancestors: null,
    sort: 0,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/** 创建测试 OAuth Client 数据 */
export function createTestClient(overrides: Record<string, any> = {}) {
  return {
    clientId: 'test_client_id',
    name: '测试应用',
    clientSecret: 'hashed_secret',
    redirectUris: ['http://localhost:4100/api/auth/callback'],
    scopes: 'openid profile',
    isInternal: false,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/** 创建测试权限上下文 */
export function createTestPermissionContext(overrides: Record<string, any> = {}) {
  return {
    roles: [{ id: 'role-1', code: 'ADMIN', name: '管理员' }],
    permissions: ['user:list', 'user:create', 'user:update', 'user:delete'],
    deptIds: ['dept-1'],
    ...overrides,
  };
}

// ========================================
// 已废弃 Fixtures（v3.2 Schema 中对应实体已合并/删除）
// 仅保留供存量测试兼容，新测试不应使用。
// ========================================

/**
 * @deprecated menus 表已合并入 permissions 表（v2），请直接使用 createTestPermission
 */
export function createTestMenu(overrides: Record<string, any> = {}) {
  return {
    id: 'menu-1',
    name: '测试菜单',
    code: 'test_menu',
    type: 'DIRECTORY',
    path: '/test',
    icon: 'test',
    parentId: null,
    sort: 0,
    visible: true,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/**
 * @deprecated sessions 表已在 v3 中移除，新实现基于 JWT + Redis jti 黑名单
 */
export function createTestSession(overrides: Record<string, any> = {}) {
  const now = Date.now();
  return {
    id: 'session-123',
    userId: 'user-1',
    accessToken: 'access-token-xxx',
    refreshToken: 'refresh-token-xxx',
    tokenExpiresAt: now + 3600 * 1000,
    createdAt: now,
    lastAccessAt: now,
    absoluteExpiresAt: now + 7 * 24 * 3600 * 1000,
    userInfo: { email: 'test@example.com', name: '测试用户' },
    ...overrides,
  };
}
