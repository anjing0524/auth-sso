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
  createTestMenu,
  createTestClient,
  createTestSession,
  createTestPermissionContext,
} from './test-fixtures';
export {
  createTestRequest,
  createAuthenticatedRequest,
  parseResponseJson,
} from './test-utils';
