/**
 * IdP 侧 Drizzle ORM DB Mock 工厂
 * 复用 Portal mock-db 的相同实现模式
 * 用于 IdP API 单元测试中隔离 PostgreSQL 依赖
 */
import { createMockDb as _createMockDb } from '../../../portal/__tests__/helpers/mock-db';

/**
 * 创建 Mock DB 实例（IdP 侧）
 * 直接复用 Portal 的 createMockDb 工厂
 */
export function createMockDb(options?: { schema?: Record<string, any> }) {
  return _createMockDb(options);
}
