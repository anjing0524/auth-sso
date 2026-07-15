/**
 * 测试数据种子工厂
 *
 * 提供常用测试数据模板（部门/用户/角色/权限/Client/JWKS），
 * 各测试文件按需组合使用。
 */
import crypto from 'crypto';
import type { SeedData } from './test-db';

const now = new Date();

/** 根部门 — 几乎所有测试都需要的组织锚点 */
export function seedRootDept(): SeedData['departments'] {
  return [{
    id: '00000000-0000-4000-8000-000000000001',
    parentId: null,
    name: '总公司',
    code: 'ROOT',
    ancestors: null,
    sort: 0,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  }];
}

/** 子部门 */
export function seedSubDept(overrides: Partial<SeedData['departments'][0]> = {}): SeedData['departments'] {
  return [{
    id: '00000000-0000-4000-8000-000000000002',
    parentId: '00000000-0000-4000-8000-000000000001',
    name: '技术部',
    code: 'TECH',
    ancestors: '00000000-0000-4000-8000-000000000001',
    sort: 1,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }];
}

/** 管理员用户 */
export function seedAdminUser(overrides: Partial<SeedData['users'][0]> = {}): SeedData['users'] {
  return [{
    id: '00000000-0000-4000-8000-000000000101',
    username: 'admin',
    email: 'admin@example.com',
    emailVerified: true,
    mobile: null,
    mobileVerified: false,
    name: '超级管理员',
    passwordHash: '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe',
    passwordHistory: null,
    avatarUrl: null,
    status: 'ACTIVE',
    deptId: '00000000-0000-4000-8000-000000000001',
    lastLoginAt: null,
    deletedAt: null,
    passwordChangedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }];
}

/** 普通用户 */
export function seedTestUser(overrides: Partial<SeedData['users'][0]> = {}): SeedData['users'] {
  return [{
    id: '00000000-0000-4000-8000-000000000201',
    username: 'testuser',
    email: 'test@example.com',
    emailVerified: true,
    mobile: null,
    mobileVerified: false,
    name: '测试用户',
    passwordHash: '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe',
    passwordHistory: null,
    avatarUrl: null,
    status: 'ACTIVE',
    deptId: '00000000-0000-4000-8000-000000000001',
    lastLoginAt: null,
    deletedAt: null,
    passwordChangedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }];
}

/** 系统角色 */
export function seedSuperAdminRole(overrides: Partial<SeedData['roles'][0]> = {}): SeedData['roles'] {
  return [{
    id: '00000000-0000-4000-8000-000000000301',
    name: '超级管理员',
    code: 'SUPER_ADMIN',
    description: '拥有所有权限',
    deptId: '00000000-0000-4000-8000-000000000001',
    isSystem: true,
    status: 'ACTIVE',
    sort: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }];
}

/** Portal OAuth Client */
export function seedPortalClient(overrides: Partial<SeedData['clients'][0]> = {}): SeedData['clients'] {
  return [{
    clientId: 'portal',
    name: 'Auth-SSO Portal',
    clientSecret: crypto.createHash('sha256').update('portal-secret').digest('hex'),
    redirectUris: ['http://localhost:4100/api/auth/callback'],
    scopes: 'openid profile email offline_access',
    homepageUrl: null,
    logoUrl: null,
    accessTokenTtl: 3600,
    refreshTokenTtl: 604800,
    status: 'ACTIVE',
    isInternal: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }];
}

/** ES256 JWK 密钥对（用于 JWT 签发/验签测试） */
export function seedJwks(overrides: Partial<SeedData['jwks'][0]> = {}): SeedData['jwks'] {
  return [{
    id: crypto.randomUUID(),
    kid: 'test-kid-001',
    algorithm: 'ES256',
    publicKey: JSON.stringify({
      kty: 'EC',
      crv: 'P-256',
      x: 'f83OJ3D2xF1Bg8vub9tM1gGPT34Ogv50GI1g9SamyC8',
      y: 'x_9LH9FHme7alQA9g1y5OB84XJWADnVEhypT5sR-vCs',
    }),
    privateKey: JSON.stringify({
      kty: 'EC',
      crv: 'P-256',
      x: 'f83OJ3D2xF1Bg8vub9tM1gGPT34Ogv50GI1g9SamyC8',
      y: 'x_9LH9FHme7alQA9g1y5OB84XJWADnVEhypT5sR-vCs',
      d: 'jpsQnnGQmLv7UfFpQ9k8-kH6-4SJyvK2Wj2N2aQeE24',
    }),
    createdAt: now,
    expiresAt: new Date(now.getTime() + 90 * 24 * 3600 * 1000),
    ...overrides,
  }];
}

/** 用户-角色绑定 */
export function seedUserRoleBinding(
  userId: string,
  roleId: string,
): SeedData['userRoles'] {
  return [{ userId, roleId, createdAt: now }];
}

/** 通用测试权限（API 类型） */
export function seedTestPermission(overrides: Partial<SeedData['permissions'][0]> = {}): SeedData['permissions'] {
  return [{
    id: '00000000-0000-4000-8000-000000000401',
    code: 'TEST_PERM',
    name: 'Test Permission',
    type: 'API',
    resource: '/api/test',
    action: 'GET',
    description: '',
    clientId: null,
    parentId: null,
    status: 'ACTIVE',
    sort: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }];
}
