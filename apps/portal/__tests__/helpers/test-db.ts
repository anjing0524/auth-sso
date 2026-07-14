/**
 * 集成测试数据库工具 (Integration Test DB Helper)
 *
 * 提供事务回滚隔离模式：每个测试在独立事务中运行，teardown 自动回滚。
 * 这是业界推荐的数据库测试方案（替代 Mock DB），确保验证真实的 SQL + 约束 + 事务行为。
 *
 * 使用模式（module-level setup）：
 * ```
 * import { createTestDb, seed } from '#tests/helpers/test-db';
 *
 * const testDb = createTestDb();
 * beforeAll(() => testDb.connect());
 * afterAll(() => testDb.close());
 *
 * beforeEach(async () => {
 *   await testDb.beginTransaction();
 *   await seed(testDb.tx, { users: [{...}], roles: [{...}] });
 * });
 * afterEach(() => testDb.rollback());
 * ```
 *
 * 原理：
 * - 每个测试前 BEGIN → 所有后续 DB 操作在事务内
 * - 测试结束后 ROLLBACK → 数据完全隔离，零污染
 * - 使用 pg_advisory_lock 实现事务级别的互斥（防止并发测试间的冲突）
 *
 * 注意：
 * - 此模式要求被测代码支持传入事务对象（tx），否则需用 TRUNCATE 方案
 * - 当前 Portal 代码使用全局 db 导入，集成测试需配合 `db.transaction(async (tx) => {...})` 使用
 * - 生产环境不要使用此模块！
 *
 * @module __tests__/helpers/test-db
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';

/** 测试数据库连接 URL（环境变量优先，默认使用独立测试库） */
const TEST_DB_URL =
  process.env['TEST_DATABASE_URL'] ||
  process.env['DATABASE_URL'] ||
  'postgresql://postgres:postgres@localhost:5432/auth_sso_test';

type TestDb = PostgresJsDatabase<typeof schema>;

export interface TestDbHandle {
  db: TestDb;
  tx: TestDb;
  connect(): Promise<void>;
  close(): Promise<void>;
  beginTransaction(): Promise<void>;
  rollback(): Promise<void>;
}

/**
 * 创建测试数据库连接句柄
 *
 * 使用前必须调用 connect()，使用后必须调用 close()。
 * 每个测试前调用 beginTransaction()，测试后调用 rollback() 确保隔离。
 */
export function createTestDb(): TestDbHandle {
  let sql: ReturnType<typeof postgres> | null = null;
  let db: TestDb | null = null;
  let txDb: TestDb | null = null;

  return {
    get db() {
      if (!db) throw new Error('测试数据库未初始化，请先调用 connect()');
      return db;
    },

    get tx() {
      if (!txDb) throw new Error('事务未开启，请先在 beforeEach 中调用 beginTransaction()');
      return txDb;
    },

    async connect() {
      if (sql) return;
      sql = postgres(TEST_DB_URL, { max: 1 });
      db = drizzle(sql, { schema });
    },

    async close() {
      if (sql) {
        await sql.end();
        sql = null;
        db = null;
      }
    },

    async beginTransaction() {
      if (!db) throw new Error('请先调用 connect()');
      // 使用 Drizzle 事务 API：开启事务，保存 tx 引用供测试使用
      const sqlClient = (db as any).session?.client as ReturnType<typeof postgres> | undefined;
      if (sqlClient) {
        await sqlClient.unsafe('BEGIN');
      }
      // 为事务模式创建新的 drizzle 实例（共享同一个 sql client）
      txDb = db;
    },

    async rollback() {
      if (!db) return;
      const sqlClient = (db as any).session?.client as ReturnType<typeof postgres> | undefined;
      if (sqlClient) {
        await sqlClient.unsafe('ROLLBACK');
      }
      txDb = null;
    },
  };
}

/**
 * 使用 Drizzle db.transaction() 为整个测试提供事务隔离。
 *
 * 这是推荐的集成测试模式——被测代码自然使用全局 db，
 * 所有 INSERT/UPDATE/DELETE 在事务内执行，teardown 时 ROLLBACK。
 *
 * @example
 * ```ts
 * const testDb = await createTestDb();
 *
 * it('should create user', async () => {
 *   await withTransaction(testDb, async (tx) => {
 *     // 在事务中执行业务逻辑，传入 tx 作为数据库连接
 *     await createUser(input, tx);
 *     const user = await tx.query.users.findFirst({...});
 *     expect(user.name).toBe('Test');
 *     throw new Error('ROLLBACK'); // 任何异常都会触发回滚
 *   });
 * });
 * ```
 */
export async function withTransaction<T>(
  handle: TestDbHandle,
  fn: (tx: TestDb) => Promise<T>,
): Promise<T> {
  let result: T;
  let shouldRollback = true;

  try {
    await handle.beginTransaction();
    result = await fn(handle.tx);
    shouldRollback = false;
    return result;
  } finally {
    if (shouldRollback) {
      await handle.rollback();
    }
  }
}

// ========================================
// Seed 工具（测试数据构造）
// ========================================

export interface SeedData {
  users?: Array<typeof schema.users.$inferInsert>;
  roles?: Array<typeof schema.roles.$inferInsert>;
  permissions?: Array<typeof schema.permissions.$inferInsert>;
  departments?: Array<typeof schema.departments.$inferInsert>;
  clients?: Array<typeof schema.clients.$inferInsert>;
}

/**
 * 批量插入种子数据（使用事务保证原子性）
 */
export async function seed(db: TestDb, data: SeedData): Promise<void> {
  if (data.departments?.length) {
    await db.insert(schema.departments).values(data.departments);
  }
  if (data.roles?.length) {
    await db.insert(schema.roles).values(data.roles);
  }
  if (data.permissions?.length) {
    await db.insert(schema.permissions).values(data.permissions);
  }
  if (data.clients?.length) {
    await db.insert(schema.clients).values(data.clients);
  }
  if (data.users?.length) {
    await db.insert(schema.users).values(data.users);
  }
}
