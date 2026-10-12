/**
 * Portal 测试辅助工具统一导出
 *
 * 注意：需要真实签发/验签的种子 `seedSigningKeys` **有意不在本 barrel 里**。
 * 它在加载期就会触碰 `@/infrastructure/db`，而 barrel 一旦带上这条边，每个
 * barrel 导入者都会继承"模块加载期触碰 DB"的顺序敏感性。请直接从
 * `./seed-signing-keys` 导入。
 */
export { MockRedisStore, createMockRedis } from './mock-redis';
export { createMockWithPermission, createMockCheckPermission } from './mock-auth';
export {
  createHoistedHolders,
  initHoistedHolders,
  DEFAULT_ADMIN_ID,
  type HoistedHolders,
} from './mock-factory';
export {
  createTestUser,
  createTestRole,
  createTestPermission,
  createTestDepartment,
  createTestClient,
  createTestPermissionContext,
} from './test-fixtures';
export {
  createTestRequest,
  createAuthenticatedRequest,
  parseResponseJson,
  createMockFetch,
} from './test-utils';
export { createTestDbHandle, seedTestData, type TestDbHandle, type TestDbHandleOptions, type SeedData } from './test-db';
export {
  seedRootDept,
  seedSubDept,
  seedAdminUser,
  seedTestUser,
  seedPortalClient,
  seedJwks,
  seedSuperAdminRole,
  seedUserRoleBinding,
  seedTestPermission,
} from './seed-fixtures';
