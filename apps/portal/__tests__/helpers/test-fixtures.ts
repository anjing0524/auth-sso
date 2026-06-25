/**
 * 测试数据 Fixture 工厂
 * 提供各业务实体的快速构造函数
 * 用于 API 单元测试中的测试数据准备
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
    emailVerified: null,
    lastLoginAt: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    // getUser 经 Relational Queries 取出，roles 以 userRoles 嵌套结构返回
    userRoles: [] as Array<{ role: Record<string, any> }>,
    ...overrides,
  };
}

/** 创建测试角色数据 */
export function createTestRole(overrides: Record<string, any> = {}) {
  return {
    id: 'role-1',
    publicId: 'r_role01',
    code: 'TEST_ROLE',
    name: '测试角色',
    description: '用于测试的角色',
    status: 'ACTIVE',
    deptId: 'dept-1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/** 创建测试权限数据 */
export function createTestPermission(overrides: Record<string, any> = {}) {
  return {
    id: 'perm-1',
    publicId: 'p_perm01',
    code: 'user:list',
    name: '用户列表',
    resource: 'user',
    action: 'list',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/** 创建测试部门数据 */
export function createTestDepartment(overrides: Record<string, any> = {}) {
  return {
    id: 'dept-1',
    publicId: 'd_dept01',
    name: '测试部门',
    code: 'TEST_DEPT',
    parentId: null,
    sortOrder: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/** 创建测试菜单数据 */
export function createTestMenu(overrides: Record<string, any> = {}) {
  return {
    id: 'menu-1',
    publicId: 'm_menu01',
    name: '测试菜单',
    path: '/test',
    icon: 'test',
    parentId: null,
    sortOrder: 0,
    permissionId: null,
    visible: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/** 创建测试 OAuth Client 数据 */
export function createTestClient(overrides: Record<string, any> = {}) {
  return {
    id: 'client-1',
    publicId: 'c_cli01',
    name: '测试应用',
    clientId: 'test_client_id',
    clientSecret: 'hashed_secret',
    redirectUris: ['http://localhost:4100/api/auth/callback'],
    grantTypes: ['authorization_code'],
    scopes: ['openid', 'profile'],
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/** 创建测试 Session 数据 */
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
    userInfo: {
      email: 'test@example.com',
      name: '测试用户',
    },
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
