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
export function seedRootDept(): NonNullable<SeedData['departments']> {
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
export function seedSubDept(overrides: Partial<NonNullable<SeedData['departments']>[0]> = {}): NonNullable<SeedData['departments']> {
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
export function seedAdminUser(overrides: Partial<NonNullable<SeedData['users']>[0]> = {}): NonNullable<SeedData['users']> {
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
export function seedTestUser(overrides: Partial<NonNullable<SeedData['users']>[0]> = {}): NonNullable<SeedData['users']> {
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
export function seedSuperAdminRole(overrides: Partial<NonNullable<SeedData['roles']>[0]> = {}): NonNullable<SeedData['roles']> {
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
export function seedPortalClient(overrides: Partial<NonNullable<SeedData['clients']>[0]> = {}): NonNullable<SeedData['clients']> {
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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }];
}

/**
 * 一个**真实可用**的 ES256 密钥对（模块级生成一次，同一测试进程内复用）。
 *
 * ## 为什么必须真实生成，而不能硬编码
 *
 * 此前这里硬编码了一组 JWK，其中私钥 **无法被 jose 导入**
 * （`Invalid keyData`），因此 `seedJwks()` 实际上从来没有支持过真正的签名——
 * 它只是把两个字符串塞进数据库。缺陷长期未被发现，是因为所有需要签发的测试
 * 都 `vi.mock('@/lib/auth/token')` 把签发整个替换掉了：**夹具失效与 mock
 * 恰好互相掩盖**。
 *
 * 用 `generateKeyPairSync` 同步生成，保证：
 * - 私钥可被 `jose` 导入并签发（`seedJwks` 的调用方可以真正走验签路径）；
 * - 公钥与私钥是**同一密钥对**——硬编码时这一点只靠人工保证，现已由密码学保证；
 * - 返回值与 `SeedData` 的同步契约一致，6 个既有调用点无需改签名。
 *
 * 生成一次即缓存：每次调用现生成会让"同一测试里签发再验签"失败。
 */
const fixtureKeyPair = (() => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const priv = privateKey.export({ format: 'jwk' }) as JsonWebKey;
  return {
    privateKey: JSON.stringify(priv),
    // 公钥只取 kty/crv/x/y：jwk 导出的私钥对象含 d，不应写入公钥列
    publicKey: JSON.stringify({ kty: priv.kty, crv: priv.crv, x: priv.x, y: priv.y }),
  };
})();

/**
 * ES256 JWK 密钥对（用于 JWT 签发/验签测试）。
 *
 * 产出的是可用的密钥对——调用方可以真正完成"签发 → 验签"闭环，
 * 无需 mock `@/lib/auth/token`。
 */
export function seedJwks(overrides: Partial<NonNullable<SeedData['jwks']>[0]> = {}): NonNullable<SeedData['jwks']> {
  return [{
    id: crypto.randomUUID(),
    kid: 'test-kid-001',
    algorithm: 'ES256',
    publicKey: fixtureKeyPair.publicKey,
    privateKey: fixtureKeyPair.privateKey,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 90 * 24 * 3600 * 1000),
    ...overrides,
  }];
}

/** 用户-角色绑定 */
export function seedUserRoleBinding(
  userId: string,
  roleId: string,
): NonNullable<SeedData['userRoles']> {
  return [{ userId, roleId, createdAt: now }];
}

/** 通用测试权限（API 类型） */
export function seedTestPermission(overrides: Partial<NonNullable<SeedData['permissions']>[0]> = {}): NonNullable<SeedData['permissions']> {
  return [{
    id: '00000000-0000-4000-8000-000000000401',
    code: 'TEST_PERM',
    name: 'Test Permission',
    type: 'API',
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
