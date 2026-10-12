/**
 * Portal 测试辅助工具统一导出（#55 收敛后）
 *
 * 只导出**在用**的 helper：判据与测试替身一致——「它替谁服务？」
 * 本目录原有 5 组真实采用者为 0 的 adapter（`mock-redis`/`mock-auth`/`mock-factory`）
 * 与 6 个零采用者 fixture 导出，已在 #55 删除；`mock-contract.test.ts`（守着一个
 * 0 采用者工厂的失效守卫）一并删除。
 *
 * 注意：需要真实签发/验签的种子 `seedSigningKeys` **有意不在本 barrel 里**。
 * 它在加载期就会请求 `@/infrastructure/db`，而 barrel 一旦带上这条边，每个
 * barrel 导入者都会继承"模块加载期触碰 DB"的顺序敏感性。请直接从
 * `./seed-signing-keys` 导入。
 */
export {
  createTestRequest,
  parseResponseJson,
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
