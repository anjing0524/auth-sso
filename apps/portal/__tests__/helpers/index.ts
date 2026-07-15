/**
 * Portal 测试辅助工具统一导出
 */
export { MockRedisStore, createMockRedis } from './mock-redis';
export { createMockWithPermission, createMockCheckPermission } from './mock-auth';
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
export { createTestDbHandle, seedTestData, type TestDbHandle, type SeedData } from './test-db';
export {
  seedRootDept,
  seedSubDept,
  seedAdminUser,
  seedTestUser,
  seedPortalClient,
  seedJwks,
  seedSuperAdminRole,
  seedUserRoleBinding,
} from './seed-fixtures';
