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
    code: 'portal:user:list',
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
    permissions: ['portal:user:list', 'portal:user:create', 'portal:user:update', 'portal:user:delete'],
    deptIds: ['dept-1'],
    ...overrides,
  };
}
